# Favorite Offline — Tài liệu flow chi tiết

> Tài liệu mô tả cách trang **Favorite** hoạt động khi **offline**: hiển thị lại
> favorite của lần online cuối, drill-down vào favorite-folder, hỗ trợ
> external (im/socialfi), phản ánh chỉnh sửa local ngay, và replay các thao tác
> offline khi có mạng trở lại.
>
> Trạng thái: **ĐÃ HOÀN THÀNH** (M0–M5 + refactor codec + create-favorite-folder offline).
> Branch: `felix/favoriate_offline`.

---

## 1. Vấn đề & mục tiêu

**Trước đây:** Trang Favorite fetch remote-only (gRPC/ES). Offline → `searchFavorites`
throw → pagination nuốt lỗi trả `[]` → màn hình hiện **"no data"**.

**Mục tiêu:** Offline hoạt động gần như online:
- Hiển thị lại toàn bộ favorite của lần online cuối (snapshot).
- Drill-down vào favorite-folder offline.
- Hỗ trợ external (im/socialfi).
- Chỉnh sửa local (đổi tên / xóa / toggle) phản ánh vào favorite view **ngay**.
- Thao tác offline (favorite, unfavorite, move, rename, delete, create-folder)
  được **replay** đúng lên server khi online lại.

---

## 2. Nguyên tắc nền tảng: **Online = nguồn chuẩn, Offline = MIRROR**

> Đây là nguyên tắc chi phối toàn bộ thiết kế. Đọc kỹ trước khi sửa bất cứ gì.

- **Coi toàn bộ hành vi online hiện tại là đúng, không có lỗ hổng.**
- Offline **KHÔNG** diễn giải lại semantics của backend. Nó chỉ:
  1. **Sao chép** (mirror) đúng dữ liệu mà online tạo ra, keyed bằng **cùng khóa**
     online dùng (`folderId`).
  2. **Replay verbatim** đúng request mà đường online dựng nên.

**Hệ quả (khử được 3 câu hỏi backend khó):**
- Read: hook `searchFavorites` upsert mỗi item với `CloudExternal.folderId = đúng
  folderId đã truyền vào searchFavorites`. Offline đọc bằng cùng khóa → nhất quán
  by-construction. **Không cần** map `'root'`→remoteId, không cần hiểu server đặt
  folderId thế nào.
- Write: offline enqueue **đúng request online dựng** (`moveFavoriteItems{ids,
  folderId}`, `updateFavorite`, `renameFile`...), online lại replay y hệt. Không
  cần biết move nhận storage hay chỉ external, server đặt membership ra sao.

---

## 3. Kiến trúc tổng thể — 3 tầng

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         NGUỒN SỰ THẬT (My Files)                           │
│   CloudFile / CloudFolder  ──  path/parent/cây ToOne gốc, KHÔNG đụng       │
└───────────────┬──────────────────────────────────────┬────────────────────┘
                │ watchAllFiles / watchAllFolders        │ (đọc lại để render)
                ▼                                        │
┌──────────────────────────────┐                        │
│  TẦNG FRESHNESS (Reconciler)  │  mirror incremental    │
│  FavoriteReconciler           │  các delta local vào   │
│  (@lazySingleton, luôn bật)   │  cache                 │
└───────────────┬──────────────┘                        │
                │ mirrorUpsert / removeByRemoteIds       │
                ▼                                        │
┌──────────────────────────────────────────────┐        │
│         TẦNG ĐỌC (snapshot cache)             │        │
│   CloudExternal  +  CloudExternalDB           │◄───────┘
│   1 row = 1 favorite item, đủ để tự query +   │
│   tự render. Key = folderId (membership).     │
│   ▲ upsert khi online fetch (write-on-fetch)  │
└───────────────────────────────────────────────┘
                ▲
                │ FavoriteCubit.onFetchLocalData → queryFavorites (1 query DB thuần)
                │
┌───────────────┴───────────────────────────────┐
│              TẦNG GHI (outbox)                 │
│   SyncTaskEntity + SyncTaskDB + CloudSyncService│
│   + SyncTaskCodec                              │
│   Offline action → ghi local + enqueue task →  │
│   online lại → replay verbatim lên server      │
└────────────────────────────────────────────────┘
```

| Tầng | Vai trò | File chính |
|------|---------|-----------|
| **Cache (đọc)** | Snapshot mọi favorite, đủ để query + render offline | `data/db/cloud_external_db.dart`, entity `CloudExternal` |
| **Write-on-fetch** | Nạp cache mỗi lần fetch online (tab All) | `favorite_service_repository_impl.dart` → `_cacheFavoritesOffline` |
| **Freshness (reconciler)** | Giữ cache tươi với edit local (không cần server) | `data/cloud_sync_service/favorite_reconciler.dart` |
| **Đọc offline** | Fallback offline + phân trang DB-level | `pages/favorite/cubit/favorite_cubit.dart` |
| **Outbox (ghi)** | Gom action offline, replay khi online | `cloud_sync_service.dart`, `sync_task_codec.dart` |

**`CloudExternal` là cache/index — KHÔNG BAO GIỜ tranh vai nguồn sự thật với
`CloudFile`.** Không thêm entity mới (CloudExternal đã đăng ký ObjectBox sẵn) →
**không cần codegen ObjectBox**.

---

## 4. Flow ĐỌC (offline read)

### 4.1. Write-on-fetch — nạp cache khi online

`favorite_service_repository_impl.searchFavorites` → gọi `_cacheFavoritesOffline`
sau mỗi lần fetch thành công:

```
searchFavorites(folderId, matchAnyCategory, pit, ...) → gRPC result
   │
   └─► _cacheFavoritesOffline(data, fetchFolderId, matchAnyCategory, pit)
         │  (fire-and-forget, mọi lỗi bị nuốt — không được throw vào fetch online)
         │
         ├─ CHỈ chạy khi matchAnyCategory == true (tab "All")   ← bài học #5
         ├─ Map mỗi item → CloudExternal, key theo folderId THẬT  ← bài học #6
         │    của item (rỗng → normalize 'root')
         ├─ Trang đầu (pit rỗng): pruneNotIn(favParent, keep)     ← bài học #7
         │    → xóa row stale (item unfavorite / move-đi / xóa từ máy khác)
         └─ upsertAll(rows)  (de-dup theo remoteId)
```

**Tại sao chỉ cache từ tab "All":** cả 4 tab đều fetch `folderId=root`; tab All đã
chứa mọi source. Nếu cache cả 4 → chồng chéo / double-count (cùng key folderId).
Offline các tab source chỉ lọc lại trên cùng cache này.

**Tại sao key theo folderId THẬT của item:** server "All" có thể trả **phẳng** (gồm
cả item nằm trong folder). Nếu ghi đè tất cả `= favParent` thì item trong folder gom
hết vào root → All phình to. Key theo folderId thật → offline All=root-only, vào
folder mới thấy item của folder (đúng yêu cầu).

### 4.2. Đọc offline — 1 query DB-level, scale unlimited

`FavoriteCubit.onFetchData` bọc `try/catch` → offline rơi vào `_localPage`:

```
onFetchData(...)  ──throw (offline)──►  catch → _localPage(limit, offset)
                                              │
init: initPagination(loadLocalFirst: true)    │
                                              ▼
_localPage:
  favParent = _folderRemoteId ?? 'root'
  tab → sources (All=filter, CloudDrive=storage, Discover=socialfi, IM=im)
  sort: sortDate→createdAt | sortName→name | else favoritedAt-desc
  │
  └─► CloudExternalDB.queryFavorites(folderId, sources, exts, sizeRange,
         search, sortField, descending, offset, limit)
         │  ← 1 query ObjectBox thuần, .order + ..offset + ..limit
         │    trên DbThreadPool (background isolate). Pattern = Recycle Bin.
         │    filter "chưa xóa": deletedAt == null OR <= 0   ← bài học #1
         ▼
  _mapRowsToViews(rows)   (giữ nguyên thứ tự sort từ query)  ← bài học #3
      ├─ external (im/socialfi) → ExternalModelView.external(row)  (render thẳng)
      └─ storage → resolve remoteId → CloudFile/CloudFolder thật →
                    FileModelView / FolderModelView  (full-fidelity, tươi)
```

**Phân trang offline** (base `PaginationController` phân trang bằng `pit`/`after`):
- Còn trang (`rows.length >= limit`): trả `pit = _kOfflinePit` (sentinel `'offline'`)
  + `after = offset + rows.length`.
- Trang cuối: `pit/after = null`.
- `onFetchData` đọc lại `offset` từ `after` để load-more tiếp tục cuộn cache.

---

## 5. Flow FRESHNESS (reconciler — chỉnh sửa local tươi ngay)

`FavoriteReconciler` (`@lazySingleton`, `start()` cùng `CloudSyncService` tại
`cloud_storage_init_repository_impl.dart:106,109`) — **luôn bật cả session**,
không chỉ khi mở trang favorite.

```
CloudFileDB.watchAllFiles(false)   ─┐
CloudFolderDB.watchAllFolders(false)─┴─► ChangeSet{created, updated, removed}
                                              │
       ┌──────────────────────────────────────┘
       ▼
  _onFiles / _onFolders  (incremental, O(số thay đổi)):
     for item in created + updated:
        remoteId rỗng → skip                       ← items chưa sync: bỏ qua
        isFavorite && !isDeleted → upsert row
        else                     → remove row
     for item in removed: → remove row
        │
        ├─ removeByRemoteIds(removes)
        └─ mirrorUpsert(upserts)   ← GIỮ folderId của row đã tồn tại
                                     (không clobber membership drill-down M1)
```

**Phạm vi reconciler:**

| Sự kiện | Xử lý | Nguồn |
|---------|-------|-------|
| Favorite ON (storage file/folder type==0) | upsert row (folderId='root') | reconciler |
| Favorite OFF | remove row | reconciler |
| Đổi tên / đổi size / re-upload | update name/size/ext → sort tươi | reconciler |
| Xóa (soft/hard) | remove row | reconciler |
| Favorite-folder (type==1) | **CHỈ mirror việc xóa**; cấu trúc/rename theo cache online M1 | reconciler (một phần) |

**Tại sao `mirrorUpsert` giữ `folderId` của row cũ:** reconciler không biết storage
item đang thuộc favorite-folder nào (thông tin đó chỉ có từ online fetch M1). Nếu
upsert mà set lại folderId → phá drill-down. Nên giữ nguyên membership đã cache.

**Kết hợp với write offline:** toggle offline → ghi `CloudFile.isFavorite` → phát
stream → reconciler → cache → view refresh. Không cần code cập nhật view favorite
riêng cho action offline.

---

## 6. Flow GHI (outbox — thao tác offline + replay)

### 6.1. Nguyên tắc chung của mọi action

```
Action (online hoặc offline)
   │
   1. Áp optimistic LOCAL trước  (ghi CloudFile/CloudFolder + cache row)
   │      → reconciler tự mirror sang CloudExternal → view tươi ngay
   │
   2. Gọi API
   │      ├─ ONLINE thành công          → xong (task không cần)
   │      ├─ ONLINE server-reject        → revert local + báo lỗi
   │      └─ OFFLINE (checkConnection()) → enqueue SyncTaskEntity + giữ local
   │
   3. Online lại → CloudSyncService drain → SyncTaskCodec.replay → server
```

> **Phân biệt offline vs server-reject bằng `CSNetworkUtils.checkConnection()`,
> KHÔNG bằng try/catch** — vì nhiều repo (`renameFile`, `moveFavoriteItems`,
> `updateFavorite`) **nuốt lỗi → trả null** thay vì throw. (Bài học quan trọng.)

### 6.2. `SyncTaskCodec` — dịch 2 chiều action ↔ task

File: `data/cloud_sync_service/sync_task_codec.dart` (`@lazySingleton`).

- **Encode (static, pure)**: `favTask` / `moveTask` / `deleteTask` / `renameTask` /
  `renameExternalTask` / `createFavFolderTask` — call site build task không cần kéo repo.
- **Decode + replay (instance)**: `replay(task, data)` switch theo `cloudSyncType`
  → gọi repo tương ứng.
- **Payload keys là hằng số dùng chung cho cả encode + decode** (`_kIds`,
  `_kFolderId`, `_kId`, `_kNewName`, ...) → 2 phía **không thể drift**. Đây là lý do
  DUY NHẤT đáng tạo class (không phải thẩm mỹ).

**Ranh giới trách nhiệm (tránh god-class):**
- **Codec** = dịch + thực thi 1 task.
- **CloudSyncService** = engine thuần (drain / retry / single-flight); chỉ giữ
  `syncTaskDB` + `syncTaskCodec`.
- **Call site** = apply/revert local + connectivity + optimistic UI. **KHÔNG** nhét
  apply/revert vào codec.

### 6.3. ⚠️ Replay-contract: **throw-on-null** (bug quan trọng đã fix)

**Bug (user phát hiện):** offline rename file → enqueue `rename` → watcher fire NGAY
(vẫn offline) → replay gọi `renameFile` → offline **trả null (nuốt lỗi)** →
`codec.replay` return êm → engine tưởng thành công → **XÓA task**. Online lại: không
còn task → server giữ tên cũ → sync kéo tên cũ về ("tên trở lại").

**Root cause:** `renameFile` / `moveFavoriteItems` / `updateFavorite` nuốt lỗi → null,
phá hợp đồng codec ("replay throw khi fail để engine retry").

**Fix:** `_replayRename` / `_replayMove` / `_replayFav` **ném khi result == null**.
Task giữ trạng thái error → reconnect `resetErrorTasksRetry()` reset → pending →
replay online → thành công.

Repo *rethrow* sẵn (`deleteFavoriteFolder`, `renameExternalData`, `createFile`) đã
đúng — không sửa.

### 6.4. `CloudSyncService` — engine drain có single-flight

```
start():
  resetErrorTasksRetry(hasResetPending: true)  ← reset task kẹt từ phiên trước
  watchAllTasksNeedSync(false).listen(_scheduleDrain)   ← pending | (error && retry≤max)
  CSNetworkUtils.listen(onOnline → resetErrorTasksRetry())

_scheduleDrain(tasks):                        ← FIX #5: single-flight
  _latestTasks = tasks
  if (_draining) { _rerunDrain = true; return }   ← đang drain: chỉ đánh dấu rerun
  _draining = true; _drainLoop()

_drainLoop():
  do { _rerunDrain=false; _processTasks(_latestTasks) } while (_rerunDrain)
  finally { _draining = false }

_processTasks(tasks):  (tuần tự)
  for task:
    if _processingIds.contains(id) continue
    _processingIds.add(id)
    try   { status=sending; put; replay(task); remove(task) }
    catch { retryCount++; status=error; backoff(10s); put }
    finally { _processingIds.remove(id) }   ← an toàn nhờ single-flight
```

**Bug loop replay (#5) — đã fix:** trước đây `watchAllTasksNeedSync` re-fire trên mỗi
`put()` (đổi status/retry) → nhiều `_processTasks` chạy chồng nhau → `task.id` vừa
remove bị re-add → **replay 2–5+ lần**. Fix = **single-flight** (`_draining` +
`_rerunDrain`): chỉ 1 drain tại một thời điểm, event mới chỉ set cờ rerun. Nhờ đó
`_processingIds.remove` trong `finally` giờ an toàn → retry-in-session hoạt động.

### 6.5. Bảng đầy đủ các action offline

| Action | CloudSyncType | Endpoint replay | Enqueue tại | Ghi chú |
|--------|---------------|-----------------|-------------|---------|
| Toggle favorite / unfavorite | `fav` | `updateFavorite` | `FavoriteItemUseCase.call` | online gọi API thẳng (limit-popup cần đồng bộ); offline mới enqueue |
| Move trong favorite | `favMove` | `moveFavoriteItems{ids,folderId}` | `MoveFavoriteItemsUseCase.call` | |
| Delete-from-favorite | `favDelete` | `deleteFavoriteFolder{ids,isDeleteFiles}` | `deleteFavoriteItem` (mixin) | repo *rethrow*; xóa cache row ngay |
| Rename **file** | `rename` | `renameFile{id,newName}` | `reNameFile` | |
| Rename **plain folder** favorite | `rename` | `renameFile` (folder remoteId) | `reNameFolder` | chung endpoint với file |
| Rename **favorite-folder** | `renameExternal` | `renameExternalData` (ExternalDataService) | `renameExternalData` path | endpoint khác |
| Create favorite-folder | `createFavFolder` | `createFavoriteFolder` → swap temp→real id | `CreateFavoriteFolderUseCase.call` | temp uuid, xem §7 |
| Upload file | `createFile` | `createFile` → swap temp→real id | `CloudFileDB` | có sẵn từ trước; replay ở codec |

**Deviation có chủ đích khỏi "enqueue luôn" (1A thuần):** toggle favorite khi online
vẫn gọi API trực tiếp (không qua engine) vì **limit-popup cần current/max từ server
đồng bộ**. Chỉ offline mới enqueue. Pure engine-only sẽ phá limit popup.

**Coalesce:** bỏ (replay FIFO tự hội tụ về trạng thái cuối; đủ cho v1). Hash task có
sẵn dạng `type:ids` nếu sau này muốn last-write-wins.

---

## 7. Create favorite-folder offline (action phức tạp nhất)

Khác 5 action kia (item **đã có remoteId**): create **chưa có remoteId** — server
sinh id mới lúc tạo. Theo pattern `createFile` (temp id → replay cập nhật real id).

```
CreateFavoriteFolderUseCase.call:
  resolve parent (favRoot khi null)
  ├─ ONLINE : API → local mirror với real id
  └─ OFFLINE: temp uuid → local CloudFolder(type=1, remoteId=temp)
              + cache row CloudExternal (scope normalize: parent==favRoot → 'root')
              + enqueue createFavFolder{tempRemoteId, folderName, parentFolderId}

Replay (_replayCreateFavFolder):
  createFavoriteFolder(...) → realId  (rethrow nếu lỗi → engine retry)
  realId rỗng → throw
  CloudFolderDB.updateRemoteId(temp→real)      ← idempotent
  CloudExternalDB.updateRemoteId(temp→real)    ← idempotent
```

- `CloudFolderDB.updateRemoteId` + `CloudExternalDB.updateRemoteId` (temp→real, idempotent).
- Business error (dup / limit) vẫn throw typed để UI xử lý.
- **Ngoài scope v1:** tạo favorite-folder **LỒNG** offline (parent cũng là temp id) —
  replay sẽ kẹt error vì server không biết parent temp id.

---

## 8. Bài học quan trọng (đừng vấp lại)

1. **Proto3 `deletedAt` unset → map thành `0`, KHÔNG phải `null`**
   (`CloudExternalProto.fromProto`). Filter "chưa xóa" phải là
   `deletedAt == null OR <= 0`. Dùng `.isNull()` thuần làm rỗng toàn bộ read.
   (Đây là bug "no-data" đã fix — xem `cloud_external_db.dart:239-247`.)
2. **Offline paging** dùng sentinel `pit='offline'` + `after=offset+count`; trang
   cuối `pit/after=null`. Đọc lại offset từ `after` trong `onFetchData`.
3. **Render:** `ExternalModelView` CHỈ cho im/socialfi. Storage phải resolve
   `remoteId` → CloudFile/CloudFolder thật → File/FolderModelView (giữ thứ tự sort).
4. **Key nhất quán:** normalize `folderId` null/empty → `'root'` ở cả read lẫn write.
5. **CHỈ cache từ tab All** (`matchAnyCategory==true`) — tránh double-count.
6. **Key theo `folderId` THẬT của item** (từ proto), KHÔNG ghi đè `= favParent` —
   tránh All phình khi server trả list phẳng.
7. **Prune trang đầu** (`pit` rỗng): `pruneNotIn(favParent, keep)` → xóa stale. Chỉ
   prune scope fetch. Đánh đổi: offline chỉ có phần đã tải online (đúng "mirror cái
   đã tải", không vượt online).
8. **`CloudFolder.remoteId` là `String?`** (khác `CloudFile.remoteId` non-null) → xử
   nullability trong reconciler.
9. **Phân biệt offline vs server-reject bằng `checkConnection()`**, không bằng
   try/catch (repo nuốt lỗi → null).
10. **Replay phải throw-on-null** để engine retry (§6.3).

---

## 9. Rủi ro còn lại / TODO

- **`retryCountMax = 1`** (`cloud_sync_service.dart:50`, có `TODO(Felix)`) — thấp cho
  offline action. Hiện OK vì reconnect `resetErrorTasksRetry()` lo phần reset.
  Phương án tương lai:
  - **A (khuyến nghị):** retry vô hạn khi lỗi MẠNG, dừng khi lỗi NGHIỆP VỤ (server reject).
  - **B:** tăng cứng (vd 5) cho mọi lỗi.
- **Watcher fire lúc offline:** task thử+fail vài lần rồi kẹt `error` tới khi reconnect
  reset. Đây chính là lý do cần nâng retry-policy (A) ở trên.
- **Write amplification + service nền luôn chạy** là chi phí cố định của thiết kế
  coherent-cache (đã chấp nhận).
- **Rename FOLDER thường** dùng chung endpoint `renameFile`; favorite-folder dùng
  `renameExternalData`. Không có endpoint riêng cho move folder.
- **Tạo favorite-folder lồng offline** ngoài scope v1 (§7).

---

## 10. BUG PHỤ THUỘC TEMP-ID (create-folder → move) — ĐÃ FIX ✅

> §10.1–§10.3: bug phụ thuộc temp-id (create-folder + move) — **ĐÃ IMPLEMENT & analyze sạch**.
> §10.4–§10.6: các hướng nâng cao (song song / scale) — **CHƯA làm, chỉ là thiết kế**.
> Đọc kèm §6 (outbox) và §7 (create-fav-folder offline).

### 10.1. Bug: offline create-folder → move-file-vào-folder → online thì move LỖI (ĐÃ FIX)

**Kịch bản tái hiện:** offline → tạo favorite-folder F → move 1 file vào F → online lại
→ action move **thất bại** (file không vào được folder).

**Nghi ngờ ban đầu (của user):** move gọi khi create folder chưa xong.
**Nguyên nhân thật (đã verify):** không phải do thứ tự. Create *đã* chạy xong và có
real-id. Vấn đề là **việc swap `temp → real` KHÔNG lan tới payload task đang chờ**:

1. Offline: create F → `remoteId = tmp` (Uuid v4 thuần, `create_favorite_folder.dart:114`),
   enqueue `createFavFolder{tempRemoteId: tmp}`. Move → enqueue
   `favMove{ids:[file], folderId: tmp}` ← **temp-id đóng băng cứng trong payload JSON**.
2. Online (replay FIFO, create trước): `_replayCreateFavFolder` (`sync_task_codec.dart:255`)
   swap `tmp → real` **CHỈ** ở `CloudFolderDB` + `CloudExternalDB`. **KHÔNG** đụng payload
   task `favMove` đang nằm chờ.
3. `_replayMove` (`sync_task_codec.dart:213`) đọc `folderId = tmp` (cũ) → gọi
   `moveFavoriteItems{folderId: tmp}` → **server không biết `tmp`** → lỗi → task kẹt `error`.
   Với `retryCountMax=1` → kẹt vĩnh viễn dù folder đã có real-id trên server.

→ Cùng họ "temp-id dependency" mà §7 đã đánh dấu ngoài-scope-v1, nhưng đây là ca
**move file vào folder-temp** (chưa xử).

### 10.2. Bản chất: bài toán phụ thuộc producer → consumer qua temp-id

Mỗi task offline tạo DAG phụ thuộc, **suy ra tự động từ temp-id trong payload** (không
khai báo tay):
- `produces` = temp-id mà task `create*` sinh (`tempRemoteId`).
- `dependsOn` = mọi `tmp_` trong payload **không phải** do chính nó sản xuất.

Replay đúng cần: (1) **thứ tự** — consumer sau producer; (2) **phân giải** — consumer gửi
real-id chứ không phải temp-id. Hiện FIFO tình cờ lo (1) ở ca đơn giản; (2) vỡ hoàn toàn.

### 10.3. GIẢI PHÁP ĐÃ IMPLEMENT — Pha 1 (correctness, đơn luồng) ✅

Không thêm entity / codegen ObjectBox, không đổi DI (`resolveTempId` static). 6 file:

1. **Tag temp-id** (MỚI `shared/utils/temp_id.dart`): `TempId.generate() = 'tmp_'+uuid`,
   `TempId.isTemp()`. `create_favorite_folder.dart` dùng `TempId.generate(Uuid().v4())`.
2. **Thứ tự tường minh (FIFO):** `sync_task_db.dart` `watchAllTasksNeedSync` thêm
   `.order(SyncTaskEntity_.id)` → replay đúng thứ tự user thao tác (create trước move).
3. **Producer resolve → viết real-id vào payload consumer:** static
   `SyncTaskDB.resolveTempId(oldId, newId)` quét payload mọi task, `replaceAll(tmp→real)`
   (an toàn vì temp là token đầy đủ `tmp_<uuid>`). Gọi trong `_replayCreateFavFolder`.
4. **Reparent cache:** `CloudExternalDB.reparentFolderId(old→new)` — file đã move vào
   folder-temp theo folder sang real-id (không biến mất khi drill-in). Gọi cùng #3.
5. **Gate defer (pre-check, KHÔNG throw):** `SyncTaskCodec.hasUnresolvedDependency(data)`
   soi field-aware (chỉ `ids`/`folderId`/`id`, **bỏ tên file**; bỏ `tempRemoteId` của chính
   create). `CloudSyncService._processTasks` decode payload TRƯỚC khi khóa; nếu gate true →
   `continue` (giữ `pending`, **không đổi status, không put**).
6. **Không spin, không kẹt `sending`:** vì defer = skip (không put) nên không tự re-fire;
   chỉ producer `resolveTempId` (put thật) mới re-fire drain → lượt kế task chạy real-id.

**Đổi so với đề xuất ban đầu:** dùng **gate pre-check + skip** thay cho `throw
DependencyNotReadyException`. Lý do: nếu throw thì `_processTasks` đã kịp set status
`sending` + put trước replay → task kẹt `sending` (rơi khỏi tập needSync), và mỗi lần
defer lại put → **spin-loop khi offline**. Pre-check tránh cả hai. → không cần thêm exception
class, cũng không cần tách `retryCount` (defer không bao giờ vào nhánh catch).

**Lưu ý cơ chế (vì sao gate là bắt buộc):** `_processTasks` chạy **tuần tự** (for + await),
nhưng list `tasks` là **snapshot in-memory** — trong CÙNG một lượt drain, task 11 KHÔNG thấy
thay đổi mà task 10 vừa ghi vào row của 11. Nó chỉ thấy ở **lượt drain kế** (put trong
`resolveTempId` bắn watch → `_rerunDrain`). Nên không thể chỉ dựa vào tính tuần tự của loop.

**File đã sửa:** `shared/utils/temp_id.dart` (MỚI), `create_favorite_folder.dart`,
`sync_task_db.dart`, `cloud_external_db.dart`, `sync_task_codec.dart`, `cloud_sync_service.dart`.

### 10.4. GIẢI PHÁP ĐỀ XUẤT — Pha 2 (throughput, chỉ khi cần)

Giới hạn của FIFO tuần tự = **head-of-line blocking** (12 chờ oan 11 dù 12 chỉ phụ thuộc
10; 1 task lỗi + backoff 10s chặn cả hàng). Nếu cần chạy song song:
- **DAG scheduler theo ready-set:** task "ready" khi mọi `dependsOn ⊆ resolved` → chạy
  song song (bounded qua `TaskQueue` có sẵn, `data/task_queue/task_queue.dart`).
- **Bắt buộc giữ per-entity FIFO:** task cùng resource-key (id item) phải tuần tự; khác
  key mới song song → tránh phá thứ tự (rename A rồi rename A lần 2...).

### 10.5. VẤN ĐỀ SCALE — queue lớn khi offline nhiều action

**Định khung:** local đã đúng nhờ optimistic + reconciler → user KHÔNG chờ màn hình;
drain là **việc nền**. Mục tiêu = drain nền tin cậy, không chặn UI, hội tụ nhanh. Các
solution xếp theo đòn bẩy:

| # | Solution | Tấn công cái gì | Trạng thái |
|---|----------|-----------------|------------|
| 1 | **Coalesce / nén** | giảm chính N | ✅ **ĐÃ LÀM** — last-write-wins theo `hash` (type+id-set): rename/toggle/move lặp trên cùng item chỉ giữ action cuối. |
| 2 | **Batch bulk** | gộp cùng loại | ✅ **ĐÃ LÀM** — gộp cùng-type-cùng-param → 1 request: fav theo flag, move theo folderId, delete theo isDeleteFiles. |
| 3 | **Non-blocking retry** | bỏ backoff 10s chặn hàng | ⏳ chưa — task lỗi gắn `nextRetryAt`, skip sang task kế, tới hạn thử lại. |
| 4 | **Song song bounded** | phần còn lại độc lập | ⏳ chưa — chỉ khi sau 1+2 vẫn nhiều task độc lập. = Pha 2 (§10.4). |
| 5 | **State-sync** (hướng sâu) | thay event-replay | ⏳ chưa — so trạng-thái-cuối local vs server → gửi diff. **Thay đổi kiến trúc lớn**, lệch nguyên tắc mirror → chỉ ghi nhận. |

**Thứ tự ưu tiên:** `[1] Coalesce → [2] Batch → [3] Non-blocking → [4] Song song`.
1+2 giải quyết ~90% "queue lớn" (cắt request tận gốc, rẻ, ít rủi ro). 4 rủi ro nhất, để sau.

#### Cách 1+2 đã implement (compaction pass — 1 chỗ, idempotent)
Cả coalesce lẫn batch làm chung trong **1 pass chạy đầu mỗi drain**, KHÔNG đổi call-site:
```
_drainLoop mỗi vòng:
  _compactQueue()                       ← coalesce + batch, rewrite queue (idempotent)
  tasks = getTasksNeedSync()            ← nạp lại queue đã nén (order theo id)
  _processTasks(tasks)                  ← replay; batch = 1 task bulk = 1 request
```
- `SyncTaskCodec.compact(tasks) → CompactionPlan{removeIds, insertTasks}` (pure):
  1. **Loại** task còn phụ thuộc temp-id (`hasUnresolvedDependency`) → gate lo, không nén.
  2. **Coalesce** theo `SyncTaskEntity.hash` (=`type:id-set`) → giữ task id lớn nhất (mới nhất).
  3. **Batch** theo `(type + param)`: fav→flag, favMove→folderId, favDelete→isDeleteFiles;
     gộp ids (dedup, giữ thứ tự) thành 1 task bulk khi group ≥ 2 (dùng lại encoder
     `favTask`/`moveTask`/`deleteTask`). Task merge chèn theo min-id gốc → giữ ~FIFO.
- `SyncTaskDB.getTasksNeedSync()` (one-shot, order id) + `applyCompaction(removeIds,
  insertTasks)` (removeMany + putMany atomic). **Idempotent** → queue đã nén thì plan rỗng
  → không ghi → không loop (single-flight `_rerunDrain` hội tụ).
- **Tôn trọng DAG temp-id** (§10.2, task blocked bị loại khỏi nén) và **~FIFO** (coalesce
  giữ mới nhất; batch chèn theo min-id).
- **Giới hạn đã biết:** coalesce chỉ theo id-set y hệt (khác id-set không gộp); mâu thuẫn
  ON/OFF chéo id-set hiếm → dựa vào thứ tự min-id, chưa per-id last-write tuyệt đối.
- **File:** `sync_task_codec.dart` (`compact`/`CompactionPlan`/`_batchKey`/`_mergeBatchTask`),
  `sync_task_db.dart` (`getTasksNeedSync`/`applyCompaction`), `cloud_sync_service.dart`
  (`_drainLoop`/`_compactQueue`, bỏ `_latestTasks`). Không đổi DI → không `/build -get`.

### 10.6. Trạng thái & bước kế tiếp
- ✅ **Pha 1 (§10.3) ĐÃ implement + analyze sạch** — bug create-folder+move offline đã fix.
  Cần **test thực tế**: offline tạo folder → move file vào → bật mạng → xác nhận file vào
  folder trên server và không còn task kẹt `error`.
- ✅ **Scale §10.5 #1 (Coalesce) + #2 (Batch) ĐÃ implement + analyze sạch** (compaction pass).
  Cần **test thực tế**: offline nhiều action (nhiều fav, nhiều move cùng folder, rename lặp)
  → bật mạng → xác nhận queue nén lại & số request giảm, kết quả server đúng.
- ⏳ **Pha 2 (§10.4 song song) + §10.5 #3 (non-blocking retry) + #5 (state-sync) CHƯA làm.**
- Còn tồn (áp dụng cho mọi replay): watcher fire lúc offline → task thử+fail rồi kẹt tới
  reconnect reset; gắn với TODO retry-policy §9 (và là động lực cho #3).

---

## 11. BUG: offline move — file KHÔNG mất khỏi "from" — ĐÃ FIX ✅

### Triệu chứng
Offline move item (from → to) thì tại folder **from** item đó **không biến mất**
(vẫn hiển thị), dù đã move sang **to**.

### Nguyên nhân (đã verify)
Việc xoá item khỏi trang nguồn do `FavoriteCubit._onFavoriteMoved` lo, chỉ chạy nhánh
`paginationController.removeItems(...)` khi **`current == from`**, với
`from = item.favoriteParentRemoteId` (membership favorite-folder của item).

Nhưng khi đọc offline, `_mapRowsToViews` dựng item storage bằng
`FileModelView.cloudFile(file)` / `FolderModelView.convertByFolder(folder)` — hai factory
này **chỉ set `parentRemoteId` (parent trong My Files), KHÔNG set `favoriteParentRemoteId`**
(membership favorite nằm ở `CloudExternal.folderId`, không được truyền sang view).

→ Offline, item storage có `favoriteParentRemoteId == null`. Khi drill vào folder A
(`current == A`), `from == null` → `current != from` → **không xoá khỏi from**.
(External items KHÔNG dính vì `ExternalModelView.external` đã set
`favoriteParentRemoteId: e.folderId`. Online cũng không dính vì mapper server set sẵn field
này — nên bug chỉ xảy ra offline với item storage.)

### Fix
`_mapRowsToViews` **đóng dấu `favoriteParentRemoteId = r.folderId`** (từ cache row) lên mọi
view sau khi dựng → offline item mang đúng membership favorite-folder như online.
- File: `pages/favorite/cubit/favorite_cubit.dart` (`_mapRowsToViews`, thêm import
  `base_view_item.dart`; tiện tay bỏ import `cloud_logger` thừa). Analyze sạch.
- Ăn khớp: optimistic cache của move (`updateFolderIdForRemoteIds` đổi `folderId` sang đích)
  đã lo phần **reload**; fix này lo phần **in-memory** (bus khớp source page → removeItems).

---

## 12. BUG: offline favorite toggle KHÔNG được enqueue (debounce nuốt) — ĐÃ FIX ✅

### Triệu chứng
Toggle favorite/unfavorite offline: item đổi trạng thái local nhưng **không được queue**
→ khi online lại **không sync lên server** (mất thay đổi). Hay gặp khi toggle nhanh /
nhiều item, hoặc lần toggle thứ 2 trong vòng 1 giây.

### Nguyên nhân (đã verify)
`FavoriteItemUseCase.call` dựa vào **catch `GrpcError`** để biết offline rồi mới enqueue.
Nhưng `FavoriteServiceRepository.updateFavorite` (`favorite_service_repository_impl.dart:393`)
có **debounce 1000ms**: nếu gọi trong vòng 1s kể từ lần trước → **return `null` KHÔNG throw**.
→ `try { await repo.updateFavorite() }` chạy êm (null) → **không vào catch → KHÔNG
`_enqueueFavoriteSync`** → toggle chỉ ghi local, không có task → online lại không sync.
(Vi phạm nguyên tắc §6.1: "phân biệt offline bằng `checkConnection()`, KHÔNG bằng try/catch".)

### Fix
`FavoriteItemUseCase.call`: sau khi ghi local, **check `CSNetworkUtils.checkConnection()`**;
offline → `_enqueueFavoriteSync` + return (KHÔNG gọi API debounced). Online → giữ nguyên
try/catch (limit → revert + throw typed; lỗi transient → enqueue).
- File: `domain/use_cases/cloud_item/favorite_item_use_case.dart` (thêm import
  `network_utils.dart`; sort lại import). Analyze sạch.
- Ăn khớp: 1 chỗ sửa phủ **cả** path multi-select (`select_all_controller.updateFavorite`)
  lẫn mọi caller khác của use case. Toggle offline lặp → nhiều task → **coalesce (§10.5 #1)**
  gộp về trạng thái cuối.
- Còn tồn: nếu offline-favorite vượt limit server, replay online sẽ bị server từ chối →
  task kẹt error (gắn TODO retry-policy §9). Chấp nhận cho v1 (offline không biết limit).

---

## 13. Bản đồ file (tra cứu nhanh)

| Thành phần | Đường dẫn |
|-----------|-----------|
| Entity cache | `lib/database/tables/cloud_storage/cloud_external/cloud_external.dart` |
| Mapper proto→entity | `data/_grpc/mapper/cloud_external_proto.dart` |
| DB cache | `data/db/cloud_external_db.dart` (`CloudExternalDB`, enum `FavoriteSortField`) |
| Write-on-fetch hook | `data/_grpc/repositories/favorite_service_repository_impl.dart` (`_cacheFavoritesOffline`) |
| Đọc offline | `pages/favorite/cubit/favorite_cubit.dart` (`onFetchLocalData`/`_localPage`/`_mapRowsToViews`) |
| Reconciler | `data/cloud_sync_service/favorite_reconciler.dart` |
| Outbox engine | `data/cloud_sync_service/cloud_sync_service.dart` |
| Codec (encode/replay) | `data/cloud_sync_service/sync_task_codec.dart` |
| Outbox DB | `data/db/sync_task_db.dart`; entity `tables/cloud_storage/sync_task/sync_task.dart` |
| Enum sync type | `shared/enum/sync_status.dart` (`CloudSyncType`, `SyncStatus`) |
| Khởi động engine + reconciler | `data/repository/cloud_storage_init_repository_impl.dart:106,109` |

**Lệnh hữu ích:**
- Lint: `/analyze-cloud <path>` (scope cloud_storage).
- DI getIt (sau khi thêm/sửa `@LazySingleton`): `/build -get`.
- Codegen ObjectBox: **KHÔNG cần** (CloudExternal đã đăng ký sẵn, không thêm entity).