# Chunk upload — App báo "Upload failed" dù server đã nhận đủ file

> Bắt đầu điều tra: 2026-10-09 · Cập nhật lần cuối: 2026-10-12
> Branch: `felix/cloud_upgrade/my_subscription` — số dòng code đúng tại thời điểm cập nhật
> Phạm vi: `lib/features/cloud_storage/` + plugin `background_downloader` (fork `background_downloader-9.5.2-fork.5`, repo `tbchat_packages`)
> Nền tảng: Android (`com.tbchatdev.io.debug`, emulator MuMu). Có thể chỉ xảy ra trên Android — chưa xác nhận.

**Trạng thái:** 🟡 Đã xác định cơ chế lỗi phía app và đã có lưới an toàn (mục 5) · Gốc phía plugin đang chờ logcat / A/B test (mục 4, 9)

Đường dẫn code tính từ `lib/features/cloud_storage/` nếu không ghi khác.

---

## 1. Tóm tắt

- **Triệu chứng:** upload → UI báo *Failed to upload*, nhưng server đã nhận đủ và ghép file thành công.
- **Đã xác nhận (log + BE):** app tự kết luận `failed` từ kết quả từng chunk ở client. 1 chunk bị plugin báo lỗi ⇒ cả file bị ghi `status = 3`, **không hỏi lại server**. Bytes của chunk "lỗi" thực tế đã tới server.
- **Gốc đang nghi:** trên Android, plugin báo chunk lỗi khi **worker WorkManager bị dừng** nhưng **không huỷ request đang gửi** (mục 2.2). Đồng nghiệp đề xuất nguyên nhân do **áp dụng HTTP3** — có cơ sở, chưa chứng minh (mục 4).
- **Phạm vi:** không phải file nào cũng bị; file lớn bị nhiều hơn nhưng file nhỏ (vài trăm KB, 1 chunk) cũng có lúc bị ⇒ sự cố xảy ra **theo từng request**, không phụ thuộc kích thước file.
- **Hệ quả phụ:** người dùng bấm Thử lại ⇒ init lại ⇒ instant upload tạo bản ghi thứ 2 ⇒ **quota bị tính 2 lần**.
- **Lưu ý khi đọc log:** `cloud_storage_logs.txt` có thể mất dòng (mục 7.1) ⇒ số đếm trong log là tối thiểu.

## 2. Cơ chế lỗi

### 2.1 Phía app — chuỗi quyết định `failed`

| # | Bước | Vị trí |
|---|---|---|
| 1 | Plugin báo chunk kết thúc lỗi ⇒ log `failed for good`, đưa vào `failures` | `data/services/cloud_background_transfer_client.dart:1342-1351` |
| 2 | Chờ tất cả chunk; 1 chunk lỗi ⇒ cả file lỗi (`failures.first`) | `cloud_background_transfer_client.dart:1416, 1424-1426` |
| 3 | Lỗi không có HTTP code ⇒ app gán **500** (không phải server trả) | `cloud_background_transfer_client.dart:1874` |
| 4 | `statusCode != 200` ⇒ log `Upload failed: …` ⇒ ghi DB `failed` | `data/services/mixins/cloud_storage_upload_ext.dart:720, 739` |
| 5 | UI: `status == 3` ⇒ "Failed to upload" | `pages/uploads_list_page/cubit/upload_cubit.dart:194` |

`status = 3` là enum local (`StorageUploadStatusEnum.failed`), chỉ do code app ghi — server / WebSocket không trả trạng thái này.

### 2.2 Phía plugin (Android) — vì sao chunk bị báo lỗi

Plugin dùng WorkManager 2.11.0 + Cronet 141. Đường dẫn tính trong package: `android/src/main/kotlin/com/bbflight/background_downloader/`.

| # | Sự thật trong code | Vị trí |
|---|---|---|
| 1 | Mỗi chunk = 1 WorkManager `CoroutineWorker`, ràng buộc mạng `NetworkType.CONNECTED`, chạy nền (không foreground, app không cấu hình `Config.runInForeground`) | `BDPlugin.kt:228-230`; `TaskWorker.kt:19-22` |
| 2 | Log `TaskException:` (rỗng) chỉ sinh ra ở **1 chỗ**: task `failed` mà không ghi exception nào | `TaskRunner.kt:226-227` |
| 3 | Lỗi mạng / IO / HTTP / huỷ coroutine đều có mô tả ⇒ chunk lỗi trong log **không phải lỗi mạng hay lỗi HTTP thông thường** | `TaskRunner.kt:615-618, 937-946`; `UploadTaskRunner.kt:73-76` |
| 4 | Đường `failed` không exception còn lại: worker bị **WorkManager dừng** (`isStopped`, log `Task <id> stopped`). Pause (app không pause upload) và timeout 9 phút (lỗi xảy ra sau 1–2 phút) đã loại | `TaskRunner.kt:792-803`; `UploadTaskRunner.kt:85-87` |
| 5 | Comment của plugin: WorkManager dừng job khi ràng buộc bị vi phạm (vd mất mạng) | `TaskRunner.kt:263-271` |
| 6 | Khi task `failed`, plugin **không `disconnect()`** request ⇒ bytes đã đẩy cho Cronet vẫn có thể tới server | `TaskRunner.kt:571-686` |
| 7 | Từ commit `cf15101f` (23/09), **mọi chunk đi Cronet**: h3 khi bật HTTP3, h2 khi tắt (trước đó dùng kết nối mặc định của hệ thống) | `cloud_background_transfer_client.dart:74-77` |

Khớp với dấu hiệu trong log: nhiều chunk lỗi **cùng lúc** (4 chunk trong ~70ms); app không thấy `Network disconnected` vì `connectivity_plus` không theo dõi trạng thái "validated" mà ràng buộc `CONNECTED` dựa vào.

### 2.3 1 chunk lỗi ≠ server thiếu chunk đó

| | Server nhận | Sau đó |
|---|---|---|
| A. Bytes thật sự không tới | Thiếu đúng phần đó; phiên còn mở | Thử lại ⇒ resume chỉ gửi phần thiếu |
| B. Bytes đã tới, app không nhận được xác nhận | **Đủ file**, server ghép xong và xoá phiên | App vẫn ghi `failed` ⇒ **bug này**; lần retry chunk nhận 404 |

Progress không về 0 khi chunk lỗi hẳn ⇒ cả 2 case đều đạt **98%** dù nhiều chunk lỗi ⇒ chunk "lỗi" đã đẩy gần hết bytes ở lần thử cuối.

## 3. Bằng chứng

Giờ log: `cloud_storage_logs.txt` = UTC+7; `storagelog.txt` / `log.txt` (SDK) = UTC.

### 3.1 Case 1 — APK 431MB · 2026-10-09 11:05–11:11

Task `0e0c6a3f-1ec4-4b64-a047-fa1c7a2ed938` · hash `2WqJEfCPeEzqHnu7RcPLAyxTnvRqCASFo9725fu3BPCx` · net_id `3dEDEreLLjGNT93rhKy4oV1bKqXvePGoDYhBjfYZKb4s` · `node5.17qpb.com:3365` (log gốc đã bị ghi đè, không tra lại được số dòng)

| Giờ | Sự kiện |
|---|---|
| 11:05:23 | Init `status: 2` (server chưa có file), unique `FamjwD5tErUmasnpB3gLbN8WK1d8dLiTmY6r6X1pWUbg` |
| 11:05:25 | 52 chunk × 8MB |
| 11:05:43 → 11:09:38 | ≥ 42 `waitingToRetry`; **≥ 13 chunk** `failed for good … TaskException:` (rỗng) |
| 11:09:38 | Progress 98% ⇒ `Upload failed: statusCode: 500` ⇒ DB `failed` |
| 11:10:58 | Chạy lại cùng task: `GET upload/progress` lỗi; `DELETE upload/cancel` → 404 `{"errCode":20102,"message":"the upload task does not exist"}` |
| 11:11:10 | Init lại → **`status: 1`** (server đã có đủ file), unique mới `BUSG7…` ⇒ success |
| 11:11:11 | `usedBytes` 0 → **862,534,270 = 2 × 431,267,135** (tính quota 2 lần) |

### 3.2 Case 2 — MuMuSharedFolder.rar 204MB · 2026-10-09 16:33–16:36

Task `3c6e5dc9-097f-4aa2-9c91-1008a152520f` · net_id `BTCQiuKYPz8cPUXEJNESngDU5BuJGaahyJTiwyoahtgE` · unique `7EruMYGCvdHJxamdx5buRwz5xYie56VamwhhSkwrte3F` · `node9.17qpb.com:3365`

- 26 chunk × 8MB; ≥ 20 `waitingToRetry`; 5–6 chunk `failed for good` (4 `TaskException:` rỗng + 1 bị ghi đè trong log).
- Chunk `201326592-209715199`: lần 1 lỗi, **lần 2 server trả 404** ⇒ phiên đã đóng ⇒ server đã nhận đủ.
- Progress 98% ⇒ `Upload failed: statusCode: 500` (thông tin 404 bị mất).
- Log có `Holding queue: 4 chunk(s) in flight per file` ⇒ **HTTP3 đang bật**.

### 3.3 Xác nhận khác

- **BE (2026-10-12):** app báo chunk fail trong khi server báo upload success.
- **Console (2026-10-12):** `GET upload/progress` → `404 {"errCode":20102,"message":"the upload task does not exist"}` ⇒ server xoá task khi xong, không còn hỏi được `Status: 1`.
- **Bug 6107 (log 21/09, trước `cf15101f`, `Holding queue: unlimited`):** lỗi upload lúc đó là lỗi thật — server thiếu byte, Thử lại resume đúng phần thiếu. Không thấy kiểu "server đủ mà app báo failed".

## 4. Giả thuyết

| ID | Giả thuyết | Trạng thái | Căn cứ / cần gì |
|---|---|---|---|
| H1 | Chunk bị app báo lỗi dù bytes đã tới server; app ghi `failed` không đối chiếu | ✅ Xác nhận | Case 1, case 2, BE |
| H1a | Chunk lỗi vì **WorkManager dừng worker** (ràng buộc `CONNECTED`, mạng chập chờn / mất "validated"), plugin không huỷ request | 🟡 Thu hẹp bằng code | Mục 2.2. Cần logcat thấy `Task <id> stopped` |
| H1b | Retry chunk nhận 404 = server đã nhận đủ và đóng phiên | 🟡 Rất có thể | Case 2; console 404 `20102`. Cần BE xác nhận (BE-1) |
| H4 | **Do áp dụng HTTP3** (đồng nghiệp đề xuất) | 🟡 Có cơ sở, chưa chứng minh | Mọi lần tái hiện đều bật HTTP3 (`.env.dev` / `.env.test` `ENABLE_HTTP3=true`; preprod / prod `false`); trước `cf15101f` chỉ thấy lỗi thật. Chưa có A/B test, chỉ 1 mẫu trước HTTP3 (khác máy). Lưu ý: tắt HTTP3 bằng toggle **vẫn đi Cronet h2**, không quay về transport cũ |

**Môi trường test là emulator MuMu** (mạng ảo dễ chập chờn) ⇒ có thể khuếch đại lỗi. Cần tái hiện trên máy thật.

## 5. Đã sửa — lưới an toàn phía app (2026-10-12)

Xử lý hậu quả, không cần BE. Khi transfer báo lỗi (khác 200 / 0), app hỏi lại server trước khi ghi `failed`:

| Server trả lời | App làm |
|---|---|
| `GET upload/progress` → `Status: 1` | success |
| Còn `Missing` / `Status: 3` | `failed` như cũ |
| Không còn phiên (404 `20102`) + `check_hash(file_hash)` 200 + lúc bắt đầu server chưa có file (init `status: 2`, hoặc resume hỏi `check_hash` → 404) | **success** |
| Còn lại (mạng lỗi, `check_hash` 404…) | `failed` như cũ |

| File:dòng | Thay đổi |
|---|---|
| `data/services/transfer_api/transfer_api.dart` | Path `checkHash` (`/api/v1/file/check_hash/:fileHash`) |
| `data/services/cloud_storage_file_uploader.dart:211` | `checkFileHashExists` → `true` / `false` / `null`; 404 không log ERROR |
| `cloud_storage_upload_ext.dart:354, 406, 478` | `fileAbsentAtStart` |
| `cloud_storage_upload_ext.dart:659-680` | Nhánh lỗi sau transfer: đối chiếu theo bảng trên; chỉ success khi bản ghi còn tồn tại |
| `cloud_storage_upload_ext.dart:908, 963, 991` | `_isUploadCompleteOnServer`, `_fileAppearedDuringUpload`, `_isFileAbsentOnNode` |
| `cloud_storage_upload_ext.dart:381` | Nhánh Thử lại: chỉ kiểm tra `Status: 1` (không dùng `check_hash` vì khoảng cách thời gian có thể dài) |

`dart analyze` sạch; `check_layers --summary`: No new violations. Chưa test trên thiết bị; không có test tự động (hàm private trong `part` file).

Rủi ro còn lại: báo success sai chỉ khi người khác upload đúng file đó trong đúng vài phút đó **và** phiên của mình hỏng phía server. Upload đã bị báo failed sai **trước** bản sửa: Thử lại vẫn tính quota 2 lần.

## 6. Hướng sửa gốc (chọn sau logcat / A/B test)

| # | Hướng | Sửa ở đâu | Khi nào chọn |
|---|---|---|---|
| R1 | Bỏ ràng buộc `CONNECTED` cho chunk upload | Plugin fork (`BDPlugin.kt:228-230`) | Logcat thấy `Task … stopped` do mạng |
| R2 | Worker bị dừng ⇒ huỷ hẳn request (`disconnect()`) | Plugin fork (`TaskRunner.kt`) | Đi kèm R1 |
| R3 | Android khi app đang mở: upload in-process (Dart `HttpClient`, không qua WorkManager) như iOS | App (`cloud_background_transfer_client.dart:929`) | Không được sửa plugin |
| R5 | Không dùng Cronet / HTTP3 cho chunk upload (quay về transport mặc định) | App (`cloud_background_transfer_client.dart:74-77`) | A/B test xác nhận H4 |
| R4 | Giới hạn số chunk chạy song song trên Android | App (`cloud_background_transfer_client.dart:235-239`) | Giảm thiệt hại, không xử lý gốc |

## 7. Bug phụ tìm được

1. **Log mất dòng** — `shared/utils/cloud_logger.dart`: ghi file không `await` (`:359, 379, 401, 460`), `writeAsString(mode: append)` (`:288`) ⇒ các entry ghi cùng lúc đè lên nhau.
2. **Quota tính 2 lần khi Thử lại** — nhánh resume không còn phiên ⇒ cancel (404) ⇒ init lại ⇒ instant upload tạo bản ghi thứ 2 (`cloud_storage_upload_ext.dart:381-420, 531`). Bản ghi `FamjwD5…` (case 1) đang chiếm 431MB quota.
3. **Mất thông tin 404** — chỉ lấy `failures.first` (`cloud_background_transfer_client.dart:1424-1426`).
4. **Log "after N attempt(s)" sai** — dùng hằng số (`:1343-1346`), trong khi `notFound` không retry.
5. **`_pauseAllActiveTransfers`** (`data/services/cloud_storage_services_impl.dart:634-710`) — tìm record native bằng taskId của file (record thật theo chunk) ⇒ luôn cancel + ghi `failed`; có thể đè `success` của upload vừa xong. Chưa thấy là nguyên nhân của bug này.

## 8. Ai liên quan (theo git log)

| Phần | Vai trò trong bug | Người đã sửa | Cần trao đổi |
|---|---|---|---|
| Plugin fork `tbchat_packages/background_downloader` (Android) | Gốc nghi ngờ: báo chunk lỗi khi worker bị dừng, không huỷ request; Cronet / HTTP3 transport | David (06/2026); mobilenexsoft (Cronet / HTTP3, 17/09) | Mục 2.2 + logcat; R1 / R2 |
| `cloud_background_transfer_client.dart` | Mọi chunk enqueue cùng lúc, không giới hạn (`72471faa`, 10/09); mọi chunk đi Cronet (`cf15101f`, 23/09); 1 chunk lỗi ⇒ cả file lỗi | Victor_Tran, ThanhNguyen, mobilenexsoft | H4; R3 / R4 / R5 |
| `cloud_storage_upload_ext.dart`, `cloud_logger.dart` | Ghi `failed` không đối chiếu (đã có lưới an toàn); log mất dòng | Victor_Tran | Review mục 5; bug phụ 7.1 |
| Storage node — HK BE | Không phải nguyên nhân; xoá task khi xong | HK BE | BE-1, BE-2 |
| QA | Test trên emulator MuMu | Tester | Máy thật, logcat, A/B test |

## 9. Việc còn mở

**Cần BE**
- [ ] **BE-1** — `PUT upload/range` và `GET upload/progress` trả 404 / `20102` có phải chỉ khi phiên đã hoàn tất không?
- [ ] **BE-2** — Dọn bản ghi mồ côi `FamjwD5tErUmasnpB3gLbN8WK1d8dLiTmY6r6X1pWUbg` (net_id `3dEDEre…`) đang chiếm 431MB quota.
- [ ] **BE-3** — "1 chunk fail" BE thấy là upload nào? (case 1 unique `FamjwD5…`, case 2 unique `7EruMYGC…`)

**Phía app / QA**
- [ ] **Logcat lúc tái hiện:** `adb logcat -v time TaskRunner:V BackgroundDownloader:V NetworkMonitor:V ConnectivityService:V *:S`. Thấy `Task <taskId>_<offset> stopped` ⇒ H1a đúng. Xem thêm dòng `[HTTP_METRICS]` của chunk lỗi: `negotiatedProtocol` (h3/h2), `requestBytes`, `error` (`ERR_QUIC_…` ⇒ do QUIC; rỗng ⇒ request thành công nhưng plugin vẫn báo lỗi).
- [ ] **A/B test H4** — cùng máy, cùng file ≥ 200MB, mỗi cấu hình vài lần: (1) HTTP3 bật; (2) HTTP3 tắt bằng toggle debug (vẫn Cronet h2); (3) transport mặc định như trước `cf15101f`. Chỉ (1) lỗi ⇒ QUIC; (1)+(2) lỗi, (3) không ⇒ Cronet; cả 3 lỗi ⇒ không phải HTTP3.
- [ ] Hỏi QA: bản preprod / prod (`ENABLE_HTTP3=false`) có gặp bug không.
- [ ] Tái hiện trên **máy Android thật**; thử thêm trên iOS với file lớn.
- [ ] **Test lưới an toàn (mục 5)** trên Android: log có `CloudUpload: reconcile … no session` → `check_hash attempt 1/3: true` → `… finishing as success`; UI thành công; `usedBytes` tăng 1 lần.
- [ ] Khi file nhỏ (1 chunk) bị lỗi: lưu log ngay — dự đoán thấy `waitingToRetry` → `failed for good … notFound http=404` → `Upload failed: statusCode: 404`.
- [ ] Lưu bản copy log mỗi lần tái hiện (log trên Desktop từng bị ghi đè).
- [ ] Sửa bug phụ 7.1 (logger) trước lần tái hiện tiếp theo; 7.3–7.5 làm sau.

## 10. Nhật ký

- **2026-10-09** — Đọc luồng upload; phân tích log case 1 ⇒ xác nhận H1, phát hiện quota tính 2 lần. Log trên Desktop bị thay bằng case 2 lúc 16:37.
- **2026-10-12** — BE xác nhận server báo success. Phát hiện `CloudLogger` mất dòng. Thông tin mới: không phải file nào cũng bị, file nhỏ cũng bị, có thể chỉ Android.
- **2026-10-12** — Thử phương án dựa `Status: 1` của server ⇒ loại vì server xoá task khi xong (`20102`). Code lưới an toàn dựa `check_hash` + init (mục 5).
- **2026-10-12** — Phân tích plugin Android ⇒ H1a (WorkManager dừng worker, không huỷ request). Môi trường test là emulator MuMu. Lập bảng ai liên quan.
- **2026-10-12** — Kiểm tra giả thuyết HTTP3 của đồng nghiệp (H4): có cơ sở, cần A/B test.

## Phụ lục — tra log nhanh (Git Bash)

```bash
f=/c/Users/Administrator/Desktop/cloud_storage_logs.txt
# các mốc chính của một lần upload
grep -n -E "InitHttpUploadWithCallBackV1=> result|Holding queue|enqueueAll (start|done)|failed for good|Upload failed|upload/progress|upload/cancel|reconcile|usedBytes=" "$f"
# đếm retry / chunk lỗi hẳn của một task
grep <taskId> "$f" | grep -c waitingToRetry
grep <taskId> "$f" | grep -c "failed for good"
# tìm entry bị ghi đè (dòng ngay sau separator mà không bắt đầu bằng "[")
awk 'prev ~ /^-{40}$/ && $0 !~ /^\[/ && $0 != "" {print NR": "$0} {prev=$0}' "$f"
```
