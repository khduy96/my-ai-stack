# check-layers — Hướng dẫn sử dụng

Skill kiểm tra module `lib/features/cloud_storage` theo luật layer
([.claude/_rule/cloud/layer-rules.md](../../_rule/cloud/layer-rules.md), script
`tool/check_layers.dart` là chuẩn) và **tự sửa vi phạm** cho đúng luật.

## Cách gọi

```
/check-layers                                   # sửa mọi vi phạm MỚI (cái chặn git push)
/check-layers pages/storage_management          # chỉ vi phạm trong thư mục này
/check-layers --rule=cubit-locator              # chỉ một rule
/check-layers pages/download -all               # sửa cả nợ cũ (baseline) trong thư mục này
/check-layers -n                                # chỉ báo cáo + kế hoạch sửa, không sửa
/check-layers -y                                # sửa luôn cả phần cấu trúc, không chờ "code đi"
```

`-all` bắt buộc đi kèm path hoặc `--rule` (baseline ~500 dòng, không quét hết một lần).

## Skill làm gì

1. Chạy `dart tool/check_layers.dart --summary` (chỉ đọc), lọc theo path/rule.
2. Đọc từng file vi phạm, xác định **dùng gì** từ import bị cấm, chọn cách sửa theo bảng
   playbook của từng rule (vd cubit `getIt` → tham số constructor; page import `data/` → inject
   use case / interface `domain/repositories/`; interface `*Repository` nằm ở `data/` → chuyển
   sang `domain/repositories/`...).
3. Chia 2 loại:
   - **Tier A – cục bộ** (1 file + chỗ khởi tạo, đổi import, thêm tham số constructor): sửa ngay.
   - **Tier B – cấu trúc** (chuyển file/interface, tạo entity/use case mới, đổi contract
     repository, sửa > 3 file): hiện bảng kế hoạch, chờ **"code đi"** (hoặc `-y`).
4. Kiểm lại: `/build -get` nếu đổi DI → `dart analyze` file đã sửa → chạy lại
   `check_layers --summary` cho tới khi `No new violations` (tối đa 3 vòng).
5. Với `-all`: chạy script không `--summary` để nó tự xoá dòng đã sửa khỏi
   `tool/layer_baseline.txt` (commit file này cùng phần sửa).

## Luật cứng

- Không bao giờ tự thêm dòng vào `layer_baseline.txt`, không chạy `--generate`.
- Chỉ sửa trong `cloud_storage` và `module_bridge`; không đụng `socialfi` — cần phía khác thì
  skill báo lại.
- Sửa layer = refactor **giữ nguyên hành vi**, không đổi API public dùng ngoài module.
- Không commit.

## Lưu ý

- Skill mới tạo/sửa giữa phiên có thể chưa hiện trong danh sách `/` cho đến khi **khởi động
  lại Claude Code**.
