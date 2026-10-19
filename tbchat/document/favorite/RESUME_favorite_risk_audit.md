# RESUME — Rà soát rủi ro trang Favorite (nhóm A đã fix, B→F còn treo)

> **Mục đích doc**: nối tiếp công việc ở một cuộc trò chuyện khác. Đọc §0 → §2 để lấy
> trạng thái, §3 để biết đã sửa gì, §4→§6 để biết còn gì phải làm.
> **Phạm vi rà soát**: `lib/features/cloud_storage/pages/favorite` (17 file, ~2.7k dòng)
> + các thành phần nó phụ thuộc (`PaginationController`, `BasePaginationCubit`,
> `ItemMetaController`, `FavoriteMoveBus`/`FavoriteExternalBus`/`FavoriteCache`,
> `searchFavorites`, `search_mapper`, `selectFavoriteOptionsSheet`).
> **Ngày**: 2026-09-08.
> **Branch**: submodule `lib/features/cloud_storage` = `felix/refactor-cloud`;
> repo cha `tbchat_CS_Fav` = `new_cloud_storage`.

---

## 0. Trạng thái nhanh

| Nhóm | Nội dung | Trạng thái |
|---|---|---|
| **A1** | Request lỗi xoá trắng list | ⏸️ **HOÃN** (user chốt) — thiết kế đầy đủ ở §4 |
| **A2** | `reloadKeepingPosition` không guard | ✅ ĐÃ FIX — commit `db49bfa7` |
| **A3** | Folder picker crash khi không có favorite root | ✅ ĐÃ FIX — commit `db49bfa7` |
| **A4** | Mapper: 1 item lỗi mất cả trang | ✅ ĐÃ FIX — commit `548004b2` |
| **A5** | Multi-delete xoá cache trước khi biết kết quả | ✅ ĐÃ FIX — commit `db49bfa7` |
| **B→F** | ~30 rủi ro logic / hiệu năng / leak / navigation | ⬜ CHƯA LÀM — liệt kê ở §6 |
| Ngoài scope | 3 mục cố ý bỏ qua | ⬜ §5 |

**Verify đã chạy**: `dart analyze lib/features/cloud_storage` → **0 error**, 313 warning/info
(toàn bộ là noise có sẵn; không có issue nào dính symbol vừa sửa).
**CHƯA test tay.**

---

## 1. Ghi chú môi trường (tiết kiệm thời gian cho session sau)

- `lib/features/cloud_storage` là **git repo
- riêng** (có `.git` riêng), và ở repo cha nó hiện
  dưới dạng `??` untracked — **không phải submodule đã đăng ký**. ⇒ Mọi lệnh `git` cho code
  cloud phải `cd` vào `lib/features/cloud_storage`; không cần cập nhật submodule pointer ở cha.
- **Không có `python`** trên máy (chỉ có stub WindowsApps). Có `perl`, `awk`, `sed`.
- **Toàn bộ file `.dart` dùng CRLF**. Khi sửa bằng `perl -0777`, anchor phải dùng `\r\n`,
  và text mới phải convert `s/\r?\n/\r\n/g` trước khi ghi, nếu không sẽ lẫn line ending.
- Lệnh analyze scoped: `dart analyze lib/features/cloud_storage` (mất ~2-4 phút).
- Heredoc bash với nội dung markdown lớn hay bị parse lỗi — dùng Write tool cho doc.

---

## 2. Quyết định đã chốt với user

1. **A1 → HOÃN.** User chọn "Hoãn A1, chỉ làm A2-A5". Không sửa code hạ tầng dùng chung
   (`PaginationController` / `BasePaginationCubit`) trong đợt này.
2. **UX khi refresh lỗi → "Toast lỗi + giữ list cũ".** Áp dụng cho đường refresh **do user
   chủ động** (pull-to-refresh, đổi filter, search) — tức là thuộc A1, chưa triển khai.
   ⚠️ Đường background resync (A2) **cố ý KHÔNG toast**: user không yêu cầu refresh đó,
   toast sẽ thành noise. Đây là lý do `reloadKeepingPosition` chỉ log, không toast.

---

## 3. ĐÃ IMPLEMENT — chi tiết nhóm A (trừ A1)

### A5 — Multi-select delete xoá `FavoriteCache` trước khi biết API thành công
**File**: `shared/utils/sheet_helper.dart` → `selectFavoriteOptionsSheet`, nhánh `onDelete`
(quanh dòng 1940-1962).

**Vấn đề**: `FavoriteCache.instance.removeMultiple(unFavIds)` chạy **trước** guard
`if (!deleted)`. Delete thất bại → sao vàng vẫn mất khắp app, không rollback.

**Đã sửa**: chuyển `removeMultiple` xuống **sau** guard `if (!deleted) { toast; return; }`.
Nay khớp với đường single-item (`deleteFavoriteItem` trong
`pages/favorite/mixin/favorite_external_action_mixin.dart`) vốn đã đúng thứ tự.

---

### A2 — `reloadKeepingPosition` không guard
**File**: `pages/favorite/cubit/favorite_cubit.dart` ≈ dòng 216-260.

**Vấn đề**: là bản copy của `RecycleBinCubit._resyncFromDbChange`
(`pages/recycle_bin/cubit/recycle_bin_cubit.dart:100-124`) nhưng **rụng các guard**:

| recycle_bin (đúng) | favorite (trước khi sửa) |
|---|---|
| `if (isClosed) return;` | không có |
| `if (result.hasError) return;` | không có |
| `requestedLimit: limit` | không truyền → `isLastPage` tính theo `limit=20` |

Thêm nữa `_scheduleRealtimeRefresh` truyền `reloadKeepingPosition` (trả `Future`) vào
`Timer(...)` nhận `void` ⇒ Future không ai await ⇒ exception thoát thành **unhandled async
error** (vì `searchFavorites` vẫn `rethrow`).

**Đã sửa**:
- bọc `try/catch` + `CloudLogger.e(e, stackTrace: stack)` (thêm import `cloud_logger.dart`);
- `if (isClosed) return;` sau await;
- `if (result.hasError) return;` — hiện chưa bao giờ true (vì A1 hoãn), nhưng **sẵn sàng cho
  khi A1 land, không phải sửa lại chỗ này**;
- truyền `requestedLimit: refreshLimit` → hết bug tắt load-more khi refetch trả về ít hơn 20;
- bỏ 2 lệnh `pits.add`/`afters.add` dư (đã do `updatePaginationMetadata(resetCursor: true)` làm).

**Cố ý KHÔNG làm**: không truyền `ignoreIfEmpty: true`. Vì `searchFavorites` **throw** khi lỗi
(không trả empty), nên một kết quả rỗng = rỗng thật (user đã unfavorite hết) → phải áp dụng.
⚠️ **Khi A1 land** (repo trả `hasError` thay vì throw), phải rà lại giả định này.

---

### A4 — Mapper: 1 item lỗi mất cả trang
**File**: `data/_grpc/mapper/search_mapper.dart` → `mapSearchFavoriteToModelView` ≈ dòng 129-192.

**Vấn đề**: cả vòng sync DB và vòng dựng view model nằm trong **một** `try` duy nhất; catch
xong `fileView` vẫn `[]` → trả trang rỗng, không phân biệt được với "không có dữ liệu".
Và chỉ `on Exception` nên `Error` (cast/StateError) thoát ra ngoài.

**Đã sửa**:
- `try/catch` **theo từng item** ở **cả hai** vòng lặp;
- `on Exception` → `catch (e, stack)` để bắt cả `Error`;
- item sync lỗi vẫn được **giữ lại** (object chưa sync vẫn là input hợp lệ cho
  `_favoriteViewOf`) thay vì bị bỏ — `favParentIds[i]` đã được chụp trước lệnh sync;
- item dựng view model lỗi thì skip + đếm, cuối cùng log `dropped N/total`.

**Quyết định thiết kế**: chọn **partial page + log** (giữ item đọc được) thay vì
all-or-nothing (`hasError: true`). Lý do: all-or-nothing biến 1 record hỏng thành mất hoàn
toàn tính năng, vĩnh viễn.

---

### A3 — Folder picker crash khi không có favorite root
**File**:
- `pages/favorite/cubit/favorite_folder_picker_state.dart`
- `pages/favorite/cubit/favorite_folder_picker_cubit.dart`
- `shared/utils/sheet_helper.dart` → `showFavoriteFolderSheet` ≈ dòng 838-876

**Vấn đề gốc**: hai invariant bị vi phạm —
(1) `_loadedState` là cast cứng `state as FavoriteFolderPickerLoaded` trong khi state là sealed
2 nhánh; (2) `FavoriteFolderPickerLoaded` cho phép `folderStack` rỗng nhưng **mọi** accessor
(`disabledIndexes`, `popFolder`, `addFolderToCurrent`) giả định ≥ 1 phần tử.

Khi `getRootFavoriteFolder()` trả `null` (DB local chưa sync favorite root), `init()` vẫn emit
`Loaded(folderStack: [])` → guard `if (cubit.state is Loaded)` ở caller **pass** → sheet mở trên
picker rỗng → `.last` throw StateError; `popFolder` còn gặp `times.clamp(0, -1)` → ArgumentError.

**Đã sửa**:
- thêm nhánh sealed **`FavoriteFolderPickerUnavailable`**; `init()` emit nhánh này khi
  `favRoot == null` thay vì emit `Loaded` rỗng;
- `FavoriteFolderPickerLoaded` thêm `assert(folderStack.isNotEmpty, ...)`;
  `disabledIndexes` guard rỗng cho release build (không throw khi đang paint row);
- bỏ cast cứng → `FavoriteFolderPickerLoaded? get _loaded`, **mọi mutator early-return** khi
  null; `updateSearch` re-check lại state **sau** async gap của use case;
- `popFolder`: `if (newStack.length <= 1) return;` + `if (removeCount == 0) return;`;
- `pushFolderStack`: `if (folderStack.isEmpty) return;` để không publish stack rỗng;
- `showFavoriteFolderSheet`: thêm `if (!context.mounted) return;` (bỏ được
  `// ignore: use_build_context_synchronously`), và khi state không phải `Loaded` thì
  `Toast.error(...somethingWentWrongPleaseTryAgain)` + gọi `onCancel?.call()` rồi return —
  trước đây caller im lặng không biết gì.

**⚠️ Đính chính so với phân tích ban đầu**: đường CastError qua "bấm clear khi đang `Loading`"
**KHÔNG reachable** qua entry point này, vì `showFavoriteFolderSheet` đã `await cubit.init()`
rồi mới mở sheet. Đường crash thật chỉ là `favRoot == null`. Guard nullable vẫn giữ làm
defense-in-depth (các method được nối **trực tiếp** vào widget callback trong
`shared/extensions/bottom_sheet_extension.dart`: `onClear: () => cubit.cleanSearch()`,
`onUpdateFolderStack` → `cubit.popFolder()`).

**Chưa quyết**: khi DB local chưa có favorite root, nên (i) chặn + toast — **đã chọn tạm** —
hay (ii) gọi server lấy favorite folders rồi mới mở sheet? (ii) đúng hơn về UX nhưng thêm
trạng thái loading trong sheet.

---

## 4. CÒN LẠI trong nhóm A — A1 (đã hoãn, thiết kế sẵn)

### Vấn đề
`searchFavorites` (`data/_grpc/repositories/favorite_service_repository_impl.dart:280`)
**rethrow** khi lỗi → `getFavoriteData` throw → `fetchPage` trong
`shared/presentation/controllers/base_pagination_cubit.dart:135` **nuốt** exception và
`return []` → `PaginationController._loadData(replaceList: true)`
(`pagination_controller.dart:161-208`) gán `updatedList = []`.

⇒ Mất mạng/timeout lúc **pull-to-refresh, đổi filter, hay search** → list rỗng +
"No data available" + mất cursor. Trang Favorite bị **cả 4 tab cùng lúc** (vì `onSearch` /
`refresh` fan-out ra 4 cubit).

### 3 phát hiện then chốt
1. **A1 KHÔNG thể sửa bên trong `pages/favorite`** — chỗ xoá list nằm ở
   `PaginationController._loadData`. `FavoriteCubit` chỉ là nạn nhân.
2. **Convention `hasError` đã có sẵn** (`recycle_bin_cubit.dart:197,240`,
   `search_service_repository_impl.dart:303`) **nhưng chỉ bảo vệ metadata/cursor**
   (`updatePaginationMetadata` return sớm ở `base_pagination_cubit.dart:59`), **không bảo vệ
   list**, vì `FetchPageCallback` trả `Future<List<T>>` nên cờ `hasError` bị mất trước khi tới
   `_loadData`. ⇒ **Bug dùng chung của cả 10 cubit**, recycle_bin cũng bị.
3. **`PagedListView` là dead code** (`shared/presentation/widgets/paged_list_view.dart`, không
   màn nào dùng) ⇒ `value.error` hiện **không UI nào đọc**. Sau khi sửa A1, refresh lỗi sẽ giữ
   list cũ mà **không có tín hiệu gì** → phải thêm toast (xem §2 quyết định 2).

### Phương án (khuyến nghị: b)
| | Cách làm | Ưu | Nhược |
|---|---|---|---|
| a | `fetchPage` không nuốt lỗi: bỏ `catch → return []`, nếu `result.hasError` thì `throw` sentinel | ~5 dòng, tái dùng đúng nhánh `catch` có sẵn của `_loadData` (không chạm `itemList`, không advance cursor, không đổi `isLastPage`) | exception làm control-flow |
| **b** | Đổi `FetchPageCallback` → trả `CloudPagination<T>` (hoặc record), `_loadData` branch tường minh trên `hasError` | Tường minh. **`PaginationController` chỉ được khởi tạo duy nhất ở `base_pagination_cubit.dart:109`** nên phạm vi code rất gọn | sửa typedef + `_loadData` |
| c | Heuristic ở `_loadData`: `replaceList && newItems.isEmpty && itemList.isNotEmpty` → giữ list | không cần repo sửa | **SAI nghiệp vụ**: unfavorite hết thì list phải rỗng thật → giữ rác. **LOẠI** |

**Phần repo**: `searchFavorites` đổi `rethrow` → `return CloudPagination(listData: [], hasError: true)`
(đúng pattern `search_service_repository_impl.dart:303`); nó **chỉ có 1 caller trong app**
(`cloud_file_by_type_repository_impl.dart:333`) nên an toàn. `hasError` tự chảy qua
`getFavoriteData` → `onFetchData` → base cubit.

**Rider bắt buộc**: khi `hasError` thì **skip `_metaCtrl?.loadFavorite(result.listData)`** trong
`FavoriteCubit.onFetchData` (4 chỗ). Hiện `loadFavorite([])` vô hại nhưng đó là tình cờ —
`loadFavorite` có quyền **xoá id khỏi `FavoriteCache` toàn app**
(`shared/presentation/controllers/select_all_controller.dart:97-136`), không được cho nó chạy
với dữ liệu của một request lỗi.

**Blast radius**: 10 cubit (`home`, `my_file`, `my_file_by_type`, `search`, `recycle_bin`,
`view_folder`, `privacy_space`, `privacy_password`, `encrypted_file`, `favorite`) → mất mạng khi
refresh sẽ **giữ list cũ** thay vì hiện empty state. Nên tách **MR riêng** + regression pass 10 màn.

**Sau khi A1 land, rà lại**: giả định "kết quả rỗng = rỗng thật" ở A2 (§3) không còn đúng
nguyên vẹn — cân nhắc `ignoreIfEmpty`.

---

## 5. Cố ý để ngoài scope (chưa làm, đã báo user)

1. **`FavoriteFolderPickerCubit` không được `close()`** trong `showFavoriteFolderSheet`
   (`shared/utils/sheet_helper.dart` ≈ 847) → leak `_searchDebounce` Timer mỗi lần mở sheet.
   Fix: `try/finally { await cubit.close(); }`. An toàn vì sheet đã đóng trước đó.
2. **Chuỗi debug chưa l10n đang ship cho user**: `'Folder selected null (^_^)'` tại
   `shared/extensions/bottom_sheet_extension.dart:664` và `:784`, cùng
   `'Folder selected null -_-'` tại `:571`. Sửa cần thêm l10n key qua skill `/add-l10n`
   cho 12 locale.
3. **Bất đối xứng key của `FavoriteCache`**: đường multi-delete chỉ xoá id của
   `files + folders` (`sheet_helper.dart:1960`), đường single (`deleteFavoriteItem`) xoá **mọi**
   loại kể cả external / favorite folder. Một trong hai sai — tuỳ `FavoriteCache` key external
   bằng favorite-record id hay `sourceId`. **Cần xác minh trước khi sửa**, và nó quyết định luôn
   `FavoriteCubit._onExternalFavoriteChanged` (`favorite_cubit.dart:140-145`) có xoá đúng key không.

---

## 6. Rủi ro B→F — CHƯA XỬ LÝ

### B. Logic nghiệp vụ
- **B1** `_createFavoriteFolder` (`pages/favorite/favorite_page.dart:164-201`) bắn
  `Toast.error` sai ngữ cảnh: (a) nhánh `MaxFavoriteFoldersException` set
  `_pendingFolderUsage` rồi **vẫn** fall-through xuống toast lỗi chung ⇒ user thấy toast lỗi +
  popup limit; (b) server tạo thành công nhưng ghi DB local fail (`idNew == null` /
  `getById` null) ⇒ báo lỗi dù folder đã có trên server ⇒ user tạo lại ⇒ trùng.
- **B2** `source` và `exts` dùng chung một `FilterFileTypeModelView` nhưng được gửi song song
  thành 2 filter `OPERATOR_IN`. Nếu backend AND: chọn "photo" + "link" ⇒ 0 kết quả.
  **Cần chốt semantics `matchAnyCategory` với backend** (chỉ tab `all` truyền `true`).
- **B3** Filter state chia sẻ 4 tab nhưng `disable` chỉ set theo tab hiện tại
  (`mixin/favorite_filter_mixin.dart`). Chọn "combinedMessage" ở tab All rồi sang Discover →
  `firstOrNull != socialfi` → `return CloudPagination(listData: [])` ⇒ tab rỗng thay vì bỏ qua
  filter không áp dụng. Chọn cả link + combinedMessage thì kết quả phụ thuộc thứ tự phần tử.
- **B4** Move multi-select (`sheet_helper.dart:1784-1870`): (a) `fromRemoteId` lấy từ item
  **đầu tiên** (`:1863`) → selection nằm ở nhiều favorite folder (tab Cloud Drive là list phẳng,
  `folderId: null`) thì các item còn lại không được page nguồn xoá; (b) `isExternalsExist`
  (`:1813`) so `externals.remoteId` với `folder.remoteId` — so id item với id folder, vô nghĩa;
  (c) chỉ **một** item đã ở đích → abort **toàn bộ** move thay vì move phần còn lại.
- **B5** `FavoriteCubit.removeItems` (`favorite_cubit.dart:377`) là no-op cho 3 tab, nhưng
  `FavoritesCubit.removeItemsFromAllTabs` gọi thẳng `paginationController.removeItems` bỏ qua nó
  ⇒ hai API mâu thuẫn, `removeItems` thực chất dead code dễ gây nhầm.
- **B6** `_suppressRealtime` cố định 5s (`favorite_cubit.dart:50`) và chỉ page đang trong stack
  nhận `FavoriteMoveBus`. ES chậm > 5s → refetch ghi đè optimistic; không có DB event nào nữa →
  không có bước reconcile chủ động.
- **B7** `_isActive` theo **tab**, không theo **page** (`favorite_cubit.dart:55`). Vào subfolder
  bằng `Navigator.push` → page cha vẫn `_isActive = true` cho tab của nó → mỗi DB event kích
  `reloadKeepingPosition` full-length ở **mọi** page trong stack. Nest N tầng = N request full list.
- **B8** Tab không active **không catch-up** khi được active lại: `setActive(true)` không trigger
  refresh ⇒ tab vừa chuyển sang có thể còn item đã bị unfavorite từ My Files lúc nó ở background.

### C. Hiệu năng (rủi ro lớn nhất về UX)
- **C1** ⭐ **`TabPage` không render lazy**: `pages/favorite/widgets/tab_page/tab_page.dart:76-94`
  nhét `FavoriteBodyView` (bên trong là `ListView/GridView.builder(shrinkWrap: true,
  physics: NeverScrollableScrollPhysics())`) vào **một** child duy nhất của
  `SliverList(childCount: 1)` ⇒ constraint dọc unbounded ⇒ shrinkWrap layout **toàn bộ** item đã
  load, không cull viewport. Cộng thêm mỗi item bọc `ValueListenableBuilder(itemMetaCtrl)`
  **dùng chung** ⇒ mỗi thay đổi select/favorite rebuild cả list. 200-500 item là drop frame nặng.
  **Fix**: đưa item thành sliver thật (`SliverList`/`SliverGrid` với `childCount: listData.length`).
- **C2** Mở page = **4 request ES song song** (4 cubit đều `initPagination` → `refresh` ngay,
  `favorites_cubit.dart:32-35`). Search = 4 request, đổi filter = 4 request, nhân số page trong
  stack. **Fix**: lazy-init tab lần đầu hiển thị.
- **C3** **8 DB watcher mỗi page** (`watchAllFiles` + `watchAllFolders` × 4 cubit,
  `favorite_cubit.dart:85-106`).
- **C4** `reloadKeepingPosition` xin `limit` = số item đã load (có thể 500) trong 1 request.
  Nếu ES cap limit server-side → trả ít hơn → list co lại → scroll clamp về đầu (đúng cái nó cố
  tránh). **Cần hỏi backend `limit` tối đa.** Cap được thì phải kèm upsert-merge thật, mà
  `syncRealtimeUpdate` hiện là **replace** (`pagination_controller.dart:240`, đoạn merge bị
  comment) — merge đơn thuần lại không phản ánh item bị xoá server-side. Tên
  `syncRealtimeUpdate` đang nói dối, nên đổi tên hoặc ghi rõ doc.

### D. Leak / lifecycle
- **D1** ⭐ **`itemMetaCtrl` không bao giờ `dispose()`** trong `_FavoritePageState.dispose()`
  (`favorite_page.dart:140-148`). Constructor `ItemMetaController` `addListener` vào singleton
  `FavoriteCache` (`select_all_controller.dart:53-58`) ⇒ mỗi lần mở FavoritePage (kể cả **từng
  subfolder**) leak vĩnh viễn 1 listener; `FavoriteCache.notifyListeners()` gọi ngày càng nhiều
  controller đã chết. Các page khác (`recycle_bin`, `search`, `privacy_space`, `view_folder`)
  đều có dispose — chỉ favorite thiếu.
- **D2** `_searchFocus.removeListener(_onSearchFocusChanged)` nhưng listener **chưa từng được
  add**; `_onSearchFocusChanged` là hàm rỗng ⇒ dead code.
- **D3** `_tabCtrl.animation?.addListener(_onTabChanged)` được add **TRƯỚC** khi `_favoritesCubit`
  (`late final`) khởi tạo (`favorite_page.dart:104-124`) ⇒ nếu callback chạy trong khoảng đó →
  LateInitializationError. Xác suất thấp; đảo thứ tự là miễn phí.
- **D4** `listFilters` giữ `BuildContext` của lần build đầu (`SortDateModelView(context)`…,
  `favorite_page.dart:236`) và chỉ khởi tạo một lần (`if (listFilters.isEmpty)`) ⇒ không cập nhật
  khi đổi locale/theme, và giữ context trong object sống lâu.

### E. Navigation
- **E1** **Trộn `Navigator.push` với `context.pop()/canPop()` của go_router 17**: subfolder favorite
  được push bằng `FadeMaterialPageRoute` (raw Navigator, `tab_page.dart:113-123`), còn `_backFolder`
  (`favorite_page.dart:155`) dùng `context.canPop()`/`context.pop()` của go_router — go_router xét
  theo RouteMatchList nên không "thấy" route imperative ⇒ breadcrumb back có thể no-op hoặc pop sai
  tầng. Thêm nữa vòng `for` pop N lần **đồng bộ trong cùng frame**: `canPop()` chưa kịp cập nhật ⇒
  nguy cơ pop quá.
- **E2** `onFavTap` gọi `context.pop()` **TRƯỚC** `await updateFavorite`
  (`widgets/favorite_body_view.dart:172-184, 219-231`). Hiện "an toàn" **chỉ vì**
  `hideFavIc` default = `true` (`file_list_item.dart:71`, `folder_list_item.dart:73`) nên sao vàng
  inline bị ẩn, callback chỉ đến từ trong sheet. Ai bật fav icon inline → tap sao sẽ **pop cả trang**.
  Landmine.
- **E3** `RefreshIndicator.onRefresh` không await `refresh()` (`tab_page.dart:39-42`) ⇒ spinner tắt ngay.

### F. Dọn dẹp / cần xác nhận ý định
- `loadLocalFirst` bị comment trong `init()` (`favorite_cubit.dart:70`) ⇒ `onFetchLocalData` +
  `getFavoriteLocalData` là **dead path** (kèm comment dài giải thích vẫn còn).
- `_favoritesCubit.reloadAllTab()` và `favoritesCubit.removeItemsFromAllTabs` trong
  `moveFavoriteItem` **đều bị comment** ⇒ `callback` của `selectFavoriteOptionsSheet` rỗng.
- `_enableScrollToTarget = false` cứng (`favorite_body_view.dart:64`, TODO Felix) ⇒ attribute
  `sourceId` từ deep-link **hiện vô tác dụng**. Cần xác nhận đây là ý muốn. `_didScroll` cũng
  không reset khi list đổi.
- `FavoriteState.items` / `selectedIds` / `isSelecting` không được dùng ở đâu.
- `_normalizeFolderId` coi `'root'` là sentinel, nhưng **chỉ tab `all`** gửi `'root'`
  (`favorite_cubit.dart` `onFetchData`), 3 tab kia gửi `null` ⇒ **cần chốt backend hiểu 2 giá trị
  này như nhau**.
- `_itemKey` fallback `remoteId ?? id` (`pagination_controller.dart:290`): folder id 5 và file id 5
  (cùng chưa có remoteId) sẽ **trùng key** ⇒ `removeItems` xoá sai item.
- `kMaxFavoriteFolders - 1` làm fallback limit (`favorite_page.dart` ≈ 196) — con số `-1` trông như bug.
- **Cần verify**: `isFavorite` của item trong favorite search lấy từ **DB row sau sync**
  (`search_mapper._favoriteViewOf`). Nếu row local chưa có cờ favorite, `loadFavorite` sẽ **xoá id
  khỏi `FavoriteCache`** ⇒ item trong chính trang Favorite render như **chưa favorite** (UI đọc
  `metaState.favoriteRemoteIds`, không đọc `item.isFavorite`). Chuỗi:
  `cloud_file_proto.dart:73` (`p.favorite`) → `syncFilesByRemoteId` → `FileModelView.cloudFile`.

---

## 7. Ưu tiên đề xuất cho đợt tiếp theo

1. **C1** (sliver hoá list) — ảnh hưởng UX lớn nhất, độc lập, dễ verify bằng mắt.
2. **D1** (dispose `itemMetaCtrl`) — 1 dòng, chặn leak tăng dần theo mỗi lần mở page.
3. **A1** (MR riêng + regression 10 màn) — theo thiết kế §4.
4. **B1** (toast sai ngữ cảnh khi tạo folder) — user-facing, dễ gặp.
5. **B4** (3 bug trong move multi-select) — sai dữ liệu.

Nhóm B2/B3 và các mục "cần chốt" ở §6-F nên gom thành **một buổi hỏi backend** trước khi code.

---

## 8. Commit đã tạo (branch `felix/refactor-cloud`, repo `lib/features/cloud_storage`)

```
548004b2 fix: improve error handling in favorite item synchronization to prevent page failures
         └─ data/_grpc/mapper/search_mapper.dart                        (A4)

db49bfa7 fix: improve error handling and state management in favorite folder picker
         ├─ pages/favorite/cubit/favorite_cubit.dart                    (A2)
         ├─ pages/favorite/cubit/favorite_folder_picker_cubit.dart      (A3)
         ├─ pages/favorite/cubit/favorite_folder_picker_state.dart      (A3)
         └─ shared/utils/sheet_helper.dart                              (A3 + A5)
```

Tổng: 5 file, +219 / −95. Working tree sạch. **Chưa test tay, chưa push.**

---

## 9. Test tay còn nợ cho nhóm A

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| 1 | Bật airplane mode → kéo pull-to-refresh trang Favorite | ⚠️ **VẪN rỗng** (A1 hoãn) — đây là hành vi đã biết, không phải regression |
| 2 | Đang ở Favorite, tắt mạng, sửa file ở tab khác để DB fire event | List **giữ nguyên**, không rỗng, không crash log (A2) |
| 3 | Scroll Favorite xuống 3-4 trang → trigger DB event | List không nhảy về đầu, load-more vẫn hoạt động khi scroll tiếp (A2 `requestedLimit`) |
| 4 | Cài mới / xoá DB local → mở Favorite → chọn item → Move | Toast lỗi, sheet **không mở**, **không crash** (A3) |
| 5 | Có favorite root → Move → breadcrumb back ở root | Không crash, không pop quá (A3 `popFolder`) |
| 6 | Multi-select 2-3 item → Delete → chặn mạng để API fail | Toast lỗi + sao vàng **vẫn còn** ở My Files (A5) |
| 7 | Favorite có nhiều item (>50) gồm cả file/folder/socialfi/im | Không mất item, log không có `dropped` (A4) |
