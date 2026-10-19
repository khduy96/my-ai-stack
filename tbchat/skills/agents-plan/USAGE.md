# agents-plan — Hướng dẫn sử dụng

Skill lập **bảng phân công agent chạy song song** cho một task đã bàn xong trong cuộc trò
chuyện (module `cloud_storage` / `module_bridge`). Sau khi bạn duyệt và nói **"code đi"**,
Claude chạy một mạch theo bảng đến khi hoàn thành.

## Luồng dùng

```
1. Bàn yêu cầu với Claude đến khi rõ (API, màn hình, string, Figma...)
2. /agents-plan            → nhận bảng phân công (CHƯA sửa file nào)
3. Xem / chỉnh bảng        → "gộp A2 với A3", "A4 không cần chờ A1"...
4. code đi                 → chạy hết các wave + bước FINAL, cuối cùng báo cáo
```

Chạy bằng Workflow thay vì từng subagent (tốn token hơn, phù hợp task lớn):

```
/agents-plan -wf
```

## Bảng phân công có gì

| Cột | Ý nghĩa |
|-----|---------|
| **ID / Wave** | Agent nào, chạy ở đợt nào. Cùng wave = chạy song song |
| **Sửa (độc quyền)** | File chỉ agent này được tạo/sửa — không agent nào trùng |
| **Chỉ đọc** | File được đọc để tham khảo |
| **Chờ** | Agent phải đợi agent nào xong trước |
| **Trả về** | Contract giao cho wave sau (tên class, signature...) |
| **Mẫu tham khảo** | File có sẵn để agent làm theo pattern |

Kèm theo: tổng số agent, số agent tối đa chạy cùng lúc, sơ đồ phụ thuộc
(vd `W0 → (A1 ∥ A2) → A3 → FINAL`), file hiện có sẽ bị sửa, rủi ro.

Nếu yêu cầu chưa đủ rõ, skill chỉ trả về **danh sách câu hỏi** và không xuất bảng.

## Quy tắc skill tự áp dụng

- **Mỗi file chỉ thuộc một agent** → không xung đột khi chạy song song.
- **Contract trước:** entity / interface dùng chung nằm ở Wave 0.
- **File dùng chung chỉ agent chính làm ở bước FINAL:**
  - 12 file ARB → `/l10n add` một lần
  - `service_locator.config.dart` → `/build -get`
  - ObjectBox → `/build -obj`
  - rồi `/analyze-cloud`, tự sửa lỗi tối đa 3 vòng
- **Phạm vi:** chỉ `cloud_storage` + `module_bridge`, không đụng `socialfi`; ưu tiên file mới.
- Tối đa **5 agent / wave**; task quá nhỏ thì đề xuất 1 agent thay vì chia.
- **Không commit** — bạn tự review rồi commit.

## Khi nào Claude dừng giữa chừng để hỏi

- Agent lỗi / trả về sai contract mà không sửa nhanh được
- Agent sửa ngoài vùng được giao, hoặc có thay đổi trong `socialfi`
- Phát sinh quyết định nghiệp vụ chưa có trong yêu cầu
- Analyze vẫn còn lỗi sau 3 vòng sửa

## Lưu ý

- Bảng được lưu vào scratchpad của phiên (`agent-plan.md`) để không mất khi hội thoại bị
  tóm tắt.
- `lib/features/cloud_storage` là git repo riêng — Claude kiểm tra file thay đổi bằng
  `git -C lib/features/cloud_storage status` sau mỗi wave.
