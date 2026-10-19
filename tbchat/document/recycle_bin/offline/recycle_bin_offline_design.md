# Recycle Bin — Offline Support (Design Doc)

> Phạm vi: `lib/features/cloud_storage/_new_cloud_storage/pages/recycle_bin/**` + data layer liên quan.
> Ngày: 2026-07-29

## Trạng thái triển khai

| Mục tiêu | Trạng thái |
|---|---|
| **G1** — offline vẫn thấy cache (file + folder), không empty-state sai | ✅ **Đã code** (xem §9) |
| **G2** — local-first paint, không nhấp nháy, không trùng item | ✅ **Đã code** (xem §9.4) |
| **G3** — remote fail không xoá list, không loop loadMore | ✅ **Đã code** (xem §9.5) — còn 1 lỗ ở `ViewFolderPage`, xem §9.6 |
| G4 — search/sort/filter offline nhất quán | ⚠️ một phần (xem §9.3) |
| G5 — delete/restore/empty offline an toàn | ❌ chưa làm |
| G6 — countdown/auto-purge | ⚠️ một phần (đã chặn purge khi offline) |

---

## 1. Mục tiêu

| # | Mục tiêu | Ưu tiên |
|---|---|---|
| G1 | Mở Recycle Bin khi **mất mạng** vẫn thấy danh sách đã cache (file **và** folder), không bị màn hình trắng/empty-state sai | P0 |
| G2 | Khi **có mạng chập chờn**, dữ liệu local hiển thị ngay (first paint nhanh), sau đó được thay bằng dữ liệu server — không nhấp nháy, không trùng item | P0 |
| G3 | Lỗi mạng **không được** làm mất danh sách đang hiển thị và **không** làm loadMore chạy vô hạn | P0 |
| G4 | Search / sort / filter khi offline cho kết quả nhất quán (hoặc bị khoá rõ ràng nếu local không hỗ trợ) | P1 |
| G5 | Delete / Restore / Empty Trash khi offline **không** làm hỏng đồng bộ (item biến mất ở máy nhưng còn trên server, hoặc ngược lại) | P0 |
| G6 | Countdown 7 ngày & auto-purge không được xoá dữ liệu local khi chưa có xác nhận từ server | P1 |

Non-goal (giai đoạn này): offline cho **preview/download** nội dung file; đồng bộ realtime qua WS khi offline.

---

## 2. Hiện trạng code

### 2.1 Các thành phần

| Layer | File | Vai trò |
|---|---|---|
| UI | `pages/recycle_bin/recycle_bin_page.dart` | List root, pull-to-refresh, loadMore, `hasNext: state.pagination != null` (dòng 342) |
| Cubit (root) | `pages/recycle_bin/cubit/recycle_bin_cubit.dart` | **Cubit thuần**, tự quản `page` / `pagination` / `listData` |
| Cubit (folder) | `pages/recycle_bin/view_folder/cubit/view_folder_cubit.dart` | Kế thừa `BasePaginationCubit` |
| Repo | `data/repository/recycle_bin/recycle_bin_repository_impl.dart` | `getFreshData()` build filter/sort → gọi `searchTrash` |
| gRPC | `data/_grpc/repositories/search_service_repository_impl.dart` | `searchTrash()` — map proto → model view, **ghi DB** qua `mapSearchFileFolderToModelView` |
| Local DB | `data/db/cloud_file_db.dart` : `fetchRecycleBin()` (dòng 1550) | Query `CloudFile.isDeleted == true` |
| Local DB | `data/db/cloud_folder_db.dart` | **Không có** API list folder trong thùng rác |
| Network | `shared/utils/network_utils.dart` : `CSNetworkUtils` | `checkConnection()` + `listen()` |

### 2.2 Phần offline đã làm và đang bị comment

Trong `recycle_bin_cubit.dart`:

- `_fetchRecycleBin()` (dòng 77–142): vẫn **đọc** local (`cloudFileDB.fetchRecycleBin`) nhưng khối `emit` local đã bị comment (dòng 97–102), và khối "query lại local sau khi sync" cũng bị comment (dòng 128–131). Kết quả: local data chỉ dùng để chạy vòng kiểm tra hết hạn, **không hiển thị**.
- `loadMore()` (dòng 144–217): tương tự — đọc local, nhưng phần emit local (dòng 172–179) và `syncedPage` (dòng 196–200) bị comment.

Tức là hiện tại luồng là **remote-only**, phần local chỉ còn tác dụng phụ (xoá item hết hạn).

---

## 3. Vì sao bản offline cũ chạy sai — phân tích nguyên nhân

> Đây là phần quan trọng nhất; nếu chỉ bỏ comment ra thì sẽ tái hiện đúng các lỗi cũ.

### R1 — `searchTrash` nuốt lỗi và trả pagination "giả" (P0)

`search_service_repository_impl.dart:71-86` — khi gRPC ném lỗi (offline là trường hợp điển hình):

```dart
return (
  <FileModelView<CloudFile>>[],                 // ← list RỖNG
  CursorPagination(                              // ← pagination KHÁC NULL (echo lại request)
    limit: ..., pit: ..., searchAfter: ...,
  ),
);
```

Hệ quả dây chuyền:

1. `getFreshData` trả list rỗng → `_fetchRecycleBin` `emit(listData: [])` → **xoá sạch dữ liệu local vừa hiển thị**. Đây chính là hiện tượng "hiện ra rồi mất".
2. `pagination != null` → UI (`recycle_bin_page.dart:342`) tin là còn trang sau → `onLoadMore` tiếp tục được gọi → mỗi lần lại fail → **loop loadMore** khi offline.
3. Cubit **không phân biệt được** "thùng rác thật sự rỗng" với "gọi API thất bại" → không thể quyết định giữ hay xoá local.

### R2 — Trộn hai hệ phân trang khác nhau (P0)

- Local: offset-based — `query.offset = page * kPageSizeDefault` (`cloud_file_db.dart:1577`).
- Remote: cursor-based — `pit` + `searchAfter`.

Code cũ append cả hai vào cùng `listData` với cùng biến `state.page`. Hai con trỏ chạy lệch nhau → **trùng item / nhảy item** khi cuộn, và `state.page` không còn ý nghĩa cho bên nào cả.

### R3 — Local query thiếu folder (P0)

`cloudFileDB.fetchRecycleBin()` chỉ đọc `CloudFile`. Folder bị xoá được lưu ở `CloudFolder.isDeleted = true` (xem `cloud_folder_db.dart:1830`) nhưng **không có hàm đọc** — chỉ có `delete()` xoá tất cả.

→ Danh sách offline luôn thiếu folder, trong khi danh sách online có folder. Vào-ra màn hình là list đổi nội dung → nhìn như bug.

### R4 — Local query không hỗ trợ filter/sort như server (P1)

| Khả năng | Remote (`getFreshData`) | Local (`fetchRecycleBin`) |
|---|---|---|
| search | `advance_search` (name + hash + folder) | `name.contains()` |
| filter theo `file_ext` | ✅ | ❌ |
| filter "folder" | ✅ | ❌ |
| filter "others" (NOT_IN known exts) | ✅ | ❌ |
| sort theo `deleted_at` | ✅ | ✅ |
| sort theo `name` | ✅ | ❌ |

→ Bật filter khi offline sẽ ra kết quả sai (filter bị bỏ qua âm thầm).

### R5 — Ghi (delete/restore/empty) không quan tâm gRPC thành công hay không (P0)

`recycle_bin_cubit.dart:247-292` (`delete`), `295-347` (`restore`), `370-390` (`emptyTrash`) đều theo mẫu:

```dart
try { await fileRepo.deleteFilesInTrash(ids: ids); }
on ServerFailure catch (e) { CloudLogger.e(...); }   // nuốt lỗi
catch (e) { CloudLogger.e(...); }                     // nuốt lỗi
await Future.delayed(const Duration(milliseconds: 1000));
// ... rồi VẪN xoá local DB
```

Offline → gRPC fail → nhưng local DB **vẫn bị xoá vĩnh viễn**. Kết quả:
- Item biến mất ở máy nhưng vẫn còn trên server → lần sync sau nó "sống lại" (nếu record còn ở server) hoặc mất luôn khỏi mọi nơi trừ server.
- Với `emptyTrash` thì thiệt hại lớn nhất: xoá sạch cache trash local mà server không đổi gì.
- `Future.delayed(1000ms)` là workaround chờ server (ticket 2300), không phải cơ chế đúng.

### R6 — Tombstone (`cacheDelItem`) chỉ nằm trong RAM (P1)

`cacheDelItem` là `Set<String>` trong state, bị reset ở `cleanCache()` (gọi từ `dispose`, `recycle_bin_page.dart:53`). Sau khi thoát màn hình / kill app, tombstone mất → item đã xoá lạc quan có thể hiện lại từ local DB.

### R7 — Auto-purge theo đồng hồ client (P1)

`_fetchRecycleBin` dòng 84–96 và `loadMore` dòng 157–169 tính hạn 7 ngày bằng `DateTime.now()` của máy rồi gọi `deleteExpired` → **xoá cứng** khỏi local DB (`recycle_bin_repository_impl.dart:75-86`).

Offline + đồng hồ máy lệch (hoặc user chỉnh giờ) → xoá nhầm dữ liệu local mà server vẫn còn giữ.

Ngoài ra, ở `loadMore` các lời gọi `deleteExpired` **không được `await`** (dòng 160, 165) → race với `emit` bên dưới.

### R8 — DB chỉ được ghi thêm, không bao giờ đối soát (P1)

`mapSearchFileFolderToModelView` (`search_mapper.dart:100-130`) gọi `syncFilesByRemoteId` / `syncFolderByRemoteId` — **upsert**, không xoá. Item đã bị restore/xoá vĩnh viễn từ thiết bị khác vẫn nằm lại trong local DB với `isDeleted = true` → offline sẽ thấy **item ma**.

### R9 — `ViewFolderCubit.onFetchLocalData` thực chất là remote (P2)

`view_folder_cubit.dart:66-78` — hàm tên là `onFetchLocalData` nhưng gọi `_recycleBinRepo.getFreshData()` (gRPC). Hiện `init()` gọi `initPagination()` không bật `loadLocalFirst` (dòng 60–61 đang comment) nên chưa gây hại, nhưng nếu bật lên sẽ **gọi remote 2 lần** chứ không phải local-first.

---

## 4. Kiến trúc đề xuất

### 4.1 Nguyên tắc

1. **Local DB là source-of-truth cho hiển thị**; remote là nguồn làm tươi. UI đọc từ một danh sách đã merge, không tự nối local + remote ở tầng cubit.
2. **Lỗi mạng phải là first-class citizen** — mọi hàm fetch trả về trạng thái rõ ràng (`fromCache` / `stale` / `failed`), không dùng "list rỗng" để biểu diễn lỗi.
3. **Không bao giờ mutate local DB dựa trên một RPC đã thất bại.** Ghi khi offline phải đi qua hàng đợi (outbox) hoặc bị chặn.
4. **Một hệ phân trang tại một thời điểm.** Online → cursor; offline → offset. Không trộn trong cùng một phiên cuộn.

### 4.2 Sơ đồ luồng đọc

```
                ┌──────────────────────────┐
   UI  ──init── │      RecycleBinCubit     │
                └────────────┬─────────────┘
                             │ loadFirstPage() / loadMore()
                             ▼
                ┌──────────────────────────┐
                │  RecycleBinRepository    │  ← quyết định online/offline
                └───┬──────────────────┬───┘
        offline     │                  │  online
                    ▼                  ▼
        ┌───────────────────┐   ┌──────────────────────┐
        │  TrashLocalSource │   │  searchTrash (gRPC)  │
        │  file + folder    │   └──────────┬───────────┘
        │  merge + sort     │              │ upsert (đã có sẵn)
        └─────────▲─────────┘              ▼
                  └──────────── reconcile window ───────┘
```

### 4.3 Kiểu dữ liệu trả về mới

Thay `(List, CursorPagination?)` bằng một record/class có ngữ nghĩa:

```dart
enum TrashDataSource { local, remote }

class TrashPage {
  final List<BaseViewItem> items;
  final CursorPagination? cursor;   // chỉ có khi source == remote
  final int? localNextOffset;       // chỉ có khi source == local
  final TrashDataSource source;
  final bool remoteFailed;          // true ⇒ dữ liệu đang là stale cache
  bool get hasNext => cursor != null || localNextOffset != null;
}
```

`RecycleBinState` thêm:

| Field | Ý nghĩa |
|---|---|
| `bool isOffline` | trạng thái mạng hiện tại (từ `CSNetworkUtils.listen`) |
| `bool isStale` | dữ liệu đang hiển thị đến từ cache do remote fail |
| `TrashDataSource source` | quyết định dùng cursor hay offset khi loadMore |
| `int localOffset` | con trỏ phân trang local (tách khỏi `page`) |
| `bool hasNext` | thay cho việc UI tự suy ra từ `pagination != null` |

---

## 5. Thiết kế chi tiết theo luồng

### 5.1 Load trang đầu (`init` / pull-to-refresh)

```
1. emit(isLoading: true)
2. local = TrashLocalSource.fetchPage(offset: 0, filters: state.filters)
   - nếu local.isNotEmpty → emit(listData: local, source: local, isLoading: false)
     (first paint ngay, kể cả khi đang online)
3. online = await CSNetworkUtils.checkConnection()
   - offline → emit(isOffline: true, isStale: true, hasNext: local.hasMore); DỪNG
4. remote = await repo.getFreshData(page 1)
   - remoteFailed → GIỮ NGUYÊN listData local, emit(isStale: true, hasNext: local.hasMore)
     (KHÔNG emit list rỗng — sửa R1)
   - thành công →
       a. reconcileWindow(remote)              // xoá item ma, xem 5.5
       b. emit(listData: remote, source: remote, cursor: ..., isStale: false)
```

Điểm khác biệt cốt lõi so với bản cũ: **nhánh remote-fail không được chạm vào `listData`**.

### 5.2 Load more

```
if (state.source == remote && state.cursor != null)  → gọi remote với pit/after
else if (state.source == local)                      → local offset += pageSize
else                                                  → no-op
```

Không bao giờ nối kết quả local vào sau kết quả remote trong cùng phiên (sửa R2). Nếu remote fail giữa chừng khi đang ở chế độ cursor:
- Giữ nguyên list, `emit(isStale: true)`, **set `hasNext = false`** để dừng vòng loadMore, và hiện một footer "Không có kết nối — chạm để thử lại".

### 5.3 Chuyển trạng thái mạng

Đăng ký `CSNetworkUtils.listen` trong cubit (`addSubscription` nếu chuyển sang `BasePaginationCubit`):

- offline → online: `emit(isOffline: false)` rồi **tự động** `loadFirstPage()` (reset cursor) + flush outbox (5.4).
- online → offline: chỉ `emit(isOffline: true)`, không đụng dữ liệu.

Banner offline: tái sử dụng chỗ `RecycleBinNoticeBanner` (`recycle_bin_page.dart:199`) — thêm biến thể "Đang xem dữ liệu ngoại tuyến".

### 5.4 Ghi khi offline — 2 phương án

#### Phương án A — Read-only offline (khuyến nghị cho Phase 1)

Khi `state.isOffline == true`:
- Delete / Restore / Empty Trash bị **disable** (mờ nút + `Toast.info` "Cần kết nối mạng để thực hiện").
- Không đụng local DB, không có rủi ro lệch dữ liệu.
- Chi phí thấp, sửa dứt điểm R5 ở mức "không làm hỏng dữ liệu".

Ngay cả khi đang online, phải sửa mẫu code hiện tại: **chỉ mutate local DB khi RPC trả về thành công**. Bỏ `Future.delayed(1000ms)`, thay bằng kiểm tra kết quả RPC; RPC fail → rollback optimistic removal + toast lỗi.

#### Phương án B — Outbox / hàng đợi thao tác (Phase 2)

Thêm entity ObjectBox:

```dart
@Entity()
class PendingTrashOp {
  int id;                 // objectbox id
  String remoteId;
  String opType;          // 'delete' | 'restore' | 'emptyTrash'
  int createdAt;
  int retryCount;
  String? lastError;
}
```

Luồng:
1. Offline + user bấm Delete → **không xoá** record; set cờ ẩn (xem dưới) + enqueue `PendingTrashOp`.
2. UI ẩn item khỏi list (optimistic) dựa trên hàng đợi, **không** dựa trên `cacheDelItem` trong RAM (sửa R6).
3. Khi online → flush theo thứ tự `createdAt`, mỗi op thành công mới mutate DB thật; op fail vĩnh viễn (server báo not-found) → coi như đã xong, xoá khỏi hàng đợi.
4. `emptyTrash` khi có op lẻ đang chờ → gộp, xoá các op lẻ trước khi enqueue `emptyTrash`.

Cần thêm cờ ẩn bền vững — 2 lựa chọn:
- (B1) trường mới `pendingOp` trên `CloudFile` / `CloudFolder` (cần migration ObjectBox + `/build -obj`);
- (B2) không thêm trường, mà join list hiển thị với bảng `PendingTrashOp` khi query (đơn giản hơn, không migration entity chính) — **khuyến nghị B2**.

> Quyết định cần chốt: làm A trước rồi B, hay làm thẳng B? Ước lượng ở §8.

### 5.5 Reconcile — chống "item ma" (R8)

Sau mỗi lần **trang đầu** remote trả về thành công:

```
window = [min(deletedAt của response), max(deletedAt của response)]
localInWindow = local items có deletedAt trong window
ghost = localInWindow.remoteId − response.remoteId
→ xoá cứng ghost khỏi local DB
```

Chỉ đối soát trong "cửa sổ" của trang vừa nhận (vì response là phân trang, không thể suy ra toàn bộ). Với các trang sau, áp dụng cùng công thức trên window của trang đó.

Trường hợp `emptyTrash` thành công → xoá toàn bộ `isDeleted == true` ở cả hai box (code hiện tại đã làm đúng phần này).

### 5.6 Countdown & auto-purge (R7)

- Khi **offline**: countdown về 0 → chỉ **ẩn khỏi UI**, không gọi `deleteExpired`. Ghi nhớ bằng cách lọc lúc render (`expiredAt <= now`), không đụng DB.
- Khi **online**: item hết hạn được server loại khỏi response → reconcile (5.5) sẽ dọn local. `deleteExpired` chỉ còn dùng như đường dọn rác phụ, và **phải `await`** (sửa lỗi thiếu `await` ở `loadMore`).
- Nếu vẫn muốn purge chủ động: dùng mốc thời gian server (offset từ response gRPC) thay cho `DateTime.now()` thuần.

---

## 6. Thay đổi theo file

| File | Thay đổi | Mức |
|---|---|---|
| `data/_grpc/repositories/search_service_repository_impl.dart` | `searchTrash`: nhánh catch trả `pagination = null` + cờ lỗi (hoặc rethrow `NetworkFailure`). **Sửa R1 — làm trước tiên** | P0 |
| `data/db/cloud_folder_db.dart` | Thêm `fetchRecycleBinFolders({offset, limit, search, isDescending})` — query `isDeleted == true`. **Sửa R3** | P0 |
| `data/db/cloud_file_db.dart` | `fetchRecycleBin` nhận thêm `exts`, `isOthers`, `sortName`, `offset` (thay `page`), trả kèm `hasMore`. **Sửa R4** | P1 |
| `data/repository/recycle_bin/…_impl.dart` | Thêm `getLocalData(...)` merge file+folder, sort theo `deletedAt` (rồi `name`), cắt trang; `getFreshData` trả `TrashPage` | P0 |
| `pages/recycle_bin/cubit/recycle_bin_state.dart` | Thêm `isOffline`, `isStale`, `source`, `localOffset`, `hasNext`; `copyWith` cần hỗ trợ **set null** cho `pagination` (hiện phải dùng `clearPagination()` thủ công) | P0 |
| `pages/recycle_bin/cubit/recycle_bin_cubit.dart` | Viết lại `_fetchRecycleBin` / `loadMore` theo §5.1–5.2; sub connectivity; sửa `delete`/`restore`/`emptyTrash` theo §5.4 | P0 |
| `pages/recycle_bin/recycle_bin_page.dart` | `hasNext: state.hasNext`; banner offline; disable action khi offline (Phase 1) | P0 |
| `pages/recycle_bin/view_folder/cubit/view_folder_cubit.dart` | `onFetchLocalData` phải đọc **local thật** (theo `parentRemoteId`), không gọi gRPC. **Sửa R9** | P2 |
| (Phase 2) `data/db/pending_trash_op_db.dart` + entity | Outbox, cần `/build -obj` | P2 |

### 6.1 Ghi chú về merge file + folder ở tầng local

ObjectBox có 2 box tách biệt nên không query gộp được. Cách thực dụng:

```
take = offset + limit
files   = fileBox.query(isDeleted).order(deletedAt).limit(take)
folders = folderBox.query(isDeleted).order(deletedAt).limit(take)
merged  = (files + folders).sortBy(deletedAt, then name).skip(offset).take(limit)
hasMore = (files.length + folders.length) > offset + limit
```

Trade-off: over-fetch tối đa `take` bản ghi mỗi box. Chấp nhận được vì thùng rác giới hạn 7 ngày; nếu dữ liệu lớn, giới hạn local ở N trang đầu (ví dụ 5 trang) rồi yêu cầu online.

---

## 7. Test cases

### Đọc
| # | Kịch bản | Kỳ vọng |
|---|---|---|
| T1 | Online → mở Recycle Bin → tắt mạng → back → mở lại | Hiện đúng danh sách cache (có cả folder), banner offline, không empty-state |
| T2 | Offline hoàn toàn, chưa từng mở | Empty-state kèm thông báo offline (không phải "thùng rác trống") |
| T3 | Online, mạng chập chờn (RPC fail ở trang 1) | List local giữ nguyên, `isStale = true`, **không** clear list (R1) |
| T4 | Offline → cuộn xuống đáy | Phân trang local chạy đúng, không trùng item, dừng khi hết (R2) |
| T5 | Online → cuộn 3 trang → mất mạng → cuộn tiếp | Không loop loadMore; footer "thử lại" (R1/R3) |
| T6 | Offline → bật mạng lại | Tự refresh trang đầu, `isStale` về false |
| T7 | Restore item ở thiết bị B → thiết bị A online refresh | Item biến mất ở A (reconcile — R8) |
| T8 | Offline → search | Kết quả từ local theo `name`; nếu chưa hỗ trợ filter thì filter bị disable rõ ràng (R4) |
| T9 | Offline → đổi sort deletedAt | Sort local đúng chiều |
| T10 | Offline → bật filter loại file | (Phase 1) chip bị disable / (Phase 2) lọc đúng theo ext local |

### Ghi
| # | Kịch bản | Kỳ vọng Phase 1 (A) | Kỳ vọng Phase 2 (B) |
|---|---|---|---|
| T11 | Offline → Delete 1 file | Nút disable + toast | Item ẩn, op vào outbox, online → gọi API, thành công mới xoá DB |
| T12 | Offline → Restore folder | Nút disable + toast | Như trên |
| T13 | Offline → Empty Trash | Nút disable + toast | Enqueue, gộp các op lẻ |
| T14 | Online → Delete nhưng RPC fail | Item quay lại list + toast lỗi, **local DB không đổi** (R5) | Chuyển thành op chờ |
| T15 | Kill app khi có op chờ | — | Op vẫn còn sau restart, flush khi online (R6) |

### Countdown
| # | Kịch bản | Kỳ vọng |
|---|---|---|
| T16 | Offline, item countdown về 0 | Ẩn khỏi UI, **không** xoá local DB (R7) |
| T17 | Chỉnh giờ máy tiến 10 ngày, offline | Không xoá dữ liệu local |

---

## 8. Kế hoạch triển khai

| Phase | Nội dung | Sửa | Ước lượng |
|---|---|---|---|
| **P0.1** | `searchTrash` không trả pagination giả + cubit không clear list khi remote fail | R1 | ~0.5 ngày |
| **P0.2** | `fetchRecycleBinFolders` + `getLocalData` merge file/folder + phân trang local tách biệt | R2, R3 | ~1.5 ngày |
| **P0.3** | State mới (`isOffline`/`isStale`/`source`/`hasNext`) + connectivity listener + banner + disable action khi offline | R5 (mức A) | ~1 ngày |
| **P1.1** | Local hỗ trợ filter ext / others / sort name | R4 | ~1 ngày |
| **P1.2** | Reconcile window + sửa countdown/auto-purge | R7, R8 | ~1 ngày |
| **P2.1** | Outbox `PendingTrashOp` + flush khi online | R5 (mức B), R6 | ~2–3 ngày |
| **P2.2** | `ViewFolderCubit.onFetchLocalData` đọc local thật | R9 | ~0.5 ngày |

Khuyến nghị: **merge P0.1 → P0.3 trước** (đã đủ để offline "không sai"), rồi đánh giá xem có cần P2 hay không dựa trên yêu cầu sản phẩm.

---

## 9. Đã code cho G1 — chi tiết

### 9.1 Danh sách thay đổi

| File | Thay đổi | Sửa |
|---|---|---|
| `data/_grpc/repositories/search_service_repository_impl.dart` | `searchTrash` không còn trả `(list rỗng, pagination echo)` khi lỗi → `rethrow` | **R1** |
| `data/repository/recycle_bin/trash_page.dart` *(mới)* | `TrashPage` (items / cursor / nextLocalOffset / source / **failed**) + `TrashDataSource{local, remote}` | R1, R2 |
| `data/db/cloud_folder_db.dart` | Thêm `fetchRecycleBinFolders({offset, limit, search, isDescending})`; import `injectable` thêm `hide Order` (tránh đụng `Order` của ObjectBox) | **R3** |
| `data/db/cloud_folder_db.dart` | `syncFolderByRemoteId` nay ghi cả `deletedAt` khi cập nhật folder đã tồn tại | (mới phát hiện) |
| `data/db/cloud_file_db.dart` | `fetchRecycleBin` đổi `page` → `offset` + `limit` (bound thô, để caller merge rồi tự cắt trang) | R2 |
| `data/repository/recycle_bin/recycle_bin_repository{,_impl}.dart` | Thêm `getRemotePage` (bọc `getFreshData`, báo `failed`) và `getLocalPage` (merge file+folder, sort, cắt trang, lọc theo loại file) | R1, R2, R3 |
| `pages/recycle_bin/cubit/recycle_bin_state.dart` | Thêm `isOffline`, `isStale`, `source`, `localOffset`, `hasNext`; `copyWith` thêm cờ `resetPagination`; bỏ `clearPagination()` | R1, R2 |
| `pages/recycle_bin/cubit/recycle_bin_cubit.dart` | Viết lại `_fetchRecycleBin` / `loadMore`; thêm `_listenNetwork`; tách `_purgeExpiredLocal` (chỉ chạy khi online); `_withoutCachedDeletions` | R1, R2, R7 |
| `pages/recycle_bin/recycle_bin_page.dart` | `hasNext: state.hasNext`; banner đổi sang `noConnection` khi offline; empty-state offline dùng `noConnection` | R1 |

Không thêm key l10n mới — dùng lại key `noConnection` đã có đủ 10 ngôn ngữ.

### 9.2 Hành vi sau thay đổi

```
mở trang
  ├─ đọc local (file + folder, đã merge/sort)  → vẽ ngay, isStale = true
  ├─ checkConnection()
  │    ├─ offline → giữ nguyên cache, isOffline = true, banner "No connection". HẾT.
  │    └─ online  → gọi server
  │         ├─ failed → GIỮ list đang hiển thị, chỉ set isStale. KHÔNG clear.
  │         └─ ok     → thay list, source = remote, cursor = pit/after, isStale = false
  │                     rồi mới dọn item hết hạn trong local DB
  └─ mạng trở lại (listener) → tự động refresh trang đầu
```

`loadMore` chọn đúng một cơ chế theo `state.source`: local → `offset`, remote → `pit/searchAfter`. Không bao giờ nối hai loại vào cùng một phiên cuộn.

Lưu ý: `BuildListFileWidget._onScroll` **không** đọc prop `hasNext` (nó chỉ chặn theo `listData.length < kPageSizeDefault`), nên chốt chặn thật nằm ở `RecycleBinCubit.loadMore` — `if (!state.hasNext) return`. Khi trang remote fail giữa chừng, cubit set `hasNext = false` để dừng hẳn.

### 9.3 Giới hạn còn lại (đã biết, chưa nằm trong G1)

1. **Cửa sổ cache local = 300 dòng/box** (`_kLocalWindow`). Vượt quá thì offline dừng ở đó; online vẫn phân trang đầy đủ.
2. **Search offline chỉ khớp `name`**, trong khi server dùng `advance_search` (name + hash + folder) → kết quả offline hẹp hơn. *(R4)*
3. **Sort theo `name`** (filter SortName) chưa áp dụng ở local — local luôn sort theo `deletedAt`, `name` chỉ là tie-break. *(R4)*
4. Filter theo loại file / "folder" / "others" **đã** hoạt động offline (lọc trong Dart theo `CloudFile.ext`).
5. **Chưa reconcile** → item bị restore/xoá ở thiết bị khác vẫn còn trong cache offline cho tới khi có bản online đè lên. *(R8)*
6. **Delete / Restore / Empty Trash khi offline vẫn chạy như cũ** (nuốt lỗi rồi vẫn xoá local DB). Đây là G5/R5, chưa đụng tới.

### 9.4 G2 — chống nhấp nháy & trùng item

G1 đã lo phần "local hiện trước, server thay sau". G2 xử lý các đường dẫn khiến việc thay đó bị **giật hai nhịp** hoặc **nhân đôi dòng**.

#### Nguyên nhân tìm được

| # | Nguyên nhân | Hệ quả |
|---|---|---|
| F1 | `RecycleBinPage.build` gọi `cubit..init()` → mỗi lần rebuild là một lần reload toàn bộ | 2+ fetch chạy song song; fetch cũ về sau đè fetch mới → list nhảy |
| F2 | Không có cơ chế huỷ kết quả cũ | Gõ search / đổi filter nhanh → response chậm của query cũ ghi đè kết quả query mới |
| F3 | `_fetchRecycleBin` **luôn** vẽ local trước, kể cả khi màn hình đang có dữ liệu server | Pull-to-refresh: list nhảy về cache cũ rồi mới nhảy sang dữ liệu mới = 2 nhịp giật |
| F4 | Remote trả về đúng dữ liệu đang hiển thị nhưng vẫn `emit` list object mới | `buildWhen` so sánh identity → rebuild toàn bộ row dù nội dung không đổi |
| F5 | `loadMore` không khoá, và append không dedupe | Hai lần append chồng nhau / trang cursor lệch trang offset → dòng lặp + trùng `ValueKey` |

#### Cách xử lý

- **F1** — `init()` chuyển từ `build()` sang `initState()` (`recycle_bin_page.dart`).
  Kèm theo: trước đây việc init lặp lại cũng vô tình làm list root refresh khi pop khỏi `ViewFolderPage`. Nay refresh **tường minh** bằng `.then((_) => c.getRecycleBin())` sau `context.push` — cần thiết vì restore từ trong folder không báo ngược ra root (`onPermanentlyDeleted` chỉ lo trường hợp xoá).
- **F2** — thêm generation counter `_fetchSeq`. Mỗi `getRecycleBin` lấy một `seq`; sau **mỗi** `await` kiểm tra `_superseded(seq)` và dừng nếu đã có lần load mới hơn. `cleanCache()` cũng tăng `_fetchSeq` để vô hiệu hoá mọi request đang bay.
- **F3** — chỉ vẽ local khi màn hình **không có gì dùng được cho query hiện tại**: `state.listData.isEmpty || queryChanged`. `queryChanged` so bằng `_currentQuery` (search + sort + 3 loại filter) với `_shownQuery` của list đang hiển thị.
- **F4** — `_reuseIfUnchanged()`: so từng item bằng `_fingerprintOf` (id + remoteId + title + `deletedAt`); nếu giống hệt thì **trả lại chính list cũ**, `buildWhen` thấy identity không đổi → không rebuild. Đây là case phổ biến nhất (cache đúng).
- **F5** — cờ `_isLoadingMore` chặn append song song; `_appendNew()` lọc theo `remoteId` đã có trong list.

Ghi chú: local và remote cùng trỏ tới một hàng ObjectBox (searchTrash ghi DB qua `syncFilesByRemoteId`/`syncFolderByRemoteId` rồi trả entity đã có `id`), nên `ValueKey(item.id)` giữ nguyên khi đổi từ local sang remote → widget được tái sử dụng, không nháy.

### 9.5 G3 — lỗi mạng không được xoá list & không loop loadMore

Phần lớn G3 đã có từ G1 (remote fail thì `emit(isStale)` chứ không đụng `listData`; loadMore fail thì `hasNext=false`). Phần bổ sung ở đây là những đường đi còn hở.

| # | Vấn đề | Xử lý |
|---|---|---|
| E1 | `BuildListFileWidget._onScroll` **không đọc** prop `hasNext` — cứ chạm đáy là gọi `onLoadMore`, kể cả khi đã hết trang hoặc đã dừng do lỗi. Cubit tuy return sớm nhưng widget vẫn `setState(_loadingMore = true)` → nháy spinner ở footer mỗi lần cuộn tới đáy | Thêm `!widget.hasNext → return`. Đã kiểm tra 2 caller phân trang đều truyền `hasNext` đúng (`recycle_bin_page` → `state.hasNext`, `folder_body_view` → `!value.isLastPage`); `hash_download_page` không truyền `onLoadMore` nên không ảnh hưởng |
| E2 | Sau khi `hasNext=false` vì lỗi, phân trang **chết lặng** — không báo gì, không có đường thử lại (chỉ tự hồi khi mạng trở lại hoặc pull-to-refresh) | Thêm `RecycleBinState.loadMoreFailed`; footer hiện `noConnection + retry`; `RecycleBinCubit.retryLoadMore()` khôi phục `hasNext` và chạy tiếp — **cursor/offset được giữ nguyên** khi fail nên nối đúng chỗ cũ |
| E3 | Empty-state chỉ xét `isOffline`. Nếu **đang online nhưng server lỗi** và cache rỗng → hiện "Không có bản ghi đã xoá" = báo sai rằng thùng rác trống | Điều kiện đổi thành `isOffline \|\| isStale`. An toàn vì `emptyTextBuilder` chỉ dùng khi list rỗng, mà "rỗng + stale" nghĩa là không có gì và refresh đã hỏng |

Không thêm key l10n: dùng `noConnection` và `retry` đã có sẵn.

### 9.6 Lỗ G3 còn lại — `ViewFolderPage` (chưa sửa)

`ViewFolderCubit` dùng `BasePaginationCubit` → `PaginationController`, và chuỗi đó **vẫn xoá list khi fetch lỗi**:

1. `BasePaginationCubit.initPagination` → `fetchPage` bắt mọi exception và `return []` (`base_pagination_cubit.dart:78-81`) → tầng dưới không phân biệt được lỗi với "rỗng thật".
2. `PaginationController._loadData`: khi `pit == null` (tức trang đầu / sau `refresh()`), `updatedList = newItems` → **list bị thay bằng rỗng**; đồng thời `isLastPage = true`.

Nên: mở ViewFolderPage lúc mất mạng, hoặc pull-to-refresh khi mạng lỗi → danh sách trong folder biến mất và hiện empty-state.

**Đây là hành vi có sẵn từ trước, không phải do các thay đổi G1–G3** (trước đây `searchTrash` trả list rỗng nên kết cục y hệt).

Cách sửa gọn nhất là 1 dòng trong `base_pagination_cubit.dart`: `rethrow` thay cho `return []`. Khi đó `_loadData` rơi vào `catch`, **không đụng `itemList`** và không ép `isLastPage`. Nhưng `BasePaginationCubit` đang được dùng bởi my_file / home / encrypted / favorite / search / by_type — đổi ở đó là đổi hành vi lỗi của cả 6 màn, nằm ngoài phạm vi "offline cho recycle bin" nên **tôi không tự sửa**. Cần quyết định riêng.

### 9.7 Cần test tay

T1 → T10 ở §7 (phần "Đọc"). Đặc biệt:

**G1**
- T1/T2: mở lại khi offline → thấy cache, có cả **folder**, countdown đúng (phụ thuộc fix `deletedAt` ở §9.1).

**G2**
- Pull-to-refresh khi đang online: list **không** được nhảy về bản cache cũ rồi mới sang bản mới (1 nhịp, không phải 2).
- Gõ search liên tục rồi xoá nhanh: kết quả cuối cùng phải khớp ô search, không bị response cũ đè lên.
- Vào một folder rồi back: list root refresh đúng (item vừa restore trong folder biến mất).
- Cuộn tới trang 2–3 rồi pull-to-refresh: không xuất hiện dòng trùng.

**G3**
- T3: bật máy bay **giữa lúc** đang ở trang → pull-to-refresh → list **không** được biến mất.
- T5: cuộn vài trang khi online → tắt mạng → cuộn tiếp → dừng lại, hiện footer "No connection / Retry", **không** loop.
- Bấm Retry sau khi bật mạng lại → nối tiếp đúng trang, không nhân đôi và không mất vị trí cuộn.
- Cuộn tới cuối danh sách (hết trang thật) → footer im lặng, không nháy spinner.

---

## 10. Câu hỏi còn mở

1. **Offline có được phép Delete/Restore không?** — Nếu sản phẩm chấp nhận read-only khi offline thì bỏ hẳn Phase 2, giảm ~3 ngày và giảm nhiều rủi ro đồng bộ.
2. **Giới hạn cache local**: giữ bao nhiêu trang trash offline? (đề xuất: 5 trang ≈ 100 item, phần còn lại yêu cầu online)
3. **Có nên chuyển `RecycleBinCubit` sang `BasePaginationCubit`** cho đồng nhất với `ViewFolderCubit` / `MyFileCubit`? Được lợi về `loadLocalFirst` + `listenToRealtimeUpdate` sẵn có, nhưng là một đợt refactor riêng (list root đang có select-all mode, filter chips, cacheDelItem…). Đề xuất: **không** gộp vào đợt offline này.
4. **Nguồn thời gian cho countdown**: dùng `DateTime.now()` hay lấy offset giờ server? Ảnh hưởng trực tiếp tới T17.