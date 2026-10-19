# My Subscription — Animation

> **Trạng thái:** đã lên kế hoạch, **chưa code** (chờ "code đi").
> Sau khi code xong, cập nhật mục "Trạng thái" và cột `file:line` cho khớp code thật.

- Màn: `lib/features/cloud_storage/pages/new_upgrade/my_subscription/` (viết tắt `MS`)
- Tầng: chỉ presentation. Không đổi cubit/state/domain/data/l10n/DI/codegen.
- Không có Figma / motion spec → dùng timing hiện có của cloud (200–250ms cho thay đổi nhỏ).
- Toàn bộ cờ bật/tắt + thời gian/curve nằm trong **một file**:
  `MS/utils/my_subscription_motion.dart`

---

## 1. Danh sách animation

| # | Nhóm | Hiệu ứng | Khi nào thấy | Thời gian / curve | Cờ bật/tắt | Mặc định | File |
|---|---|---|---|---|---|---|---|
| A1 | Chuyển skeleton → nội dung / lỗi | Skeleton mờ đi; màn lỗi mờ hiện | Lần đầu vào màn | ra 120ms easeIn · vào 220ms easeOut | `bodySwitch` | `true` | `MS/widgets/my_subscription_body_switcher.dart` |
| A2 | Stagger entrance | Các section lần lượt mờ hiện + trượt lên 12px (header → thẻ → chi tiết/free → gói mới → alert → panel đáy) | **Chỉ lần đầu** có dữ liệu, không chạy lại khi refresh ngầm | trễ 120ms, mỗi item 350ms easeOutCubic, cách nhau 50ms (tổng ~720ms) | `entranceStagger` | `true` | `MS/widgets/my_subscription_entrance.dart` |
| A3 | Section tuỳ chọn / alert | Hiện/ẩn bằng mờ + co giãn chiều cao; khoảng cách 16↔48 co giãn mượt | Pending → active, free → paid, alert xuất hiện/đổi loại | 250ms easeInOut | `sections` | `true` | `MS/widgets/my_subscription_section_slot.dart` |
| A4 | Thanh usage | Thanh chạy từ giá trị cũ → mới; màu xanh/cam/đỏ chuyển dần | Upload, xoá file, sau thanh toán | 700ms easeOutCubic | `usageBar` | `true` | `MS/widgets/plan_bottom_panel.dart` |
| A5 | Số dung lượng (count-up) | Số used / % / free đếm dần theo thanh; số tổng chuyển đỏ mượt khi đầy | Như A4 | 700ms easeOutCubic · màu 200ms | `usageNumbers` | `true` | `MS/widgets/plan_bottom_panel.dart`, `MS/utils/my_subscription_usage_tween.dart` |
| A6 | Fill từ 0 khi vào màn | Thanh (và số, nếu A5 bật) chạy từ 0 → giá trị thật | Mỗi lần vào màn | như A4 | `kAnimateUsageFromZero` | **`false`** | `MS/widgets/plan_bottom_panel.dart` |
| A7 | Bộ nút dưới đáy | Nút cũ mờ đi, nút mới hiện; chiều cao co giãn | Upgrade → Renew, số nút thay đổi | 200ms easeInOut | `actions` | `true` | `MS/widgets/plan_bottom_panel.dart` |
| A8 | Thẻ dung lượng | Ảnh nền cross-fade theo gói; label dung lượng mờ hiện + trượt lên; dòng chữ trên thẻ mờ đổi | Free ↔ gói trả phí | ảnh 300ms easeInOut · label 250ms easeOutCubic | `storageCard` | `true` | `MS/widgets/plan_storage_card.dart` |
| A9 | Badge trạng thái | Màu pill / chấm / viền chuyển dần; label đổi mượt; độ rộng co giãn. **Không nhấp nháy** | Pending → Active, v.v. | 200ms easeOut | `badge` | `true` | `MS/widgets/plan_status_badge.dart` |
| A10 | Detail card | Giá trị (ngày hết hạn, số ngày còn lại) mờ cũ hiện mới; màu cam/đỏ chuyển dần | Sau gia hạn, gần hết hạn | 200ms easeOut | `detailValues` | `true` | `MS/widgets/subscription_detail_card.dart` |
| — | Tải trước ảnh nền thẻ | Không phải animation; tránh chớp trắng khi A8 đổi ảnh | Lúc skeleton đang hiện | — | luôn bật | — | `MS/my_subscription_page.dart` |

**Không làm (đã chốt):** nhấp nháy badge pending, nút co nhẹ khi nhấn, spinner trên nút thay overlay loading,
làm mờ nội dung khi refresh, đổi route transition / Hero, thanh usage ở Home.

---

## 2. Bật / tắt nhanh

Mở `MS/utils/my_subscription_motion.dart`:

```dart
/// Flip to true to fill the usage bar (and count the numbers) from 0 on entry.
const bool kAnimateUsageFromZero = false;

/// Quick on/off switches for every animation on My Subscription.
abstract final class MySubscriptionMotionFlags {
  /// Master switch — false turns every animation below off.
  static const bool enabled = true;

  static const bool bodySwitch = true;      // A1 skeleton → content / error
  static const bool entranceStagger = true; // A2 staggered entrance
  static const bool sections = true;        // A3 optional sections / alert
  static const bool usageBar = true;        // A4 usage bar progress + colour
  static const bool usageNumbers = true;    // A5 count-up numbers + total colour
  static const bool actions = true;         // A7 bottom action buttons
  static const bool storageCard = true;     // A8 card art / label / caption
  static const bool badge = true;           // A9 status badge
  static const bool detailValues = true;    // A10 detail card values
}
```

| Muốn… | Sửa |
|---|---|
| Tắt **toàn bộ** animation của màn | `enabled = false` |
| Tắt một nhóm | đổi cờ của nhóm đó thành `false` (bảng mục 1) |
| Bật fill thanh usage từ 0 khi vào màn | `kAnimateUsageFromZero = true` |
| Chỉnh nhanh / chậm | sửa `Duration` / `Curve` trong `MySubscriptionMotion` (cùng file) |

Sau khi đổi: **hot restart** (hot reload có thể không áp dụng giá trị `const`).

### Khi một cờ = `false` thì màn hiện thế nào
Giao diện và layout **giữ nguyên như khi chưa có animation**, chỉ là thay đổi diễn ra tức thì:
- Thời gian của nhóm đó về `Duration.zero` (qua `MySubscriptionMotion.of(context, d, enabled: …)`).
- A2 tắt → các section hiện ngay, không stagger (controller đặt sẵn `value = 1`).
- A4 bật + A5 tắt → thanh vẫn chạy, số hiện thẳng giá trị cuối.
- A4 tắt + A5 bật → số vẫn đếm, thanh nhảy thẳng (không khuyến khích, sẽ lệch nhịp).
- A6 chỉ có tác dụng khi A4 (và/hoặc A5) đang bật.

### Tự động tắt theo hệ thống
Khi người dùng bật "Giảm chuyển động" (iOS Reduce Motion / Android Remove animations),
`MediaQuery.disableAnimationsOf(context)` = `true` → **mọi** animation của màn về `Duration.zero`,
bất kể cờ đang bật.

---

## 3. Kiểm tra nhanh từng animation

| Animation | Cách tái hiện |
|---|---|
| A1, A2 | Vào màn My Subscription. Debug: `MySubscriptionCubit.preview` có delay giả 600ms để thấy rõ skeleton → stagger |
| A3, A8, A9, A10, A7 | Mua / nâng cấp gói rồi quay lại màn (refresh ngầm qua `didPopNext`); chờ gói pending → active |
| A4, A5 | Upload / xoá file khi đang mở màn (usage stream cập nhật), hoặc vào Storage Management rồi quay lại |
| A6 | Đặt `kAnimateUsageFromZero = true`, hot restart, vào lại màn |
| Giảm chuyển động | Bật Reduce Motion trên máy → mọi thay đổi phải tức thì |

---

## 4. Lưu ý kỹ thuật

- **Không replay vô cớ:** `MySubscriptionState` không có `==`, mỗi emit rebuild cả màn. Mọi animation gắn key
  theo giá trị (enum / chuỗi / `UsageFrame ==` / key từ tên action) nên chỉ chạy khi dữ liệu thật sự đổi.
  Khi thêm animation mới, giữ nguyên nguyên tắc này.
- **Không sửa widget dùng chung:** `StripedProgressBarWidget` (Home cũng dùng) không bị đụng; animation bọc ở chỗ gọi.
- **Số hơi rung khi đếm:** font Poppins không có chữ số đều độ rộng (`tabularFigures` không tác dụng). Đơn vị và
  số chữ số thập phân được giữ cố định theo giá trị đích để độ dài text không đổi.
- **Đơn vị giữa chừng:** khi dung lượng đổi qua mốc đơn vị, giữa chừng có thể thấy kiểu "1229 MB → 900 MB"
  (cố ý giữ đơn vị của giá trị đích để không nhảy MB↔GB).
- **A6 + A2:** nếu bật fill từ 0, thanh bắt đầu chạy trong lúc panel đáy đang stagger vào (phần tử cuối).
- Không thêm package mới (không dùng `flutter_animate`); chỉ dùng implicit/explicit animation có sẵn của Flutter.
