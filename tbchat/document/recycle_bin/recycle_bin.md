# Recycle Bin (Thùng rác) — Documentation

**Path:** `lib/features/cloud_storage/_new_cloud_storage/pages/recycle_bin/`

## Tổng quan

Màn hình **Thùng rác** hiển thị các file/folder đã bị xóa mềm (soft-delete). Mỗi mục
được giữ lại tối đa **7 ngày** kể từ thời điểm xóa, sau đó tự động bị xóa vĩnh viễn.
Người dùng có thể:

- Xem danh sách mục đã xóa kèm **đồng hồ đếm ngược** thời gian còn lại.
- **Khôi phục** (restore) một hoặc nhiều mục về vị trí cũ.
- **Xóa vĩnh viễn** (delete) từng mục hoặc nhiều mục đã chọn.
- **Dọn sạch thùng rác** (empty trash) — xóa toàn bộ.
- **Tìm kiếm** theo tên/hash/folder (dùng `advance_search`) và **sắp xếp** theo số ngày còn lại
  (**mặc định: gần hết hạn nhất trước**).
- **Lọc** theo loại file qua filter chips (All / Folders / Images / Videos / Audio / Documents /
  Others). *(Chip "Others" hiện tạm ẩn — chờ Figma; xem §Tìm kiếm/Lọc.)*
- Bật **chế độ chọn nhiều** (select mode) qua long-press để thao tác hàng loạt.
- **Mở một folder đã xóa** để xem/thao tác với nội dung bên trong (xem §`view_folder/`).

Danh sách phân trang bằng cursor, 20 item/page, và **tự nạp bù** khi một thao tác xóa
hàng loạt làm nó ngắn đi — xem §Phân trang & ngòi nổ nạp bù.

---

## Cấu trúc thư mục

```
recycle_bin/
├── recycle_bin_page.dart              # Entry point — UI trang chính
├── cubit/
│   ├── recycle_bin_cubit.dart         # State management (LazySingleton)
│   └── recycle_bin_state.dart         # State (part of cubit)
├── models/
│   └── folder_node.dart               # Model cây thư mục (Node) — hiện chưa dùng
├── view_folder/                       # Xem BÊN TRONG một folder đã xóa
│   ├── view_folder_page.dart
│   ├── cubit/
│   │   ├── view_folder_cubit.dart
│   │   └── view_folder_state.dart
│   └── widgets/
│       ├── breadcrumb_path.dart
│       └── folder_body_view.dart
└── widgets/
    ├── build_list_file_widget.dart    # ListView + pull-to-refresh + load-more
    ├── countdown_timer_widget.dart    # Đồng hồ đếm ngược 7 ngày
    ├── select_mode_tools_bar.dart     # AppBar chế độ chọn nhiều
    ├── recycle_bin_filter_chips.dart  # Filter chips theo loại file (FR-11)
    ├── recycle_bin_notice_banner.dart # Banner "tự xóa sau 7 ngày"
    ├── recycle_bin_rules_sheet.dart   # Sheet "Recycle Bin Rules" (nút ?)
    ├── build_storage_list.dart        # (DEAD CODE — comment toàn bộ)
    └── folder_navigator.dart          # (DEAD CODE — comment toàn bộ)
```

Danh sách + con trỏ phân trang **không** nằm trong thư mục này mà ở tầng shared —
xem §Phân trang & ngòi nổ nạp bù:

```
shared/presentation/
├── cloud_pagination.dart                       # DTO 1 page trả về từ cubit
└── controllers/
    ├── base_pagination_cubit.dart              # BasePaginationCubit<S, T>
    ├── pagination_controller.dart              # PaginationController<T>
    └── pagination_state.dart                   # PaginationState<T>
```

---

## Luồng vòng đời (Lifecycle)

```
RecycleBinPage (StatefulWidget)
  ├─ initState → cubit.init()      // MỘT lần mỗi lần mở trang
  ├─ build     → BlocProvider.value(cubit)
  └─ dispose   → cubit.cleanCache()

_RecycleBinBody (StatefulWidget)
  └─ tạo ItemMetaController<BaseViewItem> để quản lý chế độ chọn nhiều
```

- `cubit.init()`: xóa `cacheDelItem` rồi gọi `initPagination()` để dựng
  `PaginationController` và nạp trang đầu.
- `cubit.cleanCache()`: reset state truy vấn (search, sort, filter, `cacheDelItem`) khi thoát.

> **Quan trọng:** `init()` phải gọi từ `initState`, **không** từ `build`. Mỗi lần gọi là
> một lần `initPagination()` dựng lại `PaginationController` mới — gọi trong `build` sẽ
> vứt cả danh sách lẫn vị trí cuộn ở mọi lần rebuild.

---

## RecycleBinCubit

**File:** `cubit/recycle_bin_cubit.dart` — đăng ký DI bằng `@LazySingleton()`.

### Dependencies

| Dependency | Vai trò |
|-----------|---------|
| `FileServiceRepository fileRepo` | Gọi gRPC: `deleteFilesInTrash`, `restoreFiles`, `emptyTrash` |
| `CloudMyFileRepository newCloudFolderRepo` | `restoreFolders` — khôi phục folder |
| `CloudFileDB cloudFileDB` | DB file: `fetchRecycleBin`, `updateDelStatusByRemoteIds`, `delete` |
| `CloudFolderDB cloudFolderDB` | DB folder: `delete` |
| `RecycleBinRepository recycleBinRepo` | `getFreshData` (server), `delFiles/FoldersFromRemoteIds`, `deleteExpired` |

### Các method chính

`RecycleBinCubit extends BasePaginationCubit<RecycleBinState, BaseViewItem>` — danh sách,
con trỏ `pit`/`after` và cờ load-more nằm ở `paginationController`, **không** ở state.

| Method | Mô tả |
|--------|-------|
| `init()` | Clear `cacheDelItem` + `initPagination()` (dựng controller, nạp trang đầu), bọc bởi `isLoading` |
| `cleanCache()` | Reset state truy vấn về mặc định |
| `onFetchData({limit, pit, after})` | **Nguồn dữ liệu DUY NHẤT** cho cả trang đầu lẫn mọi load-more. Quét/xóa mục hết hạn ở local → `recycleBinRepo.getFreshData()` → lọc `cacheDelItem` → trả `CloudPagination` |
| `reload({showSkeleton})` | `paginationController.refresh()` + bật `isLoading` khi cần skeleton |
| `refresh({listFilterSelected})` | Áp filter mới rồi `reload(showSkeleton: true)` |
| `delete<T>({items})` | Xóa vĩnh viễn: nạp `cacheDelItem` → gRPC → chờ 1s → xóa khỏi local DB (tách file/folder) → `removeItems()` |
| `restore<T>({items})` | Khôi phục: nạp `cacheDelItem` → gRPC → chờ 1s → cập nhật `delStatus` + áp đích server chọn (`_applyRestoreDestinations`) → `removeItems()` |
| `removeFromList<T>(items)` | Bỏ item khỏi list **không** gọi server — dùng khi folder bị xóa vĩnh viễn từ trong `ViewFolderPage` |
| `emptyTrash()` | Dọn sạch: gRPC `emptyTrash` → `delete()` file & folder DB → `syncRealtimeUpdate()` (list rỗng) |
| `setSort(bool status)` | Đổi `isDescending` rồi `reload(showSkeleton: true)` |
| `onSearch(String value)` | Tìm kiếm debounce 500ms; truy vấn không đổi thì bỏ qua |
| `deleteExpired(int id)` | Bỏ mục hết hạn khỏi list + `recycleBinRepo.deleteExpired` |
| `goBack()` | Pop `stack` — dùng cho điều hướng folder lồng nhau (chưa kích hoạt) |
| `close()` | Hủy `_searchDebounce` timer |

### Cơ chế xử lý hết hạn (7 ngày)

`_purgeExpiredLocalItems()` chạy đầu mỗi `onFetchData` (tức cả trang đầu lẫn mọi
load-more), duyệt local DB:
```
expired = deletedAt + 7 days
if (expired == null || now >= expired) → recycleBinRepo.deleteExpired(ids)
```
Best-effort — lỗi ở đây không được làm hỏng lượt fetch. Local DB không phải thứ list
render, nhưng nó nuôi các màn khác nên vẫn phải quét.

Ngoài ra `CountdownTimerWidget` cũng gọi `onExpired → cubit.deleteExpired(id)`
khi đồng hồ chạm 0 (real-time trên UI).

### `_classifyRemoteIds()` — helper nội bộ

Phân loại danh sách item thành 3 nhóm `remoteId` để gọi API/DB đúng loại:
- `remoteIds` — tất cả
- `folderIds` — item là `FolderModelView`
- `fileIds` — còn lại (file)

### `cacheDelItem` (Set&lt;String&gt;) — tombstone phía client

Tập `remoteId` đã delete/restore **trong phiên hiện tại**. Index tìm kiếm của server là
*eventually consistent*: một mục vừa xóa vẫn có thể quay lại ở lượt fetch kế tiếp, và
**không có cách nào biết trước độ trễ đó là bao lâu**. `onFetchData` lọc bỏ chúng.

Nguyên tắc: ứng dụng biết chắc những mục đó đã chết — chính nó vừa ra lệnh — nên không
chờ server xác nhận lại điều mình đã biết. Sự thật của client thắng cho tới khi server
bắt kịp. Nhờ vậy không cần đoán một khoảng `delay` nào.

Được nạp **trước** khi gọi gRPC (trong `delete`/`restore`), nên cửa sổ bảo vệ mở ra ngay
từ đầu thao tác. Tích lũy suốt phiên, chỉ xóa ở `init()` / `cleanCache()`.

> Đây cũng là mảnh khiến cơ chế nạp bù chịu được index stale bao lâu cũng được —
> xem §Phân trang & ngòi nổ nạp bù.

---

## RecycleBinState

**File:** `cubit/recycle_bin_state.dart` (immutable, `part of` cubit,
`extends BasePaginationState<BaseViewItem>`).

State này **chỉ** giữ những gì điều khiển *truy vấn* (search / sort / filter) cộng vài cờ
UI cấp trang. Danh sách, con trỏ `pit`/`after` và cờ load-more sống ở
`paginationController.value` (`PaginationState<T>`).

| Field | Kiểu | Ý nghĩa |
|-------|------|---------|
| `search` | `String?` | Từ khóa tìm kiếm hiện tại (kế thừa từ `BasePaginationState`) |
| `isDescending` | `bool` | Thứ tự theo `deletedAt`. **Mặc định `false`** = ascending = *gần hết hạn nhất trước* (FR-12). `true` = mới xóa nhất trước |
| `cacheDelItem` | `Set<String>` | Tombstone — remoteId đã delete/restore trong phiên |
| `isLoading` | `bool` | Đang fetch mà **không được** hiện list cũ → UI vẽ skeleton. Cố ý tách khỏi `PaginationState.isLoading` (bản debounce, vẫn true khi pull-to-refresh) |
| `listFilterSelected` | `List?` | Các filter đang chọn (SortDate / SortName / FileType) |
| `stack` | `List<Node>` | Ngăn xếp điều hướng folder (chưa dùng tới) |

**Helper truy vấn:** `getSortDate()`, `getSortName()`, `getFilterType()`,
`getFilterFolder()`, `getFilterOthers()` — bóc `listFilterSelected` thành tham số cho
`getFreshData()`.

### `PaginationState<T>` — phần còn lại của trạng thái list

**File:** `shared/presentation/controllers/pagination_state.dart`

| Field | Kiểu | Ý nghĩa |
|-------|------|---------|
| `itemList` | `List<T>` | Danh sách đang hiển thị |
| `isLastPage` | `bool` | Hết trang. Xem cảnh báo ở §Phân trang về cách cờ này bị bóp méo |
| `isLoading` | `bool` | Có debounce 300ms + giữ tối thiểu 300ms, nên fetch nhanh không nháy indicator |
| `isBackfilling` | `bool` | Đang tự nạp bù sau `removeItems` — UI dùng để **không** vẽ empty page |
| `total` / `totalImage` | `int` | Server trash **không** trả tổng số item, nên luôn là 0 ở màn này |
| `error` | `dynamic` | Lỗi lượt fetch gần nhất |

> **Lưu ý:** quản lý chọn nhiều nằm ở `ItemMetaController`, không phải state của cubit.

---

## Phân trang & ngòi nổ nạp bù (backfill)

### Vấn đề

- **Step 1** — server có > 20 item trong thùng rác.
- **Step 2** — user mở trang, app nạp page đầu = 20 item.
- **Step 3** — bật select mode → chọn "All" → 20 item được chọn.
- **Step 4** — Delete/Restore → cả 20 item rời khỏi list.
- **Step 5** — hiện **empty page**, trong khi server vẫn còn item. ❌

Mong muốn ở Step 5: hiện page tiếp theo, không nháy empty page, chuyển state mượt.

### Nguyên nhân

Một danh sách phân trang phải luôn còn đường lấy thêm dữ liệu. Ở module này khả năng đó bị
giao trọn cho **scroll** — sự kiện của tầng UI. Mà scroll chỉ tồn tại khi list đủ dài để
cuộn. Nghĩa là khả năng phân trang đang phụ thuộc điều kiện *hình học* của màn hình, chứ
không phải trạng thái dữ liệu.

```
removeItems()  →  itemList = []  →  không scroll được
                                 →  PaginationController._onScroll không chạy
                                 →  BuildListFileWidget._onScroll còn chặn thêm ở
                                    listData.length < kPageSizeDefault
                                 →  MẤT KHẢ NĂNG TỰ CỨU
```

`isLastPage` lúc này vẫn `false` (page đầu trả đúng 20 = `limit`), nhưng không gì châm
ngòi được nữa. Bug không nằm ở chỗ list rỗng — nó nằm ở chỗ list mất khả năng tự nạp thêm.

Lưu ý bug này **không chỉ xảy ra khi chọn All**: xóa 18/20 cũng chết cứng, vì
`length < kPageSizeDefault` chặn load-more và 2 item còn lại thì không cuộn được.

### Bất biến cần khôi phục

> Nếu server còn dữ liệu, list đã load không được ngắn hơn một page.

`limit` không phải con số tùy tiện — nó chính xác là ngưỡng `BuildListFileWidget._onScroll`
từ chối load-more, tức ngưỡng ngòi nổ 1 tắt.

Chỉ có đúng một thao tác làm list ngắn đi: `removeItems`. Vậy nó là nơi duy nhất phá được
bất biến, và cũng là nơi phải dựng lại. Hàm nào phá thì hàm đó sửa — không rải kiểm tra
chỗ khác, không widget nào phải quan sát hộ.

### Hai ngòi nổ

```
NGÒI NỔ 1 (sẵn có)              NGÒI NỔ 2 (thêm mới)
user scroll xuống đáy            removeItems() làm list ngắn đi
        │                                │
        ▼                                ▼
   loadNextPage()                   _backfill()

chết khi list rỗng/ngắn          không phụ thuộc scroll — châm bởi
                                 chính hành động xóa
```

### Ba ràng buộc của backend, và cách xử lý từng cái

**① Cursor `pit`/`after` hết hạn sau ~5 phút, chỉ `refresh()` mới đăng ký lại được.**

Backfill có hai đường: cursor còn sống → `loadNextPage()`; cursor chết → `refresh()`
**một lần duy nhất** để lấy cursor mới rồi quay lại đường thứ nhất. Không lặp `refresh()`
vì nó luôn về page 1, lặp là quay tại chỗ.

**② Refresh ngay sau Delete/Restore thì server vẫn trả về page vừa xóa; không biết bao lâu
mới hết.**

Không đoán, không `sleep`. Tombstone `cacheDelItem` lọc chúng ra, và backfill **chịu đi qua
nhiều page**.

Điểm mấu chốt: *tải lại* là hỏi server "bây giờ thùng rác có gì" — câu server chưa trả lời
đúng được. *Đi tiếp* là hỏi "cho tôi phần nằm sau vị trí tôi đang đứng" — câu này đúng ngay,
vì `search_after` là một **vị trí trong snapshot đã sắp xếp**, không phải truy vấn về nội
dung hiện tại. Xóa dữ liệu không làm dịch chuyển vị trí trong snapshot đó.

Nghịch lý dễ chịu: chính vì snapshot cũ *không* biết về việc xóa mà nó lại cho kết quả
đúng — item 21–25 vẫn nằm đúng chỗ 21–25.

**③ Server KHÔNG trả tổng số item trong thùng rác.**

`CursorPaginationESResponse` có field `total` nhưng endpoint trash không populate. Không
dùng nó làm điều kiện dừng. (`PaginationController.total` vì thế luôn = 0 ở màn này.)

Điều kiện dừng dùng `count < limit`, với `count` là **số dòng server gửi trong mảng
response** — client tự đếm, không phải field server trả.

### Mảnh then chốt: tách "có tiến không" khỏi "có được gì không"

Một page trả về rỗng có hai nghĩa hoàn toàn khác nhau:

| Hiện tượng | Nghĩa | Xử lý |
|---|---|---|
| 0 dòng, cursor **đứng yên** | Hết dữ liệu thật | dừng |
| 0 dòng, cursor **có tiến** | Vừa lội qua vùng toàn tombstone | **đi tiếp** |

Nhập hai thứ này làm một chính là bug gốc: `isLastPage` đang tính
`newItems.length < limit` **sau** khi cubit lọc `cacheDelItem`. Một page server trả đủ 20
nhưng bị lọc sạch ở client sẽ bị đọc nhầm thành "hết dữ liệu" → ngõ cụt vĩnh viễn.

Sửa bằng `CloudPagination.serverCount` — số dòng đếm **trước** khi lọc tombstone:

```dart
isLastPage = (page.serverCount ?? newItems.length) < limit
```

Nhờ vậy vòng lặp không quan tâm vùng tombstone dài bao nhiêu, cứ lội tới khi chạm data thật.

### Luồng — điểm châm

```
Delete / Restore
  │  ① cacheDelItem ∪= remoteIds        ← đặt TRƯỚC khi gọi gRPC
  │  ② await gRPC + ghi local DB
  ▼
paginationController.removeItems(items, autoFill: true)
  │
  ├─ không item nào khớp? ───────────────────► return (không notify, không backfill)
  ├─ itemList -= items
  │
  ├─ shouldBackfill = autoFill
  │       && !_isFetching             ← đang có fetch khác → để nó lo
  │       && !isLastPage              ← server hết data thật → empty page là ĐÚNG
  │       && itemList.length < limit
  │
  ├─ value = copyWith(itemList, isBackfilling: shouldBackfill)
  │                    └──► UI rebuild NGAY, cùng frame ──► skeleton, không phải empty
  │
  └─ shouldBackfill ? unawaited(_backfill()) : return
```

Chống nháy: `isBackfilling` được set **đồng bộ** trong cùng lần `copyWith` đã xóa item.
Không tồn tại frame nào list rỗng mà cờ chưa bật.

### Luồng — vòng chạy

```
_backfill()
  gen = _generation ;  recovered = false ;  rounds = 0
  │
┌─► WHILE   gen == _generation           ← refresh() bên ngoài chen vào → bỏ cuộc
│           && !isLastPage
│           && itemList.length < limit
│           && rounds++ < 6              ← van an toàn, chạm thì log
│   │
│   ├── cursor hết hạn (_cursorAt > cursorTtl)?
│   │      ├── recovered ──────────────────────────────────► BREAK
│   │      └── recovered = true ; await _refresh()
│   │             └─ pits/afters.clear() → fetch page 1 không cursor
│   │                → server cấp pit/after mới → _cursorAt = now
│   │                → page này có thể toàn tombstone, KHÔNG SAO ────► CONTINUE
│   │
│   └── cursor còn sống
│          before = (itemList.length, afters.length)
│          await loadNextPage()
│          ├── itemList dài ra?     ──► CONTINUE  ① lấy được data thật
│          ├── afters lớn lên?      ──► CONTINUE  ② bước qua tombstone = TIẾN BỘ
│          ├── !recovered?          ──► _cursorAt = null ──► CONTINUE
│          │                            ③ cursor chết ngầm, đồng hồ đoán sai
│          └── ────────────────────────────────────────────► BREAK
│                                       ④ đã phục hồi rồi mà vẫn tắc
└──
  finally: isBackfilling = false ──► UI rebuild ──► list mới, hoặc empty page (đúng)
```

`afters` là `Set` nên phép đo tiến bộ miễn phí: cursor lặp lại giá trị cũ thì Set không lớn
lên. Đây cũng là chốt chặn khi server không trả `pit` — lúc đó `_loadData` coi là page 1 và
*replace* list, không có ④ thì quay vòng vô hạn.

Nhánh ③ là lưới an toàn **không phụ thuộc đồng hồ**: `cursorTtl` đoán sai hướng nào cũng tự
lành — ngắn quá thì thừa một `refresh()`, dài quá thì ③ bắt được rồi mới refresh.

### Chạy thử — server 25 item, xóa 20, index còn stale

**Cursor còn sống** (thao tác trong `cursorTtl`):

| Vòng | Nhánh | Server trả | Sau tombstone | itemList | Thoát vì |
|---|---|---|---|---|---|
| 1 | `loadNextPage` `search_after`(item 20) | 21–25 | 5 | 5 | `isLastPage` (5 < 20) |

1 request. `search_after` nhảy thẳng qua 20 tombstone theo vị trí — staleness còn *có lợi*.

**Cursor hết hạn:**

| Vòng | Nhánh | Server trả | Sau tombstone | itemList | Đi tiếp vì |
|---|---|---|---|---|---|
| 1 | `_refresh()` page 1 | 20 item vừa xóa | 0 | 0 | `serverCount 20 < 20` → `isLastPage` **false** |
| 2 | `loadNextPage` page 2 | 21–25 | 5 | 5 | `isLastPage` (5 < 20) → thoát |

2 request. Suốt cả hai kịch bản `isBackfilling == true` nên UI hiện skeleton. Người dùng
thấy: item biến mất → skeleton → page tiếp theo. Không có khung "Không có bản ghi đã xóa"
nào lọt vào giữa.

### Trạng thái UI theo cờ

```
itemList rỗng + isBackfilling  ──► StorageListSkeleton   (recycle_bin_page)
                                   CircularProgressInd.  (folder_body_view)
itemList rỗng + !isBackfilling ──► EmptyDataWidget       ← chỉ khi hết data THẬT
itemList có   + bất kỳ         ──► danh sách
```

Cờ này cũng trả empty page về đúng nghĩa của nó: chỉ xuất hiện khi list rỗng **và** không
còn gì đang vá.

Hai lần chuyển (`list → skeleton`, `skeleton → list`) đi qua `AnimatedSwitcher` 200ms, key
`'skeleton'` / `'list'` — key chỉ đổi khi đổi loại widget nên `BuildListFileWidget` giữ
nguyên `State` và scroll offset suốt lúc vẫn đang là list.

### Phạm vi áp dụng

`autoFill` mặc định **`false`** — backfill là opt-in. Bật ở:

| Cubit | Chỗ gọi |
|---|---|
| `RecycleBinCubit` | `delete`, `restore`, `removeFromList`, `deleteExpired` |
| `ViewFolderCubit` | `delete`, `restore`, `removeFromList` |

**Không** bật ở `_purgeExpiredLocalItems` — nó chạy *bên trong* `onFetchData` nên
`_isFetching == true`, guard tự chặn.

> ⚠️ **`ViewFolderCubit` bắt buộc phải có tombstone trước khi bật backfill.** Nó vốn không
> có `cacheDelItem`; bật mà thiếu là biến bug "empty page" thành bug "item xóa rồi hiện
> lại" — tệ hơn. Vì lý do đó `view_folder_page.dart` cũng phải gọi `bloc.removeFromList()`
> thay vì `paginationController.removeItems()` trực tiếp, nếu không folder con xóa vĩnh
> viễn từ trang trong sẽ không được tombstone.

`favorite_cubit` / `favorites_cubit` dính **cùng bug** nhưng chưa bật. Khi bật, chúng cũng
sẽ cần tombstone như `ViewFolderCubit`.

### Vết còn lại — cố ý không sửa

| Vết | Vì sao để lại |
|---|---|
| `serverCount` đếm ở cubit chứ không ở repo | Mapper `search_mapper.dart:117-125` là 1:1 nên hai con số bằng nhau — trừ khi `.map()` throw, lúc đó `catch` trả `[]` cho cả page và `isLastPage = true`. Đúng bằng hành vi hiện tại, không regression. Đếm ở repo phải đổi kiểu trả về của `getFreshData` |
| Scroll load-more với cursor hết hạn ở **list dài** | User đã cuộn tới item 60, cursor chết → `refresh()` sẽ vứt 60 item và nhảy scroll về đầu, tệ hơn hành vi hiện tại (âm thầm dừng phân trang). Chữa đúng phải walk tiến tích lũy: 3 request ở item 60, 15 request ở item 300, và cần thêm chế độ accumulate cho `_loadData` |
| `isLastPage` vẫn có thể sai ở page trộn lẫn dòng thật + tombstone | Backfill không đọc cờ này nên bug đã báo thì hết; chỉ **scroll** load-more dừng sớm ở đúng tình huống đó. Sửa triệt để phải định nghĩa lại `isLastPage` theo cursor, chạm mọi list trong module + thêm 1 request thừa cuối mỗi list |

---

## Widgets

### 1. `recycle_bin_page.dart`

UI trang chính, gồm:

- **AppBar** (`PageBasicWidget`):
  - Tiêu đề "Recycle Bin".
  - Nút **dọn sạch thùng rác** (icon xóa) — mờ đi khi list rỗng, mở popup xác nhận
    → `cubit.emptyTrash()`.
  - Khi ở **select mode**: AppBar được thay bằng `SelectToolsRecycleBin`.
- **Body:**
  - `RecycleBinNoticeBanner` — thông báo "mục sẽ bị xóa sau 7 ngày".
  - `SearchBarWidget` → `cubit.onSearch` (mờ đi khi ở select mode).
  - `RecycleBinFilterChips` — filter nhanh theo loại file.
  - Nút **sắp xếp** — toggle trực tiếp latest/oldest (`cubit.setSort(!isDescending)`),
    mũi tên xoay bằng `AnimatedRotation`; không còn dropdown menu.
  - `CloudTool` — mở `FilterViewWidget` (bottom sheet) → `cubit.refresh(listFilterSelected:)`.
  - `BuildListFileWidget<BaseViewItem>` — danh sách chính, bọc trong `BlocSelector`
    theo `state.isLoading` (skeleton) và `ValueListenableBuilder` theo
    `paginationController` (dữ liệu). Xem §Phân trang về nhánh `isBackfilling`.
- **Tương tác mục:**
  - Tap / tap "more" → `_onMoreActionTap` → mở `showRecycleBinOptionsSheet`
    (Delete có popup xác nhận, Restore trực tiếp).
  - Long-press → bật select mode (`itemMetaCtrl.enableSelectAll()`).
  - Mỗi mục hiển thị `CountdownTimerWidget` qua `_buildCountdownTimer`.

### 2. `countdown_timer_widget.dart`

`CountdownTimerWidget({endTime, onExpired})` — `StatefulWidget` chạy
`Timer.periodic(1s)`:

- Tính `_remaining = endTime - now` (không âm).
- Khi chạm 0 → gọi `onExpired()`.
- **Màu theo mức độ khẩn cấp:**
  - ≥ 4 ngày → xanh (`green0`)
  - ≥ 2 ngày → cam (`orange0`)
  - còn lại → đỏ (`red0`)
- **Định dạng text:** `countDays(days+1)` nếu ≥1 ngày / `remainTime(h, m)` nếu ≥1 giờ /
  `remainTimeOnlyMinute(m)` nếu còn dưới 1 giờ.

### 3. `select_mode_tools_bar.dart`

Chứa 3 class:

- **`SelectModeToolsBar`** — widget AppBar chọn nhiều thuần UI: nút Close, checkbox
  "All", nút "more" (mờ khi chưa chọn), tiêu đề `countItems(count)`.
- **`SelectToolsBarContainer<SCtrl, PCtrl>`** — bản generic dùng chung (favorite,
  more-action) dựa trên `ItemMetaController` + `PaginationController`.
- **`SelectToolsRecycleBin<SCtrl>`** — bản riêng cho thùng rác:
  - Lắng nghe trực tiếp `cubit.paginationController`, nên "select all" luôn phủ đúng
    những item **đang được load**, không phải toàn bộ thùng rác trên server.
  - `_syncSelectAllCheckBox`: list đổi dưới chân selection (delete / restore /
    load-more / **backfill**) → bỏ cờ "all" nhưng **giữ** các id đã chọn, để lần tap
    kế tiếp là chọn-tất-cả chứ không phải bỏ-chọn-tất-cả.
  - `onMoreActionTap` → `showRecycleBinOptionsSheet` với Delete (có xác nhận) /
    Restore cho danh sách đã chọn, rồi `cleanSelectAll()`.

### 4. `build_list_file_widget.dart`

`BuildListFileWidget<T extends BaseViewItem>` — list dùng chung:

- **Pull-to-refresh** (`RefreshIndicator`) → `onRefresh`.
- **Load-more** khi cuộn gần cuối (`maxScrollExtent - 200`) và
  `listData.length >= kPageSizeDefault` → `onLoadMore`.
  → Đây là **ngòi nổ 1**, và điều kiện `>= kPageSizeDefault` chính là chỗ nó tắt khi
    list ngắn đi. Xem §Phân trang & ngòi nổ nạp bù.
- Empty state → `EmptyDataWidget`. Widget này **không** biết gì về `isBackfilling`;
  người gọi phải chặn trước khi render nó (xem `recycle_bin_page.dart` /
  `folder_body_view.dart`), nếu không empty page sẽ nháy giữa lúc đang nạp bù.
- Render item qua `_BuildItemFile`:
  - `FolderModelView` → `FolderListItem`
  - `FileModelView` → `FileListItem`
  - Hỗ trợ `itemContentBuilder` / `countdownTimerBuilder` để chèn đồng hồ đếm ngược.
  - Tap: select-mode → chọn item; ngược lại → mở chi tiết. Long-press → `onLongPressItem`.

### 5. `models/folder_node.dart`

`Node {id, title, data}` + `NodeApi.fetchChildren` (mock). Phục vụ điều hướng
folder lồng nhau trong thùng rác — **hiện chưa được sử dụng** trong luồng thực tế.

---

## `view_folder/` — xem bên trong một folder đã xóa

Tap một folder trong thùng rác → `push(CloudStorageRoute.viewFolderPage)`. Mỗi cấp folder
là **một `ViewFolderPage` mới** được push chồng lên (giống cơ chế my_file), breadcrumb tích
lũy qua `parentBreadcrumbs`.

`ViewFolderCubit` cũng `extends BasePaginationCubit`, dùng chung `RecycleBinRepository
.getFreshData()` nhưng truyền thêm `folderId`.

**Khác biệt cần nhớ so với `RecycleBinCubit`:**

| | `RecycleBinCubit` | `ViewFolderCubit` |
|---|---|---|
| DI | `@LazySingleton()` | `new` trực tiếp trong page, `close()` ở `dispose` |
| API xóa | `deleteFilesInTrash` | `DeleteItemsInTrashFolder` — **trừ khi** `isTopLevel`, tức folder mở thẳng từ gốc thùng rác thì dùng API như gốc |
| Tombstone | `state.cacheDelItem` | `_cacheDelItem` (field riêng của cubit, không nằm trong state — không có gì render nó) |

**Đồng bộ ngược lên cha.** Trang cha **không** rebuild/refetch khi pop, nên khi xóa vĩnh
viễn một folder từ bên trong trang của chính nó, phải chủ động báo lên:

- `ViewFolderAttributes.onPermanentlyDeleted` → gọi ngay lúc xóa, độc lập với kết quả pop.
- Giá trị pop trả về `FolderModelView` — đường thứ hai cho cùng việc đó.

Cả hai đều phải đi qua `removeFromList()` của cubit cha (`RecycleBinCubit` hoặc
`ViewFolderCubit`) chứ **không** gọi thẳng `paginationController.removeItems()`, nếu không
item sẽ không được tombstone và có thể sống lại ở lượt fetch kế tiếp.

**UI** (`folder_body_view.dart`): có cả list mode lẫn grid mode; nhánh loading/empty nằm
**trước** cả hai nên chỉ cần chặn `isBackfilling` một chỗ. Page này dùng
`CircularProgressIndicator` chứ không dùng skeleton như trang gốc.

---

## Tìm kiếm, Sắp xếp & Lọc

Cả ba đều đi qua `RecycleBinRepository.getFreshData()` (gRPC `SearchTrash`), map thành `Filter`/`Sort`.

- **Tìm kiếm** (`onSearch`, debounce): `Filter(field_1: 'advance_search', OPERATOR_LIKE)` — phủ
  tên/hash/folder, đồng bộ với phần còn lại của app (FR-13). *(Trước đây chỉ match `'name'`.)*
- **Sắp xếp** (`setSort`): `Sort(field_1: 'deleted_at', order: isDescending ? DESC : ASC)`.
  Mặc định `isDescending = false` → **ASC = gần hết hạn nhất trước** (FR-12). UI là một nút
  toggle (`setSort(!isDescending)`) chứ không phải dropdown; `SortDateModelView` /
  `SortNameModelView` trong `listFilters` hiện đang **comment**, nên `getSortDate()` /
  `getSortName()` luôn trả `null` và nhánh `isDescending` là đường duy nhất đang chạy.
- **Lọc theo loại** (`RecycleBinFilterChips`, chọn đơn) — từ `FilterFileTypeModelView` + `extraOptions`:
  - Chip loại (video/photo/document/audio/compressed): `Filter(field_1: 'file_ext', OPERATOR_IN, exts)`
    qua `state.getFilterType()`.
  - Chip **"Folders"** (`value: 'folder'`): `Filter(field_1: 'type', OPERATOR_EQ, 'folder')` qua
    `state.getFilterFolder()`.
  - Chip **"Others"** (`value: 'others'`, FR-11): `Filter(field_1: 'file_ext', OPERATOR_NOT_IN,
    allKnownFileExts)` + `Filter(type NE 'folder')` qua `state.getFilterOthers()`. `allKnownFileExts`
    = union ext của mọi `CategoryCloudEnum` (`category_cloud_enum.dart`). **Chip tạm ẩn** trong
    `recycle_bin_page.dart` — `// TODO: Figma miss UI`; logic đã sẵn sàng, chỉ cần bỏ comment.

---

## Dead code (đã comment toàn bộ)

| File | Ghi chú |
|------|---------|
| `widgets/build_storage_list.dart` | `BuildStorageList` cũ — thay bằng `BuildListFileWidget` |
| `widgets/folder_navigator.dart` | `FolderNavigator` cho điều hướng folder — chưa kích hoạt |

Hai file này giữ lại làm tham chiếu cho tính năng duyệt folder lồng nhau trong tương lai
(gắn với `Node`/`stack`/`goBack`).

---

## Luồng dữ liệu tổng quát

### Nạp danh sách

`onFetchData` là nguồn duy nhất — page đầu và mọi load-more đi chung một đường, nên
cursor thuộc về `PaginationController` chứ không thuộc state.

```
init() → initPagination() → PaginationController.refresh()
reload() / refresh(filter) / setSort / onSearch / pull-refresh
                          → PaginationController.refresh()   // clear pit/after
cuộn cuối                  → PaginationController.loadNextPage()
removeItems(autoFill:true) → PaginationController._backfill() // ngòi nổ 2
       │
       └──► onFetchData(limit, pit, after)
              → _purgeExpiredLocalItems()      // quét local, xóa mục hết hạn
              → recycleBinRepo.getFreshData()  // gRPC SearchTrash (pit + searchAfter)
              → serverCount = raw.length       // ĐẾM TRƯỚC khi lọc
              → lọc bỏ cacheDelItem
              → CloudPagination(listData, serverCount, pit, after)
```

### Xóa vĩnh viễn / Khôi phục
```
delete() / restore(items)
  → _classifyRemoteIds → (remoteIds, folderIds, fileIds)
  → emit cacheDelItem += remoteIds       // tombstone, TRƯỚC khi gọi server
  → fileRepo.deleteFilesInTrash / restoreFiles (gRPC)
  → delay 1s
  → cập nhật local DB (tách file / folder)
  → restore: _applyRestoreDestinations()  // áp đích server thật sự chọn
  → paginationController.removeItems(items, autoFill: true)   // → có thể châm ngòi nổ 2
```

### Dọn sạch
```
emptyTrash()
  → fileRepo.emptyTrash() (gRPC)
  → cloudFileDB.delete() + cloudFolderDB.delete()  // thu remoteIds đã xóa
  → paginationController.syncRealtimeUpdate()      // list rỗng
  → emit(cacheDelItem: remoteIds)
```

> Dùng `syncRealtimeUpdate()` chứ **không** `removeItems()`, nên emptyTrash cố ý **không**
> châm ngòi nổ 2 — dọn sạch thì empty page mới là đúng.

---

## Ghi chú khi bảo trì

- **Hạn 7 ngày** hard-code `const Duration(days: 7)` ở cả cubit và
  `CountdownTimerWidget` — cần đổi đồng bộ cả hai nếu thay đổi chính sách.
- **Delay 1s** trong `delete`/`restore` là workaround chờ server đồng bộ
  (xem TODO 2300 trong code về dung lượng không cập nhật ngay). Sau khi có backfill nó
  **không còn gánh vai trò đúng/sai** — tombstone + `serverCount` đã lo việc đó, không
  cần đoán độ trễ index. Nó chỉ còn làm item chậm biến mất khỏi UI thêm 1 giây. Ứng viên
  gỡ bỏ tốt để tăng độ mượt, nhưng nó nằm giữa gRPC và các lệnh ghi local DB nên có thể
  còn mục đích khác — làm riêng và đo riêng.
- **Đừng dùng `count < limit` sau khi lọc** làm điều kiện hết trang ở bất kỳ chỗ nào mới.
  Cubit lọc `cacheDelItem` nên con số đó không phản ánh số dòng server gửi. Luôn đếm
  trước khi lọc (`serverCount`).
- **`init()` gọi từ `initState`, không từ `build`** — mỗi lần gọi dựng lại
  `PaginationController`, mất list + scroll offset.
- **Chọn nhiều** quản lý qua `ItemMetaController` (không phải state của cubit).
- **L10n:** Recycle Bin dùng `context.cloudL10n.*` (module **cloud**, KHÔNG phải new_cloud).
  Thêm/sửa key trong `lib/app/global/languages/modules/cloud/l10n/cloud_*.arb` rồi gen bằng
  `dart run scripts/build_modular_l10n.dart` (skill `/add-l10n` chỉ dành cho module new_cloud).
- **File Restore path (bug nested folder):** `syncFolderByRemoteId` (`cloud_folder_db.dart`) khi
  fetch tươi folder My Files (type 0, `!keepMyFilesParent`) nay cập nhật `path` theo server — để
  folder được restore vào "File Restore" phản ánh đúng vị trí mới thay vì đường dẫn gốc cũ.