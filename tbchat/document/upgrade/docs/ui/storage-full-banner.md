# Storage Full Banner (Cloud Drive)

Banner cảnh báo khi dung lượng Cloud Drive đã đầy. Hiển thị ở trang Home của cloud, ngay dưới hàng avatar và thanh dung lượng.

- Figma: https://www.figma.com/design/uzZlbeush4dz2Gtj6vcQg6/Cloud-Drive（云存储）?node-id=24465-197357
- Widget: `lib/features/cloud_storage/shared/widgets/storage_full_banner.dart` (`StorageFullBanner`)
- Nơi dùng: `lib/features/cloud_storage/pages/home/cloud_home_page.dart` (đoạn comment `Storage-full alert`)

## Hành vi

| Mục | Quyết định |
|---|---|
| Điều kiện hiển thị | `useSpace >= freeSpace` **và** `freeSpace > 0`.|
| Vì sao có `freeSpace > 0` | `freeSpace == 0` nghĩa là quota chưa về (cold start), không phải đầy. Nếu thiếu, `0 >= 0` làm banner bật nhầm. Cùng quy ước với thanh tiến trình xám của trang |
| Khi chưa đầy | `SizedBox.shrink()`, kể cả khoảng cách phía trên cũng không còn |
| Nút | "Manage Storage" → `CloudStorageNavigator.pushStorageManagement(context)`, mở `pages/storage_management/storage_management_page.dart` |
| Không có nút dismiss | Design hiện tại chỉ có một nút hành động |
| `{limit}` trong nội dung | `FileUtils.getReadableByte(freeSpace)`, ví dụ "5GB" |

`freeSpace` được Mobile tự tính là `free_space + buy_space` từ WS push (xem `storage_quota_config.dart`). Cách tính này đã được kiểm tra thủ công, giữ nguyên, xem [Đã xác nhận với BE](#đã-xác-nhận-với-be). Nên nếu người dùng đã mua thêm dung lượng thì `{limit}` là tổng quota, không riêng phần miễn phí. Câu chữ "over the free {limit} limit" khi đó hơi lệch nghĩa. Nếu cần đúng nghĩa "free", đổi sang `freeSpaceDefault`.

## Spec giao diện

Kích thước trong Figma (337, 313, 285, 161, 93, 72) **không** đưa vào code: chiều rộng theo parent, chiều cao theo nội dung. Chỉ giữ padding, gap, radius và cỡ icon.

| Thành phần | Giá trị | Token cloud |
|---|---|---|
| Container | padding 12, gap 8, radius 8 | |
| Nền | đỏ alpha 0.1 | `cloudColors.red0` |
| Viền | đỏ alpha 0.2, 1px | `cloudColors.red0` |
| Icon | 20×20 | `assets.icAlertTriangle` |
| Tiêu đề | 14 / 21, w600 | `cloudTextThemeBaseLine.bodyMedium`, màu `neutral60` |
| Mô tả | 12 / 18, w400 | `cloudTextThemeBaseLine.bodySmall`, màu `neutral60` alpha 0.5 |
| Nút | cao 36, padding 10×24, radius 28, rộng full | `cloudButtonStyle.secondarySolidStroke` + override |

### Light và dark

| | Light | Dark |
|---|---|---|
| Nền, viền, icon | đỏ `#FF3B30` | giống light |
| Tiêu đề | `#262626` | `#FFFFFF` |
| Mô tả | đen 50% | trắng 50% |
| Nút | nền xám 20%, viền `#C4C4C4`, chữ đen | nền trắng 20%, không viền, chữ trắng |

`redLight0` và `redDark0` đều là `#FF3B30`, `neutral60` là đen (light) và trắng (dark), `neutral20` light là `#C4C4C4`. Vì vậy `secondarySolidStroke` đã xử lý đúng cả hai mode, không cần rẽ nhánh `isDarkMode`.

### Khác biệt so với Figma

- Tiêu đề light: Figma dùng `#262626`, code dùng `neutral60` (`#000000`). Chênh nhỏ, chưa có token cho `#262626`.
- `backdrop-filter: blur(4px)` của nút không được làm.
- Figma có `text-transform: capitalize` cho nhãn nút, code hiển thị đúng chuỗi trong ARB.

## L10n (12 locale, module cloud)

| Key | Ghi chú |
|---|---|
| `storageFullTitle` | "Storage is full" |
| `storageFullDescription` | có placeholder `{limit}` (String) |
| `manageStorage` | "Manage Storage", nhãn nút |

Bản dịch `lo`, `hi`, `ur` do AI dịch, cần người bản ngữ rà lại. Bản `ja` của tiêu đề được rút ngắn thành "容量が満杯です" để vừa độ rộng hiển thị.

`doItLater` đã tồn tại từ trước ở mọi locale nhưng banner không còn dùng. Bản dịch cũ ở `hi`, `ru`, `ur` hơi lạ ("Поговорим позже" nghĩa là "nói chuyện sau"). Có thể sửa bằng `/update-l10n`.
