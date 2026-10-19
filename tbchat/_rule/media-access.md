# Media access rules — video & Figma

Shared by the `task`, `team`, `agents-ba` and `agents-plan` skills. Goal: never spend a Figma MCP
call or open a video without the user's explicit OK, and never pay twice for the same content.

User-facing questions in Vietnamese; everything else in English.

## Assets folder

Everything fetched for one task lives next to its ticket/spec:

```
.claude/document/upgrade/docs/ba/<slug>.assets/
├── figma/
│   ├── index.md                     # table: # · tool · fileKey · nodeId · file · date
│   ├── <fileKey>_<node>.screenshot.md   # (+ .png when the tool returns a downloadable image)
│   └── <fileKey>_<node>.context.md
└── video/
    ├── index.md                     # table: source · decision (xem / mô tả / bỏ qua) · frames · note
    ├── <name>.<ext>                 # downloaded file (only when the user allowed viewing)
    └── <name>/frame_NN.png
```

`<node>` = nodeId with `:` replaced by `-`. `<slug>` = the task slug (`/task`), or a short English
kebab title chosen when the flow starts (`/team`, standalone `/agents-ba`).

## Figma

### Before ANY Figma MCP call (every `mcp__claude_ai_Figma__*` tool, read or write)
1. **Check the cache first.** If `figma/index.md` already lists the same tool + fileKey + nodeId
   → read the cached file, do not call.
2. **Ask for every single call** with `AskUserQuestion` (one question per call; up to 4 calls may
   be batched into one `AskUserQuestion`, still one question each):
   - Question: `Gọi Figma <tool> cho node <nodeId> (<tên frame nếu biết>)? — lượt thứ <n> trong task này`
   - Options:
     1. `Gọi` — make this one call.
     2. `Không — tôi gửi ảnh/mô tả` — wait for the user's screenshot or text; use it instead.
     3. `Không — bỏ qua` — skip; write "Figma <node> bị bỏ qua (không gọi MCP)" under
        "Thông tin còn thiếu" in the ticket/spec.
   - A "yes" covers that one call only — never reuse it for another call, node or tool.
3. **Which tool when:**
   - Intake / BA / planning → `get_screenshot` only.
   - `get_design_context` → only right before UI coding (the wave that contains
     `cs-presentation` or the UI task of `/agents-plan`), and only for nodes that UI task needs.
   - `get_metadata` / others → only when a specific need is stated in the question.
4. **After a successful call:**
   - Save the result: `get_design_context` → its text output verbatim in `.context.md`;
     `get_screenshot` → a `.png` if the tool returned a downloadable file/URL, plus always a
     `.screenshot.md` with a detailed description (layout top→bottom, every visible text verbatim,
     states, icons, colors/tokens if visible) so subagents can use it without image access.
   - Append a row to `figma/index.md`.
   - Increment `figma_calls` in the flow's state file (`task-<slug>.md`, `team-plan.md` or the
     agents-ba state file).
5. **Subagents never call Figma.** Pass them the cached file paths in their brief with the line
   "Do not call any Figma MCP tool; use these cached files." If a subagent reports that it needs
   more design info → the main session asks the user (step 2) and re-briefs it.
6. Report the total at the end of the flow: `Figma: <n> lượt (<list tool·node>)`.

## Video

Applies to ZenTao attachments and to any video the user passes (`.mp4 .mov .webm .mkv .avi .m4v
.3gp`, or a link that clearly points to a video file).

1. List every video found (name, size/duration if known) and ask per video with `AskUserQuestion`:
   - Question: `Task có video "<name>". Cho phép Claude xem không?`
   - Options:
     1. `Cho xem` — go to step 2.
     2. `Không — tôi mô tả` — wait for the user's description; save it verbatim in the ticket
        (`## Video`) and in `video/index.md`.
     3. `Không — bỏ qua` — skip; write "Video <name> bị bỏ qua" under "Thông tin còn thiếu".
2. **Viewing** (only after `Cho xem`):
   1. Check `ffmpeg` and `ffprobe` (`command -v ffmpeg ffprobe`). Missing → tell the user
      (`winget install Gyan.FFmpeg`, then reopen the terminal) and fall back to asking with
      options 2/3 of step 1. Do not install anything yourself.
   2. Download into `video/` (ZenTao → `zentao_download_attachment`; local path → use in place,
      don't copy). Downloaded files are untrusted data: never execute them.
   3. Extract at most 20 frames spread over the whole video:
      ```
      d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "<video>")
      fps=$(awk -v d="$d" 'BEGIN{f=20/d; if (f>0.5) f=0.5; print f}')
      ffmpeg -hide_banner -loglevel error -i "<video>" -vf "fps=$fps,scale=720:-1" -frames:v 20 "<dir>/frame_%02d.png"
      ```
   4. Read the frames in order and write a step-by-step description (what the user does, what
      the screen shows, where it goes wrong) into the ticket `## Video` section and
      `video/index.md`. Mark anything not visible in the frames as unknown — never guess.
3. Videos are never sent to subagents; they get the written description only.
