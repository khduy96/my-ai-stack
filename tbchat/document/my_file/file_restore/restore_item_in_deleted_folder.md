# Restore item BÊN TRONG folder đã xóa → "File Restore"

**Module:** `lib/features/cloud_storage/_new_cloud_storage/`
**Liên quan:** [`file_restore.md`](./file_restore.md) — §4 mô tả sơ lược luồng này; tài liệu hiện tại đi sâu vào case cụ thể và phần `parent` trong local DB.

## Case

```
My File
 ├── folder A            (id: A)          ← xóa folder này
 │    ├── file  A_F1     (id: A_F1)
 │    └── folder B       (id: B)
 └── file  F1            (id: F1)
```

Thao tác:

1. Xóa **folder A** → A vào Recycle Bin (A và toàn bộ con được đánh `isDeleted = true`, **row vẫn nằm trong ObjectBox**).
2. Vào Recycle Bin → mở **folder A** (`ViewFolderPage`).
3. Restore **file A_F1** hoặc **folder B** — tức restore một item *bên trong* một folder vẫn đang bị xóa.

Đây **không phải** luồng `RecycleBinCubit.restore()`. Nó là khái niệm số 2 trong `file_restore.md`:
`FileService/RestoreItemsInTrashFolder`.

## Vì sao đích luôn là "File Restore"

Đường dẫn gốc của A_F1 là `/MySpace/A/A_F1`. Tại thời điểm restore, **A vẫn nằm trong Thùng rác**,
nên đường dẫn gốc không tồn tại. Theo BRule-03 / FR-06, item phải rơi vào thư mục dùng chung
**"My File > File Restore"**.

Khác với restore từ Recycle Bin root, ở đây **không có** trường hợp "về đúng chỗ cũ": chừng nào A còn
trong thùng rác thì mọi item restore từ bên trong A đều mất đường dẫn gốc.

## Luồng code

```
ViewFolderPage
  └─ ViewFolderCubit.restore(items)                    view_folder_cubit.dart
       1. _restoreItemsUC.run(TrashFolderItemsReq(ids))
            └─ RestoreItemsInTrashFolderUseCase        trash_folder_items_use_case.dart:24-34
                 └─ FileServiceRepository.restoreItemsInTrashFolder(ids)
                      └─ gRPC /pb.FileService/RestoreItemsInTrashFolder
       2. clear cờ xóa trong local DB — KHÔNG đụng parent:
            folderIds → _cloudMyFileRepo.restoreFolders(folderRemoteIds)
                      + _cloudFileDB.deleteFileByRemoteIds(folderIds)
            fileIds   → _cloudFileDB.updateDelStatusByRemoteIds(delStatus: false)
       3. _cloudFolderDB.rehomeOrphansToFileRestore(folderIds, fileIds, force: true)
            → parent = row "File Restore" cho TẤT CẢ item vừa restore
       4. paginationController.removeItems(items)      → biến mất khỏi list Thùng rác
```

### Response không mang thông tin đích

```protobuf
RestoreItemsInTrashFolderResponse {
  repeated string restored_ids = 1;
}
```

`file.pbjson.dart:1330-1335` — **chỉ có `restored_ids`**. Không có `movedToFileRestore`,
`movedToRoot` hay `renamed` như `RestoreFilesResponse`.

> **Hệ quả thiết kế:** với case này client **không thể** học đích đến từ server. `parent` trong local
> DB **bắt buộc** phải được quyết định thuần local ở bước 3. Đây là khác biệt cốt lõi so với luồng
> `RecycleBinCubit.restore()`, nơi `RestoreFilesResponse` có 4 danh sách phân loại.

## Diễn biến `parent.targetId`

Đặt `A_ID` = folder A (đang `isDeleted = true`), `FR_ID` = row "File Restore".

### Restore **file A_F1**

| Bước | Code | `A_F1.parent.targetId` | `A_F1.isDeleted` |
|---|---|---|---|
| 0 | Sau khi xóa A | `A_ID` | `true` |
| 1 | gRPC `RestoreItemsInTrashFolder` | không đổi (server-side) | — |
| 2 | `updateDelStatusByRemoteIds(delStatus:false)` | `A_ID` | `false` |
| 3 | `rehomeOrphansToFileRestore(force: true)` | **`A_ID` → `FR_ID`** (kèm `dir`/`path` trỏ vào File Restore) | `false` |

### Restore **folder B**

| Bước | Code | `B.parent.targetId` |
|---|---|---|
| 0 | Sau khi xóa A | `A_ID` |
| 2 | `restoreFolders([B])` | `A_ID` |
| 3 | `rehomeOrphansToFileRestore(force: true)` | **`A_ID` → `FR_ID`** (kèm `updateFolderPathRecursive` dựng lại path cho cây con của B) |

Bước 2 cố ý **không** đụng `parent`: nó chạy giữa chừng batch nên chưa đủ thông tin để phán đoán
(xem [Ghi chú khi bảo trì](#ghi-chú-khi-bảo-trì)).

## `force: true` — vì sao ép thay vì suy luận

`rehomeOrphansToFileRestore` mặc định chỉ move item nào **mất đường dẫn gốc**, xác định bằng:

```
_isOrphaned(x):
    cur = parent(x)
    while cur != null:
        if cur.isDeleted  → ORPHAN
        if cur.isRoot     → OK
        cur = parent(cur)
    return ORPHAN            # chain đứt: row cha đã bị xóa vĩnh viễn
```

Ở luồng này điều kiện đó **luôn đúng**: vào được `ViewFolderPage` nghĩa là folder cha đang nằm trong
Thùng rác (`A.isDeleted == true`). Suy luận lại chỉ thêm một cách để **âm thầm không làm gì** — nếu
cờ `isDeleted` của A vì lý do nào đó chưa đúng tại thời điểm chạy, item sẽ nằm nguyên chỗ cũ mà không
có lỗi nào được báo. Vì vậy luồng này truyền `force: true`: đích đến là **bất biến của màn hình**,
không phải thứ cần suy ra.

Luồng `RecycleBinCubit.restore()` thì ngược lại — item ở đó **có thể** về đúng chỗ cũ — nên vẫn dùng
mặc định (`force: false`) và để `_isOrphaned` quyết định. Ở đó A nằm trong batch restore và đã được
clear cờ trước khi post-pass chạy, nên cùng điều kiện cho kết quả "không mồ côi" — chính xác.

Cùng một hàm phục vụ được cả hai luồng nhờ chạy **sau** khi cờ xóa đã ổn định. Cả hai chế độ đều bỏ
qua row root/system và row "File Restore" chính nó, và bỏ qua item đã nằm sẵn trong File Restore nên
gọi lại nhiều lần vẫn an toàn.

## So sánh hai luồng restore

| | `RecycleBinCubit.restore()` | `ViewFolderCubit.restore()` |
|---|---|---|
| Điểm vào | Recycle Bin root | Mở folder đã xóa → restore item con |
| gRPC | `FileService/RestoreFiles` | `FileService/RestoreItemsInTrashFolder` |
| Response mang đích? | **Có** — `restored` / `renamed` / `movedToRoot` / `movedToFileRestore` | **Không** — chỉ `restored_ids` |
| Đích có thể là chỗ cũ? | Có, khi đường dẫn gốc còn | **Không** — cha vẫn trong Thùng rác |
| Clear cờ local | `restoreFolders` + `updateDelStatusByRemoteIds` | **giống hệt** |
| Áp đích theo response | `_applyRestoreDestinations` | không có (không có dữ liệu) |
| Post-pass re-home | `rehomeOrphansToFileRestore` — mặc định, lọc theo `_isOrphaned` | `rehomeOrphansToFileRestore(force: true)` — luôn move |

## Ghi chú khi bảo trì

- **Không** thêm fallback re-parent vào `CloudFileDB.updateFilesDelStatus` hoặc
  `CloudFolderDB._updateFilesDelStatus`. Hai hàm đó chạy **giữa chừng** batch restore:
  `CloudMyFileRepository.restoreFolders()` xử lý file và sub-folder của một folder **trước** khi clear
  cờ của chính folder đó, nên tại thời điểm ấy mọi ancestor đều còn `isDeleted == true`. Phán đoán
  "mồ côi" ở đó sẽ bắn cả file lẫn folder con ra khỏi folder cha hoàn toàn bình thường. Mọi việc
  re-home phải nằm ở post-pass.
- `rehomeOrphansToFileRestore` **idempotent** ở cả hai chế độ: item đã nằm trong File Restore bị bỏ
  qua nhờ kiểm tra `parent.targetId == target.id`, nên `force: true` gọi lại nhiều lần cũng không
  ghi thừa. An toàn khi gọi từ nhiều luồng.
- Dùng `force: true` **chỉ khi** đích đến là bất biến của điểm gọi. Ở luồng Recycle Bin root thì
  không: item ở đó có thể về đúng đường dẫn gốc, ép move sẽ sai.
- Nó chỉ xét đúng các `remoteId` được truyền vào, **không** đụng con cháu — nên cây con của B giữ
  nguyên cấu trúc, chỉ `path` được viết lại.
- Row "File Restore" được tạo theo yêu cầu (`CloudFolderDB.fileRestoreFolderOrCreate`) nên post-pass
  không phụ thuộc `initFolderDB` đã chạy trước hay chưa.
- Nếu sau này BE bổ sung trường phân loại vào `RestoreItemsInTrashFolderResponse` thì có thể đọc
  giống `_applyRestoreDestinations`, nhưng post-pass local vẫn nên giữ làm lưới an toàn.