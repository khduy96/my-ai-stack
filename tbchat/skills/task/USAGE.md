# task — Hướng dẫn sử dụng

Quy trình **tự động từ lúc nhận task đến khi code analyze sạch**. Task có thể đến từ bất kỳ
nguồn nào; ZenTao là tuỳ chọn. Skill nối các skill có sẵn: `/agents-ba` → `/agents-plan` →
code theo wave → `/l10n add` · `/build` · `/analyze-cloud`. **Không bao giờ tự commit.**

## Luồng

```
/task <input...>
 ├─ 0. Intake    : đọc mọi nguồn → .claude/document/upgrade/docs/ba/<slug>.ticket.md   (-n: dừng ở đây)
 ├─ 1. BA        : /agents-ba → trả lời câu hỏi → "chốt"      (-skip-ba: bỏ qua)
 │                 → .claude/document/upgrade/docs/ba/<slug>.md
 ├─ 2. Plan      : /agents-plan → bảng phân việc → "code đi"
 ├─ 3. Code      : chạy wave song song → l10n → build → analyze
 └─ 4. Báo cáo   : file đã đổi, TODO, gợi ý commit, tóm tắt gửi người giao task
                   (ZenTao: hỏi bạn trước khi post comment / đổi trạng thái)
```

Chỉ có 2 điểm bạn phải lên tiếng: **"chốt"** và **"code đi"**.

## Ví dụ

```
/task zt#1234
/task bug#567 -skip-ba
/task https://zentao.xxx/zentao/task-view-1234.html  https://figma.com/design/...
/task thêm nút gia hạn gói khi còn 3 ngày hết hạn  D:\spec\renew.pdf
/task docs/spec/share_folder.md -n
/task                      ← không input: liệt kê task ZenTao giao cho bạn (nếu có MCP)
```

Có thể trộn nhiều nguồn trong một lệnh. Ảnh dán thẳng vào chat cũng được.

## Nguồn hỗ trợ

| Nguồn | Cách đọc |
|---|---|
| ZenTao (`zt#`, `task#`, `bug#`, link) | ZenTao MCP — tuỳ chọn, chưa cài thì skill nhờ bạn dán nội dung |
| Figma link | Figma MCP — hỏi trước từng lượt, có cache (xem dưới) |
| Video (`.mp4` `.mov` `.webm`…, hoặc đính kèm ZenTao) | Hỏi trước → cắt khung hình / bạn mô tả / bỏ qua |
| Ảnh | đọc trực tiếp |
| `.md` `.txt` `.pdf` `.docx` | đọc file |
| Link claude.ai artifact / doc | Artifact / Docs tool |
| URL khác | WebFetch (chỉ trang public) |
| Text tự do | giữ nguyên làm mô tả |

Thêm nguồn mới (Jira, Notion…) chỉ cần thêm 1 dòng adapter ở Stage 0 trong `SKILL.md`.

## Figma & video (tiết kiệm lượt MCP)

Rule chung: [.claude/_rule/media-access.md](../../_rule/media-access.md) (dùng chung cho `/task`,
`/team`, `/agents-ba`, `/agents-plan`).

**Figma — hỏi trước từng lượt gọi:**
- Mỗi lần sắp gọi Figma MCP, Claude hỏi: *"Gọi Figma get_screenshot cho node 12:34? — lượt thứ 3"*
  → `Gọi` / `Không — tôi gửi ảnh/mô tả` / `Không — bỏ qua`. Đồng ý một lượt không có nghĩa là
  đồng ý cho lượt sau.
- Intake và BA chỉ gọi `get_screenshot`. `get_design_context` chỉ gọi ngay trước khi code UI, và
  cũng hỏi trước.
- Kết quả được cache trong `.claude/document/upgrade/docs/ba/<slug>.assets/figma/`. Node đã có
  trong cache thì không gọi lại. Subagent chỉ đọc cache, không gọi MCP.
- Số lượt đã dùng được ghi trong file trạng thái và in ở báo cáo cuối.

**Video (ZenTao đính kèm hoặc file video bạn đưa):**
- Claude hỏi từng video: `Cho xem` / `Không — tôi mô tả` / `Không — bỏ qua`.
- `Cho xem`: tải video về, dùng `ffmpeg` cắt tối đa 20 khung hình rải đều cả video rồi đọc và mô
  tả lại. Máy chưa có ffmpeg thì Claude báo (`winget install Gyan.FFmpeg`) và hỏi bạn mô tả thay.
- `Không — tôi mô tả`: dán mô tả, Claude ghi nguyên văn vào ticket.
- `Không — bỏ qua`: video được ghi vào mục "Thông tin còn thiếu".

## Flag

| Flag | Tác dụng |
|---|---|
| `-n` | Chỉ intake: tạo ticket file + tóm tắt, không chạy BA |
| `-skip-ba` | Task nhỏ/rõ (bug fix, chỉnh 1 màn) → vào thẳng `/agents-plan` |

## File sinh ra

| File | Nội dung |
|---|---|
| `.claude/document/upgrade/docs/ba/<slug>.ticket.md` | Nội dung task gốc đã chuẩn hoá (nguồn, mô tả, ảnh, video, comment, chỗ thiếu) |
| `.claude/document/upgrade/docs/ba/<slug>.assets/` | Cache Figma (`figma/`) và video + khung hình (`video/`) |
| `.claude/document/upgrade/docs/ba/<slug>.md` | Spec đã chốt (từ `/agents-ba`) |
| scratchpad `task-<slug>.md` | Trạng thái pipeline (để chạy tiếp sau khi hội thoại bị nén) |
| scratchpad `agent-plan.md` | Bảng phân việc (từ `/agents-plan`) |

`<slug>` = `zt-<id>-<tên-ngắn>` với ZenTao, còn lại là `<tên-ngắn>`.

## Skill KHÔNG làm

- Commit, push, tạo/chuyển branch, tạo MR (chỉ gợi ý tên branch + commit message).
- Tự ghi lên ZenTao — luôn hỏi trước.
- Sửa `lib/features/socialfi`.

## Cài ZenTao MCP (tuỳ chọn)

1. `~/.npmrc` (GitHub token có quyền `read:packages`):
   ```
   @dyno-nexsoft:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=<GITHUB_TOKEN>
   ```
2. Đăng ký với Claude Code (scope user — credential không vào repo). Trên Windows phải chạy
   `npx` qua `cmd /c`.
   - **PowerShell** — phải quote `'--'`, nếu không PowerShell nuốt mất `--` và báo
     `error: unknown option '-y'`:
     ```
     claude mcp add zentao -s user -e ZENTAO_BASE_URL=https://<host>/zentao/api.php/v1 -e ZENTAO_ACCOUNT=<user> -e ZENTAO_PASSWORD=<pass> '--' cmd /c npx -y @dyno-nexsoft/zentao_mcp
     ```
   - **Git Bash / cmd**:
     ```
     claude mcp add zentao -s user -e ZENTAO_BASE_URL=https://<host>/zentao/api.php/v1 -e ZENTAO_ACCOUNT=<user> -e ZENTAO_PASSWORD=<pass> -- cmd /c npx -y @dyno-nexsoft/zentao_mcp
     ```
   Mật khẩu có ký tự đặc biệt (`$ & ! "` …) → bọc trong nháy đơn: `-e 'ZENTAO_PASSWORD=...'`.
3. Mở session mới, gõ `/mcp` kiểm tra `zentao` đã connected.

Nguồn: https://github.com/dyno-nexsoft/zentao_mcp
