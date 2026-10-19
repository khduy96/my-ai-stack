# My Subscription (Cloud Drive)

> **Tóm tắt.** Màn "My Subscription" cho biết người dùng đang ở gói nào, trạng thái gói (đang dùng, sắp hết hạn, chờ kích hoạt, ngừng bán, đã hết hạn) và đã dùng bao nhiêu dung lượng.
> **UI của cả 7 frame Figma đã code xong**, state do `MySubscriptionCubit` quản lý (loading / loaded / failure, kéo để làm mới). **Data layer đã nối BE**: gói lấy từ gRPC `GetStorageSubscription` (VN BE), dung lượng lấy từ `UserSpace` (HK BE), `MySubscriptionMapper` ghép hai nguồn thành view model ([mục 8](#8-kết-nối-be)). Mock (`preview`) và `unavailable()` chỉ còn dùng cho nút debug. **Mọi action đã nối** ([mục 7](#7-action)); Renew mở danh sách gói (`pushUpgradePlan`) với gói đã hết hạn được đánh dấu, không còn gọi server. **Chưa chạy thử với dữ liệu thật.** Việc để sau từ lần review 2026-10-08 ở [mục 12](#12-câu-hỏi-còn-mở-và-việc-còn-lại).

| | |
|---|---|
| Figma | https://www.figma.com/design/uzZlbeush4dz2Gtj6vcQg6/Cloud-Drive（云存储）?node-id=24456-195663 |
| CSS export | `.claude/free_plan.css` (3 frame Free), `.claude/standard_plan.css` (4 frame Standard) |
| Thư mục code | `lib/features/cloud_storage/pages/new_upgrade/my_subscription/` |
| Mở màn | `CloudStorageNavigator.pushMySubscription(context)`. Tham số `previewViewModel` chỉ dùng cho debug |
| Rule layer | [`.claude/_rule/cloud/layer-rules.md`](../../../_rule/cloud/layer-rules.md): phải chạy `dart tool/check_layers.dart --summary` → `No new violations` |
| Xem nhanh UI | Bản dev/debug: nút tròn **màu chàm, icon huy hiệu** ở mép trái mọi màn cloud → chọn mock ([mục 10](#10-preview-và-mock)) |

## Mục lục

1. [Bản đồ code](#1-bản-đồ-code)
2. [Kiến trúc và luồng dữ liệu](#2-kiến-trúc-và-luồng-dữ-liệu)
3. [View model](#3-view-model)
4. [Frame → view model (đặc tả cho mapper)](#4-frame--view-model-đặc-tả-cho-mapper)
5. [Spec giao diện](#5-spec-giao-diện)
6. [Text và l10n](#6-text-và-l10n)
7. [Action](#7-action)
8. [Kết nối BE](#8-kết-nối-be)
9. [Dành cho agent: thêm action, map data từ server](#9-dành-cho-agent-thêm-action-map-data-từ-server)
10. [Preview và mock](#10-preview-và-mock)
11. [Quyết định thiết kế và lệch so với Figma](#11-quyết-định-thiết-kế-và-lệch-so-với-figma)
12. [Câu hỏi còn mở và việc còn lại](#12-câu-hỏi-còn-mở-và-việc-còn-lại)
13. [Lịch sử theo giai đoạn](#13-lịch-sử-theo-giai-đoạn)

---

## 1. Bản đồ code

Đường dẫn tính từ `lib/features/cloud_storage/`.

```
pages/new_upgrade/my_subscription/
├── my_subscription_page.dart            MySubscriptionPage (tạo cubit: getIt<MySubscriptionCubit>() hoặc preview,
│                                        BlocConsumer), _Content (các section + _buildAlert, _buildAction),
│                                        _LoadingSkeleton, _LoadError, _CurrentSubscriptionDetails,
│                                        _LatestSubscription, _HistoryButton, _ActionButton
├── cubit/
│   ├── my_subscription_cubit.dart       MySubscriptionCubit (@injectable, nhận use case): load, refresh.
│   │                                    Giữ thêm preview() / unavailable() cho debug
│   └── my_subscription_state.dart       MySubscriptionStatus, MySubscriptionState (part of cubit)
├── mappers/
│   └── my_subscription_mapper.dart      MySubscriptionMapper: hàm thuần (StorageSubscription, UserSpace, now)
│                                        → MySubscriptionViewModel (mục 8)
├── models/
│   └── my_subscription_view_model.dart  Toàn bộ view model + enum (mục 3)
├── utils/
│   └── my_subscription_format.dart      storageLabel (0 → "0 GB"), subscriptionDate (đổi UTC → giờ máy, theo locale)
└── widgets/
    ├── plan_header.dart                 PlanHeader: tên gói + badge, "1 x Yearly · $917.99 paid"
    ├── plan_storage_card.dart           PlanStorageCard: ảnh nền + {limit} + dòng nhỏ theo style
    ├── free_plan_info.dart              FreePlanInfo: "You're on the {plan} plan" + mô tả
    ├── plan_status_badge.dart           PlanStatusBadge: Active / Expired Soon / Pending / Expired
    ├── subscription_detail_card.dart    SubscriptionDetailCard + SubscriptionDetailRow (label | value)
    ├── plan_alert_banner.dart           PlanAlertBanner + PlanAlertTone (danger / warning / neutral)
    └── plan_bottom_panel.dart           PlanBottomPanel: usage + "Manage Storage >" + các nút

pages/debug/my_subscription_mocks.dart          MySubscriptionMocks: 7 mock, map `all` cho picker
pages/debug/my_subscription_debug_picker.dart   showMySubscriptionDebugPicker: sheet chọn mock (+ "Load error")
shared/widgets/toast/cloud_banner_toast.dart    CloudBannerToast: toast full width đè header (dùng chung cả module)
shared/routes/cloud_storage_route.dart          CloudStorageRoute.mySubscription = '/mySubscription'
shared/routes/cloud_storage_route_provider.dart GoRoute → MySubscriptionPage(previewViewModel: state.extra)
shared/utils/navigators/cloud_storage_navigator.dart  pushMySubscription(context, previewViewModel:),
                                                openMySubscriptionDebugPicker(context)
shared/widgets/page_basic_widget.dart           Nút debug: _onDebugMySubscription → navigator (không import pages/)
```

Data / domain layer (thêm khi nối BE, [mục 8](#8-kết-nối-be)):

```
domain/entities/subscription/storage_subscription.dart        StorageSubscription + StorageSubscriptionPlan (Dart thuần:
                                                              bytes, DateTime?, enum display status và duration unit)
domain/repositories/storage_subscription_repository.dart      StorageSubscriptionRepository.getStorageSubscription()
domain/use_cases/subscription/get_storage_subscription_use_case.dart   GetStorageSubscriptionUseCase
data/repository/subscription/storage_subscription_repository_impl.dart  bọc StorageUserSubscriptionServiceDataSource có sẵn
data/_grpc/mapper/storage_subscription_mapper.dart            proto → StorageSubscription
```

Dung lượng dùng lại `RefreshUsedSpaceUseCase` và entity domain `UserSpace` có sẵn.

Ngoài thư mục trên:

| Đường dẫn | Ghi chú |
|---|---|
| `assets/images/new_cloud_storage/upgrade/bg_storage_card_{free,standard}.webp` | Ảnh nền card. Accessor `bgStorageCardFree` / `bgStorageCardStandard` của `$AssetsImagesNewCloudStorageUpgradeGen`, đọc qua `PlanCardStyle.background` |
| `lib/app/global/languages/modules/cloud/l10n/cloud_*.arb` | 12 locale ([mục 6](#6-text-và-l10n)) |
| `pages/new_upgrade/subscribe_plan/utils/subscribe_plan_format.dart` | Dùng lại `planAmount` để định dạng số tiền |
| `shared/widgets/progress/striped_progress_bar_widget.dart` | Dùng lại thanh dung lượng của Home |

## 2. Kiến trúc và luồng dữ liệu

```
(hiện tại)  VN BE gRPC GetStorageSubscription ─► StorageSubscriptionRepository ─► GetStorageSubscriptionUseCase ─┐
            HK BE userSpace ─────────────────────────────────────────────────► RefreshUsedSpaceUseCase ─────┤
                                                                                                             ▼
                                        MySubscriptionCubit (@injectable) ─► MySubscriptionMapper(sub, space, now)
(debug)     Nút debug ─► mock ───────► MySubscriptionCubit.preview(mock)
            "Load error" ────────────► MySubscriptionCubit.unavailable()  (luôn lỗi)
                                                         │  MySubscriptionState (status, viewModel, errorToastCount)
                                                         ▼
                                     MySubscriptionPage: BlocConsumer → loading / error / _Content
                                                         │  section nào != null thì hiện
          ┌──────────────┬──────────────┬────────────────┼────────────────┬────────────────┐
     PlanHeader   PlanStorageCard  FreePlanInfo   Detail card(s)   PlanAlertBanner   PlanBottomPanel
```

**Ba nguyên tắc cần giữ khi sửa:**

1. **Chia theo section, không dùng một enum trạng thái.** View model gồm các section tuỳ chọn, mapper bật hoặc tắt từng section độc lập. Các trạng thái chồng nhau (ví dụ Discontinued vẫn mang badge Active), nên widget **không bao giờ** `switch` theo "trạng thái màn".
2. **View model chỉ chứa dữ liệu thô:** bytes, `DateTime`, số tiền, enum, sealed class. Định dạng (GB, ngày, tiền) và chọn text l10n nằm trong widget. Nhờ vậy mapper **không cần `BuildContext`** và test được bằng unit test.
3. **Logic nghiệp vụ nằm ở mapper, không nằm ở widget.** Ví dụ so sánh với quota gói Free, đếm số ngày còn lại, ưu tiên trạng thái nào. Widget chỉ biểu diễn những gì nó nhận được.

**State và cubit** (`pages/new_upgrade/my_subscription/cubit/`, theo cùng kiểu với `SubscribePlanCubit`: class thường + `copyWith`, không freezed):

| State | Ý nghĩa |
|---|---|
| `status` | `loading` / `loaded` / `failure` |
| `viewModel` | dữ liệu màn. Giữ lại khi refresh lỗi; chỉ `null` trước lần load thành công đầu tiên |
| `errorToastCount` | tăng 1 mỗi khi cần toast lỗi (refresh lỗi khi đã có nội dung). Page so giá trị cũ và mới trong `listenWhen` để toast đúng một lần |

| Hàm | Việc làm |
|---|---|
| `load()` | phát `loading` rồi tải. Dùng cho lần đầu và nút Retry |
| `refresh()` | tải lại nhưng giữ nội dung đang hiện (kéo để làm mới) |

`renew()` và `isRenewing` **đã bị bỏ** (2026-10-08): Renew giờ chỉ điều hướng, không gọi server ([mục 7](#7-action)).

Nguồn dữ liệu cố định lúc tạo cubit, qua một hàm tải **private**:

| Constructor | Nguồn | Dùng ở |
|---|---|---|
| `MySubscriptionCubit(...)` (`@injectable`) | gọi `GetStorageSubscriptionUseCase` + `RefreshUsedSpaceUseCase`, rồi `MySubscriptionMapper` ([mục 8](#8-kết-nối-be)) | Page tạo bằng `getIt<MySubscriptionCubit>()` khi không có `previewViewModel` |
| `MySubscriptionCubit.preview(viewModel)` | mock, trễ 600ms | Chỉ cho nút debug |
| `MySubscriptionCubit.unavailable()` | luôn lỗi | Chỉ cho mục "Load error" của nút debug |

Mọi response cũ đến muộn bị bỏ qua nhờ `_requestId`.

**Cập nhật ngầm** (2026-10-09):

| Nguồn | Việc làm |
|---|---|
| `WatchUserSpaceUseCase` (`watchUserSpace().whereNotNull()`) | Sau lần load live thành công đầu tiên, cubit giữ `StorageSubscription` và map lại mỗi khi `UserSpace` trong DB đổi (không loading, không toast). Bỏ qua nếu đang có request chạy (`_settledRequestId != _requestId`). Preview không theo dõi |
| `RouteAware.didPopNext` (`AppPages.routeObserver`) | Quay lại màn (thanh toán, Storage Management, huỷ Upgrade…) → frame sau, nếu màn là `isCurrent`: `refresh()` khi đã có nội dung, ngược lại `load()` |
| App resume | Không tải lại; chỉ kéo để làm mới |

**Trạng thái màn** (`_MySubscriptionPageState._buildBody`):

| Điều kiện | Hiện |
|---|---|
| `viewModel != null` | `_Content`: các section + `RefreshIndicator` + bottom panel |
| chưa có `viewModel`, `loading` | `_LoadingSkeleton` (shimmer: card + 2 khối) |
| chưa có `viewModel`, `failure` | `_LoadError`: `icCloudFail` + `somethingWentWrongPleaseTryAgain` + nút `retry` (gọi `load()`) |
| `errorToastCount` đổi | `CloudBannerToast` "Something went wrong" |

**Thứ tự section trong Body** (`my_subscription_page.dart`):

```
PlanHeader                    khi có currentSubscription
PlanStorageCard               luôn có
_CurrentSubscriptionDetails   khi có currentSubscription: Started / Expired on / Days left
FreePlanInfo                  khi isFreePlan
_LatestSubscription           khi có latestSubscription: "Latest Subscription" + badge + Plan / Term / Paid / Started on / Expired on
PlanAlertBanner               khi có alert
──────── cố định ở đáy ────────
PlanBottomPanel               usage + Manage Storage + actions
```

Khoảng cách giữa các section là 48 khi `isFreePlan`, còn lại là 16.

## 3. View model

File: `pages/new_upgrade/my_subscription/models/my_subscription_view_model.dart`.

### `MySubscriptionViewModel`

| Field | Kiểu | Bắt buộc | Ý nghĩa |
|---|---|---|---|
| `planName` | `String?` | | Tên gói hiện tại: `plan.name`. `null` / rỗng → page hiện `freePlanName` ("Free"); gói `EXPIRED` luôn để `null` |
| `planLimitBytes` | `int` | ✅ | Quota của gói, là số to trên card |
| `cardStyle` | `PlanCardStyle` | ✅ | `free` hoặc `standard`. Mọi gói trả phí dùng `standard` |
| `usage` | `StorageUsageViewModel` | ✅ | Đã dùng / tổng, cho bottom panel |
| `isFreePlan` | `bool` | | Hiện `FreePlanInfo`, gap 48 |
| `currentSubscription` | `CurrentSubscriptionViewModel?` | | Gói trả phí đang chạy: header + card ngày |
| `latestSubscription` | `LatestSubscriptionViewModel?` | | Gói trả phí gần nhất đã hết hạn |
| `alert` | `PlanAlertViewModel?` | | Banner cảnh báo hoặc thông tin |
| `actions` | `List<PlanAction>` | | Nút ở đáy, từ trái sang phải, chia đều |

### Các kiểu con

| Kiểu | Field / giá trị |
|---|---|
| `StorageUsageViewModel` | `usedBytes`, `totalBytes`. Getter: `progress` (0–1, có clamp), `freeBytes` (≥ 0), `percentUsed` (làm tròn **xuống**, chưa đầy thì không ra 100%), `isFull` (`total > 0 && used >= total`) |
| `CurrentSubscriptionViewModel` | `badge`, `planName`, `billingCycle` (`BillingCycle`, không null), `cycleCount`, `currency`, `paidAmount`, `startedAt`, `expiredAt`, `daysLeft` (**tính ở client**, [mục 8](#8-kết-nối-be)), `unusedValue` (mặc định 0, chờ BE) |
| `LatestSubscriptionViewModel` | `badge`, `planName`, `storageBytes`, `termCycle` (`BillingCycle`, không null: `yearly` → `termYears`, `monthly` → `termMonths`) + `termValue` (`duration_value`), `currency`, `paidAmount`, `startedAt?`, `expiredAt?` (`null` → "-") |
| `PlanCardStyle` | `free`, `standard`. Getter `background` trả về ảnh nền |
| `PlanBadge` | `active`, `expiredSoon`, `pending`, `expired` |
| `BillingCycle` | `monthly`, `yearly` (không có daily) |
| `PlanAction` | `upgrade`, `viewAllPlans`, `renew`, `contactSupport` |
| `PlanAlertViewModel` (sealed) | `PlanOverLimitAlert(usedBytes, limitBytes)` · `PlanExpiringSoonAlert(daysLeft, atRiskBytes?)` · `PlanPendingAlert()` · `PlanDiscontinuedAlert()` |

Field `currency` có trong cả hai view model nhưng **chỉ dùng cho logic** (truyền sang `CurrentPlanModelView` khi Upgrade / Renew). Số tiền vẫn luôn hiện bằng `$` như Figma (`planAmount(amount, 'USD')`, có `TODO(cloud)` ở `PlanHeader` và `_LatestSubscription`).

## 4. Frame → view model (đặc tả cho mapper)

Ô để trống nghĩa là `null` / không truyền.

| Frame Figma | `cardStyle` | `isFreePlan` | `currentSubscription.badge` | `latestSubscription.badge` | `alert` | `actions` |
|---|---|---|---|---|---|---|
| Free – No Subscriptions | `free` | `true` | | | | `upgrade` |
| Free – Subscriptions Expired | `free` | | | `expired` | `PlanOverLimitAlert` | `viewAllPlans`, `renew` |
| Something went wrong | giống frame trên | | | | | toast khi refresh lỗi (Renew không còn toast, [mục 7](#7-action)) |
| Standard – Active | `standard` | | `active` | | | `upgrade` |
| Standard – Expired Soon | `standard` | | `expiredSoon` | | `PlanExpiringSoonAlert` | `upgrade` |
| Standard – Pending | `standard` | | `pending` | | `PlanPendingAlert` | `contactSupport` |
| Standard – Discontinued Plan | `standard` | | `active` | | `PlanDiscontinuedAlert` | `upgrade` |

**Quy tắc mapper phải tự xử lý** (widget không biết). Bảng map đầy đủ từ response BE ở [mục 8](#8-kết-nối-be); tóm tắt:

| Giá trị | Quy tắc |
|---|---|
| `PlanOverLimitAlert.usedBytes` / `limitBytes` | `UserSpace.usedBytes` / `UserSpace.freeDefaultBytes` (quota gói Free); chỉ có khi đã dùng > quota Free |
| `PlanExpiringSoonAlert.atRiskBytes` | dung lượng đã dùng, **chỉ khi** đã dùng > quota gói Free; ngược lại `null` (ẩn dòng "Renew now to keep…"). Lý do: khi gói hết hạn và quay về Free, chỉ phần vượt quota mới bị khoá chỉ đọc, nên chỉ lúc đó mới cần nhắc gia hạn |
| `daysLeft` | **tính ở client**: ceil((`end_time` − now) / 1 ngày), tối thiểu 0 (TODO: xin BE field) |
| `planName` | `plan.name`; rỗng → "Free" |
| `cycleCount` + `billingCycle` | `duration_value` × `duration_unit`: "6 x Monthly" = 6 tháng, "1 x Yearly" = 1 năm |

**Widget tự quyết** (mapper không cần truyền):

- Row Days left có màu cam khi `currentSubscription.badge == expiredSoon`.
- Row Expired on trong Latest Subscription luôn có màu đỏ.
- "{size} Total" chuyển đỏ khi `usage.isFull`. Thanh progress tự đổi màu theo ngưỡng ([mục 11](#11-quyết-định-thiết-kế-và-lệch-so-với-figma)).

## 5. Spec giao diện

Token màu lấy từ `context.cloudColors`. Giá trị ở light: `neutral30` `#7B7B7B`, `neutral40` `#555555`, `neutral50` `#262626`, `neutral60` `#000000` (ở dark là trắng), `green0` `#0DCC61`, `green20` `#00B238`, `green30` `#009122`, `red0` `#FF3B30`, `orange0` `#FF9500`.

### Khung màn

| Phần | Spec |
|---|---|
| Nền | `#FAFAFA`. Dark: `backgroundColors.scaffoldBackgroundColorWhiteBlack` |
| App bar | `PageBasicWidget`: nút back, title "My Subscription" 18sp/w600 `textColors.textColor`. Icon `ic_clock2` 24 trong vùng bấm 40, cùng màu, đặt ở `appBarChildren` |
| Body | `SingleChildScrollView`, padding 16 |
| Status bar / home indicator | Không vẽ, dùng `SafeArea` của `PageBasicWidget` |

### Từng widget

| Widget | Spec |
|---|---|
| `PlanHeader` | Column, gap 2. Dòng 1: tên gói 24sp/w600 `neutral50` + badge, gap 8. Dòng 2: kỳ hạn · chấm 2px (`neutral60` 20%) · số tiền, 14sp/w500 `neutral30`, gap 8 |
| `PlanStorageCard` | `AspectRatio(361/108)`, bo góc 12, padding 16, gap text 4. Số to 32sp/w600 trắng, line-height 1.0, `FittedBox` để số dài không vỡ. Dòng nhỏ 14sp/w600 trắng 80% |
| `FreePlanInfo` | padding ngang 24, gap 8, căn giữa. Tiêu đề 20sp/w600 `neutral50`. Mô tả 14sp `neutral40`, line-height 1.4 |
| `PlanStatusBadge` | padding 2/8/2/4, gap 4, bo góc 99, nền màu 10%. Chấm 8 trong vòng 16 (20%). Chữ 14sp/w500 |
| `SubscriptionDetailCard` | padding 12, gap 12, bo góc 8, nền `csCardBgColor`, viền 1px đen 5% (dark: trắng 10%), divider cùng màu. Row: label 12sp `neutral40` · value 12sp/w500 `neutral50`, căn phải, 1 dòng |
| `PlanAlertBanner` | padding 12, gap 8, bo góc 8, nền 10%, viền 20%, icon 20. Tiêu đề 14sp/w600 `neutral50`, line-height 21. Mô tả (tuỳ chọn) 12sp `neutral60` 60%, line-height 18 |
| `PlanBottomPanel` | padding 16, bo góc trên 12, nền `csCardBgColor`, shadow (0,−2) blur 16 đen 2%. Hộp usage: viền 1px đen 5% (dark: trắng 10%), bo góc 8. Nút: cao 52, chữ 16sp/w500 `neutral60`, gap 16, chia đều |
| Usage | padding 12, gap 8. "Used" 12sp `neutral40` + giá trị 12sp/w600 `neutral50` · "{size} Total" 12sp/w600 `green20` (`red0` khi đầy). Progress cao 10. "% used" / "Free" 12sp `neutral60` 40% |
| Manage Storage | padding 16×12, gap 6, `icSettings` 18 + chữ 14sp/w600 + `icArrowRight` 18 (lật theo RTL), màu `neutral50` |

### Badge và alert

| Badge | Màu | Text |
|---|---|---|
| `active` | chấm và nền `green0`, chữ `green30` (đậm hơn để đọc được trên nền nhạt) | Active |
| `expiredSoon` | `orange0` | Expired Soon |
| `pending` | `orange0` | Pending |
| `expired` | `red0` | Expired |

| Alert | Tone | Màu | Icon |
|---|---|---|---|
| `PlanOverLimitAlert` | `danger` | `red0` | `icAlertTriangle` |
| `PlanExpiringSoonAlert` | `warning` | `orange0` | `icAlertTriangle` |
| `PlanPendingAlert`, `PlanDiscontinuedAlert` | `neutral` | nền và viền `neutral60` (đen ở light, trắng ở dark), icon `neutral50` | `icNotificationInfo` |

Mỗi tone tự gắn icon của nó; `PlanAlertBanner` không có tham số `icon`. `PlanAlertBanner` có cùng kiểu dáng với `StorageFullBanner` ở Home nhưng không có nút; được viết thành widget riêng để không sửa banner đang ổn định.

### Nút

| `PlanAction` | Text | Style |
|---|---|---|
| `upgrade` | Upgrade | `primarySolid` |
| `renew` | Renew | `primarySolid` |
| `viewAllPlans` | View All Plans | `secondarySolidStroke` (nền xám 20%, viền `#C4C4C4`) |
| `contactSupport` | Contact Support (dùng lại key `paymentContactSupport`) | `primarySolid` |

### Nền Storage Card

| Style | Ảnh | Fallback khi không load được ảnh | Dòng nhỏ |
|---|---|---|---|
| `free` | `bg_storage_card_free.webp` | màu `#6C9492` | Your free plan |
| `standard` | `bg_storage_card_standard.webp` | gradient dọc `#004484 → #00C8FF` | Your plan storage |

Ảnh là bản export từ Figma, **đã gộp sẵn** các layer trang trí (blend `screen`, mask) và đã ẩn text. Không dựng lại các layer đó bằng code.

### Toast: `CloudBannerToast`

`CloudBannerToast.show(message:, subtitle:, isError:, duration:)`. Toast full width, nằm đè lên header.

| Mục | Spec |
|---|---|
| Hiển thị | `BotToast.showCustomNotification`, `topCenter`, `useSafeArea: false`, vuốt để ẩn, 3 giây, toast mới huỷ toast cũ |
| Vị trí | top = status bar + 5 (Figma: 64 trên status bar 59), margin ngang 16 |
| Khung | padding 8, bo góc 12, viền 1px đen 5%, shadow blur 20 đen 10% |
| Ô icon | 36×36, bo góc 8, padding 4, icon 24 trắng, cách chữ 8 |
| Chữ | title 14/w500, line-height 1.5 · subtitle (tuỳ chọn) 12/w400, line-height 1.2, letter-spacing 0.37, `#262626` |
| Error | nền `#FF3B30` 10% phủ trên trắng, ô icon `#F94C4C` + `icToastFail`, title `#D11922` |
| Success | nền `#0DCC61` 10% phủ trên trắng, ô icon `#0DCC61` + `icToastSuccess`, title `#009122` (Figma không có, suy ra theo cùng layout) |

Light và dark **giống nhau**. Không dùng `Toast.showCloud` (trong `lib/app/core/`): toast đó đặt cách mép trên cố định `kToolbarHeight` (không tính status bar), co theo độ dài chữ, và nằm ngoài module cloud. Nút và icon Close của frame toast đang ẩn trong Figma nên chưa làm.

## 6. Text và l10n

Mọi key nằm trong module **cloud** (`context.cloudL10n`), đủ 12 locale. Thêm key bằng `/add-l10n`, sửa key bằng `/update-l10n`. ♻️ = key có sẵn trước màn này. Các chỗ có giá trị động đều dùng key có tham số, không nối chuỗi, vì thứ tự từ ở mỗi ngôn ngữ khác nhau.

| Nhóm | Key | Text (en) |
|---|---|---|
| Header | `mySubscription` | My Subscription |
| Card | `yourFreePlan` · `yourPlanStorage` | Your free plan · Your plan storage |
| Free info | `youAreOnPlan(plan)` · `planStorageIncludedDesc(limit)` · `freePlanName` | You're on the {plan} plan · {limit} storage included. Upgrade anytime to get more space for photos, files and backups. · Free (tên gói khi `planName` rỗng) |
| Usage | ♻️ `storageLimitUsed` · `storageTotalSize(size)` · `storagePercentUsed(percent)` · `storageFreeSize(size)` · ♻️ `manageStorage` | Used · {size} Total · {percent}% used · {size} Free · Manage Storage |
| Badge | `subscriptionActive` · `subscriptionExpiredSoon` · `subscriptionPending` · `subscriptionExpired` | Active · Expired Soon · Pending · Expired |
| Header gói | `billingYearlyCount(count)` · `billingMonthlyCount(count)` · `amountPaid(amount)` | {count} x Yearly · {count} x Monthly · {amount} paid |
| Card ngày (gói hiện tại) | `started` · `expiredOn` · `daysLeft` · `daysCount(count)` | Started · Expired on · Days left · 1 day / {count} days |
| Latest Subscription | `latestSubscription` · ♻️ `plan` · ♻️ `planExpiredPlanSize(plan, size)` · `term` · `termYears(count)` · `termMonths(count)` · `paid` · `startedOn` · `expiredOn` | Latest Subscription · Plan · {plan} - {size} · Term · 1 year / {count} years · 1 month / {count} months · Paid · Started on · Expired on |
| Alert over limit | `sizeIsReadOnly(size)` · ♻️ `storageFullDescription(limit)` | {size} is read-only · You're over the free {limit} limit. View and download your files anytime, uploads and edits are paused until you renew or free up space. Nothing has been deleted. |
| Alert expiring | `planExpiresInDays(count)` · `renewToKeepStorage(size)` | Your plan expires in {count} days · Renew now to keep {size} without interruption. |
| Alert pending | `planPendingTitle` · `planPendingDesc` | Payment received - activating · Your payment was successful. It usually takes a few minutes to confirm on-chain. You'll be notified once it's active. |
| Alert discontinued | `planDiscontinuedTitle` · `planDiscontinuedDesc` | This plan has been discontinued · You can keep using it until it expires, but it can no longer be renewed. Please switch to another plan before then. |
| Nút | ♻️ `upgradeButton` · `viewAllPlans` · `renew` · ♻️ `paymentContactSupport` | Upgrade · View All Plans · Renew · Contact Support |
| Toast | ♻️ `somethingWentWrong` | Something went wrong |

Lưu ý:

- `started` ("Started") và `startedOn` ("Started on") là **hai key khác nhau**, theo đúng chữ của từng frame Figma.
- `termYears` / `termMonths` viết chữ thường (`planDurationYears` có sẵn ra "1 Year" nên không dùng). `termMonths` thêm khi nối BE vì gói có thể tính theo tháng. Không có bản theo ngày (không có gói daily); đơn vị lạ được coi là tháng.
- `storageFullDescription` dùng chung với `StorageFullBanner` ở Home.
- Key cũ `yourPlanName` ("Your {plan} plan") **đã bị xoá**. Key `doItLater` có sẵn nhưng màn này không dùng.

## 7. Action

Các action được nối trong `_Content` (`my_subscription_page.dart`). Action có gọi server (Renew) phải đi qua cubit; action chỉ điều hướng thì gọi thẳng navigator trong widget.

| Action | Chỗ nối | Đã nối |
|---|---|---|
| Nút Upgrade | `_buildAction` → `PlanAction.upgrade` → `_openUpgrade` | Có `currentSubscription` → `pushUpgradePlan` với `CurrentPlanModelView` dựng từ gói hiện tại. Gói Free → `pushUpgradeStorage` |
| Nút View All Plans | `_buildAction` → `PlanAction.viewAllPlans` | `CloudStorageNavigator.pushUpgradeStorage(context)`: danh sách gói, không đánh dấu gói nào (người dùng đã về Free). Khác Renew, nút đánh dấu gói vừa hết hạn. Prod: toast "Coming soon" như Upgrade của gói Free |
| Nút Renew | `_buildAction` → `PlanAction.renew` → `_openRenew` | `pushUpgradePlan` với `CurrentPlanModelView` dựng từ `LatestSubscriptionViewModel`: `name`, `storageBytes`, `termCycle` / `termValue`, `expiredAt`, `currency`, `unusedValue: 0` (gói đã hết hạn không còn gì để trừ). Cùng cách với `pushRenewPlan` của popup hết hạn. `expiredAt` null → `pushUpgradeStorage` (`TODO(cloud)`) |
| Nút Contact Support (chỉ khi PENDING) | `_buildAction` → `PlanAction.contactSupport` | `Toast.warm(comingSoon)` + `TODO(cloud)`: chờ PM / BA cho biết đích (chat CS, URL…). Module cloud chưa có màn hỗ trợ; `aeonContactSupport` của wallet là form khiếu nại AEON Pay, không dùng |
| Dòng Manage Storage | `PlanBottomPanel(onManageStorage:)` | `CloudStorageNavigator.pushStorageManagement(context)` |
| Icon đồng hồ | `_HistoryButton(onTap:)` | `CloudStorageNavigator.pushPlanTransactionHistory(context)` |

`BillingCycle → PlanBillingCycle` đi qua helper chung `_Content._planBillingCycle`, dùng cho cả Upgrade và Renew. Màn plan chưa có chế độ renew riêng: có `currentPlan` thì tiêu đề là "Upgrade Plan" và dòng "Unused value" hiện −$0.00 (popup hết hạn cũng vậy).

## 8. Kết nối BE

Màn ghép dữ liệu từ **2 BE khác nhau**: thông tin gói lấy từ VN BE, dung lượng lấy từ HK BE. Mọi quy tắc dưới đây đã chốt với người dùng.

### Nguồn dữ liệu

| BE | API | Dùng cho |
|---|---|---|
| **VN BE** | gRPC `subscription.v1.authz.StorageUserSubscriptionHandler/GetStorageSubscription`, request `{}` | Gói, trạng thái, ngày, số tiền, cờ sắp hết hạn / ngừng bán |
| **HK BE** | WS `userSpace` (20036) trả `free_space`, `buy_space`. App lưu `freeSpaceDefault = free_space`, `freeSpace = free_space + buy_space` | Usage panel, quota gói Free |

**Response `GetStorageSubscription`:**

| Field | Ý nghĩa / cách dùng |
|---|---|
| `id` | id subscription |
| `plan.name` | tên gói; rỗng → "Free" |
| `plan.storage_quota` + `plan.storage_unit` | quota gói, quy đổi ra bytes (xem dưới) |
| `plan.duration_value` + `plan.duration_unit` | kỳ hạn ("6 x Monthly", Term) |
| `plan.amount` | số tiền đã trả |
| `plan.currency` | **bỏ qua**, luôn hiện `$` |
| `plan.available_to_renew` | `false` → alert Discontinued (**chỉ dùng cho việc này**) |
| `display_status` | `ACTIVE` \| `PENDING` \| `EXPIRED` \| `FREE`, quyết định nhánh map |
| `provisioning_status` | **không dùng** (BE xác nhận hiện chưa có ý nghĩa) |
| `start_time`, `end_time` | ngày bắt đầu / hết hạn, có thể vắng |
| `is_expiring_soon` | badge `expiredSoon` + alert sắp hết hạn |

Ví dụ (PENDING, chưa có `start_time` / `end_time`):

```json
{"id":"1","plan":{"name":"Lite","storage_quota":"10","storage_unit":"GB","duration_value":"10","duration_unit":"DAY","amount":0.95,"currency":"USDT","available_to_renew":true},"display_status":"PENDING","provisioning_status":"PENDING"}
```

**`UserSpace`** (domain, HK BE):

| Field | Nguồn |
|---|---|
| `usedBytes` | dung lượng đã dùng |
| `totalBytes` | `freeSpace` của entity (= `free_space + buy_space`) |
| `freeDefaultBytes` | `free_space` của HK BE = quota gói Free |

Lấy bằng `RefreshUsedSpaceUseCase`. Lỗi thì dùng giá trị cache; **chỉ khi không có cache** mới ra màn lỗi.

- `usedBytes` đến từ REST storage node (`GET /api/v1/user/space/{netId}`); `totalBytes` / `freeDefaultBytes` **chỉ** đến từ WS 20036 (cache DB). Chưa có row → 0.
- Quota Free trong mapper = `freeDefaultBytes`, **bằng 0 thì dùng `resolveCloudQuotaBytes` (5 GiB)** (`shared/utils/storage_quota_config.dart`), áp cho card FREE / EXPIRED, `PlanOverLimitAlert` và ngưỡng `atRiskBytes`.
- Usage cập nhật live qua `watchUserSpace()` (xem mục 2).

### Data / domain layer

Đường dẫn tính từ `lib/features/cloud_storage/`.

| File | Vai trò |
|---|---|
| `domain/entities/subscription/storage_subscription.dart` | `StorageSubscription` + `StorageSubscriptionPlan`: Dart thuần, quota đã ra bytes, ngày là `DateTime?`, enum cho display status và duration unit |
| `domain/repositories/storage_subscription_repository.dart` | `getStorageSubscription()` |
| `data/repository/subscription/storage_subscription_repository_impl.dart` | bọc `StorageUserSubscriptionServiceDataSource` có sẵn |
| `data/_grpc/mapper/storage_subscription_mapper.dart` | proto → entity |
| `domain/use_cases/subscription/get_storage_subscription_use_case.dart` | `GetStorageSubscriptionUseCase` |
| `pages/new_upgrade/my_subscription/mappers/my_subscription_mapper.dart` | hàm thuần `(StorageSubscription, UserSpace, now) → MySubscriptionViewModel` |
| `pages/new_upgrade/my_subscription/cubit/my_subscription_cubit.dart` | constructor `@injectable` nhận các use case; page dùng `getIt<MySubscriptionCubit>()`. `preview()` / `unavailable()` giữ lại cho debug picker |

### Quy đổi dung lượng

`bytes = storage_quota × pow(kByteConversionBase, ByteUnit.index)`

- `kByteConversionBase` = 1024 (`shared/utils/byte_unit_config.dart`).
- `storage_unit` khớp với `ByteUnit {b, kb, mb, gb, tb}`, **không phân biệt hoa thường**.
- Đơn vị lạ → coi là bytes + log warning.

### Bảng map

Xét **từ trên xuống**, dòng đầu tiên khớp thì dùng. So sánh `display_status` không phân biệt hoa thường.

| # | Điều kiện | Card (style / `planLimitBytes`) | Badge | Alert | Actions |
|---|---|---|---|---|---|
| 1 | `EXPIRED` | `free` / `freeDefaultBytes` | `latestSubscription` badge `expired` (dựng từ `plan`) | `PlanOverLimitAlert(used, freeDefaultBytes)`, **chỉ khi** used > `freeDefaultBytes` | `viewAllPlans` + `renew` (luôn có) |
| 2 | `FREE`, status lạ, không có `plan`, hoặc thiếu `start_time` / `end_time` | `free` / `freeDefaultBytes`, `isFreePlan` | | | `upgrade` |
| 3 | `PENDING` | `standard` / quota gói | current `pending` | `PlanPendingAlert` | `contactSupport` |
| 4 | `ACTIVE` + `!available_to_renew` | `standard` / quota gói | `expiredSoon` nếu `is_expiring_soon`, ngược lại `active` | `PlanDiscontinuedAlert` | `upgrade` |
| 5 | `ACTIVE` + `is_expiring_soon` | `standard` / quota gói | `expiredSoon` | `PlanExpiringSoonAlert(daysLeft, atRiskBytes = used nếu used > freeDefaultBytes, ngược lại null)` | `upgrade` |
| 6 | `ACTIVE` | `standard` / quota gói | `active` | | `upgrade` |

Lưu ý:

- VN BE đảm bảo: chỉ 4 status; `ACTIVE` / `PENDING` / `EXPIRED` luôn có `plan`, `FREE` không bao giờ có; `ACTIVE` / `PENDING` luôn có `start_time` / `end_time`. Dòng 2 vì vậy thực tế chỉ còn `FREE`; status khác rơi vào đây là vi phạm hợp đồng và được log (`CloudLogger.w`).
- `ACTIVE` / `PENDING` có `plan.name` rỗng → header và dòng "Plan" của Latest hiện "-" (`planNameLabel`).
- EXPIRED: alert theo quota Free nhưng panel theo `totalBytes` (HK BE có thể chưa thu hồi `buy_space`) — FE không can thiệp, **cần test phối hợp VN BE ↔ HK BE**.
- Card Standard của `ACTIVE` chỉ có badge `active` hoặc `expiredSoon`.
- `available_to_renew` chỉ dùng cho alert Discontinued (sau này có thể chuyển sang gRPC riêng).
- Usage panel luôn là `UserSpace.usedBytes / totalBytes`.

### Hiển thị

| Mục | Quy tắc |
|---|---|
| Header | `"{duration_value} x Monthly\|Yearly · ${amount} paid"`. Số là độ dài kỳ hạn (ví dụ "6 x Monthly"), đã được designer / BA / PM xác nhận |
| Đơn vị không hỗ trợ (ví dụ `DAY` trên dev) | Không có gói daily, nên mapper coi là **Monthly** (`month \|\| unsupported → monthly`); data mapper vẫn log warning |
| Term (Latest Subscription) | `termYears` ("1 year / N years") hoặc key mới `termMonths` ("1 month / {count} months") |
| Số tiền | `amount` = số tiền đã trả, luôn có `$` như Figma qua `planAmount(amount, 'USD')` |
| `daysLeft` | ceil((`end_time` − now) / 1 ngày), tối thiểu 0, **tính ở client** (TODO: BE bổ sung field) |
| Tên gói | `plan.name`; rỗng → "Free" |
| Ngày ở Latest Subscription | nullable → "-" |
| Múi giờ | `Timestamp.toDateTime()` trả UTC; `subscriptionDate` đổi `toLocal()` trước khi format để không lệch 1 ngày (ví dụ 20:00 UTC 31/1 là 1/2 ở VN) |

**Hỏi đáp đã chốt với design / BA / PM:**

| # | Câu hỏi | Trả lời |
|---|---|---|
| 1 | Có gói theo ngày không? | Không có gói daily |
| 2 | Số trong "1 x Yearly" là gì? | Độ dài kỳ hạn (`duration_value`) |
| 3, 4 | Gói theo tháng hiện thế nào? | "6 x Monthly · $X paid" |
| 5 | Có đổi chữ ở Term không? | Không |

## 9. Dành cho agent: thêm action, map data từ server

### Quy tắc làm việc với người dùng (bắt buộc)

- **Chỉ code khi người dùng nói "code đi".** Trước đó chỉ phân tích và đề xuất.
- Trước mỗi phần việc, đi theo flow: (1) đã đủ text hiển thị chưa, (2) đã nắm bố cục chưa, (3) còn thiếu gì cần người dùng hỗ trợ.
- Chỉ sửa trong `lib/features/cloud_storage/` và `lib/module_bridge/`. **Không sửa code đang ổn định** (ví dụ `Toast.showCloud`, `StorageFullBanner`, `plan_expired_popup.dart`); thêm file hoặc class mới thay thế.
- Tuân theo [layer-rules.md](../../../_rule/cloud/layer-rules.md). Những điểm hay vấp ở màn này:
  - `shared/` (kể cả `page_basic_widget.dart`) **không được import `pages/`**. Cần mở gì thuộc `pages/` thì đi qua `CloudStorageNavigator` (navigator được phép biết pages). Đó là lý do có `openMySubscriptionDebugPicker`.
  - Cubit **không gọi `getIt`**; nhận use case qua constructor.
  - Widget chỉ được `getIt<MySubscriptionCubit>()`, không được `getIt` use case hay repository.
  - `pages/` không import `data/` hay `package:grpc/`.
- Text mới phải qua `/add-l10n` (đủ 12 locale). Kiểm tra bằng `/analyze-cloud` hoặc `dart analyze <path>`, **và** `dart tool/check_layers.dart --summary` (chạy trong `lib/features/cloud_storage`) phải ra `No new violations`. Xong việc thì cập nhật doc này.

### Thêm một action

1. **Nút mới:** thêm giá trị vào `enum PlanAction`, thêm nhánh trong `_buildAction` (label + `_ActionButton.primary` / `.secondary` + handler), rồi thêm vào `actions` của mock cần thiết.
2. **Action đã có:** thay `() {}` hoặc `TODO` tại chỗ nối ở [mục 7](#7-action). Ưu tiên dùng hàm có sẵn trong `CloudStorageNavigator`.
3. **Action gọi server:** thêm hàm vào `MySubscriptionCubit`, cập nhật state; lỗi thì tăng `errorToastCount` để page toast. Không gọi use case trong widget. (Hiện không còn action nào gọi server; Renew chỉ điều hướng.)
4. **Lỗi trên màn này:** `CloudBannerToast.show(message:, isError: true)`, do listener của page bắn.

### Map data từ server

**Đã nối xong** theo các bước dưới; đặc tả nguồn dữ liệu, quy đổi dung lượng và bảng map nằm ở [mục 8](#8-kết-nối-be). Khi sửa logic map thì sửa `MySubscriptionMapper` và cập nhật bảng ở mục 8.

| # | Bước | Trạng thái |
|---|---|---|
| 1 | Use case: `GetStorageSubscriptionUseCase` (mới, `@injectable`, trong `domain/use_cases/subscription/`) + `RefreshUsedSpaceUseCase` (có sẵn), rồi `/build -get` | ✅ |
| 2 | `MySubscriptionMapper` (hàm thuần, không `BuildContext`) trong `pages/new_upgrade/my_subscription/mappers/`. Luật nghiệp vụ thuần đặt ở entity / use case bằng Dart thuần (`domain/` không được import Flutter) | ✅ |
| 3 | Constructor chính `@injectable MySubscriptionCubit(...)` nhận use case; `_fetch` = gọi use case rồi gọi mapper. **Không gọi `getIt` trong cubit** | ✅ |
| 4 | `_MySubscriptionPageState._createCubit` dùng `getIt<MySubscriptionCubit>()`, giữ nhánh `preview` cho nút debug | ✅ |
| 5 | Unit test cho mapper (mỗi dòng của bảng map ở mục 8 một case, đối chiếu `MySubscriptionMocks`) và cubit (thành công / lỗi / refresh lỗi giữ nội dung / response cũ bị bỏ) | ⏳ chưa có |
| 6 | `check_layers --summary` → `No new violations` | chạy lại sau mỗi lần sửa |

## 10. Preview và mock

Nút debug (`_onDebugMySubscription` trong `PageBasicWidget`, FAB màu chàm, icon `workspace_premium`) chỉ hiện khi `isDev` hoặc `kDebugMode`. Bấm vào gọi `CloudStorageNavigator.openMySubscriptionDebugPicker` → `showMySubscriptionDebugPicker` (`pages/debug/my_subscription_debug_picker.dart`), mở sheet liệt kê `MySubscriptionMocks.all` và mục **"Load error"** (giả lập lỗi tải). Mỗi mock hiện màn loading khoảng 600ms trước khi hiện nội dung.

| Picker | Mock | Dữ liệu chính |
|---|---|---|
| Free – No Subscriptions | `free` | Free 5GB, đã dùng ≈ 3.1GB |
| Free – Subscriptions Expired (Renew → error toast) | `freeExpired` | Free 5GB, đã dùng 120GB. Gói cũ Standard 200GB, 1 year, $917.99, 31 Jan 2025 → 31 Jan 2026 |
| Standard – Active | `standardActive` | 200GB, 1 x Yearly, $917.99, 30 Jan 2026 → 30 Jan 2027, còn 365 ngày, đã dùng 1.2GB |
| Standard – Expired Soon (used > free) | `standardExpiredSoon` | đã dùng 120GB, còn 5 ngày, alert có mô tả |
| Standard – Expired Soon (used ≤ free) | `standardExpiredSoonFitsFree` | đã dùng 1.2GB, còn 5 ngày, alert chỉ có tiêu đề |
| Standard – Pending | `standardPending` | badge Pending, còn 365 ngày |
| Standard – Discontinued Plan | `standardDiscontinued` | badge Active, còn 104 ngày |
| Load error | không có | `MySubscriptionCubit.unavailable()` → màn lỗi + Retry |

Mở màn **không kèm mock** (luồng thật) thì page dùng `getIt<MySubscriptionCubit>()` và lấy dữ liệu từ BE ([mục 8](#8-kết-nối-be)). Mock dựng view model trực tiếp (không qua mapper), nên `daysLeft` của mock là số gán sẵn, không tính theo ngày hiện tại.

Các mock Standard (trừ `standardActive`) dùng chung helper `_standard(badge:, usedBytes:, daysLeft:, alert:)`. Thêm frame mới thì thêm mock và thêm một dòng vào `all`.

## 11. Quyết định thiết kế và lệch so với Figma

| Mục | Quyết định |
|---|---|
| Progress bar | Dùng lại `StripedProgressBarWidget` của Home, kể cả màu theo ngưỡng: < 50% xanh, ≥ 50% vàng, > 70% đỏ. Figma vẽ màu xanh ở 50%; đây là lệch có chủ ý để đồng nhất với Home |
| Vượt quota | Bar dừng ở 100%, "% used" tối đa 100 (làm tròn xuống, nên chỉ ra 100 khi thật sự đầy), "Free" là `0 GB`, không ra số âm |
| Dung lượng | `1.2 GB` (có dấu cách), theo `FileUtils.getReadableByte` giống Home, khớp Figma |
| Ngày | Đổi sang giờ máy rồi format theo locale, cùng quy tắc với `plan_expired_popup.dart`: `en` ra "31 Jan 2026", locale khác dùng `DateFormat.yMMMd` (ví dụ `2026年1月31日`) |
| Số tiền | `planAmount(amount, 'USD')` (`NumberFormat.simpleCurrency` theo locale): luôn hiện `$` như Figma, bỏ qua `currency` của BE (ví dụ `USDT`) |
| Card gói trả phí | Mọi gói (Standard, Lite, Pro…) dùng chung `PlanCardStyle.standard` |
| Shadow bottom panel | Một shadow chung cho mọi màn. Trong Figma có frame dùng blur 8 / 4%, có frame dùng blur 16 / 2% |
| Nền dưới home indicator | Là màu nền màn, không phải màu trắng của panel (do `SafeArea` nằm trong `PageBasicWidget`). Giống `SubscribePlanPage` |
| Copy placeholder trong Figma | Các alert và nút ("Your plan expires in 5 days", "Backup Secret Phrase") được thay bằng copy đã chốt ở [mục 6](#6-text-và-l10n) |
| Expired Soon | Figma có nút "Do it later"; đã đổi thành "Upgrade" theo yêu cầu |
| Pending | Figma dùng icon tam giác; đã đổi thành `icNotificationInfo` giống Discontinued. Copy gốc "You payment" đã sửa thành "Your payment" |
| Toast | Viền trong bản export là `#000000` đặc; code dùng đen 5% (chờ xác nhận) |

## 12. Câu hỏi còn mở và việc còn lại

**Câu hỏi còn mở**

*Kết nối BE ([mục 8](#8-kết-nối-be)):*

| # | Câu hỏi / TODO | Hỏi ai | Ghi chú |
|---|---|---|---|
| 1 | Renew: response `GetStorageSubscription` không có `plan_id` | VN BE | Renew đã đổi sang mở danh sách gói, gói cũ được tìm theo tên / quota (`CurrentPlanModelView.findIn`). Có `plan_id` thì match chính xác hơn |
| 2 | `daysLeft` tính bằng đồng hồ máy, có thể lệch 1 ngày so với `is_expiring_soon` | VN BE | Xin BE trả sẵn field số ngày còn lại |
| 3 | Có cần tự tải lại (polling) khi đang Pending để màn tự chuyển sang Active không? Hiện chỉ có kéo để làm mới | người dùng / PM | Còn mở |
| 4 | Với hệ subscription mới, `buy_space` còn dùng không? `free_space` có đổi khi mua gói không? | HK BE | Ảnh hưởng `totalBytes` và `freeDefaultBytes` |
| 5 | Discontinued (`available_to_renew`) có thể chuyển sang gRPC riêng | VN BE | Khi đó chỉ sửa dòng 4 của bảng map |
| 6 | Tổng ở usage (`UserSpace.totalBytes`) có thể khác quota gói trên card | | Kiểm tra với dữ liệu thật |

*UI:*

- Viền `CloudBannerToast`: đen đặc hay đen 5%? Cần designer xác nhận.
- Dark mode của alert neutral: hiện nền chuyển sang trắng mờ, chưa được xác nhận.

**Việc còn lại**

- Chạy app với dữ liệu thật (đủ các nhánh của bảng map), và so 7 mock với Figma ở light và dark.
- Rà các locale có chữ dài (`ru`, `id`, `hi`) trên máy thật. Badge, `PlanHeader` và nút đều có `maxLines: 1` + ellipsis.
- Chưa có unit test cho `MySubscriptionMapper` và `MySubscriptionCubit`.
- Label mock trong debug picker "Free – Subscriptions Expired (Renew → error toast)" đã cũ: Renew giờ mở danh sách gói.
- `check_layers --summary` còn 1 vi phạm mới **ngoài màn này**: `pages/storage_management/cubit/storage_category_files_cubit.dart:2` import `data/mapper/storage_file_mapper.dart` (rule `presentation`). Pre-push hook sẽ chặn cho tới khi sửa.

**Để sau (review 2026-10-08)**

| # | Vấn đề | Chỗ | Đề xuất |
|---|---|---|---|
| R4 | Comment "Only what the free tier cannot hold is at risk" nhưng code truyền **toàn bộ** `usedBytes` (dùng 8 GB, Free 5 GB → "keep 8 GB", không phải 3 GB) | `MySubscriptionMapper`, `PlanExpiringSoonAlert.atRiskBytes` | Đối chiếu design: giữ code và sửa comment, hoặc đổi sang `usedBytes - freeDefaultBytes` |
| R5 | Nhánh 2 của bảng map (`ACTIVE` thiếu ngày, status lạ) vẫn truyền `planName: plan?.name` → "You're on the **Standard** plan" kèm quota Free | `MySubscriptionMapper.map`, nhánh 2 | Để `planName: null` ở nhánh này |
| R6 | Route cast `state.extra as MySubscriptionViewModel?`: `extra` khác kiểu thì crash | `shared/routes/cloud_storage_route_provider.dart` | `extra is MySubscriptionViewModel ? … : null`, hoặc chặn bằng `kDebugMode` |
| R7 | `MySubscriptionCubit.unavailable()` | `my_subscription_cubit.dart` | Kiểm tra debug picker ("Load error") còn dùng không; không dùng thì xoá |

Lặt vặt (không gấp): logic màu đường kẻ (dark trắng 10% / light đen 5%) lặp ở skeleton, `_UsageBox`, `SubscriptionDetailCard`, có thể gom một chỗ.
- Người bản ngữ rà bản dịch `lo`, `hi`, `ur` của 32 key mới (do AI dịch). Ghi chú bản dịch: `id` dịch cả "Expired" lẫn "Expired on" là "Berakhir"; `ja` rút gọn thành "マイサブスク" / "最新のサブスク"; `ru` "{amount} paid" là "Оплата {amount}" để vừa độ rộng.
- `page_basic_widget.dart` còn 2 warning có từ trước (`_onDebugDatePicker`, `showDebugLanguageSwitcher`), không thuộc màn này.

## 13. Lịch sử theo giai đoạn

Màn được làm theo 7 giai đoạn, mỗi giai đoạn tương ứng một frame Figma.

| # | Frame | Thêm mới | Key l10n mới |
|---|---|---|---|
| 1 | Free – No Subscriptions | Khung màn, route, nút debug, `PlanStorageCard`, `FreePlanInfo`, `PlanBottomPanel` | 8 |
| 2 + 3 | Free – Subscriptions Expired / Something went wrong | `PlanStatusBadge` (expired), `SubscriptionDetailCard`, `PlanAlertBanner` (danger), 2 nút, xử lý vượt quota, helper định dạng ngày, `CloudBannerToast` | 9 |
| 4 | Standard – Active | `PlanHeader`, `CurrentSubscriptionViewModel`, badge active | 7 |
| 5 | Standard – Expired Soon | badge expiredSoon, alert warning, `PlanExpiringSoonAlert` (mô tả tuỳ chọn) | 3 |
| 6 + 7 | Standard – Pending / Discontinued Plan | badge pending, alert neutral, `PlanPendingAlert`, `PlanDiscontinuedAlert`, helper mock `_standard` | 5 |

Sau 7 giai đoạn:

- Thêm `MySubscriptionCubit` (loading / error / refresh / Renew). Route `extra` chuyển thành tuỳ chọn (`previewViewModel`).
- Sửa 2 vi phạm rule `shared` (`page_basic_widget.dart` import `pages/`): tách picker sang `pages/debug/my_subscription_debug_picker.dart`, mở qua navigator.
- **Nối BE:** thêm entity `StorageSubscription`, `StorageSubscriptionRepository` + impl + gRPC mapper, `GetStorageSubscriptionUseCase`, `MySubscriptionMapper`; cubit thành `@injectable`, page dùng `getIt<MySubscriptionCubit>()`. Bỏ `currency` khỏi view model (luôn `$`), `daysLeft` tính ở client, thêm key `termMonths` (1 key l10n mới). Chi tiết ở [mục 8](#8-kết-nối-be).

**Sửa 2026-10-13:**

- View All Plans: `pushStorageManagement` → `pushUpgradeStorage` (mở danh sách gói, không trùng đích với Manage Storage).

**Kiểm tra map gRPC → UI 2026-10-09** (spec: `.claude/document/upgrade/docs/ba/my-subscription-grpc-mapping-audit.md`):

- Không có sai lệch so với các quyết định đã chốt; chốt thêm D1–D12.
- Đã code: quota Free = 0 → 5 GiB (BR-07), tên gói rỗng → "-" (BR-13), usage live qua `WatchUserSpaceUseCase` (BR-14), tải lại khi quay về màn qua `didPopNext` (BR-15), "View plan" trên popup thanh toán thành công → My Subscription, không push trùng nếu đang ở đó (BR-17, `finishPlanPayment`), log khi rơi vào nhánh phòng hờ.

**Review 2026-10-08:**

- Ngày đổi `toLocal()` trước khi format (trước đó hiện theo UTC, có thể lệch 1 ngày).
- `percentUsed` làm tròn xuống; doc / comment dung lượng sửa thành `5 GB` (có dấu cách, đúng output).
- Không có gói daily: `billingCycle` / `termCycle` không null, xoá nhánh `null` (hết 4 warning analyzer), mapper coi đơn vị lạ là Monthly.
- Renew: bỏ `renew()` / `isRenewing` (luôn toast lỗi), đổi sang `pushUpgradePlan` từ `LatestSubscriptionViewModel`. View All Plans → `pushStorageManagement`.
- Các mục để sau ghi ở [mục 12](#12-câu-hỏi-còn-mở-và-việc-còn-lại) (R4–R7).
- PENDING: nút ở đáy đổi từ Upgrade thành **Contact Support** (`PlanAction.contactSupport`, đích còn `TODO`).
- VN BE xác nhận: chỉ có 4 status (`ACTIVE`, `PENDING`, `EXPIRED`, `FREE`); `ACTIVE` / `PENDING` / `EXPIRED` luôn có `plan`, `FREE` luôn không có `plan`.

Thay đổi xuyên giai đoạn: dòng nhỏ của card ban đầu là "Your {plan} plan" (`yourPlanName`), sau đó đổi thành text cố định theo style (`yourFreePlan` / `yourPlanStorage`), và key cũ đã bị xoá.
