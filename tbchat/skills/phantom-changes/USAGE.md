# phantom-changes — Hướng dẫn sử dụng

Skill xử lý tình trạng **file không đổi nội dung nhưng vẫn bị liệt kê trong change list**
của git / VS Code (hay gặp sau khi chạy `scripts/pull_buf_proto.dart` generate proto).

## Cách gọi

```
/phantom-changes lib/features/cloud_storage/data/_grpc/storage_generated
```

Chỉ kiểm tra, không dọn (dry run):

```
/phantom-changes lib/features/cloud_storage/data/_grpc/storage_generated -n
```

Có thể truyền 1 thư mục hoặc 1 file. Skill tự tìm đúng repo chứa path đó — lưu ý
`lib/features/cloud_storage` là **repo git riêng**, tách khỏi repo gốc của project.

## Skill làm gì

1. Phân loại mọi file đang bị báo `M` thành 4 nhóm:
   - **phantom**: nội dung giống hệt index, chỉ lệch stat cache → **sẽ được dọn**.
   - **eol-only**: blob thật sự đổi, nhưng chỉ khác CRLF↔LF → giữ nguyên, hỏi bạn.
   - **mode-only**: chỉ đổi quyền file → giữ nguyên, hỏi bạn.
   - **real**: thay đổi thật → giữ nguyên.
2. Lấy 1 file phantom làm mẫu để chỉ ra nguyên nhân (ví dụ: *checkout ra CRLF do
   `core.autocrlf=true`, rồi tool generate ghi đè bằng LF*).
3. Refresh stat cache **chỉ cho nhóm phantom** (`git add` file giống index nên không stage
   gì), rồi kiểm tra lại staging area. Nếu lỡ có gì bị stage, skill tự rollback.
4. Gợi ý chặn tái diễn bằng `.gitattributes` trong repo chứa folder đó, ví dụ:
   ```
   data/_grpc/storage_generated/** text eol=lf
   ```
   Skill sẽ **hỏi trước** khi ghi file này.

## An toàn

- Không bao giờ đụng file untracked (`??`), thay đổi thật, file trên đĩa, và không commit.
- Chạy tay cũng được (Git Bash, từ root project):
  ```
  bash .claude/skills/phantom-changes/scripts/phantom.sh [--apply] <path>
  ```

## Lưu ý

- Panel Source Control của VS Code có thể còn hiển thị cũ → bấm refresh trong panel.
- Skill mới tạo/sửa giữa phiên có thể chưa hiện trong danh sách `/` cho đến khi **khởi động
  lại Claude Code**.
