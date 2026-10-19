# Favorite — Thumbnail cho bài post SocialFi

> **Mục đích doc**: khi nâng cấp tiếp / fix bug feature này, đọc file này là đủ nắm trọng tâm — không phải dò lại code từ đầu.
> **Phạm vi**: chỉ thumbnail cho item Favorite nguồn **SocialFi** (feed Discover). Hành vi Favorite hiện có + item nguồn **IM** giữ nguyên 100%.
> **Nguyên tắc kiến trúc bất di bất dịch**: Cloud **tự tải + tự lưu** thumb (cache riêng theo `fileHash`). **KHÔNG** dùng lại `SocialNetworkImage` / `ResolveMediaUrlUseCase` / cache của socialfi. Socialfi xoá cache của nó → cloud không bị ảnh hưởng.

---

## 1. Quy tắc hiển thị (đã chốt)

"Icon SocialFi" = icon mặc định nguồn SocialFi (`ExternalIconIgnoreBg`, `external_icon.dart:151`).

| # | Nội dung post | Nguồn thumb | Badge | Ghi chú |
|---|---|---|---|---|
| R1 | Chỉ text | Icon SocialFi | — | `files` rỗng |
| R2 | 1 ảnh | Chính ảnh (crop cover) | — | |
| R3 | 1 video | Poster video (`/thumbnail/hash`) | — | **KHÔNG** icon play (đã chốt) |
| R4 | 1 video + nhiều ảnh | **Ảnh đầu tiên** (crop cover) | "+N" | Ưu tiên ảnh; chỉ dùng video khi post không có ảnh nào |
| R5 | Nhiều ảnh | Ảnh đầu tiên (crop cover) | "+N" | |
| R6 | Share link / quote-repost | Icon SocialFi | — | Repost/quote không có media riêng → `files` rỗng → tự ra icon |
| R7 | GIF / ảnh động | Frame tĩnh (`/thumbnail/hash`) | "GIF" | |

### Quyết định đã chốt với PO (không tự đổi nếu chưa hỏi lại)
1. **Badge "+N": N = tổng media − 1** (số item còn lại). VD 1 video + 3 ảnh (4 media) → "+3".
2. **Nguồn thumb khi mixed media = ẢNH đầu tiên trong list** (bỏ qua file non-media như audio/other). Ưu tiên ảnh; chỉ fallback về video đầu tiên khi post KHÔNG có ảnh nào (vd post chỉ có 1 video).
3. **Video KHÔNG có icon play** đè lên (khác với `FileIcon` cloud thường — cloud video có play icon).
4. **Không detect `post_type` để ép icon.** Feature áp dụng cho POST + QUOTE (sau này COMMENT); tất cả đều có media. Rule đơn giản: `files` rỗng → icon; `files` có phần tử → thumb theo `files[0]`.

### Thuật toán rút gọn
```
parse metadata.files
files rỗng                              → Icon SocialFi
media = ẢNH đầu tiên (bỏ qua audio/other); nếu không có ảnh → VIDEO đầu tiên
media == null (không có media nào)      → Icon SocialFi
ngược lại:
   thumb = getThumbnail() theo media.hash
   badge = isGif ? "GIF" : (files.length > 1 ? "+{len-1}" : none)
```
> Lưu ý N của badge vẫn tính theo **tổng số phần tử `files` − 1** (số item còn lại của post), không phụ thuộc việc media hiển thị đứng thứ mấy.

---

## 2. Nguồn dữ liệu: `metadata`

Field: `CloudExternal.metadata` (`lib/database/tables/cloud_storage/cloud_external/cloud_external.dart:96`) → map sẵn vào `ExternalModelView.metaData` (`external_model_view.dart:29`, gán tại `.external()` dòng `metaData: e.metadata`).

**Cấu trúc (JSON string mã hoá 2 lớp — điểm dễ sai nhất):**
```jsonc
{
  "files": [                      // ← List<String>, KHÔNG phải List<Map>
    "{\"hash\":\"GCQ...\",\"mime_type\":\"video/mp4\",\"ext\":\".mp4\", \"width\":\"576\",\"height\":\"1024\",\"duration\":\"14000\", ...}"
  ],
  "post_content_type": "VIDEO",   // TEXT | IMAGE | VIDEO | IMAGE+VIDEO | AUDIO
  "post_type": "POST",            // POST | REPOST | QUOTE ...  (không dùng để ép icon)
  "content": "1", "parent_id": null, ...
}
```

**Cách parse đúng:**
```dart
final map = jsonDecode(metaData) as Map<String, dynamic>;
final files = (map['files'] as List?) ?? const [];  // List<String>
// decode lần 2 từng phần tử; ưu tiên ẢNH đầu tiên, fallback VIDEO đầu tiên
Map<String, dynamic>? firstImage, firstVideo;
for (final f in files) {
  final m = jsonDecode(f as String) as Map<String, dynamic>;
  final t = MediaFileType.fromMimeType(m['mime_type'] as String?);
  if (t == MediaFileType.image) { firstImage = m; break; }  // ảnh thắng
  if (t == MediaFileType.video) { firstVideo ??= m; }
}
final media = firstImage ?? firstVideo;
final hash = media?['hash'] as String?;             // null → Icon SocialFi
final mime = media?['mime_type'] as String?;        // detect gif
final ext  = media?['ext'] as String?;              // fallback detect gif
final extraCount = files.length > 1 ? files.length - 1 : 0;  // N của badge
```
- Phân loại media: `MediaFileType.fromMimeType(mime)` (`lib/features/socialfi/.../media_file_type.dart:19`) → image/video/audio/other. Chỉ image|video mới có thumb.
- GIF: `mime == 'image/gif'` hoặc `ext.toLowerCase() == '.gif'`.
- Bọc toàn bộ trong try/catch → lỗi parse trả null → fallback Icon SocialFi.

---

## 3. Thumbnail: tải & cache (CƠ CHẾ CỐT LÕI)

Bám đúng flow của **cloud file** — key thuần theo `fileHash`, thư mục cache riêng của cloud.

### URL (chỉ dùng để tải/hiển thị tạm khi chưa có local)
`FileUtils.getThumbnailStreamUrl(hash)` → `{fastestStorageNode}/thumbnail/{hash}` (`shared/utils/file_utils.dart:370`).
- **Dùng URL builder của cloud**, KHÔNG dùng `ResolveMediaUrlUseCase` của socialfi.
- Endpoint `/thumbnail/{hash}` trả poster cho cả video (giả định đã được socialfi verify — `media_attachment_mapper.dart:77`). Đây là **assumption chính**, nếu video ra ảnh trắng → kiểm tra endpoint này trước.

### Lưu local (cache bền, offline)
- Tải: `CloudStorageServices.downloadThumbnail(fileHash: hash, taskId: hash)`
  → `cloud_storage_download_thumbnail_ext.dart:5`.
  Ghi file `.jpeg` vào `CloudStoragePath.getDirCacheThumbs(fileHash)` (dòng 25-29).
- Đọc lại: `CloudStorageTransponder.getPathThumbnailLocal(fileHash: hash)`
  → `cloud_storage_transponder_impl.dart:772` (list file trong đúng dir đó).

**Điểm quan trọng — external KHÔNG cần tạo entity gì:**
`processDownloadThumbnailTaskExt` (`...thumbnail_ext.dart:53`) lưu file `.jpeg` **trước** khi update DB. Đoạn update `FileCacheTransfer`/`CloudFile` (dòng 93-116) chỉ chạy nếu có record — external không có record thì **bỏ qua, nhưng file `.jpeg` vẫn nằm trong `getDirCacheThumbs(hash)`**. Lần sau `getPathThumbnailLocal(hash)` tự tìm thấy. → Không đụng DB/proto/repository.

### Offline behavior (khớp spec mục 4)
| Tình huống | Kết quả |
|---|---|
| Đã tải trước (file trong `getDirCacheThumbs`) | Hiển thị local, **kể cả offline** |
| Chưa tải + online | Tải qua URL (hiển thị tạm) + lưu local nền |
| Chưa tải + offline | Network fail → `errorWidget` = Icon SocialFi |
| Parse lỗi / hash rỗng / audio/other | Icon SocialFi |

---

## 4. Các điểm sửa code (map file)

Flow tham chiếu (đọc để copy pattern): `FileIcon` (`storage_icon/file_icon.dart`), `FileListItem` (`storage_item/file_list_item.dart`), `FileGridItem` (`storage_item/file_grid_item.dart`), `FileModelView.getThumbnail()` (`model_view/files/file_model_view.dart:332`).

| # | File | Sửa gì |
|---|---|---|
| 1 | `model_view/files/external_model_view.dart` | Thêm getter parse: `thumbFileHash`, `extraCount` (=max(0, len-1)), `isGifThumb`. Thêm `Future<String?> getThumbnail()`: hash null→null; `getPathThumbnailLocal(hash)` tồn tại→local; else `FileUtils.getThumbnailStreamUrl(hash)`. |
| 2 | `shared/mixin/cloud_item_action_mixin.dart` | Thêm `downloadExternalThumbnail({fileHash, callback})`: check local trước; chưa có → `downloadThumbnail(fileHash: hash, taskId: hash)` → callback. **Không sửa** `getStreamThumbnail`/`checkAndDownloadThumbnail` cũ. |
| 3 | `shared/widgets/storage_icon/external_icon.dart` | Thêm param `thumbnail` / `extraCount` / `isGif` cho `ExternalIcon` + `.square`. Render `StorageThumbnail(type: image, fit: cover, bgWidget: _Background, errorWidget: ExternalIconIgnoreBg)`. **KHÔNG** play icon. Badge góc dưới-phải (tránh fav/checkbox góc trên-phải): "GIF" | "+N". |
| 4 | `shared/widgets/storage_item/external_list_item.dart` | → `StatefulWidget` + `CloudItemActionMixin`. `_thumbnailFuture = item.getThumbnail()` (chỉ khi `type == socialfi`). `didUpdateWidget`: chưa có local → `downloadExternalThumbnail` → setState. `FutureBuilder` bọc `ExternalIcon.square(thumbnail: snapshot.data, extraCount, isGif)`. Type `im` giữ nguyên. |
| 5 | `shared/widgets/storage_item/external_grid_item.dart` | Tương tự #4 với `ExternalIcon(...)`. |

**KHÔNG đụng:** DB entity, proto, repository, service_locator. Metadata đã có sẵn.

---

## 5. Render (StorageThumbnail)

`storage_icon/storage_thumbnail.dart` — tái dùng nguyên:
- Chỉ render khi `type ∈ {image, video}` → external luôn truyền `StorageItemType.image` (thumb luôn là ảnh jpeg, kể cả poster video).
- URL chứa `http` → `CachedNetworkImage`; else path local → `FileImage`. Cả 2 có `errorWidget` → truyền `ExternalIconIgnoreBg` (Icon SocialFi) để lo case lỗi/offline.
- **Loading**: `StorageThumbnail` nhận thêm param `placeholder` (truyền Icon SocialFi, cùng widget với `errorWidget`) và dùng cho CẢ 2 nhánh:
  - URL: `CachedNetworkImage.placeholder` → tải từ mạng vẫn hiện Icon SocialFi thay vì ô xám.
  - Local: `Image.frameBuilder` → giữ Icon SocialFi tới khi frame đầu decode xong, **tránh nháy `_Background` xám** lúc chuyển URL→local (bug đã fix). Flow đúng: Icon SocialFi → thumbnail, không có gray flash.
- Crop cover mặc định `BoxFit.cover`, bo góc 6.

Badge tự viết trong `external_icon.dart` (box đen bo góc, chữ trắng, `Positioned(right,bottom)`). Không cần l10n ("GIF"/"+N" literal).

> **Trạng thái hiện tại: badge "GIF"/"+N" đang TẠM ẨN** (theo yêu cầu PO). Widget `_MediaBadge` vẫn còn trong `external_icon.dart` nhưng chưa wire vào `build` (đánh dấu `// ignore: unused_element`). Muốn bật lại: render `_MediaBadge` trong `Stack` của `ExternalIcon`, dùng `extraCount`/`isGifThumb` từ `ExternalModelView`.

---

## 6. Gotchas / lưu ý khi nâng cấp

- **files 2 lớp JSON**: quên `jsonDecode` lần 2 là bug thường gặp nhất.
- **taskId = fileHash**: dùng hash làm taskId để dedupe tải trùng; đừng random.
- **`baseUrl` cache trong service**: `downloadThumbnailExt:13` cache `baseUrl` — nếu đổi storage node giữa phiên, url cũ có thể lỗi (hiếm).
- **StatefulWidget**: phải giữ future trong `initState`/`didUpdateWidget`, KHÔNG tạo future trực tiếp trong `build` (flicker + tải lặp) — xem `file_list_item.dart:76-102`.
- **KHÔNG swap URL→local giữa phiên** (chống nháy): khi đã hiển thị được thumb (URL), callback download xong KHÔNG `setState`/re-resolve sang file local — ảnh y hệt nên swap chỉ gây nháy nhanh (đổi widget `CachedNetworkImage`→`FileImage`, có khoảng decode hiện lại Icon SocialFi/gray). Guard bằng `_resolvedThumb` trong `external_list_item.dart`/`external_grid_item.dart`: chỉ re-resolve khi `_resolvedThumb == null`. File local vẫn được download lưu lại → lần mở sau `getThumbnail()` trả local trực tiếp (không URL, không nháy). Flow đúng: **Icon SocialFi → thumbnail** (không nháy lại).
- **Video ra ảnh trắng** → nghi vấn số 1: endpoint `/thumbnail/{hash}` cho video socialfi (platform 5). Test bằng cách mở URL trực tiếp.
- **Mở rộng loại post (COMMENT...)**: không cần sửa gì nếu metadata vẫn có `files`; rule đã không phụ thuộc `post_type`.
- **Đổi rule chọn media** (vd quay lại `files[0]` cứng, hoặc ưu tiên video trước ảnh): chỉ sửa vòng lặp chọn `media` trong `_parseThumbInfo`, phần còn lại giữ nguyên. Hiện tại = ẢNH đầu tiên, fallback video đầu tiên nếu không có ảnh.

---

## 7. Nguồn tham chiếu (line anchor)

- Metadata field: `database/tables/cloud_storage/cloud_external/cloud_external.dart:96`
- Model view: `_new_cloud_storage/model_view/files/external_model_view.dart` (`.external()` :62, getThumbnail cloud mẫu: `file_model_view.dart:332`)
- Download thumb: `_new_cloud_storage/data/services/mixins/cloud_storage_download_thumbnail_ext.dart:5,53`
- Local path: `_new_cloud_storage/data/repository/cloud_storage_transponder_impl.dart:772`
- URL builder: `_new_cloud_storage/shared/utils/file_utils.dart:370`
- Render: `_new_cloud_storage/shared/widgets/storage_icon/storage_thumbnail.dart`
- Icon SocialFi: `_new_cloud_storage/shared/widgets/storage_icon/external_icon.dart:151`
- Phân loại media / gif: `features/socialfi/_shared/core/native_handle/models/media_file_type.dart:19`
- SocialFi cũng dùng `/thumbnail/hash`: `features/socialfi/post/data/mapper/media_attachment_mapper.dart:68,77`