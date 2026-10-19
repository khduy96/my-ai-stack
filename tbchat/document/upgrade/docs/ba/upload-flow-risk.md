# Phân tích rủi ro — Luồng upload từ UploadProgressVerify

> Loại tài liệu: phân tích rủi ro (as-is), không phải spec tính năng mới. Không đổi hành vi.
> Ngày: 2026-10-13 · Nguồn: `/agents-ba` (lane LA, R1, R2, R3) · Đọc code tĩnh, chưa chạy/profiling.
> Path trong tài liệu tương đối với `lib/features/cloud_storage/` trừ khi ghi rõ khác.

---

## 1. Mục tiêu & phạm vi

**Mục tiêu:** liệt kê, chứng minh bằng code và xếp mức các rủi ro của luồng upload hiện tại, kèm hướng giảm thiểu ở mức ý tưởng để làm đầu vào cho `/agents-plan` sau này.

**In scope**
- Upload khởi chạy từ widget `UploadProgressVerify` (`shared/widgets/bottom_sheet/upload_files/upload_progress_verify.dart`).
- Toàn bộ chuỗi phía sau: `CloudStorageServices.uploadFile` → queue → HK BE (native SDK + HTTP) → transfer row → watcher ObjectBox → `CloudFile` + `SyncTask` → `CloudSyncService` → VN BE gRPC `FileService/CreateFile` → ghi `remoteId`.
- UI hiển thị kết quả của luồng này (verify sheet, Upload list, Transfer manager, folder list/Home).

**Out of scope** (chỉ xét khi đụng vào cùng dữ liệu)
- `saveFilesToCloudStorage` (transponder `:1083`), `hash_download_page.dart:455`, benchmark debug, `TransferMediaRepositoryImpl` (SocialFi share), upload IM.
- Không sửa `lib/features/socialfi` — rủi ro SocialFi chỉ được ghi nhận, hướng xử lý nằm phía CS.

---

## 2. Actor & thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| HK BE | Backend HK — `data/native_handle` + HTTP node (`/api/v1/upload/...`). Lưu bytes của file. |
| VN BE | Backend VN — `data/_grpc`, gRPC `FileService/CreateFile`. Lưu bản ghi file để quản lý thư mục. |
| Transfer row | `FileCacheTransferEntity` (ObjectBox) — trạng thái upload/download. `status`: 0 waiting, 1 success, 2 uploading, 3 failed, 4 pause. `process`: 0..1. |
| Watcher | `_staticWatchTask` (`data/db/file_cache_transfer_db.dart:74-129`) chạy trong DB isolate, theo dõi toàn bảng transfer. |
| CloudFile | Bản ghi file local (`lib/database/tables/cloud_storage/cloud_file/cloud_file.dart`). `remoteId = ''` cho tới khi VN tạo xong. |
| SyncTask | `SyncTaskEntity` — hàng đợi đồng bộ lên VN. `status`: pending 0, sending 1, done 2, error 3. |
| taskId | UUID v4 sinh ở widget cho mỗi file mỗi lần mở màn. = `row.taskId` = `CloudFile.hash` = `SyncTask.hash`. |
| fileHash / unique | Do HK init trả về. `unique` = `CreateFile.uniqueHash`. |
| Cửa sổ chưa có remoteId | Khoảng từ lúc CloudFile được tạo tới lúc VN trả `id`. |
| Poison row | Transfer row `process == 1` mà watcher không tạo được CloudFile (ném lỗi) ở mọi lần emit. |

**Actor:** người dùng upload; thiết bị khác của cùng user; HK BE; VN BE; OS (kill app / dọn cache).

---

## 3. Kịch bản người dùng bị ảnh hưởng

- **US-1** Là người dùng, khi màn hình báo "Saved to My Space" tôi kỳ vọng file đã thật sự nằm trên cloud và thấy được ở thiết bị khác. → U1, U3, U11, U27
- **US-2** Là người dùng, khi upload vào một folder mà folder đó bị xoá (kể cả từ thiết bị khác), tôi không muốn mọi upload sau đó bị hỏng âm thầm. → U5
- **US-3** Là người dùng, tôi muốn xoá / di chuyển / đổi tên / favorite / share file ngay sau khi upload mà kết quả đúng như tôi làm. → U17
- **US-4** Là người dùng, khi bấm "Background" tôi muốn được báo khi upload xong hoặc lỗi. → U28
- **US-5** Là người dùng dùng app lâu ngày, tôi không muốn app chậm dần hoặc hết RAM khi upload. → U6

---

## 4. Luồng nghiệp vụ (as-is)

### 4.1 Sequence

```mermaid
sequenceDiagram
  participant W as UploadProgressVerify
  participant S as CloudStorageServicesImpl/_uploadFileExt
  participant Q as uploadQueue (max 3)
  participant P as _processUploadTaskExt
  participant HK as HK SDK + Node HTTP
  participant T as FileCacheTransfer (ObjectBox)
  participant WT as _staticWatchTask (DB isolate)
  participant CF as CloudFile + SyncTask
  participant CS as CloudSyncService
  participant VN as VN gRPC FileService
  W->>W: taskId = uuid v4 / file
  W->>T: watchByTaskIds(taskIds) (UI progress)
  W->>S: getIt.uploadFile(taskId, file, folderId local)
  S->>T: put row {status 0, process 0, parentId, folderId=folder.remoteId snapshot}
  S->>Q: enqueue(taskId)
  Q->>P: processor(params)
  P->>HK: getDomainCurrent()
  opt row có infoData (resume)
    P->>HK: GET upload/progress/:netId/:unique (Missing)
  end
  P->>HK: InitHttpUploadWithCallBackV1 (global lock, no timeout)
  HK-->>P: {file_hash, net_id, unique, out_path, data.status}
  P->>T: update fileHash, unique, infoData (data.status==1 ⇒ instant: process 1, success)
  P-->>W: row json (caller unblocked)
  loop chunks
    P->>HK: PUT upload/range/:netId/:unique
    P->>T: process=received/total, status 2 (≥1.0 ⇒ status 1) mỗi 500ms
  end
  HK-->>P: statusCode (200 | 0 | other), body chỉ log
  alt 200
    P->>T: process 1.0, status 1
  else 0 / other / offline
    P->>T: status 4 | 3 (process KHÔNG reset)
  end
  T-->>WT: watch (toàn bảng)
  WT->>WT: lọc process==1 & !exists(CloudFile.hash==taskId)
  WT->>CF: createFileHandler → CloudFile(remoteId='') + SyncTask(createFile)
  CF-->>W: UploadCubit ⇒ "completed" (không xét remoteId)
  CF-->>CS: watchAllTasksNeedSync
  CS->>HK: GetDelFileSign (native)
  CS->>VN: CreateFile(fileHash, uniqueHash, folderId, space, ...)
  alt id ok
    CS->>CF: CloudFile.remoteId = id; xoá SyncTask
  else null / rỗng
    CS->>CF: retryCount++, status error (delay 10s)
  end
```

Điểm then chốt:
- Không có use case domain; widget gọi thẳng data service (`upload_progress_verify.dart:149`).
- Không có code nào tạo CloudFile ngay sau 200; CloudFile được tạo gián tiếp qua watcher (`file_cache_transfer_db.dart:111-119` → `data/db/cloud_file_db.dart:238-329`).
- 200 của HK chỉ có statusCode; `fileHash`/`unique` lấy từ bước init (`data/services/cloud_storage_file_uploader.dart:120-136`).

### 4.2 State machine — Transfer row (upload)

| Từ | Sự kiện | Đến (status / process) | Ref |
|---|---|---|---|
| — | `uploadFile` lần đầu | 0 / 0.0 | `data/services/mixins/cloud_storage_upload_ext.dart:90-126` |
| 3/4 | enqueue lại cùng taskId | 0 / giữ | `upload_ext:44-53` |
| 0 | init null / exception | 3 / giữ | `upload_ext:489-496, 766-779` |
| 0 | init `data.status==1` (instant) | 1 / 1.0 | `upload_ext:468-471, 484-488` |
| 0/2 | progress (500ms) | 2 / r; r≥1.0 ⇒ **1 / r** | `upload_ext:569-581` |
| 2 | HK 200 | 1 / 1.0 | `upload_ext:624-644` |
| 2 | HK statusCode 0 | 4 / giữ | `upload_ext:678-686` |
| 2 | HK khác / offline | 3 / giữ | `upload_ext:673-686` |
| có mạng lại | process<1, status 0/2/3, file còn | reUpload | `data/services/cloud_storage_services_impl.dart:712-769` |
| app start | process<1 & status≠3 | 4 (không tự resume) | `file_cache_transfer_db.dart:801-823` |
| app start | status 4 & process≥1 | 1 | `file_cache_transfer_db.dart:769-799` |
| process==1 (mọi status) | watcher | sinh CloudFile + SyncTask | `file_cache_transfer_db.dart:89-119` |

### 4.3 State machine — SyncTask

| Từ | Sự kiện | Đến | Ref |
|---|---|---|---|
| — | `createFileHandler` | pending | `cloud_file_db.dart:316-322` |
| pending / error (retry≤1) | watcher emit | sending | `data/cloud_sync_service/cloud_sync_service.dart:107-108` |
| sending | thành công / đã có remoteId | **bị xoá** | `cloud_sync_service.dart:159-162, 198-204` |
| sending | lỗi, retry≤1 | error (sau 10s) | `cloud_sync_service.dart:115-127` |
| sending | lỗi, retry>1 | error, không được chọn nữa | `cloud_sync_service.dart:128-132` |
| error/pending | `start()` (mỗi init/login) | pending, retry 0 | `data/db/sync_task_db.dart:53-92` |
| error | có mạng lại | pending, retry 0 | `cloud_sync_service.dart:87-93` |
| sending | app bị kill | **kẹt sending** | `sync_task_db.dart:27-37, 60-74` |

---

## 5. Quy tắc nghiệp vụ

### 5.1 Đã chốt (dùng để đánh giá rủi ro)
- **BR-01** Upload chỉ được coi là "hoàn tất" (hiện "Upload completed / Saved…") khi VN đã tạo bản ghi (CloudFile có `remoteId`). Trước đó là trạng thái trung gian. *(Q16)*
- **BR-02** Chỉ upload `platform == cloud` mới được sinh CloudFile và VN CreateFile; SocialFi đi qua watcher là bug. *(Q4)*
- **BR-03** Upload chạy nền (sau "Background") phải có phản hồi khi kết thúc; việc tắt `UploadsListListener` là tạm thời. *(Q18)*
- **BR-04** Nhãn giai đoạn trên verify sheet là trang trí, nhưng không được hiện "Upload completed" trước 100%. *(Q21, mặc định)*
- **BR-05** Câu thông báo hoàn tất phải theo đích lưu (My Space / Privacy / Encrypted). *(Q23, mặc định)*
- **BR-06** Không hiện system notification cho luồng này là cố ý (đã có toast trong app). *(Q26, mặc định)*

### 5.2 Quy tắc ngầm của code hiện tại (as-is, để đối chiếu)
- `process == 1` được coi là "đã lên HK" và là tín hiệu tạo CloudFile.
- Dedupe CloudFile theo `CloudFile.hash == taskId`; upsert theo `hash`.
- SyncTask chỉ được tạo khi transfer có `taskId` và `fileHash` khác rỗng.
- `CloudSyncService.retryCountMax = 1` (tối đa 2 lần gọi mỗi phiên), delay 10s.
- Folder đích null → root "myFiles"; folder đích không tìm thấy → throw.

---

## 6. Dữ liệu & API

| Thành phần | Nơi | BE | Ghi chú rủi ro |
|---|---|---|---|
| `FileCacheTransferEntity` | `lib/database/tables/cloud_storage/…`, DAO `data/db/file_cache_transfer_db.dart` | local | Không index `taskId`; không bao giờ prune; `pwd` plaintext (`file_cache_transfer_entity.dart:482`) |
| `CloudFile` | `cloud_file.dart`, DAO `data/db/cloud_file_db.dart` | local | `remoteId` mặc định `''`; không index `hash`; `createdAt` giây→ms |
| `SyncTaskEntity` | DAO `data/db/sync_task_db.dart` | local | Không unique theo hash; payload chứa `pwd` |
| Upload init | `data/native_handle/cloud_storage_upload_init_handler.dart` → `InitHttpUploadWithCallBackV1` | **HK** (native) | Lock toàn cục, không timeout; Err 3009/3010 bị bỏ qua |
| Upload range | `PUT /api/v1/upload/range/:netId/:unique` (`lib/app/core/transfer/enums/transfer_api.dart:5`) | **HK** (HTTP) | Không có header auth; body 2xx không kiểm |
| Upload progress / cancel | `GET /upload/progress`, `DELETE /upload/cancel` | **HK** (HTTP) | Resume lỗi tạm thời ⇒ DELETE + làm lại |
| Del signature | `GetDelFileSignNativeHandle` (`data/datasource/cloud_storage_datasource_impl.dart:66-78`) | **HK** (native) | Lỗi ⇒ null ⇒ CreateFile không chạy |
| CreateFile | `data/_grpc/repositories/file_service_repository_impl.dart:213-241` | **VN** (gRPC) | Mọi exception ⇒ null; không gửi favorite/password; payload là snapshot |
| Folder list | `searchFilesInFolder` (`data/repository/my_file/cloud_my_file_repository_impl.dart:279-314`) | **VN** (ES) | Eventually-consistent; lỗi ⇒ list rỗng |

Không có use case/interface domain cho upload: `domain/use_cases/` chỉ có `user_space/watch_storage_usage_events_use_case.dart`.

---

## 7. Màn hình & trạng thái UI

### 7.1 As-is
| Nơi | Nguồn dữ liệu | "Xong" khi |
|---|---|---|
| Verify sheet — progress card | `UploadCubit.progresses` (`process*100`) | 100% |
| Verify sheet — completed card | CloudFile local (`pages/uploads_list_page/cubit/upload_cubit.dart:101-123`) | có CloudFile, **không xét remoteId** |
| Upload list "Completed" | CloudFile local | như trên |
| Transfer manager | transfer row (`transfer_cubit.dart:55`) | status 1 |
| Folder list / Home | VN ES (`my_file_cubit.dart:113-136`, `home_cubit.dart:115-142`) | ES đã index |

Ba nguồn sự thật khác nhau; không có trạng thái "đang đồng bộ"; không có trạng thái lỗi đồng bộ VN.

### 7.2 l10n gợi ý (chỉ dùng nếu triển khai hướng giảm thiểu)
| Key gợi ý | English |
|---|---|
| `cloudUploadSyncing` | Syncing… |
| `cloudUploadSyncFailed` | Couldn't sync to cloud |
| `cloudFileNotSyncedYet` | This file is still syncing. Try again shortly. |
| `cloudUploadTargetFolderDeleted` | Target folder was deleted. File moved to File Restore. |
| `cloudUploadStorageFull` | Not enough storage space |
| `cloudUploadFileTooLarge` | File exceeds the size limit |
| `cloudSavedToPrivacySpace` | Saved to Privacy Space |
| `cloudSavedToEncryptedVault` | Saved to Encrypted Vault |

---

## 8. Bảng rủi ro (edge case & xử lý lỗi)

Mức: 🔴 Cao · 🟠 Trung bình · 🟢 Thấp · ❔ chưa rõ.
Nhóm giảm thiểu: **QW** quick win · **BE** cần BE xác nhận/phối hợp · **RF** refactor lớn.
Cột "Lane" là ID gốc trong báo cáo các lane.

### A. Báo "thành công" sai thời điểm

| ID | Rủi ro & kịch bản | Bằng chứng | Mức | Giảm thiểu | Lane |
|---|---|---|---|---|---|
| U1 | `process=1.0` + `status=success` ghi **trước khi HK trả 200** (progress tính theo byte đã gửi). Chunk cuối lỗi ⇒ status 3/4 nhưng `process` vẫn 1 ⇒ watcher đã tạo CloudFile + VN CreateFile cho file chưa có trên HK; row bị loại khỏi resume (`process<1`); lúc start `repairClobberedUploadStatus` còn đổi pause+process≥1 thành success | `upload_ext:569-581, 646-649, 683-686`; `in_process_chunk_uploader.dart:268-277, 309`; `cloud_background_transfer_client.dart:1281, 1306`; `file_cache_transfer_db.dart:89-120, 407, 531-533, 769-799, 805` | 🔴 | QW: chặn progress ở 0.99, chỉ nhánh 200 ghi 1.0 + success; nhánh lỗi reset `process`. RF: watcher lọc theo cờ "HK đã xác nhận" | R1-01, R2-01 |
| U2 | 2xx của range PUT không kiểm body (`errCode`, `data`); không có bước xác nhận cuối (`/upload/progress` Status==1) | `in_process_chunk_uploader.dart:283-285`; `cloud_background_transfer_client.dart:1454`; `cloud_storage_file_uploader.dart:120-136` | 🟠 | BE (Q7): xác nhận ngữ nghĩa 200; gọi kiểm cuối | R2-02 |
| U3 | UI báo "Upload completed / Saved to My Space" khi chỉ có CloudFile local; VN CreateFile lỗi không bao giờ đi lên UI. **Vi phạm BR-01** | `upload_progress_verify.dart:505-521, 615-622`; `upload_cubit.dart:101-123`; `cloud_sync_service.dart:114-135` | 🔴 | QW: completed chỉ khi có `remoteId`; trạng thái "Syncing…"; lỗi sync vào failed sheet | R3-01 |
| U4 | 3 định nghĩa "xong" trong một màn; nhãn giai đoạn cứng theo %, "Upload completed" ở mốc 50%; % trung bình không theo size; subscription `:92-114` setState mỗi tick mà không render gì. **Vi phạm BR-04** | `upload_progress_verify.dart:92-114, 175-310, 475, 580-583` | 🟢 | QW: một định nghĩa duy nhất; bỏ nhãn hoàn tất trước 100% | R3-11, R3-12 |

### B. Watcher tạo CloudFile

| ID | Rủi ro & kịch bản | Bằng chứng | Mức | Giảm thiểu | Lane |
|---|---|---|---|---|---|
| U5 | **Poison row:** folder đích bị xoá (kể cả từ thiết bị khác) trong lúc upload ⇒ `createFileHandler` throw "Parent folder not found" ⇒ `try` bọc cả vòng `for` ⇒ mọi row sau trong snapshot không được tạo CloudFile; lặp lại ở mọi emit **vô thời hạn**. HK đã có bytes (tính quota) nhưng không có VN record. Verify sheet kẹt N/N 100%; `failedFiles` có tính nhưng không render. Row có status 1 nên Transfer manager hiện "success" — có nút Delete nhưng user không có tín hiệu để xoá | `file_cache_transfer_db.dart:84-125`; `cloud_file_db.dart:250-261, 325-327`; `cloud_folder_db.dart:112-117`; `upload_cubit.dart:116-134`; `transfer_state.dart:92-99` | 🔴 | QW: try/catch từng row; fallback "File Restore"/root; đánh dấu row failed để hiện ở failed sheet | R1-02, R3-05 |
| U6 | **Hiệu năng:** mỗi lần ghi bảng transfer (mỗi tick 500ms/file) watcher `find()` toàn bảng + gửi mọi row qua SendPort (×2); chưa có listener thì snapshot bị buffer không giới hạn trên main isolate; `initConfig()` đăng ký lại watcher mỗi lần init không huỷ cũ; `asBroadcastStream()` không `onCancel` ⇒ mỗi lần mở verify sheet rò 3 watcher; không index `taskId`/`CloudFile.hash`; bảng transfer không bao giờ prune. Ước lượng N=500 ≈ 6–12MB/s bị copy | `file_cache_transfer_db.dart:41-48, 74-151`; `cloud_file_db.dart:92-99, 1655-1670`; `lib/app/db/db_thread_pool/db_thread_pool.dart:310-327, 479-495`; `stream_controller_pool.dart:33`; `cloud_storage_init_repository_impl.dart:128` | 🔴 | QW: huỷ watcher cũ; thêm `onCancel` (phía `data/db` cloud); query có điều kiện. RF: index + chính sách prune | R2-14, R2-15, R3-06, LA |
| U7 | `box.put(CloudFile)`, `put(folder)`, `putPublic(SyncTask)` là 3 transaction; `putPublic` nuốt lỗi; `fileHash` rỗng ⇒ không SyncTask. Lần sau watcher bỏ qua vì hash đã có ⇒ file không bao giờ lên VN | `cloud_file_db.dart:286-323, 309-312`; `sync_task_db.dart:108-123` | 🟢 | QW: một transaction; kiểm `fileHash` | R1-12 |
| U8 | Watcher không lọc platform ⇒ upload SocialFi (`isDisplay=false`) tạo CloudFile ở root + VN CreateFile; không hiện ở Transfer manager nên không dọn được qua UI. **Vi phạm BR-02** | `file_cache_transfer_db.dart:89-119`; `upload_ext:102`; `lib/features/socialfi/post/data/data_sources/media/social_media_storage_service_http_impl.dart:112-125` (chỉ đọc) | 🟠 | QW (phía CS): watcher chỉ xử lý `platform == cloud` | LA |
| U9 | `updateFileByTaskId` put cả entity ⇒ row đã xoá/huỷ sát 100% bị insert lại ⇒ CloudFile + CreateFile cho file user đã huỷ | `file_cache_transfer_db.dart:239-277`; `upload_ext:640-644` | 🟢 | QW: chỉ update khi row còn tồn tại | R1-14, R2-11 |

### C. Đồng bộ VN (SyncTask)

| ID | Rủi ro & kịch bản | Bằng chứng | Mức | Giảm thiểu | Lane |
|---|---|---|---|---|---|
| U10 | App bị kill khi đang gọi CreateFile (hoặc sau khi OK nhưng trước khi ghi remoteId) ⇒ SyncTask kẹt `sending` mãi | `cloud_sync_service.dart:107-108, 159-162, 220-223`; `sync_task_db.dart:27-37, 60-74` | 🟠 | QW: reset `sending` khi `start()` | R1-03 |
| U11 | Chỉ 2 lần thử; mọi lỗi (gRPC, del-sign HK) thành null, không phân loại; không UI nào đọc trạng thái sync; không có đối soát HK↔VN ⇒ orphan chỉ-HK (U5, U7, U10, U11) và chỉ-VN (U1, U12) | `cloud_sync_service.dart:51, 114-132, 207-217`; `file_service_repository_impl.dart:213-240` | 🟠 | BE + RF: backoff, phân loại lỗi, trạng thái lỗi ra UI, job đối soát | R1-04 |
| U12 | CreateFile trùng: response mất ⇒ null ⇒ retry, guard `getRemoteIdByHash` vẫn rỗng; `_processTasks` chạy song song mỗi emit | `cloud_sync_service.dart:81-104, 198-207` | 🟠 (phụ thuộc Q6) | BE: idempotent theo `uniqueHash`. QW: xử lý tuần tự | R1-05, R1-16 |
| U13 | Folder đích (root/system folder) chưa có `remoteId` ⇒ `folder_id` null hoặc `''`; `parentRemoteId` là snapshot không refresh | `cloud_folder_db.dart:180-205, 530-541`; `cloud_file_db.dart:320`; `cloud_sync_service.dart:178-180` | 🟢–🟠 | BE (Q5) | R1-11 |
| U14 | Đổi tài khoản khi task đang chờ retry 10s ⇒ task của A ghi vào store của B, xử lý bằng token B; hoặc xoá nhầm task của B trùng id | `cloud_sync_service.dart:114-142, 162, 264-270`; `lib/app/db/db_service.dart:33-50` | 🟢 khả năng / tác động cao (rò dữ liệu) | QW: huỷ vòng xử lý khi dispose; kiểm user trước khi ghi | R1-13 |
| U15 | Nếu HK trả `unique` theo nội dung (instant upload), hai CloudFile cùng `unique` ⇒ sync khớp nhầm, `remoteId` nhảy giữa hai file | `cloud_file_db.dart:1437-1454, 1572-1575` | ❔ | BE HK (Q13) | R1-15 |
| U16 | `createdAt = time` (giây) rồi bị ghi thành ms khi có remoteId; `totalFileToday` giả định giây | `cloud_file.dart:289`; `cloud_file_db.dart:368-374, 1288` | 🟢 | QW | R1-17 |

### D. Cửa sổ file chưa có remoteId

| ID | Rủi ro & kịch bản | Bằng chứng | Mức | Giảm thiểu | Lane |
|---|---|---|---|---|---|
| U17 | Không badge, mọi action vẫn bật và hỏng mỗi kiểu: **Delete** gửi `remoteIds=['']` ⇒ CreateFile vẫn chạy ⇒ file bật ra khỏi thùng rác (hard delete ⇒ orphan VN); **Move** gửi `ids=['']`, SyncTask giữ parent cũ ⇒ file nhảy về chỗ cũ; **Rename / chuyển Privacy** chỉ local ⇒ server ghi đè, file privacy có thể nằm ở space thường trên VN; **Favorite** sao bật rồi tắt, mất khi sync; **Share** bỏ qua âm thầm; **Link** `remoteId!` ⇒ toast lỗi chung; **Chọn nhiều** không phản hồi | `cloud_my_file_repository_impl.dart:378-412, 469-478, 625-638, 709-718`; `cloud_privacy_repository_impl.dart:236-246`; `cloud_file_db.dart:1353-1380, 1556, 1566, 1589-1598`; `transponder/cloud_share_transponder_impl.dart:198`; `shared/presentation/controllers/select_all_controller.dart:77-91, 160-174`; `sheet_helper.dart:1225-1283` | 🔴 | QW: badge "Syncing…" + khoá action + giải thích. RF: hàng đợi ý định, phát lại sau CreateFile | R1-06..10, R3-19 |

### E. Thực thi upload phía HK

| ID | Rủi ro & kịch bản | Bằng chứng | Mức | Giảm thiểu | Lane |
|---|---|---|---|---|---|
| U18 | Init dùng lock toàn cục, không timeout, mã hoá cả file ⇒ file lớn chặn mọi file sau (kể cả SocialFi); SDK treo ⇒ không upload được cho tới khi restart | `cloud_storage_file_uploader.dart:220-302` | 🟠 | QW: timeout + giải phóng lock | R2-10 |
| U19 | Init trả `status=3` / Err 3009 (hết dung lượng) / 3010 (quá kích thước) mà vẫn upload; mã lỗi không lên UI | `upload_ext:462-516`; `cloud_storage_upload_init_handler.dart:109-124`; `shared/utils/storage_space_utils.dart:16-33` | 🟠 | BE (Q8). QW: dừng sau init, sheet "Not enough storage" | R2-03 |
| U20 | Resume: `getUploadProgress` lỗi tạm thời (null) hoặc `Missing` null ⇒ DELETE + init lại từ đầu; bỏ qua `data.Status` | `upload_ext:360-396`; `cloud_storage_file_uploader.dart:139-169` | 🟠 | QW: xét `data.Status`, không DELETE khi lỗi mạng (Q9) | R2-05 |
| U21 | Task kẹt "waiting" vĩnh viễn: (a) file scratch mất khi resume ⇒ exception trước `try`, `catchError` không ghi DB, Live Activity không untrack; (b) `_uploadFileExt` lỗi trước khi có row ⇒ trả `{}`, widget comment ":141 failed upload lands in DB" sai | `cloud_background_transfer_client.dart:840 vs 942`; `upload_ext:28-147, 715-728`; `upload_progress_verify.dart:139-142` | 🟠 | QW: mọi nhánh lỗi ghi status 3 | R2-06, R3-04 |
| U22 | Đã 200 nhưng không ghi được trạng thái cuối (exception trong `.then` / kill) ⇒ HK có file, row pause. Lúc start, row dở bị set pause và không tự resume (chỉ resume khi có network event, bỏ qua pause). iOS nền: không nhận biết "đã xong khi app chết", chunk mồ côi chạy song song với resume | `upload_ext:616-645`; `file_cache_transfer_db.dart:801-823`; `cloud_storage_services_impl.dart:257-273, 349-367, 719-749`; `cloud_background_transfer_client.dart:496-498, 626-628` | 🟠 | QW: tự resume khi startup | R2-07, R2-08, LA |
| U23 | Khoảng giữa init trả về và lúc persist `unique`/`infoData` (đang copy file lớn) bị kill ⇒ init lại, record trùng trên HK, có thể tính quota 2 lần | `upload_ext:462-488, 866-887` | 🟢 | QW: persist trước khi copy | R2-04 |
| U24 | Hai upload cùng nội dung song song: staging/`out_path` SDK theo hash nội dung; task 1 xong xoá scratch task 2 đang đọc | `cloud_storage_file_uploader.dart:209-218`; `upload_ext:651, 832-843` | 🟠 | QW: tuần tự theo `fileHash` | R2-09 |
| U25 | Tốn đĩa 3–4× size file; `_safeMoveFile` copy rồi xoá nguồn ⇒ có thể xoá file gốc nếu path picker ngoài sandbox (Q11) | `upload_ext:478-483, 866-887`; `cloud_storage_services_impl.dart:840-866` | 🟠 | Dev xác nhận Q11; không xoá nguồn ngoài sandbox | R2-12 |
| U26 | `pwd` file plaintext trong transfer row, `infoData` và payload SyncTask | `file_cache_transfer_entity.dart:482`; `cloud_file_db.dart:319` | 🟠 (bảo mật) | QW: không lưu hoặc mã hoá | LA, R2 |

### F. UI & vòng đời màn hình

| ID | Rủi ro & kịch bản | Bằng chứng | Mức | Giảm thiểu | Lane |
|---|---|---|---|---|---|
| U27 | Folder list/Home không đọc CloudFile local mà refetch ES khi có event; lúc CloudFile tạo ES chưa có, lúc ghi remoteId ES có thể chưa index, sau đó không còn trigger ⇒ file "biến mất", user upload lại (trùng). Refetch lỗi ⇒ `listData: []` thay cả danh sách | `my_file_cubit.dart:113-136, 248-304`; `cloud_my_file_repository_impl.dart:279-314`; `home_cubit.dart:115-142` | 🟠–🔴 | BE (Q19). QW: giữ list cũ khi lỗi; hiển thị item pending local | R3-02, R3-03 |
| U28 | Sau "Background" không có phản hồi kết thúc: `isDisplayNotification:false`, `UploadsListListener` bị comment (`cloud_home_page.dart:414`, commit 97c03669); nếu bật lại thì `return` sớm ở `uploads_list_page.dart:150` chặn toast failed/completed và `BlocSelector` không rebuild. **Vi phạm BR-03** | `upload_progress_verify.dart:160, 627`; `uploads_list_page.dart:150, 172-188` | 🟠–🔴 | QW: sửa logic toast rồi bật lại listener | R3-09, R3-21 |
| U29 | `UploadCubit` `@lazySingleton`: batch mới `init()` xoá theo dõi batch cũ (lỗi batch cũ biến mất khỏi verify & Upload list); `_subConnection` ghi đè không cancel | `upload_cubit.dart:19-21, 39-63, 80-90` | 🟠 | QW: cubit theo màn hình hoặc gộp batch | R3-08 |
| U30 | Subscription gán sau `dispose` (await nén thumbnail); `Future.wait` kéo dài suốt transfer giữ `State` sau khi pop, log lỗi nhiễu khi task bị huỷ; map `progresses` sửa tại chỗ, chỉ cập nhật nhờ setState gián tiếp | `upload_progress_verify.dart:73-133, 163-172, 195-200`; `upload_cubit.dart:156-167, 224-229`; `data/task_queue/task_queue.dart:65-91, 148-183` | 🟢–🟠 | QW | R3-07, R3-10, R3-20 |
| U31 | Crash `listFiles.first.createdAt!` khi danh sách rỗng: huỷ picker trong preview ⇒ `listFile = []`, nút Upload vẫn bật. *Giả thuyết, cần thử trên máy* | `preview_before_upload.dart:50, 60`; `select_file_utils.dart:161-166`; `bottom_sheet_extension.dart:858-865`; `upload_progress_verify.dart:475` | 🔴 tác động / chưa xác nhận | QW: guard rỗng, disable nút | R3-13 |
| U32 | Double-tap Upload / chọn lại cùng file ⇒ UUID mới mỗi lần, upload trùng | `upload_progress_verify.dart:61-69`; `bottom_sheet_extension.dart:862-865` | 🟢 | QW: debounce | R3-14 |
| U33 | Privacy/Encrypted vẫn hiện "Saved to My Space"; kiểm `pwd` và `checkBeforeUpload` chỉ trong callback sheet; route verify public nhận `dynamic`. **Vi phạm BR-05** | `upload_progress_verify.dart:515`; `sheet_helper.dart:996, 1041-1049`; `cloud_storage_navigator.dart:259-267` | 🟢 | QW: câu theo đích; guard route | R3-15 |

### G. Kiến trúc

| ID | Rủi ro & kịch bản | Bằng chứng | Mức | Giảm thiểu | Lane |
|---|---|---|---|---|---|
| U34 | Không use case upload; widget `getIt` data service/DB; cubit `getIt`; data import `go_router`/`model_view`. Nghiệp vụ "HK xong → tạo file → xếp hàng VN" nằm trong DB watcher ở isolate (không DI, không thêm được quota/analytics/thông báo, không unit test được). Mọi vi phạm đã baseline (`lib/features/cloud_storage/tool/layer_baseline.txt:336-341, 357, 433-448, 478-485`); `check_layers --summary`: TOTAL 507, không có vi phạm mới | `upload_progress_verify.dart:15-16, 92, 149`; `upload_cubit.dart:10-12, 23-26`; `cloud_sync_service.dart:12`; `file_cache_transfer_db.dart:74-129` | 🟠 (nợ kỹ thuật) | RF: `UploadFileUseCase` + repository interface ở domain; đưa bước tạo CloudFile ra khỏi watcher | R3-16..18, LA |
| U35 | `docs/upload_flow.md` lỗi thời: không có watcher, SyncTask, VN CreateFile; tên method cũ | `docs/upload_flow.md:22, 37, 130-167` | 🟢 | QW: cập nhật theo §4 | LA |

**Ưu tiên xử lý trước:** U1, U3, U5, U6, U17, U31 (Cao; phần lớn có hướng QW).

---

## 9. Acceptance criteria (cho việc giảm thiểu sau này)

- **AC-01 (BR-01, U3)** Given upload đã xong phía HK nhưng VN chưa trả `id`, When verify sheet hiển thị, Then không hiện "Upload completed", file ở trạng thái "Syncing…".
- **AC-02 (BR-01, U3, U11)** Given SyncTask đã hết retry, When user mở verify sheet / Upload list, Then file hiện ở danh sách lỗi với Retry/Delete.
- **AC-03 (U1)** Given byte cuối đã gửi nhưng HK trả lỗi, When transfer kết thúc, Then `process < 1`, status failed, không có CloudFile/SyncTask nào được tạo.
- **AC-04 (U5)** Given folder đích bị xoá trong lúc upload, When transfer đạt 200, Then file được tạo ở folder fallback (theo quyết định sau này) và các upload khác trong cùng snapshot vẫn được tạo CloudFile.
- **AC-05 (U17)** Given CloudFile chưa có `remoteId`, When user mở menu file, Then các action cần `remoteId` bị khoá và có giải thích.
- **AC-06 (BR-02, U8)** Given upload `platform = socialFi` đạt `process = 1`, When watcher chạy, Then không có CloudFile và không có SyncTask được tạo.
- **AC-07 (BR-03, U28)** Given user bấm "Background", When upload kết thúc (thành công hoặc lỗi), Then có toast tương ứng.
- **AC-08 (U6)** Given bảng transfer có N row và một upload đang chạy, When đóng/mở verify sheet nhiều lần, Then số watcher hoạt động trong DB isolate không tăng.
- **AC-09 (BR-05, U33)** Given đích là Privacy Space, When upload xong, Then câu thông báo là "Saved to Privacy Space".
- **AC-10 (U31)** Given danh sách file rỗng, When ở màn preview, Then nút Upload bị disable và không crash.

---

## 10. Test case (tái hiện rủi ro)

| TC | Loại | Bước | Kết quả hiện tại (as-is) | Liên quan |
|---|---|---|---|---|
| TC-01 | negative | Upload file 1 chunk; chặn mạng ngay sau khi gửi xong body, trước response | CloudFile + VN record có, row failed `process=1`, UI "Saved" | U1 |
| TC-02 | negative | Mock VN CreateFile trả lỗi 3 lần | UI vẫn "Upload completed"; file không có ở folder list; không thông báo | U3, U11 |
| TC-03 | edge | Upload vào folder F; trong lúc upload xoá F từ thiết bị khác; rồi upload thêm 1 file vào root | Cả hai file không có CloudFile; sheet kẹt N/N 100% | U5 |
| TC-04 | edge | Ngay sau "completed", xoá file vào thùng rác; chờ sync | File bật ra khỏi thùng rác | U17 |
| TC-05 | edge | Ngay sau "completed", rename file; mở lại folder | Tên bị revert | U17 |
| TC-06 | edge | Upload vào Privacy Space, chuyển file khác sang privacy trước khi có remoteId | File nằm ở space thường trên VN | U17 |
| TC-07 | perf | DB có 3.000 row transfer; upload 3 file lớn; đo RAM/CPU (DevTools) khi Transfer page không mở | RAM tăng tuyến tính | U6 |
| TC-08 | perf | Mở/đóng verify sheet 10 lần; log `_cleanupWatch` | Watcher không được dọn | U6 |
| TC-09 | edge | Kill app trong lúc CloudSyncService đang gọi CreateFile; mở lại | SyncTask kẹt `sending`, file không có remoteId mãi | U10 |
| TC-10 | edge | Logout/login tài khoản khác trong 10s sau khi CreateFile lỗi | Task của A xuất hiện trong store B | U14 |
| TC-11 | negative | Upload khi quota gần đầy | Upload chạy hết rồi mới lỗi chung | U19 |
| TC-12 | edge | Upload file lớn, bật/tắt mạng liên tục | Tiến độ reset về 0 | U20 |
| TC-13 | edge | Pause upload, xoá cache app, resume | Row kẹt waiting | U21 |
| TC-14 | edge | Chọn cùng một file 2 lần trong một batch | Một task fail hoặc dữ liệu sai | U24 |
| TC-15 | negative | Preview → thêm file → huỷ picker → Upload | Nghi crash `StateError` | U31 |
| TC-16 | happy | Upload → "Background" → chờ xong | Không có thông báo nào | U28 |
| TC-17 | edge | Upload SocialFi post có media | CloudFile lạ ở root, VN CreateFile platform socialFi | U8 |
| TC-18 | happy | Upload 1 file bình thường, mở folder ngay | File chưa hiện cho tới khi ES index | U27 |

---

## 11. Quyết định đã chốt & giả định đã xác nhận

| Q | Câu trả lời |
|---|---|
| Q1 | Mục tiêu: phân tích rủi ro, không refactor, không đổi hành vi |
| Q2 | Phạm vi: chỉ entry `UploadProgressVerify` |
| Q3 | Có kèm hướng giảm thiểu (ý tưởng, không phải quyết định) + nhóm QW/BE/RF |
| Q4 | SocialFi đi qua watcher là bug (BR-02) |
| Q16 | "Hoàn tất" = VN có `remoteId` (BR-01) |
| Q18 | `UploadsListListener` bị comment là tạm thời (BR-03) |
| Q21 | Nhãn giai đoạn là trang trí, không hiện hoàn tất trước 100% (mặc định, BR-04) |
| Q23 | Câu thông báo theo đích lưu (mặc định, BR-05) |
| Q26 | Tắt system notification là cố ý (mặc định, BR-06) |

Giả định chưa kiểm chứng runtime (đánh dấu trong bảng rủi ro):
- A-1 `asBroadcastStream()` không `onCancel` không huỷ stream gốc (U6).
- A-2 Mỗi row transfer ~1–2KB khi serialize (con số ước lượng U6).
- A-3 SDK đặt `out_path` theo hash nội dung (U24).
- A-4 `query.find()` trả theo id tăng dần ⇒ row mới đứng sau poison row (U5).
- A-5 Folder list đi qua `syncFilesByRemoteId` khi mở folder (giảm thiểu một phần U10/U12, revert ở U17).
- A-6 Huỷ picker trong preview để lại danh sách rỗng mà vẫn bấm Upload được (U31).

---

## 12. Việc còn mở — cần BE / dev / design xác nhận

| # | Ai | Câu hỏi | Ảnh hưởng |
|---|---|---|---|
| Q5 | BE VN | CreateFile với `folderId` rỗng/null: vào root hay lỗi? | U13 |
| Q6 | BE VN | CreateFile có idempotent theo `uniqueHash`/`fileHash`? | U12 |
| Q12 | BE VN | DeleteFiles/MoveFiles với `ids` chứa `''`: từ chối cả batch hay bỏ qua? | U17 |
| Q14 | BE VN | CreateFile vào folder favorite / trùng tên: VN tự xử lý hay từ chối? | U17 |
| Q19 | BE VN | ES index sau CreateFile mất bao lâu? Có event WS khi searchable? | U27 |
| Q7 | BE HK | Range PUT 200 có đảm bảo file đã hoàn tất? Có 2xx kèm `errCode≠0`? | U1, U2 |
| Q8 | BE HK | SDK báo 3009/3010 bằng `code 500` hay `200 + data.status=3/err`? | U19 |
| Q9 | BE HK | API progress khi đã xong trả `Missing` null hay `[]`? DELETE `/upload/cancel` trên upload đã xong có xoá nội dung / hoàn quota? | U20 |
| Q10 | BE HK | TTL của `unique`/`sign`; pause nhiều ngày còn resume được? | U22 |
| Q13 | BE HK | `unique` duy nhất theo lần upload hay theo nội dung? | U15 |
| Q25 | BE HK / dev | `cancelUploadByTaskId(isDelete: true)` trên upload đã xong có xoá object HK? | U5 (dọn poison row) |
| Q11 | Dev | Path từ picker có luôn là bản copy trong sandbox? | U25 |
| — | Dev | Xác nhận runtime A-1 (rò watcher) và A-6 (crash U31) | U6, U31 |
| — | Dev | Sửa rò watcher nên làm ở `data/db` của cloud hay ở `lib/app/db` (ngoài scope CS/MB)? | U6 |

Các quyết định thiết kế cho phần giảm thiểu (fallback folder khi parent bị xoá, chặn hay xếp hàng action khi chưa có remoteId, chính sách prune bảng transfer, tự resume khi startup, dedupe cùng nội dung) **chưa chốt** — sẽ quyết ở bước `/agents-plan`.
