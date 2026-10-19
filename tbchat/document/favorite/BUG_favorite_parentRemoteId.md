# BUG — Favorite move ghi đè cha MyFiles (`parentRemoteId` bị dùng lẫn)

> Doc độc lập để fix bug trên branch **`new_cloud_storage`** (KHÔNG có code offline).
> Bug tự chứa: chỉ đụng view-model + mapper favorite + 2 hàm sync + call site move.
> Không phụ thuộc bất kỳ hạ tầng nào của effort offline (RESUME_favorite_offline.md).

---

## ✅ TRẠNG THÁI: ĐÃ IMPLEMENT (analyze 0 errors) — chờ test tay
Quyết định đã chốt: **Q1 = null · Q2 = cờ `preserveLocalParent` · Q3 = giữ external nguyên**.
Toàn bộ thay đổi A→D ở §6 đã hoàn tất trên branch `new_cloud_storage`. `dart analyze` trên
`_new_cloud_storage`: **0 errors** (433 warning/info đều là noise có sẵn, không dính code mới
`favoriteParentRemoteId`/`preserveLocalParent`/`_favoriteViewOf`).

**CÒN LẠI**: test tay theo §8 (đặc biệt: move trong favorite xong, vào My Files kiểm tra item
KHÔNG bị dời). Chưa commit.

### 🔧 Follow-up fix (runtime cast) — ĐÃ SỬA
- **Lỗi**: `type 'List<dynamic>' is not a subtype of type 'List<BaseViewItem>' in type cast`
  tại `searchFavorites` (`favorite_service_repository_impl.dart` — `fileMVs as List<BaseViewItem>`).
- **Nguyên nhân (regression do bước B5)**: helper mới `_favoriteViewOf` khai báo trả `dynamic`
  → list literal `[for ...]` bị suy ra `List<dynamic>` → cast thất bại. (Bản gốc dùng
  `.map().toList()` nên Dart tự suy ra LUB = `List<BaseViewItem>`.)
- **Fix** trong `search_mapper.dart`: `_favoriteViewOf` trả **`BaseViewItem`**; `fileView` khai báo
  **`List<BaseViewItem>`**; thêm import `base_view_item.dart`. → `analyze` file: **No issues found!**

---

## 1. Triệu chứng
- Move 1 favorite item (đang ở root, `parentRemoteId = null`) vào favorite-folder **A**.
- Sau khi list re-fetch từ server → item có `parentRemoteId = A`.
- Nhưng `parentRemoteId` này **chính là field cha của My Files** ⇒ vị trí file/folder trong
  cây My Files bị đổi sai theo favorite-folder.

## 2. Bản chất: 1 field gánh 2 nghĩa
Favorite có **2 loại "cha" TÁCH BIỆT**, đang bị nhồi chung vào `parentRemoteId`:

| Khái niệm | Ý nghĩa | Nguồn đúng |
|---|---|---|
| **Cha MyFiles** | Vị trí THẬT trong cây My Files | `CloudFile/CloudFolder.parentRemoteId` |
| **Membership favorite** | Item đang favorite trong favorite-folder nào (folder ảo `folderType==1`) | server trả qua `proto.folderId` khi search favorite |

Move "trong favorite" chỉ được đổi **membership favorite**, KHÔNG được đụng **cha MyFiles**.

## 3. Gốc rễ (đã verify trong code)
Đường favorite ghi membership favorite **đè** lên cha MyFiles của **cùng một row DB**:

1. `CloudFileProto.fromProto` — `cloud_file_proto.dart:25`: `parentRemoteId = p.folderId`
   → với favorite search, `folderId` = favorite-folder (KHÔNG phải cha MyFiles).
2. `SearchMapperResponse.mapSearchFavoriteToModelView` — `search_mapper.dart:132,139`
   → gọi `syncFilesByRemoteId` / `syncFolderByRemoteId`.
3. `syncFilesByRemoteId` — `cloud_file_db.dart:1471`: `existing.parentRemoteId = remoteFile.parentRemoteId`
   → `box.put(existing)` (dòng 1510) ⇒ **persist đè cha MyFiles**. Nhánh `parent.target==null`
   (1473-1508) cũng set `parentRemoteId`/`dir`/`parent`.
4. Folder y hệt: `syncFolderByRemoteId` — `cloud_folder_db.dart:1804` (`copyWith(parentRemoteId: remote.parentRemoteId)`).

⇒ No-op check + `FavoriteMoveBus` "chạy được" chỉ NHỜ clobber này (item.parentRemoteId tình cờ = A),
đánh đổi bằng việc **phá cây MyFiles**.

### ⚠️ Ràng buộc quan trọng
`fromProto` + `syncFilesByRemoteId`/`syncFolderByRemoteId` **DÙNG CHUNG** cho browse/search MyFiles
bình thường (`search_service_repository_impl.dart`, `file_service_repository_impl.dart`,
`file_mapper.dart`) — ở đó `folderId` = cha MyFiles và **ĐÚNG**.
→ Fix phải **scope RIÊNG đường favorite**, TUYỆT ĐỐI không đổi hành vi mặc định của `fromProto`/sync.

## 4. Trạng thái view model hiện tại

| Model | `parentRemoteId` đang giữ | Nguồn |
|---|---|---|
| `FileModelView.cloudFile` (`file_model_view.dart:141,199`) | cha MyFiles — **bị clobber thành favorite A** khi qua favorite fetch | `file.parentRemoteId` |
| `FolderModelView.convertByFolder` (`folder_model_view.dart:59,77`) | cha MyFiles — clobber tương tự | `folder.parentRemoteId` |
| `ExternalModelView.external` (`external_model_view.dart:61,79`) | membership favorite (đã đúng cho favorite) | `e.folderId` |

`BaseViewItem` (`base_view_item.dart:7-26`): field MUTABLE `parentRemoteId` (+ id, remoteId, isFavorite, space...).

---

## 5. GIẢI PHÁP: tách field cha riêng cho favorite

Nguyên tắc:
- Thêm **`favoriteParentRemoteId`** ở tầng **view-model** (`BaseViewItem`) — plain Dart, **KHÔNG codegen**.
- Đường favorite nạp `favoriteParentRemoteId` trực tiếp từ `proto.folderId`, **không đi qua `CloudFile.parentRemoteId`**.
- Favorite-sync **giữ nguyên cha MyFiles local** (không đụng `parentRemoteId`/`dir`/`parent`).
- Mọi logic favorite (no-op check, bus, bulk-move) đọc `favoriteParentRemoteId`.

---

## 6. DANH SÁCH THAY ĐỔI  ✅ (đã implement)

### A. Thêm field (view-model) ✅
1. ✅ `model_view/base_view_item.dart` — field `String? favoriteParentRemoteId;` + param ctor +
   static getter `getFavoriteParentRemoteId(dynamic obj)`.
2. ✅ `model_view/files/file_model_view.dart` — ctor + `copyWith` (`cloudFile(...)` giữ default `null` → Q1).
3. ✅ `model_view/folders/folder_model_view.dart` — ctor + `copyWith` (`convertByFolder` default `null`).
4. ✅ `model_view/files/external_model_view.dart` — ctor + `copyWith` + `external(...)` set `= e.folderId`.

### B. Nạp favoriteParentRemoteId từ ES + ngừng clobber MyFiles ✅
5. ✅ `data/_grpc/mapper/search_mapper.dart` — `mapSearchFavoriteToModelView`:
   - Snapshot `folderId` (đọc `CloudFile/CloudFolder.parentRemoteId` mà `fromProto` set) vào
     `favParentIds[i]` **trước** khi sync.
   - Sync với `preserveLocalParent: true`.
   - Helper mới `_favoriteViewOf(e, favParentId)` build view model + `..favoriteParentRemoteId = favParentId`.
     ⚠️ Helper phải trả **`BaseViewItem`** (không `dynamic`) và `fileView` là `List<BaseViewItem>`,
     nếu không list literal thành `List<dynamic>` → vỡ cast `as List<BaseViewItem>` ở caller (xem follow-up fix §đầu).
6. ✅ `data/db/cloud_file_db.dart` — `syncFilesByRemoteId` (**thực tế L1388**): thêm `{bool preserveLocalParent = false}`.
   - Khi bật: bỏ ghi `existing.parentRemoteId` + `existing.dir` + nhánh `parent.target==null`.
   - File **mới** (existing==null): `parentRemoteId = null` trước `box.put`.
7. ✅ `data/db/cloud_folder_db.dart` — `syncFolderByRemoteId` (**thực tế L1731**): thêm cờ.
   - `keepMyFilesParent = preserveLocalParent && folderType == 0` → chỉ chặn folder MyFiles thường;
     favorite-folder (`folderType==1`) giữ nguyên (parent = cây favorite).
   - `copyWith`: khi keep → giữ `existing.parentRemoteId` + `existing.path`.
   - Folder **mới** + keep → `parentRemoteId = null`, không resolve parent.
   > Chỉ đường favorite (`searchFavorites` → mapper) truyền cờ = true. Mọi caller khác
   > (search/browse MyFiles) giữ mặc định false → hành vi cũ nguyên vẹn.

### C. Dùng field mới ở logic favorite ✅
8. ✅ `pages/favorite/mixin/favorite_external_action_mixin.dart` — `moveFavoriteItem`:
   `currentParentRemoteId = item.favoriteParentRemoteId` (no-op check + `notifyMove(fromRemoteId:)`).
9. ✅ `shared/utils/sheet_helper.dart` — bulk-move: `isFileExist/isFolderExist/isFavoriteFoldersExist`
   + `fromRemoteId` dùng `favoriteParentRemoteId` (bỏ switch `data.parentRemoteId`).
10. ✅ `pages/favorite/cubit/favorite_cubit.dart` — `_onFavoriteMoved`: khi `current == to`, set
    `item.favoriteParentRemoteId = event.toRemoteId` cho từng item trước `insertItems`.

### D. Audit ✅
- ✅ Grep `parentRemoteId` trong `pages/favorite/**`: chỉ còn comment, không còn logic dùng sai.
- ✅ `analyze-cloud _new_cloud_storage`: 0 errors; code mới không phát sinh issue.
- ⏳ Chưa gặp path `deleteFavoriteFolderKeepChildren` dùng `parentRemoteId` (không nằm trong grep hit) — coi như ngoài phạm vi bug này.

---

## 7. ĐIỂM CẦN CHỐT — ✅ ĐÃ CHỐT

| # | Câu hỏi | Quyết định |
|---|---------|-----------|
| Q1 | File/folder chỉ biết qua favorite (chưa có DB MyFiles), sync tạo row mới → cha MyFiles? | ✅ **= null** |
| Q2 | Cơ chế chặn clobber | ✅ **Cờ `preserveLocalParent`** trên 2 hàm sync |
| Q3 | External `parentRemoteId` (hiện = folderId) | ✅ **Giữ nguyên** (external không có MyFiles) |

---

## 8. Thứ tự thực thi + kiểm thử
1. A (field) → build OK.
2. B (mapper + sync + cờ) → `/build -get` KHÔNG cần (không đổi DI, không entity).
3. C (call site) → dùng field mới.
4. `/analyze-cloud lib/features/cloud_storage/_new_cloud_storage` — lint sạch.
5. **Test tay** (quan trọng vì bug ảnh hưởng MyFiles):
   - Favorite 1 file ở MyFiles/folder X → mở favorite → move sang favorite-folder A.
   - ✅ Kỳ vọng: item hiện dưới A trong favorite; **vào My Files, file VẪN ở folder X** (không bị dời).
   - No-op check: move item đang ở A → chọn lại A ⇒ toast "already exists", không gọi server.
   - Move ngược từ A về root ⇒ cho phép (không bị chặn nhầm).

---

## 9. Tham chiếu file (branch new_cloud_storage)
- `model_view/base_view_item.dart:7-26`
- `model_view/files/file_model_view.dart:141,199` · `folders/folder_model_view.dart:59,77` · `files/external_model_view.dart:61,79`
- `data/_grpc/mapper/search_mapper.dart:132`
- `data/_grpc/mapper/cloud_file_proto.dart:25` · `cloud_folder_proto.dart` (folderId→parentRemoteId)
- `data/db/cloud_file_db.dart` `syncFilesByRemoteId` (~L1388) · `cloud_folder_db.dart` `syncFolderByRemoteId` (~L1731) — số dòng dịch nhẹ sau khi thêm cờ
- `data/_grpc/repositories/favorite_service_repository_impl.dart:251` (searchFavorites), `:342` (moveFavoriteItems)
- `pages/favorite/mixin/favorite_external_action_mixin.dart:191-280`
- `pages/favorite/cubit/favorite_cubit.dart:148-166`
- `shared/utils/sheet_helper.dart:1725-1799`