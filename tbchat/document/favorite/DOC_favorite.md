# DOC — Feature Favorite (Cloud Storage)

> Doc bối cảnh để LẤY LẠI CONTEXT nhanh cho feature Favorite: kiến trúc, luồng dữ liệu,
> và cách favorite tách biệt với My Files. Con trỏ tới effort **offline** ở §5.
>
> Nguồn: code branch `new_cloud_storage`.
>
> ⚠️ **Effort offline (RESUME) CHƯA approve, CHƯA merge vào `new_cloud_storage`.**
> §1-§4 mô tả branch hiện tại. §5 chỉ là con trỏ tham khảo tới đề xuất ở branch khác —
> **KHÔNG có trong branch này** (không `CloudExternal` write path, không `onFetchLocalData`,
> không reconciler, không syncTask outbox).

---

## 0. Định vị nhanh

| Muốn tìm | File |
|---|---|
| Action item favorite (move/rename/delete) | `pages/favorite/mixin/favorite_external_action_mixin.dart` |
| State + fetch danh sách favorite | `pages/favorite/cubit/favorite_cubit.dart` |
| Renderer list favorite | `pages/favorite/widgets/favorite_body_view.dart` |
| Bulk-move (nhiều item) | `shared/utils/sheet_helper.dart` (~L1725) |
| Fetch favorite (ES filter/sort) | `data/repository/files_by_type/cloud_file_by_type_repository_impl.dart` (`getFavoriteData`, L168) |
| gRPC favorite (search/move/rename/update) | `data/_grpc/repositories/favorite_service_repository_impl.dart` |
| Map proto → view model | `data/_grpc/mapper/search_mapper.dart` (`mapSearchFavoriteToModelView`, L132) |
| Bus đồng bộ move giữa page | `FavoriteMoveBus` |
| View model | `model_view/base_view_item.dart` + `files/`, `folders/` |

Tabs: `All` (cả 3 nguồn) · `Cloud Drive` (storage) · `Discover` (socialfi) · `IM` (im).
Chỉ tab **All** liệt kê favorite-folder + nội dung hỗn hợp và cho drill-down.

---

## 1. KHÁI NIỆM LÕI: 2 loại "cha" TÁCH BIỆT

Một favorite item mang **hai** notion "parent" độc lập — mỗi cái có field riêng, đừng lẫn:

| Khái niệm | Field trên view model | Ý nghĩa | Nguồn sự thật |
|---|---|---|---|
| **Cha MyFiles** | `parentRemoteId` | Vị trí THẬT trong cây My Files | `CloudFile.parentRemoteId` / `CloudFolder.parentRemoteId` |
| **Membership favorite** | `favoriteParentRemoteId` | Item đang favorite trong favorite-folder nào | server `proto.folderId` khi search favorite |

- Favorite-folder = folder ảo `folderType == 1` (khác folder MyFiles `folderType == 0`), có remoteId riêng.
- Move "trong favorite" chỉ đổi **`favoriteParentRemoteId`** (membership), **KHÔNG đụng `parentRemoteId`** (My Files).
- `favoriteParentRemoteId` là field mutable trên `BaseViewItem` (plain Dart, **không codegen**).

---

## 2. LUỒNG DỮ LIỆU (online)

### Fetch danh sách
```
FavoriteCubit.onFetchData (favorite_cubit.dart:216-302)
  → CloudFileByTypeRepository.getFavoriteData (build filter/sort ES)  [L168]
    → FavoriteServiceRepository.searchFavorites (gRPC/ES)             [L251]
      → mỗi proto: CloudFileProto/FolderProto/ExternalProto.fromProto
      → SearchMapperResponse.mapSearchFavoriteToModelView             [search_mapper.dart:132]
         → snapshot proto.folderId (membership) → favParentIds[i]
         → syncFilesByRemoteId / syncFolderByRemoteId (preserveLocalParent: true)
         → _favoriteViewOf: build view model + gán favoriteParentRemoteId = favParentIds[i]
```
- **`preserveLocalParent: true`** cho đường favorite: sync KHÔNG ghi đè `parentRemoteId`/`dir`/`parent`
  của row DB (giữ nguyên vị trí My Files); row mới (chưa có DB) → `parentRemoteId = null`.
  Folder chỉ bảo vệ `folderType == 0`; favorite-folder (`type == 1`) sync parent như cũ (cây favorite).
  → `fromProto`/sync vẫn dùng chung với browse My Files (mặc định cờ = false) nên My Files không đổi.
- Offline: `searchFavorites` throw → list rỗng → "no data" (đây là lý do có effort offline, xem §5).
- `MoveFavoriteItemsUseCase` / `moveFavoriteItems` (repo, L342) = **gRPC thuần, KHÔNG ghi DB local**.

### Move item (1 item)
`favorite_external_action_mixin.dart::moveFavoriteItem` (L191-280):
1. Mở sheet chọn favorite-folder đích (`destFolder`).
2. No-op check: so **`item.favoriteParentRemoteId`** vs `destFolder.remoteId`.
3. `MoveFavoriteItemsUseCase.run({ids, folderId: destFolder.remoteId})` (gRPC).
4. Nếu là favorite-folder → `CloudFolderDB.moveFoldersById([item.id], destFolder.id)` (chỉ folder).
5. `FavoriteMoveBus.instance.notifyMove(items, fromRemoteId: item.favoriteParentRemoteId, toRemoteId: destFolder.remoteId)`.

Consumer bus: `FavoriteCubit._onFavoriteMoved` — chỉ tab All:
- `current == to` → set `favoriteParentRemoteId = toRemoteId` cho từng item rồi `insertItems` (chèn ngay, không chờ ES re-fetch).
- `current == from` → `removeItems`.
- Suppress ES re-fetch tạm (`_suppressRealtimeFor`) để tránh dữ liệu cũ ghi đè optimistic.

Bulk-move (nhiều item): `sheet_helper.dart` — cùng pattern; no-op check + `fromRemoteId` đọc **`favoriteParentRemoteId`**.

---

## 3. Cơ chế tách cha favorite khỏi cha My Files

Vì `parentRemoteId` (cha My Files) và membership favorite là 2 namespace khác nhau, favorite dùng
field riêng **`favoriteParentRemoteId`** và tuyệt đối không ghi membership vào `parentRemoteId`:

- **Nạp**: favorite search trả membership ở `proto.folderId`. Mapper snapshot giá trị này **trước** khi
  sync entity, rồi gán vào `favoriteParentRemoteId` của view model (qua `_favoriteViewOf`).
  `ExternalModelView.external` set thẳng `favoriteParentRemoteId = e.folderId`.
- **Không clobber My Files**: `syncFilesByRemoteId`/`syncFolderByRemoteId` nhận cờ `preserveLocalParent`;
  đường favorite bật cờ → giữ nguyên `parentRemoteId`/`dir`/`parent` của row (row mới → `parentRemoteId = null`).
  Folder chỉ bảo vệ `folderType == 0`; favorite-folder (`type == 1`) giữ hành vi cũ.
- **Dùng**: no-op check + `FavoriteMoveBus` + bulk-move đọc `favoriteParentRemoteId`, không đọc `parentRemoteId`.
- **Lưu ý kiểu**: helper `_favoriteViewOf` phải trả `BaseViewItem` (không `dynamic`) để `mapSearchFavoriteToModelView`
  trả `List<BaseViewItem>` reified — nếu không, cast `as List<BaseViewItem>` ở `searchFavorites` sẽ vỡ.

> Lịch sử/chi tiết đầy đủ vì sao tách field này (từng có lỗi ghi đè cha My Files): xem
> `.claude/BUG_favorite_parentRemoteId.md`.

---

## 4. Bản đồ view model

| Model | `parentRemoteId` (cha My Files) | `favoriteParentRemoteId` (membership favorite) |
|---|---|---|
| `FileModelView.cloudFile` | `file.parentRemoteId` | set ở mapper = `proto.folderId` |
| `FolderModelView.convertByFolder` | `folder.parentRemoteId` | set ở mapper = `proto.folderId` |
| `ExternalModelView.external` | `e.folderId` (external không có My Files) | `e.folderId` |

`BaseViewItem` (`base_view_item.dart`): `id, remoteId, parentRemoteId, favoriteParentRemoteId,
isSelected, isFavorite, space, updatedAt, createdAt` — MUTABLE.
Getter tĩnh: `BaseViewItem.getFavoriteParentRemoteId(obj)` (pattern như `getRemoteId`).

---

## 5. Effort OFFLINE — ĐỀ XUẤT RIÊNG, CHƯA APPROVE/MERGE (chi tiết ở RESUME_favorite_offline.md)

> 🚧 **KHÔNG có trong branch `new_cloud_storage`.** Nằm ở branch `felix/favoriate_offline`,
> chưa duyệt/chưa merge. Ghi ở đây CHỈ để tham khảo hướng thiết kế, KHÔNG mô tả code hiện có.
> **Không giả định** bất kỳ hạ tầng nào dưới đây tồn tại trên branch này.

Mục tiêu: offline hiển thị lại favorite lần online cuối, drill-down + external, phản ánh edit local ngay.

Thiết kế đã CHỐT (ở branch offline):
- **`CloudExternal` = snapshot-cache hợp nhất** cho MỌI nguồn (đã đăng ký ObjectBox → **không codegen**).
  `CloudExternal.folderId` = membership favorite (cùng khái niệm với `favoriteParentRemoteId` ở §1).
- **Phương án B (coherent cache)**: reconciler nền nghe `watchAllFiles/Folders` → mirror incremental
  vào CloudExternal ⇒ read offline = 1 query DB thuần đã tươi.
- **syncTask outbox**: action offline (toggle/move/rename/delete) → optimistic local + enqueue → online replay.
- **`SyncTaskCodec`**: encode/decode 2 chiều action ↔ SyncTaskEntity, khoá key dùng chung 2 phía.
- Nguyên tắc: **Online = nguồn chuẩn, Offline = MIRROR** (không diễn giải lại semantics backend).

Trạng thái (theo RESUME, CHỈ trên branch offline): M0-M5 + refactor codec + offline delete/rename đã làm;
**PENDING**: create favorite-folder offline (temp-id). Với `new_cloud_storage`: coi như **chưa tồn tại**.

> Khi/nếu offline merge sau này: đường offline map row → view model cũng phải set `favoriteParentRemoteId`
> (hình chiếu của `CloudExternal.folderId`). Hiện tại §3 tự đứng độc lập, không phụ thuộc offline.

---

## 6. Bẫy / bài học (đừng vấp lại)

1. **`parentRemoteId` = cha My Files, KHÔNG phải favorite membership.** Favorite dùng `favoriteParentRemoteId`. Đừng lẫn.
2. `fromProto` + `syncFilesByRemoteId`/`syncFolderByRemoteId` dùng chung favorite + browse My Files →
   mọi thay đổi liên quan membership phải **scope riêng favorite** (cờ `preserveLocalParent`), không đổi mặc định.
3. `moveFavoriteItems`/`renameFile`/`updateFavorite` (gRPC) **nuốt lỗi → trả null**, KHÔNG throw
   → phân biệt offline vs server-reject bằng `CSNetworkUtils.checkConnection()`, không bằng try/catch.
4. _(offline-only)_ Proto3 `deletedAt` unset → map thành `0` chứ không `null` → filter "chưa xóa" phải `<= 0`.
5. _(offline-only)_ Chỉ cache từ tab **All** (`matchAnyCategory==true`); key theo `folderId` THẬT (normalize rỗng→`'root'`).
6. Move chỉ đồng bộ DB local cho **folder** (`moveFoldersById`); file dựa vào ES re-fetch → dễ staleness.

---

## 7. Lệnh hữu ích
- Lint scope cloud: `/analyze-cloud <path>`
- DI getIt (sau khi thêm `@LazySingleton`): `/build -get`
- ObjectBox codegen: **KHÔNG cần** (không thêm entity).