# "File Restore" trong local DB — thiết kế & trạng thái

**Module:** `lib/features/cloud_storage/_new_cloud_storage/`
**Cập nhật:** 2026-08-03
**Liên quan:** [`file_restore.md`](./file_restore.md) (tổng quan tính năng) ·
[`restore_item_in_deleted_folder.md`](./restore_item_in_deleted_folder.md) (case restore item bên trong folder đã xóa)

Tài liệu này ghi lại phần **local DB** của tính năng File Restore: các bất biến, lý do chọn từng
quyết định, và những việc còn treo. Mục đích là quay lại sau vẫn nắm được vì sao code như vậy.

---

## 1. Bất biến của row "File Restore"

Phải luôn có **đúng một** row, với đúng các giá trị sau:

| Thuộc tính | Giá trị | Vì sao |
|---|---|---|
| `name` | `FILE_RESTORE_FOLDER_KEY` | Locale-independent, giống `encrypted`/`privacy`. Hiển thị qua `NewSystemFolder.convertToLang` |
| `path` | `/MySpace/FILE_RESTORE_FOLDER_KEY` | Phải khớp tiền tố với `path`/`dir` của con — xem §2 |
| `isSystem` | `true` | Để bị ẩn khỏi list thường và được `getSysFolderByNameHandler` nhận |
| `parent` | My Files root | |
| `remoteId` | id thật của backend | Để `parentRemoteId` của item resolve về row này |

`NewSystemFolder.fileRestoreDisplayName` (`'File Restore'`) **chỉ là matcher** cho tên backend dùng.
**Không bao giờ** lưu giá trị này vào `CloudFolder.name`.

---

## 2. Vì sao `path` phải ở dạng key

`getFolderStackByPath` dựng breadcrumb bằng cách so khớp **chuỗi** từng segment, và
`_buildStackPaths` (`cloud_folder_db.dart`) **âm thầm bỏ qua** segment không resolve được:

```dart
final item = callback(current);
if (item != null) result.add(item);   // không thấy → bỏ qua, không lỗi
```

Lệch một segment ⇒ mất "File Restore" khỏi breadcrumb, không có lỗi nào báo ra.

Backend gọi folder này là `File Restore`, nên `fullPath` của con trả về tên đó. Codebase đã có quy
ước xử lý: **mapper dịch segment system folder sang localization key**. `CloudFolderProto.fromProto`
và `CloudFileProto.fromProto` làm việc này cho privacy (`e.id == FileSpaceEnum.privacy.value`) và
encrypted. File Restore **không có sentinel id** — backend cấp id folder thật — nên được nhận **theo
tên**:

```dart
if (e.name == NewSystemFolder.fileRestoreDisplayName) {
  return NewSystemFolder.fileRestore.localizationKey;
}
```

Nhờ đó con có `path`/`dir` = `/MySpace/FILE_RESTORE_FOLDER_KEY/...`, khớp với row local.

> ⚠️ Nếu backend đổi tên folder này, matcher trên sẽ trượt và breadcrumb sẽ âm thầm mất segment.
> Đây là điểm giòn nhất của thiết kế hiện tại.

---

## 3. Vòng đời row — `ensureFileRestoreFolderHandler`

Gọi ở **cuối** `initFolderDB`, sau `_createSyncFolder`, và **không điều kiện** (mọi lần khởi động).

### Vì sao phải chạy cuối

`GetFolders(root)` có liệt kê folder này, nên `_createSyncFolder` có thể đã tạo row cho nó với
`remoteId` thật, `isSystem: false`, tên backend. `getOrCreateFolder` match theo `remoteId` — row của
ta chưa có `remoteId` nên **không** match ⇒ chạy trước sẽ sinh **row thứ hai**, và item của backend
gắn vào row của backend trong khi UI mở row của ta.

### Hành vi

```
rows = _fileRestoreRows(store)        // match theo NAME (cả key lẫn tên BE), ưu tiên row có remoteId
if rows không rỗng:
    keep = rows.first                 // row có remoteId thắng — đó là row item thực sự nằm trong
    xóa các row còn lại NẾU rỗng      // subFolders.isEmpty && files.isEmpty
    ép keep: isSystem=true, name=key, path=/MySpace/<key>, parent=root
else:
    createFolderHandler(name: key)    // path tự dựng từ name → đúng dạng key
```

`fileRestoreFolderOrCreate(store)` = ensure + get, dùng cho các fallback lúc restore để không phụ
thuộc `initFolderDB` đã chạy trước hay chưa.

### Khác biệt có chủ ý so với Encrypted Vault

`getEncryptedVaultFolderHandler` chọn cách **sống chung với 2 row** và chỉ ưu tiên row có `remoteId`
(xem docstring của nó). File Restore không dùng lại được cách đó vì `_createSyncFolder` map con của
encrypted/privacy về row key-named **dựa vào `space`**:

```dart
if (folder.space == FileSpaceEnum.encrypt.value)  parent = <row encrypted>;
if (folder.space == FileSpaceEnum.privacy.value)  parent = <row privacy>;
```

File Restore có `space = normal` nên không nhánh nào bắt được. Vì vậy ở đây chọn **adopt + dedup**.

> Phương án thay thế nếu muốn nhất quán với encrypted: giữ 2 row, bỏ ép path, và thêm nhánh nhận
> File Restore **theo tên** vào `_createSyncFolder`.

---

## 4. `parent` được ghi ở đâu

`parent` là quan hệ **local**; server không bao giờ ghi vào nó.

| Nơi ghi | Khi nào | Phụ thuộc server? |
|---|---|---|
| `moveFoldersById` / `moveFilesById` (qua `_reparentByRemoteIds`) | `RestoreFilesResponse.movedToFileRestore` / `movedToRoot` không rỗng | Có |
| **`rehomeOrphansToFileRestore`** | post-pass sau mọi luồng restore | **Không** |
| `syncFolderByRemoteId` / `syncFilesByRemoteId` | resolve theo `parentRemoteId` khi fetch | Có |

Hai hàm clear cờ xóa (`CloudFileDB.updateFilesDelStatus`,
`CloudFolderDB._updateFilesDelStatus`) **không** ghi `parent` — xem §6.

---

## 5. `rehomeOrphansToFileRestore`

```dart
Future<void> rehomeOrphansToFileRestore({
  List<String> folderRemoteIds = const [],
  List<String> fileRemoteIds = const [],
  bool force = false,
})
```

Điều kiện mồ côi:

```
_isOrphaned(x):
    cur = parent(x)
    while cur != null:
        if cur.isDeleted  → ORPHAN     # ancestor không nằm trong batch restore
        if cur.isRoot     → OK
        cur = parent(cur)
    return ORPHAN                      # chain đứt: row cha đã bị xóa vĩnh viễn
```

Với file, thêm `parent == null || parent.isDeleted == true` ở tầng ngoài.

| Caller | `force` | Vì sao |
|---|---|---|
| `RecycleBinCubit.restore()` | `false` | Item có thể về đúng path gốc — phải để `_isOrphaned` quyết định |
| `ViewFolderCubit.restore()` | `true` | Mở được `ViewFolderPage` nghĩa là folder cha còn trong Thùng rác ⇒ đích là bất biến của màn hình |

### Ghi gì

- **Folder:** `parent.target` + `updateFolderPathRecursive` (dựng lại `path` cho cả cây con).
- **File:** `parent.target` + **`dir`** — và **tuyệt đối không đụng `path`**.

> `CloudFile.dir` = *"full directory path within the **cloud storage**"*.
> `CloudFile.path` = *"the **local** path to the downloaded file on the user's device"*.
> Ghi cloud path vào `path` sẽ làm hỏng cache download (`resetAllPathLocal` cũng thao tác trên field
> này). `CloudFileDB.updateFilePath` dù tên vậy nhưng **chỉ** set `dir`.
> Với `CloudFolder` thì ngược lại — `path` chính là path cloud, nên rewrite là đúng.

Idempotent nhờ guard `parent.targetId == target.id` ⇒ gọi lại nhiều lần, kể cả `force`, đều an toàn.
Chỉ xét đúng các `remoteId` được truyền vào, **không** đụng con cháu.

---

## 6. Vì sao re-home phải là post-pass

`CloudMyFileRepository.restoreFolders()` xử lý **con trước, cha sau**:

```
for element in cloudFolders:
   1. restore files của element      ← element.isDeleted vẫn = true
   2. đệ quy restore subFolders      ← element.isDeleted vẫn = true
   3. clear cờ của chính element
```

Nên mọi phán đoán "mồ côi" **bên trong** bước clear cờ đều sai — tại thời điểm đó ancestor nào cũng
đang `isDeleted == true`, và fallback sẽ bắn file/folder con ra khỏi folder cha hoàn toàn bình
thường. Code cũ chính vì vậy mà quăng file về My Files root.

> ⚠️ **Không** thêm lại fallback re-parent vào `CloudFileDB.updateFilesDelStatus` hoặc
> `CloudFolderDB._updateFilesDelStatus`. Mọi việc re-home phải nằm ở post-pass, chạy sau khi cờ xóa
> đã ổn định.

Cùng `_isOrphaned` phục vụ được cả hai luồng chính nhờ chạy sau: ở luồng Recycle Bin root, folder cha
**nằm trong batch** và đã được clear cờ ⇒ "không mồ côi"; ở luồng view-folder, cha **không** nằm
trong batch và vẫn deleted ⇒ "mồ côi".

---

## 7. Điều hướng & hiển thị

- **`FolderNavigator.openFolder`** tự suy ra `isFileRestore` từ tên folder được mở, nên Recent /
  location tap / search / deep link đều vào đúng chế độ (nguồn dữ liệu = gRPC `SearchRecoveryFiles`)
  mà không call site nào phải tự truyền cờ. Folder **nằm trong** File Restore là folder thường.
- **`MyFilePage.initState`** phải forward `isFileRestore` ở **cả** nhánh `initialFolder`; nhánh này
  đứng trước nhánh fallback nên nếu quên sẽ ăn mất cờ.
- **Breadcrumb** đi theo chain `parent`, không có code prefix riêng: File Restore là folder thật nên
  xuất hiện như mọi segment khác.
- ⚠️ Luôn dùng `FolderModelView.getTitle(context)` khi hiển thị tên folder. `title` thô sẽ lòi
  `FILE_RESTORE_FOLDER_KEY` ra UI (đã từng xảy ra ở app bar của `MyFilePage`).
- Row bị ẩn khỏi list thường qua `_isCloudFolderInHiddenSystemSpace`, match **theo tên** —
  cố ý **không** thêm vào `_HiddenSystemSpacePaths`, vì rule theo path sẽ ẩn luôn mọi thứ được restore
  **vào trong** nó.

---

## 8. Discovery `remoteId`

Backend không expose id folder File Restore qua API nào (`Folder` proto không có cờ `is_system`,
`GetFolders` chỉ nhận `folder_id`). Id được học từ `full_path` của response
`SearchRecoveryFiles`: **segment đầu tiên khác `root`** chính là nó.

`SearchServiceRepositoryImpl._discoverFileRestoreRemoteId` chạy sau mỗi response (miễn phí, không
thêm call), gọi `CloudFolderDB.updateFileRestoreRemoteId`. Best-effort — lỗi không được làm hỏng
danh sách.

> ⚠️ Giả định File Restore nằm **ngay dưới root**. Nếu backend lồng sâu hơn, cách suy này sai.

---

## 9. Việc còn treo / cần kiểm chứng

Toàn bộ phần trên **mới chỉ verify bằng `dart analyze`**, chưa chạy thực tế đầy đủ.

1. **Xác nhận chỉ còn 1 row.** Query `CloudFolder` với `name IN (FILE_RESTORE_FOLDER_KEY, 'File
   Restore')`. Nếu ra 2 row thì dedup chưa chạy (hoặc row thừa không rỗng nên bị giữ lại có chủ ý).
2. **Xác nhận `path` khớp tiền tố.** Row phải là `/MySpace/FILE_RESTORE_FOLDER_KEY`; con phải bắt đầu
   bằng đúng chuỗi đó. Lệch ⇒ breadcrumb mất segment.
3. **Tên backend.** Toàn bộ mapper phụ thuộc `'File Restore'`. Cần log `full_path` một lần để xác
   nhận, và xác nhận folder nằm ngay dưới root.
4. **`SearchRecoveryFiles` trả con trực tiếp hay đệ quy?** Chưa rõ, ảnh hưởng nội dung hiển thị ở màn
   File Restore.
5. **`renamed` chưa xử lý.** `RestoreFilesResponse.renamed` bị bỏ qua; tên mới về ở lần sync kế tiếp.
6. **Hai writer phụ thuộc server** (§4, dòng 1 và 3) là thứ duy nhất có thể lật `parent` sau khi
   post-pass đã ghi đúng. Nếu gặp lỗi kiểu "parent đúng rồi lại sai sau ~1.5s", nghi hai chỗ này
   trước. Đã cân nhắc gỡ để flow thuần local nhưng **chưa làm** — writer 3 vốn được thêm để phản ánh
   move từ thiết bị khác.
7. **`_applyRestoreDestinations` có thể dàn phẳng cây** nếu `movedToFileRestore` liệt kê cả con cháu
   chứ không chỉ item cấp cao nhất. Chưa xác nhận backend trả gì. `rehomeOrphansToFileRestore` không
   có rủi ro này vì chỉ xét id được truyền vào.

---

## 10. Inventory các file đã đụng

| File | Nội dung |
|---|---|
| `shared/enum/sys_folder_enum.dart` | `fileRestore` enum + `fileRestoreDisplayName` (matcher) + `isFileRestoreFolderName` + nhánh `convertToLang` |
| `data/db/cloud_folder_db.dart` | `_fileRestoreRows` / `getFileRestoreFolderHandler` / `ensureFileRestoreFolderHandler` / `fileRestoreFolderOrCreate` / `updateFileRestoreRemoteId` / `_safeParentOf` / `_isOrphaned` / `rehomeOrphansToFileRestore` / `_resolveParentByRemoteId`; sửa fallback root trong `syncFolderByRemoteId`; gọi ensure ở cuối `initFolderDB` |
| `data/db/cloud_file_db.dart` | Bỏ fallback re-parent về root trong `updateFilesDelStatus`; repoint `parent` theo `parentRemoteId` trong `syncFilesByRemoteId` |
| `data/_grpc/mapper/cloud_folder_proto.dart` | Map segment `'File Restore'` → key |
| `data/_grpc/mapper/cloud_file_proto.dart` | Map segment `'File Restore'` → key |
| `data/_grpc/repositories/search_service_repository_impl.dart` | `_discoverFileRestoreRemoteId` |
| `data/repository/my_file/cloud_my_file_repository_impl.dart` | Ẩn row khỏi list local-first |
| `pages/recycle_bin/cubit/recycle_bin_cubit.dart` | Đọc `RestoreFilesResponse`; `_applyRestoreDestinations` / `_resolveFileRestoreFolder` / `_reparentByRemoteIds`; gọi post-pass |
| `pages/recycle_bin/view_folder/cubit/view_folder_cubit.dart` | Gọi post-pass với `force: true` |
| `pages/my_file/my_file_page.dart` | Forward `isFileRestore` ở nhánh `initialFolder`; `titleAppBar` dùng `getTitle(context)` |
| `shared/utils/folder_navigator.dart` | Suy ra `isFileRestore` từ folder được mở |
| `shared/widgets/sys_folders/file_restore.dart` | Tap mở row DB thật qua `initialFolder` |