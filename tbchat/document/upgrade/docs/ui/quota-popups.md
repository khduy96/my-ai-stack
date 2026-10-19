# Quota Popups (Cloud Drive)

Ba popup giữa màn hình, dùng chung một layout, chỉ khác nội dung:

| Popup | Tiêu đề | Khi nào hiện |
|---|---|---|
| Plan expired | "Your {plan} plan is expired" | Một lần mỗi phiên, khi vào tab Cloud và subscription có `display_status == EXPIRED`. Ưu tiên hơn Storage full |
| Storage is full | "Storage is full" | Một lần mỗi phiên, khi vào tab Cloud, quota đã đầy và phiên chưa hiện Plan expired. |
| Not enough storage | "Not enough storage" | Mỗi lần upload vượt dung lượng còn trống |

Mỗi phiên chỉ tự hiện **tối đa một** popup: Plan expired hoặc Storage is full.

## File

| File | Nội dung |
|---|---|
| `lib/features/cloud_storage/shared/widgets/quota_popup_frame.dart` | `showQuotaPopup`, `QuotaPopupFrame`, `QuotaInfoRow`: layout chung và hiệu ứng scale/fade |
| `lib/features/cloud_storage/shared/widgets/storage_limit_popup.dart` | `showStorageLimitPopup`, `StorageLimitType { full, notEnough }` |
| `lib/features/cloud_storage/shared/widgets/plan_expired_popup.dart` | `showPlanExpiredPopup` |
| `lib/features/cloud_storage/shared/utils/storage_limit_guard.dart` | `StorageLimitGuard`: cờ phiên, cache subscription, chọn popup của phiên, kiểm tra upload |
| `lib/features/cloud_storage/pages/home/cubit/storage_session_popup_cubit.dart` | `StorageSessionPopupCubit`: cung cấp `loadSubscription` và `loadRecycleBinBytes` cho guard |
| `domain/repositories/trash_overview_repository.dart`, `domain/use_cases/recycle_bin/get_trash_size_use_case.dart` | `TrashOverviewRepository.getTrashSize()`, `GetTrashSizeUseCase` |
| `data/_grpc/repositories/management_service_repository*.dart`, `data/repository/recycle_bin/trash_overview_repository_impl.dart` | `ManagementServiceDataSource` (hiện chỉ có `getTrashOverview`; các API Manage Storage khác nên thêm vào đây), `TrashOverviewRepositoryImpl` |

Các chỗ gắn vào code cũ:
- `pages/home/cloud_home_page.dart`: `_quotaSub` (nghe `userSpace`), `_tabChanges` (chuyển tab) và `didChangeDependencies` gọi `StorageLimitGuard.maybeShowSessionPopup`.
- `shared/utils/select_file_utils.dart`: 2 chỗ (`uploadFiles`, `uploadAlbum`), thay popup "Upgrade Reminder" cũ bằng `StorageLimitGuard.canUploadOrShowSheet`.
- `data/repository/cloud_storage_init_repository_impl.dart`: `dispose()` gọi `StorageLimitGuard.resetSession()` khi đăng xuất hoặc đổi account.

## Hành vi

### Popup của phiên (`maybeShowSessionPopup`)

Thứ tự kiểm tra:
1. Bỏ qua nếu phiên đã hiện popup, nếu tab Cloud không hiển thị, hoặc nếu quota chưa về (`freeSpace <= 0`).
2. Lấy subscription (`GetStorageSubscriptionUseCase`). **Luôn chờ API trả về rồi mới xét quota**, để quota về trước không làm Storage full chen lên trước Plan expired.
3. `displayStatus == expired`, có `plan` và có `endTime` → hiện **Plan expired** và dừng.
4. Nếu không → xét điều kiện **Storage is full**.

| Mục | Quyết định |
|---|---|
| Một lần mỗi phiên | Cờ `_sessionPopupShown` chỉ nằm trong bộ nhớ và dùng chung cho cả hai popup. Popup hiện lại khi đăng nhập một account (cờ reset trong `dispose()`) hoặc khi kill app rồi mở lại (bộ nhớ bị xóa) |
| Gọi API subscription | Một lần mỗi phiên, kết quả được cache trong `_subscription` và xóa ở `resetSession()` |
| API lỗi | Bỏ qua Plan expired, xét Storage full như bình thường. Lỗi cũng được cache, nên phiên đó không gọi lại API |
| `EXPIRED` nhưng thiếu `plan` hoặc `endTime` | Bỏ qua Plan expired, xét Storage full |
| Đổi account khi API đang chạy | `_session` tăng trong `resetSession()`. Kết quả của phiên cũ bị bỏ |

### Storage is full

| Mục | Quyết định |
|---|---|
| Điều kiện | `freeSpace > 0 && useSpace >= freeSpace`, giống `StorageFullBanner`. `freeSpace == 0` nghĩa là quota chưa về, không phải đã đầy. ⏳ **Chờ BA confirm**: trong luồng bình thường popup này gần như không bao giờ hiện, xem [Chờ BA confirm](#chờ-ba-confirm) |
| Không hiện khi tab đang ẩn | Kiểm tra `TabVisibilityScope.isShowingIn(context)` (đúng tab đang chọn và `ModalRoute.isCurrent`). **Không** dùng `TickerMode`: `IndexedStack` bọc tab bằng `Visibility(maintainAnimation: true)` nên tab ẩn vẫn có ticker bật |
| Quay lại tab Cloud | Chuyển tab không gọi `didChangeDependencies`, nên `cloud_home_page` nghe `TabVisibilityScope.changesIn(context)` (`_tabChanges` của home) để kiểm tra lại. Pop route đè lên thì `didChangeDependencies` tự chạy (do `ModalRoute.of` đăng ký dependency) |
| Quota về muộn | `cloud_home_page` nghe `homeView.bloc.stream` và kiểm tra lại mỗi khi `userSpace` thay đổi |
| Dòng Recycle Bin | Size lấy từ `pb.ManagementService/GetTrashOverview` (`size`), format bằng `FileUtils.getReadableByte(bytes, fractionDigits: 1)`. Chỉ gọi khi Storage full sắp hiện (sau khi đã loại Plan expired). Popup chờ API xong mới mở. API lỗi thì popup vẫn hiện, chỉ ẩn dòng này. Ẩn cả khi size bằng 0 |
| Luồng gọi size Recycle Bin | `cloud_home_page` truyền `StorageSessionPopupCubit.loadRecycleBinBytes` vào `maybeShowSessionPopup` → `GetTrashSizeUseCase` → `TrashOverviewRepository` → `ManagementServiceDataSource.getTrashOverview`. Guard ở `shared/` nên nhận callback, không gọi `getIt` |

### Not enough storage

| Mục | Quyết định |
|---|---|
| Điều kiện | `freeSpace - (useSpace + pendingUploadSize) < tổng dung lượng upload`, cùng công thức với `StorageSpaceUtils.canUploadFiles` |
| Tần suất | Mỗi lần không đủ chỗ, **kể cả khi đã full**. Lúc đó Space available là `0B` màu đỏ, Your file là `{size} (over {size})` |
| `usedBytes` truyền vào popup | `useSpace + pendingUploadSize`, để `available` trong popup khớp với phép kiểm tra |
| `totalBytes` khi `freeSpace <= 0` | Chỉ để hiển thị: `resolveCloudQuotaBytes(freeSpaceDefault, buySpace)` |
| `over` | `uploadBytes - available` |
| Base của dòng Your file | Hiện dùng `kByteConversionBase` (1024) như mọi con số khác của popup. **Chờ BA xác nhận** đề xuất: chỉ số `uploadBytes` đổi sang base 1000 cho khớp với size picker Files hiển thị, còn `over` giữ 1024 cho khớp Space available. Lưu ý picker album (HXPhotoPicker/PictureSelector) lại đếm theo 1024 |

### Plan expired

| Mục | Quyết định |
|---|---|
| Điều kiện | `GetStorageSubscription.display_status == "EXPIRED"`. **Không** xét dung lượng: user chưa gia hạn thì phiên nào cũng hiện, kể cả khi dung lượng đang dùng vẫn nằm trong gói free |
| Ưu tiên | Trùng với Storage full thì chỉ hiện Plan expired |

| Tham số | Ý nghĩa | Nguồn |
|---|---|---|
| `planName` | Tên gói như API trả về, **không dịch** (Standard, Premium…) | `subscription.plan.name` |
| `planBytes` | Dung lượng của gói đã hết hạn, ví dụ 200GB | `subscription.plan.storageBytes` |
| `freeBytes` | Gói free mà user quay về, ví dụ 5GB | `resolveCloudQuotaBytes(freeSpaceDefault:)`, mặc định `kDefaultFreeSpaceBytes` |
| `usedBytes` | `useSpace`. Description ("Your {X} is read-only") và dòng "Your files" ("{X} kept, read-only") **dùng chung** giá trị này, nên hai chỗ không bao giờ lệch nhau | `userSpace.useSpace` |
| `expiredAt` | `DateTime`, format theo locale (xem bên dưới) | `subscription.endTime.toLocal()` (protobuf trả UTC) |

Ngày được format theo `Localizations.localeOf(context).toLanguageTag()`:
- `en` dùng `DateFormat('d MMM y')`, ra `31 Jan 2026`. Mẫu `yMMMd` sẽ ra "Jan 31, 2026", nên phải đặt mẫu riêng.
- Các locale khác dùng `DateFormat.yMMMd(locale)`, ví dụ `2026年1月31日`, `2026년 1월 31일`.
- Nếu locale không có dữ liệu ngày thì quay về mẫu tiếng Anh.

### Nút

| Popup | Nút chính (xanh) | Nút phụ |
|---|---|---|
| Not enough | "Upgrade plan" (`onUpgrade`) → `CloudStorageNavigator.pushUpgradeStorage` | "Manage Storage" (`onManageStorage`) → `CloudStorageNavigator.pushStorageManagement` |
| Storage is full | "Upgrade plan" (`onUpgrade`) → `pushUpgradeStorage` | "Manage Storage" (`onManageStorage`) → `pushStorageManagement` |
| Plan expired | "Renew {plan} Plan" (`onRenew`) → `pushUpgradePlan` với gói vừa hết hạn (xem bên dưới) | "See All Plans" (`onSeeAllPlans`) → `pushUpgradeStorage` |

Bấm nút nào cũng đóng popup (`popScoped`) trước, rồi mới gọi callback.

Cách gắn:
- Gắn hết trong `StorageLimitGuard` bằng 3 hàm private: `_openUpgrade`, `_openStorageManagement`, `_openRenew`. Không sửa `select_file_utils.dart`, `StorageLimitPopup`, `PlanExpiredPopup` hay `QuotaPopupFrame`.
- `QuotaPopupFrame._close` đóng popup rồi mới gọi callback. Callback điều hướng bằng `context` của nơi mở popup (home page hoặc trang upload), nên mỗi hàm phải kiểm tra `context.mounted` trước.
- Not enough: dùng `onUpgrade ?? _openUpgrade`, tương tự cho `onManageStorage`, để callback do nơi gọi truyền vào vẫn được ưu tiên.
- `pushStorageManagement` mở `pages/storage_management/storage_management_page.dart` (route `CloudStorageRoute.storageManagement`). **Không** phải trang cũ `pages/storage_management_page/storage_management_page.dart`: trang này trùng tên class nhưng không có route.
- Popup mở từ nút debug không đi qua guard, nên nút của nó vẫn chỉ đóng popup.

#### Renew {plan} Plan

Mở trang Upgrade với gói vừa hết hạn làm `currentPlan`. Dữ liệu chính là thông tin mà My Subscription hiện ở "Latest Subscription" (`MySubscriptionMapper._expired`), lấy từ `subscription` mà guard đã có lúc mở popup, nên **không gọi lại API**.

| Field của `CurrentPlanModelView` | Giá trị |
|---|---|
| `name` | `plan.name` |
| `storageQuotaBytes` | `plan.storageBytes` |
| `billingCycle` | `plan.durationUnit`: `month` → `PlanBillingCycle.month`, `year` → `PlanBillingCycle.year` |
| `durationValue` | `plan.durationValue` |
| `expiresAt` | `endTime`, là một ngày đã qua |
| `unusedValue` | `0`: gói đã hết hạn, không còn giá trị để trừ |
| `currency` | `plan.currency` |

Tham số `usedBytes` của `pushUpgradePlan` là `userSpace.useSpace`.

`durationUnit == unsupported` (ví dụ `DAY`): mở `pushUpgradeStorage` như gói free, giống TODO trong `_openUpgrade` của My Subscription. Mapper của My Subscription thì map `unsupported` thành `monthly`, nhưng ở đây không đoán, vì đoán sai sẽ đánh dấu nhầm card trên trang Upgrade.

Các vấn đề thấy khi review, **chưa quyết**:
- **Prod:** `pushUpgradeStorage` trên prod chỉ hiện toast "Coming soon", còn `pushUpgradePlan` không kiểm tra `isProd`. Vì vậy trên prod, Renew mở thẳng trang Upgrade trong khi 5 nút còn lại chỉ hiện toast.
- **Card của gói cũ:** `SubscriptionPlanCard` hiện "Your current plan expires on {date}" (`currentPlanExpiresOn`) với một ngày đã qua.
- **Tóm tắt giá:** chọn gói khác thì `PlanUpgradeSummary` hiện dòng "Unused {plan} value  - $0.00".

Lưu ý: popup "Upgrade Reminder" cũ trong luồng upload từng mở `CloudStorageNavigator.pushUpgradeStorage`. Nay nút "Upgrade plan" của Not enough mở lại đúng trang đó.

## Spec giao diện

Popup là `Dialog` có `insetPadding` ngang 16, nên trên điện thoại luôn cách mỗi mép 16px. `maxWidth: 600` chỉ để popup không kéo giãn hết màn hình tablet.

Chiều cao trong Figma (504, 522, 356…) **không** đưa vào code: chiều cao theo nội dung, và nội dung sẽ cuộn nếu màn hình thấp.

| Thành phần | Giá trị | Token |
|---|---|---|
| Card | radius 20 | Nền light `#FAFAFA` (hard-code, giống `CloudLimitPopup`), dark `cloudColors.neutral10` |
| Vùng header | padding 32/16/16, gap 16, viền dưới `textColor` alpha 0.1 | |
| Badge | tròn 64×64, đỏ alpha 0.1 | `cloudColors.red0` |
| Icon trong badge | Storage: `assets.icAlertTriangle` 38px. Plan expired: `Icons.close` 32px, `red0` | |
| Tiêu đề | 18 / 27, w600 | `cloudTextThemeBaseLine.titleLarge`, `textColor` |
| Mô tả | 14, line-height 1.3 | `bodyMedium`, `neutral30` (`#7B7B7B` ở cả hai mode) |
| Card thông tin | padding 12, gap 12, radius 8; viền và đường kẻ 1px `textColor` alpha 0.05 | Nền light trắng, dark trắng 5% |
| Label dòng | 12, line-height 1.4 | `bodySmall`, `neutral40` (light `#555555`, dark `#C4C4C4`) |
| Value thường | 12, w500 | `neutral50` (light `#262626`, dark `#E9E9E9`) |
| Vùng nút | padding 16, gap 12 | |
| Nút | cao 52, radius 28, chữ 16 w500 màu `textColor` | Nút chính `green0`. Nút phụ: light xám `#8B8B8B` 20% + viền `#C4C4C4`; dark trắng 20%, không viền |
| Nút đóng | 44×44, `right: 11.5`, `top: 12`, `Icons.close` 24 | `textColor` |

### Màu của value

| Dòng | Màu |
|---|---|
| Space available | **đỏ** khi bằng `0B`, còn lại **xanh** |
| In Recycle Bin | luôn xanh |
| Your file (dung lượng đang upload) | luôn đỏ |
| Now: Free - {size} | đỏ |
| Used, Was, Your files | màu value thường (`neutral50`) |

### Khác biệt so với Figma

- Icon X trong badge của Plan expired dùng `Icons.close` thay cho vector x-alt của designer, vì project không có asset X màu đỏ.
- `backdrop-filter: blur(4px)` của nút phụ không được làm.
- Nút đóng ở light không có nền `rgba(255,255,255,0.2)`. Nền này vốn không nhìn thấy trên `#FAFAFA`.
- Chữ nút chính: Figma đen ở light, trắng ở dark. Code dùng `textColor` nên cho cùng kết quả.

## L10n (12 locale, module cloud)

Tái dùng: `storageFullTitle` ("Storage is full"), `manageStorage` ("Manage Storage").

| Key | Placeholder |
|---|---|
| `storageLimitNotEnoughTitle` | |
| `storageLimitFullDesc` | `{total}` |
| `storageLimitNotEnoughDesc` | |
| `storageLimitUsed`, `storageLimitSpaceAvailable`, `storageLimitInRecycleBin`, `storageLimitYourFile` | |
| `storageLimitUsedOfTotal` | `{used}`, `{total}` |
| `storageLimitRecoverable` | `{size}` |
| `storageLimitOverSize` | `{size}`, `{overSize}` |
| `storageLimitUpgradePlan` | |
| `planExpiredTitle` | `{plan}` |
| `planExpiredDesc` | `{date}`, `{freeSize}`, `{usedSize}` |
| `planExpiredWas`, `planExpiredNow`, `planExpiredYourFiles` | |
| `planExpiredPlanSize` | `{plan}`, `{size}` |
| `planExpiredFreeSize` | `{size}` |
| `planExpiredKept` | `{size}` |
| `planExpiredRenew` | `{plan}` |
| `planExpiredSeeAllPlans` | |

Dung lượng được format bằng `FileUtils.getReadableByte(bytes, fractionDigits: 1)`, theo base `kByteConversionBase` (1024): có khoảng trắng trước đơn vị (`5 GB`, `820 MB`), bỏ số 0 thừa ở cuối (`5.0` → `5`).
Bản dịch ngoài `en` do AI dịch, sau đó đã được người bản ngữ rà lại.

## Nút debug (test UI)

Nằm trong `shared/widgets/page_basic_widget.dart`: FAB màu đỏ (`Icons.storage`, `bottom: 152`), chỉ hiện khi `isDev` hoặc `kDebugMode`. Mỗi lần bấm sẽ luân phiên:
1. Storage full: 5GB of 5GB, 820MB recoverable
2. Not enough: 3GB of 5GB, upload 3GB
3. Plan expired: Standard 200GB → Free 5GB, 187GB, hết hạn 31/01/2026

**Gỡ nút và biến `_debugQuotaPopupIndex` trước khi commit.**

## Chờ BA confirm

Review với spec `Mobile_Cloud Drive.docx` ngày 07/10/2026. **Chưa sửa code**, chờ BA trả lời.

### 1. Spec không có popup Storage is full (và cả Plan expired)

| Chỗ trong spec | Nội dung | Có phải popup Storage is full không |
|---|---|---|
| §1.6 Design | "Mobile — Storage Full state (*contextual, e.g. at upload time*)" | Không. Đây chỉ là màn hình suy đoán: spec ghi "Design: Not required… exact screen boundaries/names are not confirmed" |
| US-11, BR-09 | Định nghĩa trạng thái Full (`Used >= Available`), hành động nào được phép, hành động nào bị chặn | Không. Chỉ có logic, không có UI |
| US-12, BR-18 | Popup "Not enough space. This upload needs {needed}…" | Không. Đây là popup **Not enough storage** |
| US-26 AC-01, BR-19/20 | Notification "Storage is full" | Không. Đây là notification |

Popup Plan expired cũng không có trong spec. Spec chỉ liệt kê "Mobile — Package Expiration touchpoints" mà không mô tả gì thêm.

Như vậy các quyết định ở mục [Popup của phiên](#popup-của-phiên-maybeshowsessionpopup) (một lần mỗi phiên, hiện khi vào tab Cloud, Plan expired được ưu tiên, copy, dòng Recycle Bin) đều không lấy từ spec, mà từ Figma hoặc do dev tự chốt. Spec chỉ gợi ý UI Full xuất hiện *khi upload*, và case đó đã được popup Not enough storage phủ: nó hiện mỗi lần upload, kể cả khi đã full.

### 2. Trong luồng bình thường popup gần như không bao giờ hiện

- BR-18 chặn mọi upload không vừa chỗ còn trống, §5.3 chặn mọi cách vượt quota, và chạm quota đúng từng byte gần như không xảy ra. Vì vậy `useSpace >= freeSpace` thực tế chỉ xảy ra khi **gói hết hạn → quota về free 5GB → data vẫn > 5GB**. Phân tích chi tiết ở mục 1 của [storage-full-banner.md](storage-full-banner.md#chờ-ba-confirm).
- Đúng lúc đó subscription có `display_status == EXPIRED`, nên **Plan expired thắng** (được ưu tiên, mỗi phiên tối đa một popup).

Storage is full chỉ còn hiện trong các case sau:

| Case | Bản chất |
|---|---|
| `GetStorageSubscription` lỗi (lỗi được cache cả phiên) | Fallback khi lỗi |
| `EXPIRED` nhưng thiếu `plan` hoặc `endTime` | Dữ liệu BE thiếu |
| Over quota nhưng `display_status` không phải `EXPIRED` | Chưa rõ, xem câu hỏi 2 bên dưới |
| Vượt quota không do hết hạn (restore từ Recycle Bin, admin giảm free tier, usage từ platform khác) | Spec chưa nói tới |

Ngoài ra, ở case fallback (thực chất là user đã hết hạn), copy "Your {total} plan is full" làm "Your 5GB plan" nghe như user đang có một gói 5GB.

So với banner:

| | Banner | Popup Storage is full |
|---|---|---|
| Điều kiện | `used >= total` | `used >= total` và không phải `EXPIRED` |
| Case thực tế | Hết hạn + over quota | Gần như không có (chỉ fallback) |
| Copy hợp với | Case hết hạn ("renew", "free limit") | Case đầy thật ("upgrade") |

### 3. Tổng quota có thể lệch BR-05

`freeSpace = free_space + buy_space` do Mobile tự cộng, trong khi BR-05 nói gói 200GB thì Available Storage là 200GB, không phải 205GB. Lỗi này ảnh hưởng cả 3 popup, kể cả phép kiểm tra của Not enough storage. Chi tiết ở mục 3 của [storage-full-banner.md](storage-full-banner.md#chờ-ba-confirm).

### Câu hỏi cho BA / BE

1. **BA:** Popup Storage is full và Plan expired tự hiện khi vào tab có phải yêu cầu chính thức không? Nếu có, cần bổ sung vào spec: trigger, tần suất, thứ tự ưu tiên, copy. Nếu Figma là nguồn chính thức thì Figma có ghi điều kiện hiển thị không?
2. **BE:** `display_status == EXPIRED` có tồn tại mãi không? Nếu có, user over quota sẽ thấy Plan expired mỗi phiên vĩnh viễn và Storage is full không bao giờ hiện với họ. Nếu sau một thời gian status chuyển sang trạng thái khác, Storage is full mới tiếp quản.
3. **BA:** Popup Storage is full dành cho ai, khi case over quota đã có Plan expired lo?
4. **BA / BE:** File trong Recycle Bin có tính vào usage không? (Dòng "In Recycle Bin … recoverable" trong design đang ngầm hiểu là có.) Restore có bị chặn khi không đủ chỗ không?
5. **BE:** `buy_space` là phần mua thêm hay dung lượng của gói (BR-05)?

### Hướng xử lý sau khi BA trả lời

- **(a)** Đổi trigger của Storage is full sang ngưỡng "gần đầy" (US-13, ví dụ ≥ 90% hoặc còn ít hơn X MB). Copy hiện tại vẫn dùng được nếu sửa nhẹ.
- **(b)** Giữ nguyên, chấp nhận popup chỉ là fallback khi API lỗi.
- **(c)** Bỏ popup Storage is full, chỉ giữ Not enough storage (có trong spec) cùng Plan expired và banner cho case hết hạn.

## Việc còn lại

- ⏳ Chờ BA confirm điều kiện hiển thị của Storage is full, xem [Chờ BA confirm](#chờ-ba-confirm).
- Quyết định 3 vấn đề của nút Renew (prod, card gói cũ, tóm tắt giá), xem [Renew {plan} Plan](#renew-plan-plan).
- BA xác nhận base (1000 hay 1024) cho số `uploadBytes` của dòng Your file, xem [Not enough storage](#not-enough-storage).
