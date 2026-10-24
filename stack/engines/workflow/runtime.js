// ---- ai-stack workflow runtime --------------------------------------------------
// Appended by `stack build` after FLOW, AGENTS, HANDOFF, CONTRACTS and REPORT. It runs a
// flow deterministically with the Workflow hooks (agent, parallel, phase, log, args).
// No file system here: inputs travel in memory, handoffs come back through `schema`.
//
// args: a string (the flow input) or
//   { input, approved: [step ids], answers: { <step id>: <text> } }
// A step that needs a human (gate human, questions, partial/blocked, loop limit) ends the
// run with status "waiting". Run again with the same input plus approved/answers and
// resumeFromRunId: finished agents are reused from the cache.

const INPUT = typeof args === 'string' ? args : (args && args.input) || ''
const APPROVED = new Set((args && Array.isArray(args.approved) && args.approved) || [])
const ANSWERS = (args && args.answers) || {}
const SEVERE = ['critical', 'major']
const results = {}
const LAST = {}
const LOOP_OF = {}
const BODY_INDEX = {}
for (const s of FLOW.steps) {
  if (s.loop) s.loop.steps.forEach((b, i) => { LOOP_OF[b.id] = s.id; BODY_INDEX[b.id] = i })
}

const list = (r) => (Array.isArray(r) ? r : r ? [r] : []).filter(Boolean)

function lookup(stepId, ctx) {
  const loop = LOOP_OF[stepId]
  if (!loop) return results[stepId]
  if (ctx.loop === loop) return results[`${stepId}#${BODY_INDEX[stepId] < ctx.bodyIndex ? ctx.n : ctx.n - 1}`]
  return results[`${stepId}#${LAST[loop]}`]
}

function resolveRef(ref, ctx) {
  if (ref === '$input') return INPUT
  const m = /^\$([a-z][a-z0-9-]*)(?:\.(.+))?$/.exec(ref)
  if (!m) return undefined
  const found = lookup(m[1], ctx)
  if (found === undefined) return undefined
  const get = (h) => (m[2] ? m[2].split('.').reduce((o, k) => (o == null ? undefined : o[k]), h) : h)
  if (!Array.isArray(found)) return get(found)
  const values = found.filter(Boolean).map(get).filter((v) => v !== undefined)
  return values.every(Array.isArray) ? values.flat() : values
}

// A list of references means "the most recent that exists".
function resolveInput(value, ctx) {
  if (Array.isArray(value)) {
    for (const ref of value) {
      const v = resolveRef(ref, ctx)
      if (v !== undefined) return v
    }
    return undefined
  }
  return typeof value === 'string' && value.startsWith('$') ? resolveRef(value, ctx) : value
}

function holds(cond, ctx) {
  const findings = list(resolveRef(`$${cond.step}.findings`, ctx))
  const questions = list(resolveRef(`$${cond.step}.questions`, ctx))
  const major = findings.some((f) => SEVERE.includes(f.severity))
  return {
    'has-findings': findings.length > 0,
    'has-major-findings': major,
    'no-findings': findings.length === 0,
    'no-major-findings': !major,
    'has-questions': questions.length > 0,
  }[cond.is]
}

function schemaFor(agentId, external, isolated) {
  const schema = JSON.parse(JSON.stringify(HANDOFF))
  const produces = !external && AGENTS[agentId] && AGENTS[agentId].produces
  if (produces && CONTRACTS[produces]) schema.properties.output = CONTRACTS[produces]
  if (isolated) {
    schema.properties.worktree = { type: 'string', description: 'Absolute path of the git worktree you worked in.' }
    schema.required = [...schema.required, 'worktree']
  }
  return schema
}

function taskPrompt(step, inputs, item, isolated) {
  const task = { id: step.id, goal: step.goal, inputs }
  if (item !== undefined) task.inputs.item = item
  const lines = [
    `You are one step of the ai-stack flow "${FLOW.id}", run by its workflow engine.`,
    'Your task, with every input given inline:',
    '```json',
    JSON.stringify({ task }, null, 2),
    '```',
    'Return your handoff through the structured output tool, with the same fields your instructions describe for the handoff block (and `output` when your role produces one), instead of writing a YAML block.',
  ]
  if (isolated) lines.push('You work in your own git worktree. Do not commit. Put the absolute path of that worktree (`git rev-parse --show-toplevel`) in `worktree`.')
  if (ANSWERS[step.id]) lines.push(`Answers from the user to the questions of an earlier attempt: ${ANSWERS[step.id]}`)
  return lines.join('\n')
}

async function runAgent(step, agentId, inputs, item, label, isolated) {
  const type = step.external ? agentId : AGENTS[agentId].type
  const opts = { agentType: type, schema: schemaFor(agentId, step.external, isolated), label, phase: step.id }
  if (isolated) opts.isolation = 'worktree'
  const h = await agent(taskPrompt(step, JSON.parse(JSON.stringify(inputs)), item, isolated), opts)
  return h || { status: 'failed', summary: `${label} returned nothing` }
}

// Ready items run in parallel unless their files overlap: those go to later batches.
function batchesByFiles(items) {
  const batches = []
  for (const p of items) {
    const files = new Set((p.item && p.item.files) || [])
    const batch = batches.find((b) => b.every((q) => !((q.item && q.item.files) || []).some((f) => files.has(f))))
    if (batch) batch.push(p)
    else batches.push([p])
  }
  return batches
}

async function runForeach(step, inputs, ctx) {
  const items = list(resolveRef(step.foreach, ctx))
  const keyOf = (it, i) => (it && it.id) || String(i)
  // Worktrees branch from the last commit, so they only work for items that depend on nothing.
  const isolated = step.isolation === 'worktree' && items.every((it) => !(it.depends_on && it.depends_on.length))
  if (step.isolation === 'worktree' && !isolated) log(`${step.id}: items depend on each other, so they run without worktrees`)
  const status = new Map()
  const out = []
  let pending = items.map((item, i) => ({ item, i, key: keyOf(item, i) }))
  while (pending.length) {
    const ready = pending.filter((p) => ((p.item && p.item.depends_on) || []).every((d) => status.get(d) === 'done'))
    if (!ready.length) {
      log(`${step.id}: not started because a dependency did not finish: ${pending.map((p) => p.key).join(', ')}`)
      break
    }
    for (const batch of isolated ? [ready] : batchesByFiles(ready)) {
      const res = await parallel(batch.map((p) => () => runAgent(step, step.agent, inputs, p.item, `${step.id}:${p.key}`, isolated)))
      batch.forEach((p, j) => {
        out[p.i] = res[j] || { status: 'failed', summary: `${p.key} returned nothing` }
        status.set(p.key, out[p.i].status)
      })
    }
    pending = pending.filter((p) => !status.has(p.key))
  }
  const handoffs = out.filter(Boolean)
  if (isolated) {
    const trees = handoffs.map((h) => h.worktree).filter(Boolean)
    if (trees.length) {
      const merge = await agent(
        [
          `Apply the changes of these git worktrees to the main working tree, one after another: ${JSON.stringify(trees)}.`,
          'For each: `git -C <worktree> add -N .` then `git -C <worktree> diff HEAD > <tmp patch>` and `git apply --3way <tmp patch>` in the main tree; then `git worktree remove --force <worktree>`.',
          'Do not commit. Stop at the first conflict and report it as a critical finding naming the files.',
          'Return a handoff: status done when every worktree applied cleanly, failed otherwise.',
        ].join('\n'),
        { agentType: AGENTS[step.agent].type, schema: schemaFor(step.agent, false, false), label: `${step.id}:merge`, phase: step.id },
      )
      handoffs.push(merge || { status: 'failed', summary: 'merging the worktrees returned nothing' })
    }
  }
  return handoffs
}

function gate(step, key, result) {
  const handoffs = list(result)
  const statuses = handoffs.map((h) => h.status)
  const questions = handoffs.flatMap((h) => h.questions || [])
  if (statuses.includes('failed')) return { status: 'failed', step: key }
  if (statuses.some((s) => s === 'partial' || s === 'blocked')) return { status: 'waiting', step: key, questions }
  if (step.gate === 'on-questions' && questions.length && !ANSWERS[step.id]) return { status: 'waiting', step: key, questions }
  if (step.gate === 'human' && !APPROVED.has(step.id)) return { status: 'waiting', step: key, approve: step.id }
  return null
}

async function runStep(step, ctx) {
  const key = ctx.loop ? `${step.id}#${ctx.n}` : step.id
  if (step.when && !holds(step.when, ctx)) {
    log(`${key}: skipped (condition not met)`)
    return null
  }
  if (!ctx.loop) phase(step.id)
  const inputs = {}
  for (const [name, value] of Object.entries(step.in || {})) {
    const v = resolveInput(value, ctx)
    if (v !== undefined) inputs[name] = v
  }
  let result
  if (step.fanout) result = await parallel(step.fanout.map((a) => () => runAgent(step, a, inputs, undefined, `${key}:${a}`, false)))
  else if (step.foreach) result = await runForeach(step, inputs, ctx)
  else result = await runAgent(step, step.agent, inputs, undefined, key, false)
  results[key] = Array.isArray(result) ? result.map((r) => r || { status: 'failed', summary: 'returned nothing' }) : result
  return gate(step, key, results[key])
}

async function runLoop(step) {
  if (step.when && !holds(step.when, {})) {
    log(`${step.id}: skipped (condition not met)`)
    return null
  }
  phase(step.id)
  const { max, until, steps } = step.loop
  for (let n = 1; n <= max; n++) {
    LAST[step.id] = n
    for (let i = 0; i < steps.length; i++) {
      const stop = await runStep(steps[i], { loop: step.id, n, bodyIndex: i })
      if (stop) return stop
    }
    if (holds(until, { loop: step.id, n, bodyIndex: steps.length })) return null
    log(`${step.id}: iteration ${n} did not meet the stop condition`)
  }
  if (APPROVED.has(step.id)) return null
  return { status: 'waiting', step: step.id, approve: step.id, reason: `still open after ${max} iteration(s)` }
}

let stop = null
for (const step of FLOW.steps) {
  stop = step.loop ? await runLoop(step) : await runStep(step, {})
  if (stop) break
}
const outcome = stop || { status: 'done' }
return {
  flow: FLOW.id,
  ...outcome,
  results,
  report: REPORT,
  ...(outcome.status === 'waiting'
    ? { resume: 'Answer or approve, then run this workflow again with the same input, args.approved / args.answers, and resumeFromRunId: finished agents are reused.' }
    : {}),
}
