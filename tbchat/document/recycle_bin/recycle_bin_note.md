# Recycle Bin — Changelog v0.0.1

> **Ngày:** 2026-07-17
> **Branch:** `new_cloud_storage` (submodule `lib/features/cloud_storage`)
> **Phạm vi:** Cập nhật UI trang Thùng rác (Recycle Bin) — banner thông báo & thanh sort.

---

## 1. Tổng quan

Bản cập nhật này tập trung vào **UI trang Recycle Bin**, gồm 2 thay đổi chính:

1. Thêm widget banner thông báo **riêng** cho Recycle Bin (`RecycleBinNoticeBanner`) thay cho `WarningBanner` dùng chung.
2. Bố cục lại **thanh Sort** trên trang Recycle Bin (bọc trong `Row`, đổi canh lề, chừa chỗ cho filter sắp tới).

> Lưu ý: Trong cùng đợt commit còn có thay đổi ở `video_detail_by_file_hash_bloc.dart` (comment tạm `cacheKey`) — **không thuộc phạm vi Recycle Bin**, xem mục 4.

---

## 2. Danh sách file thay đổi

| Trạng thái | File | Ghi chú |
|-----------|------|---------|
| `A` (mới) | `_new_cloud_storage/pages/recycle_bin/widgets/recycle_bin_notice_banner.dart` | Widget banner thông báo riêng cho Recycle Bin |
| `M` (sửa) | `_new_cloud_storage/pages/recycle_bin/recycle_bin_page.dart` | Thay banner + bố cục lại thanh Sort |
| `M` (sửa) | `_new_cloud_storage/pages/media_detail/bloc/video_detail_by_file_hash_bloc.dart` | *Ngoài phạm vi* — comment tạm `cacheKey` |

---

## 3. Chi tiết thay đổi Recycle Bin

### 3.1. Widget mới: `RecycleBinNoticeBanner`

File: `pages/recycle_bin/widgets/recycle_bin_notice_banner.dart`

Banner thông báo tông màu cam (orange) dành riêng cho trang Recycle Bin.

**Đặc điểm:**
- `StatelessWidget`, nhận `message` (bắt buộc) và `icon` (tùy chọn, mặc định `null` → không hiển thị icon theo thiết kế CSS).
- Nền: `context.cloudColors.orange0` với `alpha = 0.1`, bo góc `8`.
- Padding: ngang `16`, dọc `8`; chiều rộng full (`double.infinity`).
- Text: `cloudTextThemeBaseLine.bodyMedium`, màu `orange0`, `fontWeight: w400`, `letterSpacing: 0.37`.

```dart
RecycleBinNoticeBanner(
  message: context.newCloudL10n.trashNotice,
);
```

### 3.2. `recycle_bin_page.dart`

**a) Thay `WarningBanner` → `RecycleBinNoticeBanner`**
- Bỏ import `shared/widgets/warning_banner.dart`, thêm import `widgets/recycle_bin_notice_banner.dart`.
- `WarningBanner` cũ (dùng chung) được **comment giữ lại tạm** kèm `TODO(css)`: sẽ thay bằng banner riêng theo thiết kế Figma.
- **Vị trí banner được đưa ra ngoài** `Padding(horizontal: 16)` của header → banner giờ **trải full chiều rộng** trang, sau đó là `SizedBox(height: 16)`.

**b) Bố cục lại thanh Sort**
- `IconMenuWidget` (Sort) được bọc trong một `Row`, mở đầu bằng `SizedBox(width: 16)`.
- Đổi canh lề dropdown: `OverlayAlignment.right` → **`OverlayAlignment.left`**.
- Thêm placeholder comment `// filter` — chừa chỗ cho nút filter sẽ bổ sung sau.
- Nội dung nút Sort giữ nguyên: label `remainingDays` + icon mũi tên; chọn `latest`/`oldest` → `cubit.setSort(true/false)`.

---

## 4. Thay đổi ngoài phạm vi (cùng đợt commit)

File: `pages/media_detail/bloc/video_detail_by_file_hash_bloc.dart`

Tham số `cacheKey` bị **comment tạm** tại 4 vị trí (`pushPlaybackFocus`, `isFullyCached`, `_controllerFactory`, `cancelTasksByUrl`). Đây là thay đổi thuộc luồng phát video (media detail), **không liên quan Recycle Bin**, cần review/tách riêng khi commit.

---

## 5. Việc còn tồn (TODO)

- [ ] `TODO(css)`: Hoàn thiện `RecycleBinNoticeBanner` đúng thiết kế Figma, sau đó **xóa hẳn** đoạn `WarningBanner` đang comment.
- [ ] Bổ sung nút **filter** vào thanh Sort (chỗ đánh dấu `// filter`).
- [ ] Xác nhận/tách riêng thay đổi `cacheKey` trong `video_detail_by_file_hash_bloc.dart` (ngoài phạm vi).

---

# Recycle Bin — Changelog v0.0.2

> **Ngày:** 2026-07-20
> **Branch (submodule `lib/features/cloud_storage`):** `felix/recycle_bin`
> **Phạm vi:** Thêm bottom sheet **"Recycle Bin Rules"** (theo design Figma).

---

## 1. Trạng thái Git (tại thời điểm ghi note)

Submodule `lib/features/cloud_storage` đang ở branch `felix/recycle_bin`.

**Thay đổi chưa commit:**

| Trạng thái | File |
|-----------|------|
| `A` (staged, mới) | `_new_cloud_storage/pages/recycle_bin/widgets/recycle_bin_rules_sheet.dart` |

> Đây là **thay đổi duy nhất** chưa commit trong submodule. Các thay đổi UI ở note v0.0.1 (`recycle_bin_notice_banner.dart`, layout `recycle_bin_page.dart`, `cacheKey` của `video_detail_by_file_hash_bloc.dart`) **đã được commit** trong commit `23b3f4bb "save"`, kèm thêm các thay đổi cubit/state/repository của Recycle Bin.

---

## 2. Chi tiết file mới: `recycle_bin_rules_sheet.dart`

File: `pages/recycle_bin/widgets/recycle_bin_rules_sheet.dart`

Bottom sheet giải thích **quy tắc Thùng rác**, dựng theo design Figma (`.claude/document/recycle_bin/css`).

**Thành phần export:**

- `showRecycleBinRulesSheet(BuildContext context)` — hàm mở bottom sheet qua `context.showBottomSheet`, với `sheetHeader` gồm drag handle (grabber `24x4`, `#999999`, radius 4) + tiêu đề `l10n.recycleBinRules`.
- `RecycleBinRulesSheet` — `StatelessWidget` nội dung sheet: 2 card + 1 nút xác nhận.

**Cấu trúc nội dung:**

1. `_RuleCard` #1 — `restoreRulesTitle` + `restoreRulesDesc` (quy tắc khôi phục).
2. `_RuleCard` #2 — `storageUsageTitle` + `storageUsageDesc` (quy tắc dung lượng).
3. `_ConfirmButton` — nút `confirm`, bấm → `Navigator.pop()`.

**Đặc điểm style (bám CSS Figma):**
- `_RuleCard`: nền `textColor` alpha `0.05`, bo góc `10`, padding `12`; tiêu đề `labelLarge`, mô tả `bodySmall` màu xám (alpha `0.5`).
- `_ConfirmButton`: nền `cloudColors.green0` (`#0DCC61`), bo góc `28`, cao `52`, chữ `titleMedium` `w500`.
- Padding sheet: `fromLTRB(16, 0, 16, 20)`.

---

## 3. L10n

Toàn bộ key dùng trong sheet **đã tồn tại** trong ARB parent repo (`.../new_cloud/l10n/cloud_en.arb`):

| Key | Giá trị EN |
|-----|-----------|
| `recycleBinRules` | "Recycle Bin Rules" |
| `restoreRulesTitle` | "1. Restore Rules" |
| `restoreRulesDesc` | "Files in the Recycle Bin are restored to their original path..." |
| `storageUsageTitle` | "2. Storage Usage" |
| `storageUsageDesc` | "Files in the Recycle Bin do not count toward your cloud drive storage." |
| `confirm` | "Confirm" |

---

## 4. Việc còn tồn (TODO)

- [ ] **Wire sheet vào UI**: hiện `showRecycleBinRulesSheet` / `RecycleBinRulesSheet` **chưa được gọi ở đâu** (không có reference ngoài chính file). Cần gắn trigger (vd: icon "?" / info trên trang Recycle Bin) để mở sheet.
- [ ] Commit file `recycle_bin_rules_sheet.dart` sau khi wire xong.
- [ ] Cân nhắc thay hằng số màu cứng `Color(0xFF999999)` (grabber) bằng token màu chung nếu có.
