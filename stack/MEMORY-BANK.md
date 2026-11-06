# Memory bank: cách dùng và duy trì

Áp dụng cho stack 1.2. Dự án phải đã được tích hợp (xem [INTEGRATE.md](INTEGRATE.md)).

Memory bank là **6 file cố định** mô tả dự án là gì, đang ở đâu và vì sao được làm như vậy. Mỗi phiên làm việc mới đọc nó trước tiên, nên không phải giải thích lại dự án từ đầu, và agent không đề xuất lại một hướng đã bị loại.

| Lệnh | Việc | Ai làm |
|---|---|---|
| `/ai-memory-init [mô tả]` | Tạo memory bank cho dự án mới (từ mô tả) hoặc dự án có sẵn (khảo sát repo và git) | `ai-archivist` |
| `/ai-memory-update [run \| ghi chú]` | Làm mới memory bank sau một thay đổi đáng kể | `ai-archivist` |

---

## 1. Bật memory bank

Khai trong `.claude/project.yaml`, rồi build lại:

```yaml
memory_bank: memory-bank
```

```bash
node <stack>/kernel/cli/stack.mjs build --project .
```

Từ đó mọi agent `ai-*` được dặn:
- đọc `projectbrief.md` và `activeContext.md` trước khi làm việc;
- đọc 4 file còn lại khi task chạm tới;
- tin code và git khi memory bank lạc hậu, và nói ra chỗ lệch.

Chỉ `ai-archivist` được ghi vào thư mục này. Nếu dự án bật `scope`, thư mục memory bank vẫn luôn được phép ghi.

Dự án đã có sẵn thư mục memory bank (ví dụ viết tay từ trước)? Chỉ cần trỏ `memory_bank:` vào đúng thư mục đó, rồi dùng `/ai-memory-update`.

## 2. Sáu file

| File | Chứa | Agent đọc khi | Cập nhật khi |
|---|---|---|---|
| `projectbrief.md` | Dự án là gì, cho ai, phạm vi được sửa và không được sửa, mục tiêu, ràng buộc, thuật ngữ, trỏ tới tài liệu có sẵn | luôn luôn | hiếm khi |
| `activeContext.md` | `Last updated`, branch, đang làm gì, thay đổi gần đây (kèm commit hoặc ticket), bước tiếp, cạm bẫy | luôn luôn | mỗi lần update |
| `systemPatterns.md` | Cấu trúc repo, layer, module, pattern phải theo và lý do, luồng dữ liệu, vùng không được đụng | hỏi về kiến trúc, thêm module | cấu trúc đổi |
| `techContext.md` | Stack và phiên bản, lệnh build/test/lint/codegen/run, biến môi trường (**chỉ tên**), git hook, công cụ | build, dependency, môi trường | stack hoặc lệnh đổi |
| `decisions.md` | Mỗi quyết định một mục `## D<n> — <tiêu đề>`: ngày, bối cảnh, quyết định, phương án đã loại, bằng chứng, trạng thái | trước khi đề xuất một hướng khác | có quyết định kiến trúc |
| `progress.md` | Đã xong (có ngày), đang làm, còn lại (kể cả TODO trong code, nhóm theo việc đang chờ), nợ kỹ thuật | lên kế hoạch, hỏi tiến độ | mỗi lần update |

Quy tắc chung:
- Mỗi file dưới 150 dòng. Dài hơn thì cắt phần cũ hoặc phần code đã thể hiện, không bao giờ cắt quyết định còn hiệu lực.
- Mỗi điều có nguồn (`path`, `path:line`, commit, ticket). Điều chưa xác nhận được đánh dấu `[?]`.
- Không ghi điều code, manifest hay `git log` đã nói rõ. Không bao giờ ghi giá trị secret, chỉ ghi tên biến.
- Viết bằng tiếng Anh (dành cho agent). Muốn ngôn ngữ khác thì nói trong `context` của `project.yaml`.

Ví dụ `decisions.md`:

```markdown
## D2 — Additive bridges, no refactor of stable code
- Date: 2026-09-28
- Context: refactoring shared share-link code was rolled back by the user.
- Decision: new capability = new bridge interface + new impl files; existing files only get additive lines.
- Rejected: changing `CloudShareTransponder.searchSharedFolder`.
- Status: active.
```

## 3. Tạo memory bank với `/ai-memory-init`

Archivist tự xác định dự án mới hay có sẵn bằng cách nhìn repo (có source code và lịch sử git chưa), không chỉ dựa vào lời bạn nói.

### 3.1. Dự án mới (chưa có code)

Mô tả dự án ngay trong lệnh, càng rõ càng tốt: dự án là gì, cho ai, mục tiêu, stack dự kiến, các lựa chọn đã chốt.

```
/ai-memory-init App đặt lịch cắt tóc cho chuỗi salon nhỏ. Khách đặt qua app Flutter, chủ tiệm quản lý trên web Next.js, backend Supabase. Mục tiêu: ra MVP trong 6 tuần. Đã chốt: không làm thanh toán online ở MVP.
```

Archivist sẽ:
- viết đầy đủ `projectbrief.md` từ mô tả;
- ghi stack và cấu trúc dự kiến vào mục `Planned` trong `techContext.md` và `systemPatterns.md`, đánh dấu `[?]` cho tới khi có code;
- ghi các lựa chọn đã chốt vào `decisions.md`, kèm lý do;
- ghi các bước đầu tiên vào `activeContext.md`, còn `progress.md` chủ yếu là việc cần làm;
- hỏi lại khi thiếu điều cốt lõi (mục đích, người dùng, stack). Flow dừng chờ bạn trả lời rồi viết tiếp.

Khi đã có code, chạy `/ai-memory-update` để thay phần `Planned [?]` bằng thực tế.

### 3.2. Dự án có sẵn

```
/ai-memory-init
/ai-memory-init chỉ tập trung vào lib/features/cloud_storage và lib/module_bridge, phần còn lại thuộc team khác
```

Archivist khảo sát và **chỉ đọc**:
- `README*`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, thư mục docs/ADR, rule của công cụ AI khác (như `.cursor/rules/`). Nó trỏ tới các tài liệu này thay vì chép lại.
- Manifest, lock file, `Makefile` hay script, CI, `.env*.example` (chỉ tên biến), `.gitmodules`.
- Hai tầng đầu của cây thư mục, và một hai file tiêu biểu mỗi layer để học pattern.
- `git branch`, `git status`, `git log` gần đây (cả trong submodule mà công việc chạm tới).
- TODO, FIXME: đếm và nhóm lại, không liệt kê hết.

Sau đó nó viết đủ 6 file. Điều suy ra từ commit message mà chưa ai xác nhận (ví dụ "đang tập trung vào…") được đánh dấu `[?]`. Nếu bạn nêu vùng phụ trách, hoặc `project.yaml` có `scope`, memory bank xoay quanh vùng đó, phần còn lại chỉ ghi là bối cảnh.

### 3.3. Sau khi tạo

- **Nối vào CLAUDE.md.** Nếu `CLAUDE.md` chưa nhắc tới memory bank, flow đề nghị thêm khối dưới đây và chỉ thêm khi bạn đồng ý. Khối này để cả phiên Claude thường (không qua agent `ai-*`) cũng nạp memory bank:

  ```markdown
  # Memory Bank
  Always loaded:
  - @memory-bank/projectbrief.md
  - @memory-bank/activeContext.md

  Read on demand (only when the task touches it):
  - `memory-bank/systemPatterns.md`: architecture, patterns, module boundaries
  - `memory-bank/techContext.md`: stack, commands, build and environment
  - `memory-bank/decisions.md`: before proposing an alternative approach
  - `memory-bank/progress.md`: planning, status questions

  After a significant change, run the memory-update command. Never record what the
  code already shows. Trust the code when the memory bank disagrees with it.
  ```

- **Dùng chung hay riêng:** flow hỏi bạn (xem mục 6).
- **Xác nhận `[?]`:** báo cáo liệt kê các điểm `[?]`. Trả lời bằng `/ai-memory-update <câu trả lời>`.
- **Đã có memory bank rồi?** `/ai-memory-init` không ghi đè mà tự chuyển sang cập nhật.

## 4. Cập nhật với `/ai-memory-update`

```
/ai-memory-update                                              # đọc git từ lần cập nhật trước
/ai-memory-update .ai-runs/20261106-1430-feature-favorite-search # học thêm từ một lần chạy
/ai-memory-update quyết định: chỉ có gói MONTH và YEAR, không có DAY
/ai-memory-update đang chuyển sang làm màn thanh toán, bug #13958 đã chờ MR
```

Archivist sẽ:
1. Đọc 6 file, tìm ngày `Last updated` trong `activeContext.md`.
2. Lấy thay đổi từ ngày đó: `git status`, `git diff --stat`, `git log` (cả submodule), cùng thư mục run hoặc ghi chú bạn đưa.
3. **`activeContext.md`:** đổi ngày, cập nhật đang làm gì, thay đổi gần đây (giữ khoảng 10 mục mới nhất), bước tiếp, cạm bẫy còn đúng.
4. **`progress.md`:** chuyển việc xong sang Done kèm ngày, làm mới đang làm và còn lại, làm mới danh sách TODO nếu đổi.
5. **`decisions.md`:** chỉ thêm khi có lựa chọn kiến trúc hoặc sản phẩm. Quyết định bị thay thì đánh dấu `superseded by D<m>`, không xóa.
6. **3 file còn lại:** chỉ đụng tới khi cấu trúc, stack, lệnh, phạm vi hay mục tiêu thực sự đổi.
7. Xóa điều mà bằng chứng mới cho thấy đã sai hoặc lỗi thời.

Cuối cùng nó cho bạn xem diff (`git diff -- memory-bank` khi thư mục được track, nếu không thì phần trước và sau khi sửa). Không bao giờ stage hay commit.

## 5. Duy trì

Memory bank chỉ có ích khi `activeContext.md` còn mới. Bản cũ một tuần có thể dẫn agent đi sai hướng.

### 5.1. Nhịp đề xuất

| Khi nào | Làm gì |
|---|---|
| Xong một task, một bugfix, hoặc cuối ngày làm việc | `/ai-memory-update` |
| Sau một flow `/ai-feature` hay `/ai-bugfix` | `/ai-memory-update <thư mục run>` |
| Vừa chốt một quyết định (với PM, backend, team khác) | `/ai-memory-update quyết định: …` |
| Đổi branch, chuyển sang việc khác | `/ai-memory-update đang chuyển sang …` |
| Thêm dependency, đổi lệnh build, đổi cấu trúc | `/ai-memory-update`. Archivist tự cập nhật `techContext` và `systemPatterns` |
| Bắt đầu phiên mới sau vài ngày nghỉ | Đọc `activeContext.md`. Thấy lệch thì `/ai-memory-update` trước khi làm |
| Dự án mới bắt đầu có code | `/ai-memory-update` để thay phần `Planned [?]` |

### 5.2. Dấu hiệu cần cập nhật

- `Last updated` trong `activeContext.md` cũ hơn commit gần nhất vài ngày.
- Agent nói "memory bank says X but the code shows Y".
- `progress.md` vẫn ghi "đang làm" cho việc đã merge.
- Một file vượt 150 dòng.

### 5.3. Sửa tay

Sửa tay được, ví dụ để thêm một quyết định nhanh. Giữ đúng tên 6 file, tiêu đề `# <File title> — <project name>`, và định dạng `D<n>` cho quyết định. Lần `/ai-memory-update` sau sẽ chỉnh lại nếu lệch.

### 5.4. Xem lại trước khi giữ

Sau mỗi lần init hay update, đọc lướt diff: có điều gì sai, có secret nào lọt vào, có quyết định còn hiệu lực nào bị xóa nhầm không.

## 6. Dùng chung hay dùng riêng

| Cách | Khi nào | Làm |
|---|---|---|
| Dùng chung | Cả team làm cùng một phạm vi, muốn chung bối cảnh | Commit `memory-bank/`. Ai làm xong việc thì update trong cùng PR |
| Dùng riêng | Memory bank ghi trạng thái công việc của riêng bạn (branch, việc đang làm), hoặc bạn chỉ phụ trách một phần repo | Thêm `memory-bank/` vào `.git/info/exclude` (không thêm vào `.gitignore`) |

Khi dùng chung, `activeContext.md` dễ bị nhiều người sửa cùng lúc. Có thể thống nhất rằng `projectbrief`, `systemPatterns`, `techContext`, `decisions` dùng chung, còn mỗi người giữ trạng thái riêng ở nơi khác. Với nhóm nhỏ, dùng riêng thường đơn giản hơn.

## 7. Memory bank và knowledge

| | memory bank | knowledge (`knowledge:`) |
|---|---|---|
| Trả lời | "Dự án là gì, đang ở đâu, làm gì tiếp?" | "Phần X hoạt động thế nào, vì sao?" |
| Cấu trúc | Cố định 6 file, mỗi file dưới 150 dòng | Mỗi chủ đề một file và `INDEX.md`, số file không giới hạn |
| Agent đọc | Luôn đọc đầu phiên | Tra khi cần |
| Nội dung | Có cả trạng thái đang thay đổi | Chỉ tri thức lâu dài |
| Ghi bằng | `/ai-memory-init`, `/ai-memory-update` | `/ai-learn`, `/ai-knowledge-audit` |

- Dự án nhỏ, ngắn hạn: memory bank là đủ.
- Dự án lớn, làm lâu: dùng cả hai. Memory bank giữ phần tổng quan và trạng thái, knowledge giữ phần chi tiết. Một cạm bẫy hay cơ chế trong `activeContext.md` đáng giữ lâu thì chuyển sang knowledge bằng `/ai-learn`, rồi để memory bank chỉ còn một dòng trỏ tới đó.

Xem [KNOWLEDGE.md](KNOWLEDGE.md).

## 8. Sự cố thường gặp

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| Lệnh báo `blocked`, đòi khai `memory_bank` | Chưa có `memory_bank:` trong `project.yaml`, hoặc chưa build lại sau khi thêm |
| Không thấy lệnh `/ai-memory-init` | Chưa build lại sau khi cập nhật stack, hoặc cần mở phiên mới |
| Phiên Claude thường không biết gì về memory bank | Chưa thêm khối `# Memory Bank` vào `CLAUDE.md` (mục 3.3). Agent `ai-*` vẫn đọc vì đã được dặn sẵn |
| `/ai-memory-init` không tạo lại file | Thiết kế có chủ đích: memory bank đã có thì không ghi đè. Muốn làm lại từ đầu thì tự xóa hoặc đổi tên thư mục cũ trước |
| Archivist coi dự án có sẵn là dự án mới, hoặc ngược lại | Nói rõ trong lệnh, ví dụ `/ai-memory-init dự án có sẵn, tập trung vào …` |
| Nhiều `[?]` | Bình thường với dự án có sẵn. Trả lời bằng `/ai-memory-update <câu trả lời>` |
| File quá dài, agent tốn context | `/ai-memory-update rút gọn activeContext và progress dưới 150 dòng`. Chuyển chi tiết lâu dài sang knowledge |
| Diff có cả `git status` của submodule hay file không phải của bạn | Archivist chỉ ghi lại, không đụng vào. Thêm vào mục gotchas để agent khác không stage nhầm |

---

Xem thêm: [USAGE.md](USAGE.md) (mục F4), [kernel/conventions.md](kernel/conventions.md) (mục Memory bank).
