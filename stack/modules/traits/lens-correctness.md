---
id: lens-correctness
kind: trait
version: 0.1.0
kernel: ^0.3
description: Review focus on whether the code does what it claims for every input it can receive.
applies_to: [verifier]
slot: lens
tags: [core, lens]
---
## Focus: correctness

Concentrate on whether the code does what it claims, for every input it can receive:

- Logic: conditions, off-by-one, wrong operator or variable, inverted checks, unreachable branches.
- Edge cases: empty, absent or null, zero, negative, very large, duplicates, unicode, time zones and dates.
- Errors: failures swallowed, the wrong error surfaced, partial updates left behind, resources not released.
- State and concurrency: stale or shared state, ordering assumptions, races, re-entrancy, caches that are never invalidated.
- Contracts: callers relying on behaviour that changed; types or nullability that lie.

Leave security and style to other reviewers unless an issue is critical.
