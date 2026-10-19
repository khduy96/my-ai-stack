# Share2Social: Đính kèm file/folder Cloud vào bài post (Socialfi)

> Tài liệu này để **lấy lại context nhanh** cho tính năng *đính kèm file/folder từ Cloud Drive khi tạo bài post* và *xem bài post có đính kèm*.
>
> - **Nguồn**: code đang checkout ở branch `new_cloud_storage` (repo chính + các submodule), khảo sát ngày 2026-09-28. Mọi claim đã được đối chiếu lại với code bằng một vòng kiểm chứng độc lập.
> - **Cập nhật 2026-09-28 (chiều)**: Cloud đã có **cầu riêng cho social** `CloudSocialShareTransponder` (§3.4) dùng các endpoint `SocialCreatePublicLink` / `SocialVerifyShareEncrypt` / `SocialSearchSharedFolder`. **Socialfi chưa chuyển sang cầu này**: các luồng create/view trong §4–§5 vẫn chạy trên cầu cũ. Riêng popup nhập code đã đổi sang `SocialVerifyShareEncrypt` cho **mọi** luồng (§10.2 #16).
> - **Tên hàm/class là chuẩn**. Tài liệu cố ý không ghi số dòng vì code thay đổi liên tục; hãy grep theo tên (xem §9).

**Quy ước viết tắt đường dẫn**

| Viết tắt | Đường dẫn thật | Repo |
|---|---|---|
| `SF/` | `lib/features/socialfi/` | submodule `tbchat_socialfi` |
| `CS/` | `lib/features/cloud_storage/` | submodule `tbchat_cloud_storage` |
| `DB/` | `lib/database/` | submodule `tbchat_database` (entity ObjectBox) |
| `MB/` | `lib/module_bridge/` | repo chính (interface cầu nối) |

**Quy ước nhãn gọi mạng** (dùng xuyên suốt tài liệu):

| Nhãn | Ý nghĩa |
|---|---|
| 🟦 **CLOUD-gRPC** | Gọi tới backend **Cloud Storage**: `pb.ShareService`, `publicsvc.PublicShareService`, `pb.SearchService`, `pb.FileService`, `pb.EncFileService`, `pb.FavoriteConfigService` |
| 🟩 **SOCIAL-gRPC** | Gọi tới backend **Socialfi**: `api.v1.authz.PostHandler`, `FeedHandler`, `CommentHandler`, `SearchHandler` |
| ⬜ **HTTP / Native / Local** | Không phải gRPC: short-link HTTP, thumbnail/stream HTTP, FFI native, đọc/ghi ObjectBox local |

---

## Mục lục

1. [Tổng quan trong 1 phút](#1-tổng-quan-trong-1-phút)
2. [Hai nhóm gRPC: Cloud vs Social](#2-hai-nhóm-grpc-cloud-vs-social)
3. [Cầu nối Cloud ↔ Socialfi (Transponder)](#3-cầu-nối-cloud--socialfi-transponder)
4. [Luồng CREATE bài post có đính kèm](#4-luồng-create-bài-post-có-đính-kèm)
5. [Luồng VIEW bài post có đính kèm](#5-luồng-view-bài-post-có-đính-kèm)
6. [Các luồng liên quan (edit history, favorite, deep link, realtime)](#6-các-luồng-liên-quan)
7. [Bảng tra: lúc nào gọi gRPC nào](#7-bảng-tra-lúc-nào-gọi-grpc-nào)
8. [Data model và mapping](#8-data-model-và-mapping)
9. [Cách tìm kiếm nhanh](#9-cách-tìm-kiếm-nhanh)
10. [Gotcha, rủi ro, comment lỗi thời](#10-gotcha-rủi-ro-comment-lỗi-thời)

---

## 1. Tổng quan trong 1 phút

### 1.1 Ý tưởng cốt lõi

- Bài post **không upload lại file**. Nó chỉ mang một danh sách **tham chiếu** (`PostSharedFile`) tới file/folder trong Cloud của người đăng. Mỗi tham chiếu kèm một **short link** `{inviteUrl}/{key}/2` ở field `link`. Backend Social lưu nguyên chuỗi này; token thật nằm trong payload KV phía sau short link (chi tiết §1.3).
- **Share link chỉ được tạo (mint) lúc worker submit post lên server.** Chọn file, lưu draft hay hiển thị đều **không** tạo link. Link tạo ra **không có hạn** và **không bao giờ bị thu hồi**.
- Người xem tap item thì app **giải share link**: short key → token → kiểm tra trạng thái → (có thể) hỏi access code.
  - **File**: bước giải link chỉ là *cổng kiểm tra* (và cập nhật `space`/`deletedAt`). Sau đó file được mở **theo `fileHash`** trong viewer của Cloud; token **không** được dùng để tải bytes.
  - **Folder**: token/code/session dùng để liệt kê nội dung qua 🟦 `SearchSharedFolder` trên trang `SharedFolderPage`. Sẽ chuyển sang `SocialSearchSharedFolder` khi socialfi dùng cầu social (§3.4).
- Hai module `socialfi` và `cloud_storage` **không import trực tiếp nhau**. Mọi giao tiếp đi qua interface `*Transponder` ở `MB/`. Phía socialfi lấy instance bằng `TransponderHelper.getTransponder<T>()`.

### 1.2 Sơ đồ tổng thể

```
                    ┌──────────────────────────── lib/module_bridge (MB/) ────────────────────────────┐
                    │ CloudFilePickerTransponder   CloudShareTransponder   AppLinkCloudTransponder     │
                    │ CloudStorageTransponder      CloudTransponderUi      CloudFavoriteTransponder    │
                    └──────────────▲───────────────────────────────────────▲──────────────────────────┘
                                   │ abstract interface                    │ impl (@LazySingleton / @Injectable)
 ┌────────────── SOCIALFI (SF/) ───┴───────────┐        ┌──────────────────┴─────────── CLOUD (CS/) ───────────┐
 │ CREATE                                      │        │                                                      │
 │  CreatePostPage ── pickFromMyFile ───────────────────▶│ MyFilePickerSheet (duyệt My Files)                   │
 │                                             │        │   ├─ 🟦 SearchService/SearchFilesInFolder            │
 │                                             │        │   ├─ 🟦 SearchService/SearchRecoveryFiles (File Restore)│
 │                                             │        │   ├─ 🟦 FileService/GetFolderFileStats (đếm)         │
 │                                             │        │   ├─ 🟦 EncFileService/GetEncSettings (tap Encrypted)│
 │                                             │        │   └─ ⬜ native getFileInfo (khi confirm)             │
 │  CreatePostBloc.state.cloudAttachments      │        │                                                      │
 │  CreatePostUseCase → PendingPostRecord (DB/)│  ⬜ chưa gọi mạng, chạy được offline                         │
 │  PostUploadWorker (khi online)              │        │                                                      │
 │   ├─ upload media local trước               │        │                                                      │
 │   ├─ refreshPickedItems ──────────────────────────────▶│ ⬜ đọc CloudFileDB / CloudFolderDB                    │
 │   ├─ createShareLinks ────────────────────────────────▶│ 🟦 ShareService/CreatePublicLink|CreatePrivateLink   │
 │   │                                         │        │   + ⬜ HTTP short link (/get_kv, /op_kv)             │
 │   ├─ 🟩 PostHandler/CreatePost|CreateQuote|UpdatePost|UpdateQuote   (shared_files[])                   │
 │   └─ 🟩 PostHandler/GetPost (finalize, thay card pending)                                              │
 │                                             │        │                                                      │
 │ VIEW                                        │        │                                                      │
 │  🟩 FeedHandler/GetFeed, PostHandler/GetPost, SearchHandler/... → PostCard.shared_files               │
 │  _PostCloudSection (grid ở feed, list ở detail)      │                                                      │
 │   └─ icon/thumbnail ──────────────────────────────────▶│ CloudTransponderUi (⬜ HTTP /thumbnail/{hash})       │
 │  tap → ReactionBloc._onOpenCloudItem        │        │                                                      │
 │   └─ resolveShareLink ────────────────────────────────▶│ ⬜ HTTP getKV → 🟦 CheckShareTokenStatus             │
 │                                             │        │   → 🟦 VerifySession → (màn nhập code) 🟦 SocialVerifyShareEncrypt│
 │   ├─ FILE   → openFile ───────────────────────────────▶│ viewer image/video/doc (⬜ HTTP theo hash)           │
 │   └─ FOLDER → SharedFolderPage              │        │                                                      │
 │        └─ searchSharedFolder ─────────────────────────▶│ 🟦 PublicShareService/SearchSharedFolder             │
 └─────────────────────────────────────────────┘        └──────────────────────────────────────────────────────┘
```

### 1.3 Bài post lưu SHORT LINK (không lưu token)

Mỗi đính kèm trên bài post mang field **`PostSharedFile.link` (field 13)**. Giá trị của nó là **short link URL**, không phải share token và cũng không phải URL tải file.

#### Short link trông như thế nào

```
{appConfig.inviteUrl}/{key}/2
                        │    └─ ShortLinkType.cloud (suffix 2; 3 = socialFi post, 4 = dapp, 5 = bubble)
                        └─ base64( 6 ký tự hex của md5(contentJson) )     vd: https://share.tbchat.io/ZThiOWFm/2
```

Short link chỉ là **chìa khoá tra cứu**. Nội dung thật là một **payload JSON** lưu trên server KV (HTTP `/op_kv`) dưới `key`, gồm:

| Loại | Field trong payload | Ghi bởi |
|---|---|---|
| Quyền truy cập | `token` (share token từ 🟦 Create*Link), `access_code`, `attach_code` | `CloudShareRepositoryImpl._createShortLinkCloud` / `_createShortLinkFolder` |
| File | `file_id`, `file_hash`, `file_name`, `file_size`, `file_ext`, `url_thumbnail` | `_createShortLinkCloud` |
| Folder | `is_folder: true`, `folder_id`, `folder_name`, `file_name`, `item_count`, `folder_size` | `_createShortLinkFolder` |
| Người chia sẻ + thời gian | `username`, `user_node_id`, `create_time`, `short_link_created_time`, `short_link_expiry_hours` (null), `language` | cả hai |
| Trường chung | `createTime`, `language`, `createNode` (chỉ điền nếu chưa có) | `ShortLinkService.createShortLink` |

- Payload bị **đóng băng** tại thời điểm mint: tên file, size, thumbnail, người chia sẻ không cập nhật theo Cloud. Trạng thái "sống" (`space`, `deletedAt`) phải hỏi lại bằng 🟦 `CheckShareTokenStatus` mỗi lần tap.
- Với item `encryption`, `access_code` do server sinh nằm **dạng rõ** trong payload (`attach_code: true`). Ai có short link đều đọc được code qua `/get_kv`.

#### Vòng đời của `link`

```
CREATE (worker, sau khi upload media)
  CloudShareTransponder.createShareLinks
    → 🟦 ShareService/CreatePublicLink | CreatePrivateLink        → share token (+ access code)
    → ⬜ ShortLinkService.createShortLink(payload, ShortLinkType.cloud)
         lặp: POST /get_kv(key) — key đã tồn tại? → thử key kế tiếp
              chưa tồn tại → POST /op_kv(key, payload)  → trả "{inviteUrl}/{key}/2"
    → map id → url  → CloudAttachmentEntity.copyWith(link: url)
    → toSharedFiles() → PostSharedFile.link → 🟩 CreatePost/UpdatePost   (backend Social lưu chuỗi này)

VIEW (tap item)
  PostCard.shared_files[].link → CloudAttachmentEntity.link
    → ReactionBloc._onOpenCloudItem → resolveShareLink(link)
    → parseShareKeyFromLink: path segment đầu tiên = key
    → ⬜ POST /get_kv(key) → payload → token
    → 🟦 CheckShareTokenStatus(token) → … (xem §5.4)
```

#### `link` được lưu ở đâu

| Nơi | Có `link`? | Ghi chú |
|---|---|---|
| Backend Social (`shared_files[].link`) | ✅ | **Nguồn sự thật**. Trả về trong mọi `PostCard` |
| `PostCacheRecord` (`DB/`, cache feed offline) | ✅ | Nằm trong bytes `PostCard` |
| Ref `remote:<PostSharedFile JSON>` trong `PendingPostRecord` / `DraftPostRecord` | ✅ | Chỉ với item cũ của post đang edit, chưa pick lại |
| Ref `file:<localId>` / `folder:<localId>` | ❌ | Không lưu link. Link mint ra ở worker chỉ nằm trong RAM rồi đi thẳng vào request (nên retry sẽ mint lại, §10.2) |
| `CloudPickedItem` (model bridge) | ❌ | Cố ý không có field `link` |
| Phía Cloud | — | App không lưu lại link đã mint cho post. Share token vẫn sống vĩnh viễn trên server |

#### Ai đọc `link`

Trong socialfi, `link` **chỉ** được dùng ở `ReactionBloc._onOpenCloudItem` (tap). Nó không hiển thị trên UI, không có nút copy.

Cùng định dạng link này cũng mở được qua deep link và thẻ share trong IM (`AppLinkCloudTransponder.handle`, §6.3), vì đây chính là loại share link thông thường của Cloud.

#### Các trường hợp `link` rỗng hoặc hỏng

| Trường hợp | `link` | Hệ quả khi tap |
|---|---|---|
| Item `privacy`, row local không còn/đang trong thùng rác, RPC hoặc short link lỗi, không có user, thiếu `CloudShareTransponder` | `null` | Không làm gì (im lặng) |
| `createShortLink` hết key trống (thử hết 6-ký-tự-trượt trên md5): fallback `postKeyValueToServer(hash, …)` và **trả về `hash` trần, không có URL** | `"<md5 hex>"` | `parseShareKeyFromLink` yêu cầu `http(s)://`, nên trả null. Tap im lặng. Link hỏng vĩnh viễn trên post (§10.2) |
| Edit: item giữ ref `remote:` | link cũ | Vẫn dùng được (link không có hạn) |
| Edit: item được pick lại | link **mới** | Link cũ bị bỏ nhưng không bị thu hồi |

### 1.4 Nhiều repo git

`.gitmodules` khai báo các submodule với `branch = new_tbchat_test`; `new_cloud_storage` là branch đang checkout trong working copy. Tính năng này chạm tới **4 repo**:

| Repo | Chứa gì cho tính năng này |
|---|---|
| repo chính | `MB/` (interface + model cầu nối), `lib/app/core/di/service_locator.config.dart` (DI), `lib/app/core/services/short_link_service.dart` |
| `SF/` | composer, outbox, mapper, UI đính kèm, `SharedFolderPage` |
| `CS/` | impl transponder, picker, share repository, wrapper gRPC Cloud |
| `DB/` | entity ObjectBox: `PendingPostRecord.cloudAttachmentIds`, `DraftPostRecord.cloudAttachmentIds`, `PostCacheRecord`, `CloudFile`, `CloudFolder` |

Đổi `@Entity` thì chạy `/build -obj`, đổi `@injectable` thì chạy `/build -get`.

---

## 2. Hai nhóm gRPC: Cloud vs Social

Hai module có **channel, factory, proto riêng**. Cả hai đều có class tên `GrpcClientFactory`: trùng tên nhưng khác file, cẩn thận khi import.

| | 🟦 **CLOUD-gRPC** | 🟩 **SOCIAL-gRPC** |
|---|---|---|
| Factory | `CS/shared/network/cloud_grpc_factories.dart` (`GrpcClientFactory`). Factory tự tạo channel, host `appConfig.cloudBaseUrl`, không đặt deadline theo từng lời gọi. DI ở `cloud_clients_module.dart` | `SF/_shared/core/network/socialfi_grpc_factories.dart` (`GrpcClientFactory`). Channel do `SocialFiGrpcChannelProvider` quản lý (host `appConfig.socialFiBaseUrl`, keepAlive). Mọi RPC có deadline 45s và retry interceptor. DI ở `SF/_shared/core/di/socialfi_module.dart` |
| Proto | `CS/data/_grpc/proto_generated/` | `SF/_shared/data/proto_generated/`. Client được export ở `SF/_shared/data/proto_generated.dart`; các file message `post_models` / `feed_models` phải import trực tiếp |
| Wrapper | Thường là `CS/data/_grpc/repositories/*_service_repository_impl.dart` → domain repo `CS/data/repository/<area>/` → transponder **hoặc** cubit của Cloud. Ngoại lệ: `EncFileService` gọi client thẳng trong `encrypted_repository_impl.dart` | `SF/post/data/data_sources/post/post_grpc_data_sources.dart` (`PostGrpcDataSources`), `SF/post/data/data_sources/feed/feed_grpc_data_source.dart` (`FeedGrpcDataSource`), `CommentGrpcDataSource`, `SF/search/data/data_sources/search_remote_data_source.dart` |
| Ai gọi | Socialfi **không bao giờ** gọi thẳng RPC Cloud. Một phần qua transponder (mint link, giải link, liệt kê folder share). Phần còn lại do cubit của Cloud tự gọi **bên trong** picker sheet mà transponder mở ra | Socialfi gọi trực tiếp qua data source |

### 2.1 🟦 CLOUD-gRPC dùng trong tính năng

| Service / RPC | Client (factory) | Chuỗi wrapper | Luồng: khi nào |
|---|---|---|---|
| `pb.SearchService/SearchFilesInFolder` | `createSearchClient` | `SearchServiceRepositoryImpl.searchFilesInFolder` ← `CloudMyFileRepositoryImpl.getFreshMore` ← `MyFileCubit.onFetchData` | **CREATE**, trong picker: mỗi cấp folder (root, folder con, Discover `platforms:[5]`, Encrypted space `encryption`), load thêm, gõ search (filter `advance_search`), refresh, và khi DB watcher báo thay đổi. Trang đầu hiện dữ liệu ObjectBox trước rồi mới gọi RPC. Kết quả được **sync vào ObjectBox**. RPC lỗi thì list rỗng, không báo lỗi |
| `pb.SearchService/SearchRecoveryFiles` | `createSearchClient` | `SearchRecoveryFilesUseCase` ← `MyFileCubit` (space `restore`) | **CREATE**, trong picker: khi vào system folder **File Restore** (thay cho `SearchFilesInFolder`) |
| `pb.FileService/GetFolderFileStats` | `createFileClient` | `FileServiceRepositoryImpl.getCountChildSystemFolder` ← `CloudMyFileRepositoryImpl` ← `MyFileCubit.getCountPrivacyAndSocialFi` | **CREATE**, trong picker: đếm số item cho ô Encrypted và Discover. Chạy mỗi khi một `MyFileCubit` được `init` (tức mỗi lần vào folder, kể cả folder con), mỗi lần `CloudFileDB` đổi, và khi refresh. Request rỗng; lỗi thì đếm về 0 |
| `pb.EncFileService/GetEncSettings` | `createEncFileClient` | `EncryptedFileNavigator.openEncryptedFileInPicker` → `EncryptedFileAuthCubit.refreshEncSettings` | **CREATE**, trong picker: tap ô Encrypted. Vault chưa bật thì push luồng setup `CloudStorageRoute.createEncryptedFile`. **Không hỏi PIN** trong picker |
| `pb.ShareService/CreatePublicLink` | `createShareClient` | `CloudShareRepositoryImpl.createPublicShare` / `createPublicFolderShare` ← `CloudShareTransponderImpl.createShareLinks` | **CREATE**, worker submit: item space `normal` / `restore`. Sẽ thay bằng `SocialCreatePublicLink` khi socialfi chuyển cầu (§3.4) |
| `pb.ShareService/CreatePrivateLink` | `createShareClient` | `createPrivateShare` / `createPrivateFolderShare` | **CREATE**, worker submit: item space `encryption` (`attachCode: true`, code nhúng trong short link). Sẽ thay bằng `SocialCreatePublicLink` khi socialfi chuyển cầu (§3.4) |
| `publicsvc.PublicShareService/CheckShareTokenStatus` | `createPublicShareClient` | `CloudShareRepositoryImpl.checkShareTokenStatus` ← `AppLinkCloudTransponderImpl.resolveShareLink` | **VIEW**: mỗi lần tap item (lấy `space`, `deletedAt` thật). Lỗi thì repo trả `null`, dẫn tới `space = ''` |
| `pb.ShareService/VerifySession` | `createShareClient` | `CloudShareRepositoryImpl.verifySession` (đọc session từ `CloudSessionTokenDB` trước) | **VIEW**: tap item có `space != 'normal'`. **Luôn gửi**, kể cả khi chưa có session cache (lúc đó `sessionToken = null`) |
| `publicsvc.PublicSocialShareService/SocialVerifyShareEncrypt` | `createPublicSocialShareClient` | `SocialShareServiceRepositoryImpl.socialVerifyShareEncrypt` ← `CloudSocialShareRepositoryImpl.socialVerifyShareEncrypt` ← `PopupShareConfirmAccessCode` (và cầu `CloudSocialShareTransponder.socialVerifyShareEncrypt`) | **VIEW**: mỗi lần user nhập code trong popup (sai thì gọi lại). Request/response giống `VerifyAccessCode`. Popup **dùng chung** cho post, deep link và IM. **Không lưu session** vào `CloudSessionTokenDB`; popup trả về code vừa nhập |
| `publicsvc.PublicShareService/SearchSharedFolder` | `createPublicShareClient` | `CloudShareRepositoryImpl.searchSharedFolder` ← `CloudShareTransponderImpl.searchSharedFolder` | **VIEW**: `SharedFolderPage` lần đầu, load thêm, refresh, folder con, load-more gallery. Limit 20, sort `created_at DESC`. **Không ghi DB local**. Sẽ thay bằng `SocialSearchSharedFolder` (§3.4) |
| `pb.SocialShareService/SocialCreatePublicLink` | `createSocialShareClient` | `SocialShareServiceRepositoryImpl.socialCreatePublicLink` ← `CloudSocialShareRepositoryImpl.socialCreatePublicShare` / `socialCreatePublicFolderShare` ← `CloudSocialShareTransponder.socialCreateShareLinks` | **Sẵn sàng qua cầu social, socialfi chưa gọi.** Thay cho cả `CreatePublicLink` lẫn `CreatePrivateLink` với đính kèm post, kể cả item encryption |
| `publicsvc.PublicSocialShareService/SocialSearchSharedFolder` | `createPublicSocialShareClient` | `SocialShareServiceRepositoryImpl.socialSearchSharedFolder` ← `CloudSocialShareRepositoryImpl.socialSearchSharedFolder` ← `CloudSocialShareTransponder.socialSearchSharedFolder` | **Sẵn sàng qua cầu social, socialfi chưa gọi.** Cùng request/response với `SearchSharedFolder`; item encryption cần `sessionToken` từ `SocialVerifyShareEncrypt` |
| `pb.FavoriteConfigService/GetFavoriteLimitUsage` | `createFavoriteConfigService` | `CloudFavoriteTransponder.getFavoriteLimitUsage` | Favorite cả bài post (§6.2), không phải đính kèm |

**Có trong proto nhưng KHÔNG dùng** ở tính năng này (dễ nhầm):

- `pb.ShareService/VerifyAccessCode`: wrapper và `CloudShareRepository.verifyAccessCode` vẫn còn nhưng **không còn ai gọi**, vì popup đã chuyển sang `SocialVerifyShareEncrypt`.
- `publicsvc.PublicShareService/VerifyAccessCode` và `pb.SocialShareService/SocialVerifyShareEncrypt` (2 bản trùng tên với RPC đang dùng): chưa dùng.
- `pb.ShareService/RevokeSharedLinks`, `UpdatePublicLink`, `UpdatePrivateLink`, `GenAccessCode`, `ListSharedLink`.
- `publicsvc.PublicShareService/GetSharedItemDetail`.
- `publicsvc.PublicShareService/GetShareLink`: chỉ dùng trong `AppLinkCloudTransponder.handle()` (deep link, thẻ share trong IM; xem §6.3).
- `pb.ExternalDataService` (trang Favorites của Cloud) và mọi `*.m2m.*` / `*.admin.*` (server-to-server).

### 2.2 🟩 SOCIAL-gRPC dùng trong tính năng

Client post là **`api/v1/authz/post_handler.pbgrpc.dart`** (path `/api.v1.authz.PostHandler/...`); message type lấy từ `post/v1/m2m/post_models.pb.dart`. File `post/v1/m2m/post_handler.pbgrpc.dart` là proto m2m, **app không dùng**.

**Ghi (có `shared_files`)**

| RPC | Wrapper | Field | Luồng |
|---|---|---|---|
| `PostHandler/CreatePost` | `PostGrpcDataSources.createPost` | `CreatePostRequest.shared_files` = 18 | CREATE post gốc |
| `PostHandler/CreateQuote` | `PostGrpcDataSources.quote` | `CreateQuoteRequest.shared_files` = 19 | CREATE quote một post |
| `PostHandler/UpdatePost` | `PostGrpcDataSources.editPost` | `UpdatePostRequest.shared_files` = 22 (gửi cả danh sách, kèm `version`) | EDIT post gốc |
| `PostHandler/UpdateQuote` | `PostGrpcDataSources.editQuote` | `UpdateQuoteRequest.shared_files` = 22 | EDIT quote (mọi quote, kể cả quote-một-comment) |

**Ghi (KHÔNG có `shared_files`)**: `CommentHandler/CreateComment`, `CommentHandler/UpdateComment`, `CommentHandler/CreateQuote` (quote một comment, `CreateQuoteCommentRequest`).

**Đọc (`PostCard.shared_files` = field 34)**

| RPC | Wrapper | Luồng |
|---|---|---|
| `FeedHandler/GetFeed` | `FeedGrpcDataSource` (message `feed/v1/m2m/feed_models.pb.dart`, `FeedPost.post`) | Feed. Được cache offline dạng bytes trong `PostCacheRecord` |
| `PostHandler/GetPost` | `getPost` | Post detail; finalize sau submit; SSE `post_status_updated`; mở từ Favorites |
| `PostHandler/GetListPosts`, `ListPostByIDs`, `ListQuotes`, `ListReposts`, `ListPinnedPost`, `MyPendingPosts`, `GetProfileVideo` | cùng file | Các danh sách; `ListPostByIDs`/`MyPendingPosts` được `PostPendingReconciler` poll |
| `SearchHandler/SearchPosts`, `SearchPostsByHashtag`, `SearchAll` | `SearchRemoteDataSource` | Kết quả tìm kiếm cũng vẽ đính kèm |

**Khác**

| RPC | Luồng |
|---|---|
| `PostHandler/CheckPostEditable` | Bấm Edit, **trước** khi mở composer |
| `PostHandler/GetPostEditHistory` | Xem lịch sử chỉnh sửa (`changes.shared_files` = 6, `SharedFileChange{before, after}`) |
| `PostHandler/FavoritePost` / `UnfavoritePost` | Favorite cả bài post |

`post.v1.m2m.PostHandler/UpdatePostSharedFile`: backend Cloud gọi sang Social khi metadata file/folder thay đổi. **App không gọi**, cũng không có wrapper Dart.

### 2.3 ⬜ Không phải gRPC (dễ nhầm)

| Việc | Cơ chế | Luồng |
|---|---|---|
| Tạo short link | HTTP `ShortLinkService.createShortLink(payload, linkType: ShortLinkType.cloud)`: lặp POST `/get_kv` để dò key trống, rồi POST `/op_kv` (có ký) ghi payload `{token, access_code, attach_code, file_hash / folder_id, url_thumbnail, …}`. Trả về `{inviteUrl}/{key}/2`. Cần `UserService.getUser()` (không có user thì throw, dẫn tới `link = null`) | CREATE (worker, ngay sau Create*Link) |
| Giải short key → token | HTTP POST `/get_kv` (`ShortLinkService.getKeyValueFromServer`) | VIEW (tap) |
| Thumbnail ảnh/video | HTTP `{fastestNode}/thumbnail/{fileHash}` (`FileUtils.getThumbnailStreamUrl`). `fastestNode` do `CloudStorageNodeProvider` dò reachability các `cloudNodes` rồi cache | VIEW (icon); CREATE (`prepareSelection`, `url_thumbnail` trong short link) |
| Xem ảnh | HTTP `{node}/store/file/{hash}` (placeholder là thumbnail) | VIEW |
| Xem video | Player Cloud, `{node}/video/{hash}.{ext}` qua proxy `VideoCacheService`, hoặc HLS | VIEW |
| Mở document | Có cache local thì mở luôn; không thì `CloudStorageTransponder.downloadFileHttp` rồi mở bằng app hệ thống | VIEW |
| Bổ sung width/height/duration | Native FFI `GetFileInfoNativeHandle` (`CloudStorageRepository.getFileInfo`) | CREATE (confirm picker) |
| ObjectBox `CloudFileDB` / `CloudFolderDB` | pre-select theo remoteId; trang đầu picker; sync kết quả RPC; `refreshPickedItems` theo localId; `createShareLinks._subjectsOf` theo remoteId | CREATE |
| ObjectBox `PendingPostRecord`, `DraftPostRecord` (`DB/`) | Lưu `cloudAttachmentIds` | CREATE |
| ObjectBox `CloudSessionTokenDB` | Đọc session trước `VerifySession`. **Hiện không còn ai ghi**: popup verify bằng `SocialVerifyShareEncrypt` và không lưu session | VIEW |
| ObjectBox `UserSpaceDB` | `CloudStorageTransponder.userSpace()` (Full Cloud, chỉ cho media local) | CREATE |

---

## 3. Cầu nối Cloud ↔ Socialfi (Transponder)

### 3.1 Cơ chế

```dart
// Phía socialfi (caller): trả null nếu T chưa đăng ký trong getIt
final picker = TransponderHelper.getTransponder<CloudFilePickerTransponder>();

// Phía cloud (impl)
@LazySingleton(as: CloudFilePickerTransponder)
class CloudFilePickerTransponderImpl implements CloudFilePickerTransponder { ... }
```

- `TransponderHelper`: `MB/transponder_helper.dart`. Một số caller gọi `getTransponder()` **không kèm type argument** (kiểu được suy ra từ field), vì vậy grep theo tên interface chứ đừng grep `getTransponder<X>`.
- Kiểu đăng ký DI:
  - `@LazySingleton`: `CloudFilePickerTransponderImpl`, `CloudShareTransponderImpl`, `CloudTransponderUiImpl`, `AppLinkCloudTransponderImpl` (impl này dùng `extends`).
  - `@Injectable` (factory, mỗi lần lấy ra một instance mới): `CloudStorageTransponderImpl`, `CloudFavoriteTransponderImpl`.
- Chiều ngược lại (cloud → socialfi) chỉ có **một chỗ**: `CS/pages/favorite/mixin/favorite_external_action_mixin.dart` gọi `getIt<SocialFiTransponder>().postDetailPath(sourceId)`. Chỗ này gọi thẳng `getIt`, nên sẽ throw nếu chưa đăng ký.

**Khi transponder trả `null`** (chưa đăng ký), mỗi chỗ xử lý khác nhau:

| Chỗ gọi | Hành vi |
|---|---|
| `_pickCloudAttachments` | Giữ nguyên selection, chỉ ghi log |
| `_refreshLocalRefs` (thiếu picker transponder) | Throw `StateError`. Lúc submit thì post fail; lúc mở draft thì đính kèm thành `[]` |
| `resolveCloudAttachmentsForSubmit` (thiếu share transponder) | **Không throw**: post vẫn gửi nhưng không item nào có link |
| `SearchSharedFolderUseCase`, `ResolveSharedAttachmentLinkUseCase` | Throw `StateError`, dẫn tới toast lỗi |
| `CloudSpaceGuard`, `OpenSharedFolderFileUseCase` | Bỏ qua (no-op) |

### 3.2 Bảng hàm cầu nối dùng trong tính năng

| Transponder (`MB/…`) | Hàm | Impl (`CS/transponder/…`) | Socialfi gọi từ | Bên trong làm gì | Gọi mạng |
|---|---|---|---|---|---|
| `CloudFilePickerTransponder` (`cloud_storage/cloud_file_picker_transponder.dart`) | `pickFromMyFile({maxCount, allowFolder, showSystemFolders, confirmTitle, selectedFileRemoteIds, selectedFolderRemoteIds, …})` → `List<CloudPickedItem>` | `cloud_file_picker_transponder_impl.dart` | `SF/post/presentation/create_post/pages/create_post_page.dart` (`_pickCloudAttachments`) | Pre-select bằng remoteId (ObjectBox), rồi `context.showMyFilePickerSheet`. Khi confirm: `prepareSelection`. Huỷ thì trả `[]` | ⬜ Local + 🟦 các RPC của picker (§2.1) + ⬜ native |
| | `refreshPickedItems({fileIds, folderIds})` | như trên | `SF/post/data/mapper/cloud_attachment_mapper.dart` (`_refreshLocalRefs`) | Đọc lại theo **localId**. Row hard-delete thì vắng mặt; row trong thùng rác **vẫn được trả về** kèm cờ `isDelete` | ⬜ Local |
| `CloudShareTransponder` (`cloud_storage/cloud_share_transponder.dart`) | `createShareLinks({remoteIds})` → `Map<id, link?>` | `cloud_share_transponder_impl.dart` | `cloud_attachment_mapper.dart` (`resolveCloudAttachmentsForSubmit`) | Gộp id trùng. `_subjectsOf` tra ObjectBox theo remoteId (không có row, hoặc row trong thùng rác, thì trả `null`). Space lấy từ **DB local**. Tạo **tuần tự**: `privacy` → `null`; `encryption` → private link `attachCode: true`; còn lại → public link. Folder dùng `create*FolderShare`. Không có expiry. Lỗi từng item → `null` | ⬜ Local → 🟦 CreatePublic/PrivateLink → ⬜ HTTP short link |
| | `searchSharedFolder({token, folderId, accessCode, sessionToken, limit, pit, searchAfter})` → `CloudSharedFolderPage` | như trên (limit 20) | `SF/post/domain/use_cases/search_shared_folder_use_case.dart` | Không throw (lỗi → `CloudSharedFolderPage.error()`), không ghi DB, bỏ entry không có remoteId | 🟦 SearchSharedFolder |
| `AppLinkCloudTransponder` (`app_link/app_link_cloud_transponder.dart`) | `resolveShareLink(link)` → `CloudShareLinkAccess` | `app_link_cloud_transponder_impl.dart` | `SF/post/domain/use_cases/resolve_shared_attachment_link_use_case.dart` | Xem §5.4. **Bỏ qua** `access_code`/`attach_code` trong payload. Không kiểm tra `expiredAt`. Không hiện loading | ⬜ HTTP getKV → 🟦 CheckShareTokenStatus → ⬜ session DB → 🟦 VerifySession → (màn nhập code) 🟦 SocialVerifyShareEncrypt |
| `CloudStorageTransponder` (`cloud_storage/cloud_storage_transponder.dart`) | `openFile(fileHash, fileName, fileExt, fileCreatedAt, gallery, …)` | `cloud_storage_transponder_impl.dart` | `SF/post/domain/use_cases/open_shared_folder_file_use_case.dart` (dùng cho **cả** file trong post lẫn file trong folder share) | Chọn viewer theo ext: image → viewer theo hash; video → player Cloud; loại khác → tải/cache rồi mở bằng app hệ thống. **Không nhận token** | ⬜ HTTP theo hash |
| `CloudTransponderUi` (`cloud_storage/cloud_transponder_ui.dart`) | `pickedItemIcon`, `pickedItemName` | `cloud_transponder_ui_impl.dart` | `SF/_shared/presentation/widgets/cloud_attachment/cloud_attachment_thumb.dart`, `cloud_attachment_row.dart` | Icon/thumbnail (chỉ image/video có `fileHash`), tên cắt ở giữa (giữ extension). Item `encryption` có style frosted + ổ khoá | ⬜ HTTP thumbnail |

**Transponder socialfi cũng dùng nhưng KHÔNG thuộc tính năng đính kèm** (phục vụ media của post hoặc favorite):

- `CloudStorageTransponder`: `userSpace`, `toScreenUpgrade` (Full Cloud cho media local), `uploadFileHttp`, `downloadFileHttp`, `cancelUploadByTaskId`, `cancelDownloadByTaskIds`, `fileInfoByTaskIdsWatch`, `downloadThumbnailAsync`, `totalCloudSpaceSize`, `chooseFolderForTransferMedia`, `transferMediaToCloudStorage`, `navigateToFolder`, `downloadWatermarkMedia`.
- `CloudFavoriteTransponder`: xem §6.2.

### 3.3 Model đi qua cầu nối

| Model | File | Hướng | Ghi chú |
|---|---|---|---|
| `CloudPickedItem` (sealed) → `CloudPickedFile` / `CloudPickedFolder` | `MB/cloud_storage/models/cloud_picked_item.dart` | **Hai chiều** | Cloud → Social: kết quả picker, refresh. Social → Cloud: socialfi dựng lại bằng `toPickedItem()` để vẽ icon/tên. **Cố ý không có `link`** |
| `CloudSharedEntry` (sealed) → `CloudSharedFile` / `CloudSharedFolder` | `MB/cloud_storage/models/cloud_shared_entry.dart` | Cloud → Social | Nội dung folder share |
| `CloudSharedFolderPage` | cùng file | Cloud → Social | Gồm `entries`, `pit`, `searchAfter` (opaque, phải gửi lại nguyên vẹn), `total`, `totalImage` (chỉ có ở trang đầu), `hasError`. Getter `hasMore`. Constructor `.error()` |
| `CloudGalleryImage{fileHash, fileName, fileExt?, subTitle}`, typedef `CloudGalleryPage = ({List<CloudGalleryImage> images, bool hasMore})` | `MB/cloud_storage/models/cloud_gallery_image.dart` | Social → Cloud | Gallery và callback `onGalleryLoadMore` khi mở ảnh trong folder share |
| typedef record `CloudShareLinkAccess = ({String? token, String space, String? accessCode, String? sessionToken, DateTime? deletedAt})` | `MB/app_link/model/cloud_share_link_result.dart` | Cloud → Social | `token == null` nghĩa là không có gì để mở. `space == ''` nghĩa là không đọc được trạng thái (**khác** `normal`). Tối đa một trong `accessCode`/`sessionToken` có giá trị. (`CloudShareLinkInfo` cùng thư mục không ai dùng) |
| `FileSpaceEnum` | `MB/cloud_storage/enum/file_space_enum.dart` | chung | `fileRestore('restore')`, `encrypt('encryption')`, `privacy`, `normal`. `getByValue` gặp giá trị lạ/rỗng thì fallback về `normal` |
| typedef record `CloudSocialVerifyResult = ({bool success, String? sessionToken, int? sessionExpiresAt})` | `MB/cloud_storage/cloud_social_share_transponder.dart` | Cloud → Social | Kết quả `socialVerifyShareEncrypt` (§3.4). `sessionExpiresAt` giữ nguyên giá trị server gửi |

### 3.4 Cầu riêng cho social: `CloudSocialShareTransponder` (mới)

> **Trạng thái**: đã có ở `CS/` và `MB/` (đã đăng ký DI), nhưng **socialfi chưa gọi**. Các hàm cũ (`CloudShareTransponder`, `AppLinkCloudTransponder`, `CloudShareRepository.createPublicShare`/`createPrivateShare`/`searchSharedFolder`…) giữ nguyên, không bị xoá hay đổi hành vi.

**Vì sao tách cầu**: BE thêm các endpoint dành riêng cho link đính kèm post (`pb.SocialShareService`, `publicsvc.PublicSocialShareService`). Tách thành cầu riêng để các luồng Cloud Drive thường (share sheet, deep link, IM) vẫn chạy trên endpoint cũ.

| Method của cầu | RPC | Thay cho (cầu cũ) | Hành vi |
|---|---|---|---|
| `socialCreateShareLinks({remoteIds})` → `Map<id, link?>` | 🟦 `pb.SocialShareService/SocialCreatePublicLink` + ⬜ short link | `CloudShareTransponder.createShareLinks` (`CreatePublicLink` / `CreatePrivateLink`) | Cùng quy tắc: bỏ id trùng, tra DB local theo remoteId, bỏ item trong thùng rác, privacy → `null`, tạo tuần tự, item lỗi → `null`, không throw. **Khác**: mọi space, **kể cả encryption**, đều tạo link qua `SocialCreatePublicLink`. Short link mang `attach_code: false` và không có `access_code` |
| `socialVerifyShareEncrypt({token, accessCode})` → `CloudSocialVerifyResult?` | 🟦 `publicsvc.PublicSocialShareService/SocialVerifyShareEncrypt` | `pb.ShareService/VerifyAccessCode` | Verify PIN mã hoá của chủ sở hữu cho item encryption. Trả `(success, sessionToken?, sessionExpiresAt?)`, trả `null` khi lỗi mạng. **Không lưu session, không mở popup** |
| `socialSearchSharedFolder({token, folderId, accessCode, sessionToken, limit = 20, pit, searchAfter})` → `CloudSharedFolderPage` | 🟦 `publicsvc.PublicSocialShareService/SocialSearchSharedFolder` | `CloudShareTransponder.searchSharedFolder` (`SearchSharedFolder`) | Cùng contract: không throw (lỗi → `.error()`), không ghi DB, sort `created_at DESC`. Item encryption cần `sessionToken` từ `socialVerifyShareEncrypt` |

**Chuỗi gọi bên Cloud**

```
CloudSocialShareTransponder                     MB/cloud_storage/cloud_social_share_transponder.dart
 → CloudSocialShareTransponderImpl              CS/transponder/cloud_social_share_transponder_impl.dart   (@LazySingleton)
    ├─ socialCreateShareLinks → _subjectsOf (CloudFileDB / CloudFolderDB)
    │                         → CloudSocialShareRepository.socialCreatePublicShare | socialCreatePublicFolderShare
    ├─ socialVerifyShareEncrypt → CloudSocialShareRepository.socialVerifyShareEncrypt
    └─ socialSearchSharedFolder → CloudSocialShareRepository.socialSearchSharedFolder → map sang CloudSharedFolderPage
 → CloudSocialShareRepositoryImpl               CS/data/repository/shares/cloud_social_share_repository_impl.dart
    ├─ socialCreatePublic(Folder)Share → SocialShareServiceRepository.socialCreatePublicLink
    │     → CloudShareRepository.createFileShortLink | createFolderShortLink
    │       (gọi thẳng _createShortLinkCloud / _createShortLinkFolder: payload short link chung 1 nguồn)
    ├─ socialVerifyShareEncrypt → SocialShareServiceRepository.socialVerifyShareEncrypt
    └─ socialSearchSharedFolder → SocialShareServiceRepository.socialSearchSharedFolder → FileModelView / FolderModelView
 → SocialShareServiceRepositoryImpl             CS/data/_grpc/repositories/social_share_service_repository_impl.dart
    ├─ client       = GrpcClientFactory.createSocialShareClient()        → pb.SocialShareService (cần đăng nhập)
    └─ publicClient = GrpcClientFactory.createPublicSocialShareClient()  → publicsvc.PublicSocialShareService
```

**File cũ chỉ được THÊM (không đổi hành vi code có sẵn)**

- `CS/shared/network/cloud_grpc_factories.dart`: thêm `createSocialShareClient()`, `createPublicSocialShareClient()`.
- `CS/data/repository/shares/cloud_share_repository(_impl).dart`: thêm `createFileShortLink` / `createFolderShortLink` (chỉ uỷ quyền cho hàm private sẵn có).
- `MB/cloud_storage/cloud_storage.dart`: export cầu mới.
- Ngoại lệ **có đổi hành vi**: `PopupShareConfirmAccessCode` giờ verify bằng `CloudSocialShareRepository.socialVerifyShareEncrypt` thay cho `verifyAccessCode`, áp dụng cho **mọi** luồng mở popup (§10.2 #16–#17).
- `service_locator.config.dart` nằm trong `.gitignore`, nên sau khi pull cần chạy `/build -get`.

**Việc phía socialfi cần làm để chuyển** (do người phụ trách socialfi thực hiện)

| Chỗ gọi hiện tại (`SF/`) | Đang gọi | Đổi sang |
|---|---|---|
| `post/data/mapper/cloud_attachment_mapper.dart` (`resolveCloudAttachmentsForSubmit`) | `CloudShareTransponder.createShareLinks` | `CloudSocialShareTransponder.socialCreateShareLinks` |
| `post/domain/use_cases/search_shared_folder_use_case.dart` | `CloudShareTransponder.searchSharedFolder` | `CloudSocialShareTransponder.socialSearchSharedFolder` |
| `post/domain/use_cases/resolve_shared_attachment_link_use_case.dart` | `AppLinkCloudTransponder.resolveShareLink` | Giữ nguyên (chưa có bản social; bên trong vẫn `CheckShareTokenStatus` + `VerifySession`). Popup trong luồng này đã verify bằng social, nhưng chỉ trả **code** chứ không trả session (§10.2 #18) |

---

## 4. Luồng CREATE bài post có đính kèm

### 4.1 Sơ đồ

```
[Bấm icon Attach Cloud]  CreatePostToolbar (icAttachCloudFile) — ẩn khi comment / quote-một-comment
        │
        ▼
CreatePostPage._pickCloudAttachments(selected)
        │  _splitPickable: item KHÔNG có remoteId → "unpickable" (giữ nguyên)
        │  remaining = 8 - unpickable.length   (≤ 0 → không mở picker)
        ▼
CloudFilePickerTransponder.pickFromMyFile(allowFolder: true, showSystemFolders: true, maxCount: remaining, …RemoteIds)
        │  ── sang CLOUD ──  MyFilePickerSheet + MyFilePickerCubit + stack MyFileCubit
        │     duyệt:  🟦 SearchFilesInFolder / SearchRecoveryFiles, 🟦 GetFolderFileStats, 🟦 GetEncSettings
        │     confirm: prepareSelection (⬜ native getFileInfo + thumbnail)
        ▼  List<CloudPickedItem>   (rỗng = huỷ → giữ selection cũ)
[...unpickable, ...picked.toCloudAttachments()]   ← THAY THẾ selection cũ
        ▼
CreatePostEvent.updateCloudAttachments(list) → CreatePostState.cloudAttachments (dedupe theo id)
        │
[Bấm Publish]  CreatePostEvent.publishPost()  (edit mode → _onUpdatePost, xem §4.8)
        ▼
CreatePostUseCase: CloudSpaceGuard (chỉ media local) → DeviceStorageGuard → sandbox copy
        → PostQueueRepository.insertPendingPost → PendingPostRecord.cloudAttachmentIds (DB/)   ⬜ chưa gọi mạng
        ▼
PostUploadWorker (online; retry/backoff CHỈ với NetworkFailure)
        │  PublishPostUseCase → PostOutboxRepositoryImpl.publishPost
        │   ├─ _resumeAlreadySubmitted (đã có serverId → chỉ finalize)
        │   └─ _submitPendingRecord → _submitPendingRecordInner
        │        (0) _mediaUploader.run — upload media local
        │        (1) _backgroundGuard.protect('sf.publish'):
        │            _prepareSharedRequestFields: hashtag/mention, ngôn ngữ, resolveCloudAttachmentsForSubmit
        │               ├─ refreshPickedItems (⬜ local)   ← lỗi → THROW
        │               └─ createShareLinks (⬜ local → 🟦 Create*Link → ⬜ HTTP short link)
        │        (2) _enterPointOfNoReturn
        │        (3) _submitPendingCreate → toSharedFiles() → 🟩 PostHandler/CreatePost | CreateQuote
        │        (4) _updatePendingPostAfterPublish → _finalizeSubmittedRecord → 🟩 PostHandler/GetPost
        │            → PostChange.created (card pending → card thật, có link từ server)
```

### 4.2 Bước 1: Nút đính kèm và picker

| Bước | Ở đâu | Chi tiết |
|---|---|---|
| Nút | `SF/post/presentation/create_post/widgets/create_post_toolbar.dart` | Props `onPressedAttachCloudFile`, `showAttachCloudFile` |
| Ẩn/hiện | `create_post_page.dart` → `_showAttachCloudFile` | **Ẩn** khi đang viết comment hoặc quote một comment (các request đó không có `shared_files`). ⚠️ Vẫn lọt qua được bằng đường Draft (§10.1) |
| Tap | `create_post_page.dart` | `_pickCloudAttachments(selected: bloc.state.cloudAttachments)`, rồi `bloc.add(updateCloudAttachments(picked))` |
| Chia item | `_splitPickable` | Item **không có `remoteId`** thì vào `unpickable` và giữ nguyên. Item có `remoteId` thì truyền vào picker để pre-select |
| Giới hạn | `SFConstants.cloudAttachmentMaxCount = 8` (`SF/_shared/core/constants/sf_constants.dart`) | `maxCount = 8 - unpickable.length`. Nếu `≤ 0` thì không mở picker, không có toast. **Không** truyền `maxFileSizeBytes`, nên không giới hạn dung lượng |
| Kết quả | | `[...unpickable, ...picked]`. Kết quả **thay thế** selection cũ và **sắp lại thứ tự**: unpickable → file pre-select → folder pre-select → item mới tick. Entity từ picker có `localId`, **không có `link`** |

**Bên trong Cloud** (`CS/shared/widgets/bottom_sheet/my_file_picker/`):

- `CloudFilePickerTransponderImpl.pickFromMyFile`:
  - Lấy context từ `GoRouter.navigatorKey`.
  - `_loadViewItemsByRemoteId` tra ObjectBox theo remoteId. Id không có row local thì mở ra **không tick**. Row đang trong thùng rác **vẫn được tick**, vì bộ lọc soft-delete đang bị comment.
  - Mở `context.showMyFilePickerSheet(...)` (`CS/shared/extensions/bottom_sheet_extension.dart`).
  - Default của `showFilter` / `showViewModeSwitch` ở impl là `false` (interface ghi `true`). Vì vậy picker trong socialfi không có nút lọc và không có nút đổi grid/list.
- `MyFilePickerSheet`:
  - Giữ một stack `MyFileCubit`; mỗi lần vào folder thì `_pushFolder` tạo một cubit mới với `platform` và `space` của folder đó.
  - System folder chỉ hiện ở root: **Encrypted**, **Discover** (platform 5) và **File Restore** (`CloudSystemFolderMode.forMyFile`).
  - Ô search có debounce 400ms.
- `MyFilePickerCubit`:
  - `toggleSelection`: nếu `maxCount <= 1` thì chạy chế độ **single-select** (tick item mới thay item cũ, không có toast). Nếu đã đủ số lượng thì báo `reachLimit` và toast `selectUpToLimit`.
  - `_seedSelection` cắt bỏ phần pre-select vượt `maxCount`.
  - `prepareSelection` bổ sung width/height/duration/thumbnail.
- `my_file_picker_footer.dart` → `confirmMyFilePickerSelection`: selection rỗng thì không confirm được. Có item thì hiện loading → `prepareSelection` → `pop(items)`.

### 4.3 Bước 2: State trong composer

- `CreatePostState.cloudAttachments` (`SF/post/presentation/create_post/blocs/create_post/create_post_state.dart`):
  - Các getter `canPublish`, `canComment`, `isEmptyContent` đều **tính đính kèm là nội dung**. Quote một post mà chỉ có đính kèm thì vẫn là quote, không bị biến thành repost.
  - `_hasCloudChanges` so sánh danh sách id đã sort (dùng ở chế độ edit).
- Event `CreatePostEvent.updateCloudAttachments(list)` → `_onUpdateCloudAttachments`: **chỉ dedupe theo `.id`**, không validate, chỉ đổi state trong RAM.
- UI trong composer: `SF/post/presentation/create_post/widgets/create_post_cloud_files.dart` (`CreatePostCloudFiles`) gồm:
  - `CloudAttachmentPanel` + `CloudAttachmentRow` (style `.badge` cho item encrypted);
  - `CloudAttachmentSummary`: "N items • visibility", suy ra từ `PostPrivacy`.
  - Nút ✕ gửi lại event với danh sách đã bỏ item.

### 4.4 Bước 3: Kiểm tra dung lượng (Full Cloud)

- `CloudSpaceGuard.ensureRoomFor(List<LocalAttachmentEntity>)` (`SF/post/data/services/cloud_space_guard.dart`) được gọi **bên trong** `CreatePostUseCase` / `UpdatePostUseCase`, trước sandbox copy và trước `insertPendingPost`.
- Guard **chỉ cộng size media local**. **Đính kèm cloud không bị tính**, vì chỉ là tham chiếu.
- Guard nằm sau feature flag `ESFFeature.fullCloud`. Danh sách rỗng, flag tắt, hoặc `userSpace` null thì bỏ qua.
- Hết dung lượng thì luồng là: `CloudFullFailure` → `CreatePostEffect.cloudFullFail` → `FullCloudDialog.show`. Nút Upgrade gọi `toScreenUpgrade()` ở non-prod; bản prod chỉ hiện toast `comingSoon`.

### 4.5 Bước 4: Submit → Outbox (chạy được khi offline)

1. `create_post_appbar.dart` gửi `CreatePostEvent.publishPost()` → `_onPublishPost` tạo `CreatePostParams(cloudAttachments: state.cloudAttachments)`. Chế độ edit thì chuyển sang `_onUpdatePost` (§4.8).
2. `CreatePostUseCase.call` (`SF/post/domain/use_cases/create_post_use_case.dart`) có 4 nhánh:
   - **repost**: content, asset và cloud đều rỗng, có `parentPost` → gọi `repostPost` thẳng, không qua outbox;
   - **comment**: **không** chuyển `cloudAttachments`;
   - **quote**: có `cloudAttachments`;
   - **origin**: có `cloudAttachments`.
3. `PostQueueRepositoryImpl.insertPendingPost` (`SF/post/data/repositories/post_repository_queue.dart`):
   - ghi `PendingPostRecord.cloudAttachmentIds = encodeCloudAttachmentIds(...)` (entity ở `DB/tables/social_fi/pending_post_model.dart`);
   - phát `PostChange.addedPendingPost` (card pending mang sẵn `cloudAttachments` từ RAM);
   - đặt status `queued`.
   - **Chưa gọi mạng.**
4. `publishSuccess(draftId)` được phát **ngay lúc này**, tức chỉ nghĩa là row đã vào outbox. Draft nguồn bị xoá luôn (§4.7).

**Định dạng `cloudAttachmentIds`** (`SF/post/data/mapper/cloud_attachment_mapper.dart`, hàm `encodeCloudAttachmentIds`):

| Prefix | Khi nào | Khi submit |
|---|---|---|
| `file:<localId>` / `folder:<localId>` | Item có localId (**ưu tiên**; mọi item vừa đi qua picker đều có) | Đọc lại từ DB local. **Không mang link**, nên sẽ mint link mới |
| `remote:<PostSharedFile JSON>` | Chỉ có remoteId (item cũ của post đang edit, chưa pick lại) | Dùng nguyên, **giữ link cũ** |
| (bỏ) | Không có id nào | Bị loại |

### 4.6 Bước 5: Worker gửi lên server

`PostUploadWorkerImpl` (`SF/post/application/post_upload_worker_impl.dart`) nghe `pendingPostsStream` cùng trạng thái mạng, rồi đi `PublishPostUseCase` → `PostOutboxRepositoryImpl.publishPost` (`SF/post/data/repositories/post_repository_outbox.dart`). Thứ tự xem ở sơ đồ §4.1. Chi tiết:

1. **Share link chỉ được mint SAU KHI media local đã upload xong.** Upload lỗi thì không mint link nào.
2. **`resolveCloudAttachmentsForSubmit`** (chạy **trước** `_enterPointOfNoReturn`):
   - Ref local → `refreshPickedItems`:
     - row không còn → bỏ item, **không báo**;
     - row trong thùng rác → giữ lại với `deletedAt` (`isAvailable = false`);
     - thiếu `CloudFilePickerTransponder` hoặc lookup lỗi → **throw**.
   - Ref `remote:` → dùng nguyên.
   - Item `isAvailable`, có `remoteId` và **chưa có `link`** → gom lại, gọi `createShareLinks` **một lần** cho cả batch. Giá trị trả về là **short link URL** `{inviteUrl}/{key}/2`, được gán vào `link` (định dạng và payload: §1.3).
     - Thiếu `CloudShareTransponder` thì **không throw**; post đi mà không có link.
     - Từng item lỗi (RPC, short link, không có row local) → `link = null`, **không làm fail post**.
     - Riêng bước tra DB `_subjectsOf` nằm ngoài try/catch; lỗi ở đó làm fail cả lần submit.
   - ⚠️ Link vừa mint **không được ghi lại** vào `PendingPostRecord`. Mỗi lần thử lại submit sẽ mint link mới (§10.2).
3. **`_submitPendingCreate`**:
   - `contentType = PostContentType.fromMimeTypes(mimes, hasSharedFiles)`: không có media mà có đính kèm thì ra `PostContentType.file`; có media thì tính theo mime.
   - `sharedFiles: cloudAttachments.toSharedFiles()` (`SF/post/data/mapper/post_shared_file_mapper.dart`):
     - `sortOrder` = index, `type` = `'file'` / `'folder'`;
     - **có gửi** `link`, `space`, `metadata`, `updatedAt`, `deletedAt` (item trong thùng rác vẫn lên server, kèm `deletedAt` và không có link);
     - **không gửi** (wire không có field): size, thumbnail, width/height, duration, createdAt, localPath, `path` / `itemCount` của folder.
   - Ghi `rpcAttemptedAt`, rồi gọi RPC theo loại post:

| Loại post | RPC | `shared_files`? |
|---|---|---|
| Post gốc | 🟩 `PostHandler/CreatePost` | ✅ |
| Quote một post | 🟩 `PostHandler/CreateQuote` | ✅ |
| Quote một comment | 🟩 `CommentHandler/CreateQuote` (`CreateQuoteCommentRequest`) | ❌ bị bỏ, nhưng link **vẫn bị mint vô ích** |
| Comment | 🟩 `CommentHandler/CreateComment` | ❌ (nhánh comment đã bỏ đính kèm từ use case, nên không mint) |

4. **Finalize**: 🟩 `PostHandler/GetPost` → `PostChange.created`. Card pending được thay bằng bản server (có `link` thật).
5. **Retry**: `decideUploadRetry` chỉ retry với `NetworkFailure`. Lỗi resolve (`StateError`, ObjectBox) thành `UnknownFailure` → `GiveUp`: card chuyển sang failed ngay, user phải bấm Retry.

Payload mapping nằm ở `post_repository_outbox_payloads.dart`.

### 4.7 Draft (lưu nháp)

- **Lưu**: `CreatePostAppbar.confirmSaveDraft` (`widgets/create_post_appbar.dart`):
  - text, asset và cloud đều rỗng thì pop luôn, không hỏi;
  - giới hạn **10 draft** là hard-code, chỉ kiểm ở UI và chỉ áp dụng khi tạo draft mới;
  - dispatch `DraftsPostEvent.saveDraft(cloudAttachments)` kiểu fire-and-forget rồi pop;
  - chuỗi lưu: `SaveDraftPostUseCase` → `PostDraftRepositoryImpl.saveDraft` → `DraftPostEntityMapper.toRecord` (cùng encoding).
  - **Chỉ local**: không gọi mạng, không mint link.
- **Khôi phục**: resolve chạy lúc `DraftsPostBloc` load danh sách (khi mở composer), **không phải** lúc chọn draft.
  - Chuỗi: `DraftPostRecordMapper.toEntity` → `resolveCloudAttachments` (best-effort).
  - Lỗi thì **cả danh sách thành `[]`**, kể cả ref `remote:`. Row local đã mất thì item bị loại mà không báo.
  - Chọn draft thì `_onSelectDraft` gán `cloudAttachments`. UI: `widgets/create_post_drafts.dart` (`_DraftCloudAttachmentList`).
- Draft chỉ có ở chế độ **create**. Ở edit, nút Drafts bị ẩn và Cancel đi `confirmDiscardEditChanges`.
- Draft **không lưu** `sharedPost` / `isComment`.

### 4.8 Edit bài post có đính kèm

1. **Kiểm tra quyền sửa**:
   - tap Edit → `ReactionEvent.editPost` → `CheckEditPostEligibilityUseCase`;
   - check local trước (post bị ban, đã có pending edit → `postIsPending`), rồi gọi 🟩 `PostHandler/CheckPostEditable` (`checkPendingStatus`, `checkEditCount`);
   - qua được thì `ReactionState.editEligible` → shell push `CreatePostArgs.edit(post)`.
   - `postToEdit` là snapshot lấy từ feed, không fetch lại.
2. **Nạp**: `post_mapper.dart` → `sharedFiles.toCloudAttachments()`. Item có `remoteId`, **không có `localId`**; `link` có thể null nếu lúc tạo mint thất bại. `CreatePostBloc` khởi tạo với `postToEdit.cloudAttachments`.
3. **Mở lại picker** (nếu user mở):
   - item cũ được pre-tick nếu có row local theo remoteId;
   - item không có row local thì mở ra **không tick**, và vì có `remoteId` nên cũng **không** nằm trong `unpickable`, dẫn tới **bị mất khi confirm** mà không báo;
   - item được pre-tick rồi confirm sẽ thành entity mới (có `localId`, **mất link cũ**), khi submit sẽ **mint link mới**;
   - chỉ item **không đi qua lần confirm nào** mới giữ ref `remote:` và link cũ.
4. **Save**:
   - `_onPostPressed` pop luôn nếu `!hasUnsavedEditChanges`. `_hasCloudChanges` so id đã sort, nên re-pick đúng tập cũ thì không tính là thay đổi;
   - thu hẹp audience thì có dialog xác nhận;
   - sau đó `_onUpdatePost` → `UpdatePostUseCase` (`SF/post/domain/use_cases/update_post_use_case.dart`) → `PostQueueRepositoryImpl.insertPendingEdit` (thay thế pending edit cũ, **không phát `PostChange`**). Card cũ giữ nguyên nội dung và đính kèm; chỉ có `PostEditUploadSection` hiện trạng thái upload.
5. **Worker**: `_prepareSharedRequestFields` (refresh + mint như create) → `_submitPendingEdit` → `toSharedFiles()` → **gửi TOÀN BỘ danh sách** (kèm `version = baseVersion`). Routing chỉ dựa vào `record.postType`:

| Loại post | RPC |
|---|---|
| Quote (mọi quote) | 🟩 `PostHandler/UpdateQuote` |
| Comment | 🟩 `CommentHandler/UpdateComment` (không có `shared_files`) |
| Còn lại | 🟩 `PostHandler/UpdatePost` |

6. **Finalize**: 🟩 `PostHandler/GetPost` → `PostChange.updated`.

> "Bỏ item khỏi danh sách tức là thu hồi" (comment BR-14) là **giả định phía client**. Thực tế:
> - Item chỉ bị gỡ **tham chiếu** khỏi post; share link vẫn sống vĩnh viễn (không ai gọi `RevokeSharedLinks`).
> - Comment trong proto `UpdatePostRequest.shared_files` lại ghi "to add". **Cần xác nhận với backend.**

---

## 5. Luồng VIEW bài post có đính kèm

### 5.1 Sơ đồ

```
🟩 GetFeed | GetPost | SearchPosts | … → PostCard.shared_files (field 34)   (feed có cache offline: PostCacheRecord)
        ▼
post_mapper.dart: sharedFiles.toCloudAttachments() → PublishPostEntity.cloudAttachments
        │   (origin & quote; repost không có field nhưng card repost vẽ lại post gốc → vẫn thấy đính kèm)
        ▼
PostContentSection.buildCloud() → _PostCloudSection
        ├─ Feed / quote nhúng : CloudAttachmentGrid  (1 item full; 2–4 đủ ô; >4: 3 ô + "+N" → post detail)
        └─ Post detail        : CloudAttachmentList  (panel cuộn, maxHeight 230)
             └─ CloudAttachmentRow → CloudAttachmentThumb → CloudTransponderUi.pickedItemIcon (⬜ /thumbnail/{hash})
[Tap item]  (tắt nếu post.isPending server-side, hoặc bị overlay review che)
        ▼
ReactionEvent.openCloudItem → ReactionBloc._onOpenCloudItem  (droppable: tap khi đang xử lý bị bỏ; không loading)
        │  link = isAvailable ? attachment.link : null     → null: return IM LẶNG
        ▼
ResolveSharedAttachmentLinkUseCase → AppLinkCloudTransponder.resolveShareLink(link)   (chi tiết §5.4)
        ▼  CloudAccessEntity | null   → null: return IM LẶNG
attachment.copyWith(space, deletedAt) → !isAvailable → NotFoundFailure → toast
        ├─ FILE   → OpenSharedFolderFileUseCase(gallery: []) → CloudStorageTransponder.openFile   (không kèm token)
        │            image → CloudStorageRoute.cloudStorageImageByHashPreview
        │            video → CloudStorageNavigator.pushVideoPlayerByFileHash (origin: shareLink)
        │            khác  → NewCloudFileUtils.openFileByHash (cache hoặc ⬜ downloadFileHttp → app hệ thống)
        └─ FOLDER → ReactionState.navigateToSharedFolder → listener social_fi_shell (chỉ khi isTopMost)
                     → context.pushUnique('/shared-folder', extra: SharedFolderArgs(access, attachment))
                     → SharedFolderBloc.fetchPage → SearchSharedFolderUseCase → CloudShareTransponder.searchSharedFolder
                     → 🟦 PublicShareService/SearchSharedFolder
```

### 5.2 Mapping proto → entity

- `PostCard.sharedFiles` (`SF/_shared/data/proto_generated/common/post.pb.dart`, field 34).
- `SF/post/data/mapper/post_mapper.dart`: `final cloudAttachments = sharedFiles.toCloudAttachments();` rồi truyền vào `PublishPostEntity.origin` và `.quote`.
  - Entity `repost` / `comment` không có đính kèm (getter trả `[]`).
  - Card repost vẽ lại `OriginPostCard` / `QuotePostCard` của `parentPost` (map đệ quy), nên **vẫn hiển thị và tap được** đính kèm của post gốc.
  - Post có parent mà chỉ mang `sharedFiles` được phân loại là **quote** (`postTypeEnum`).
- `PostSharedFileX.toCloudAttachment()` (`post_shared_file_mapper.dart`):
  - `type == 'folder'` → `.folder(...)`, ngược lại → `.file(...)`.
  - Chỉ `uniqueHash`, `space`, `folderId`, `link`, `fileMimeType` đổi chuỗi rỗng thành null. `id`, `name`, `fileHash`, `fileType`, `fileExt` giữ nguyên `''`.
  - `platform` / `metadata` / `updatedAt` / `deletedAt` chỉ đọc khi `has*()`. Timestamp parse bằng `toDateTime()` **không `toLocal`**, nên ra giờ UTC.
  - Wire **không có** `created_at`, size, thumbnail, width/height/duration, localId.
  - **Không sort theo `sortOrder`** khi đọc: giữ nguyên thứ tự server trả về.

### 5.3 UI hiển thị

Mọi widget nằm ở `SF/_shared/presentation/widgets/cloud_attachment/`, trừ các file có ghi đường dẫn khác.

| Widget | Vai trò |
|---|---|
| `post_card/published_post/sections/post_cloud_section.dart` (`_PostCloudSection`) | Chọn Grid (feed, quote nhúng) hay List (`isExpandedView` = detail). Tắt tap khi `post.entity.isPending` (trạng thái **server** `PostStatus.pending`, vd. đang transcode, kể cả post đã edit) hoặc `!interactive` (overlay kiểm duyệt đang che) |
| `post_card/pending_post/pending_post_card.dart` (`PendingPostCard`) | Post **trong outbox local**: vẽ `CloudAttachmentGrid` **không có** handler tap, bọc trong `IgnorePointer` + opacity 0.6. Dữ liệu từ `getPendingPosts` (loại các row edit) → `resolveCloudAttachments` |
| `CloudAttachmentGrid` | 1 item: full width. 2–4 item: đủ ô (2 cột). > 4 item: 3 ô + `_OverflowCell('+N')`, bấm vào thì mở post detail |
| `CloudAttachmentList` | Post detail: `CloudAttachmentPanel(maxHeight: 230)`, row có `trailing: open`, không cắt bớt |
| `CloudAttachmentPanel` | Khung viền + divider, cuộn khi vượt maxHeight |
| `CloudAttachmentRow` | Thumb + tên + subtitle + trailing. Trailing chỉ có khi `trailing == open`: folder `icArrowRight`, file `icExternalLink`, không khả dụng `icInformation`. Item không khả dụng không hiện tên mà hiện "No longer available" (grid, bản ngắn) hoặc "This content no longer available" (list), và tắt tap |
| `CloudAttachmentThumb` | Không khả dụng → `icFileUnavailable`. Transponder null → ô trống. Còn lại → `CloudTransponderUi.pickedItemIcon`. Item `encryption` ở màn VIEW dùng style `.placeholder` (frosted + ổ khoá) |
| `cloud_attachment_visuals.dart` | Style chung + nhãn loại (Folder / Document / Image / Video / Audio / Archive / File) |
| `CloudAttachmentSummary` | **Chỉ dùng trong composer** |

**Thumbnail**: `_PickedFileIcon` chỉ stream thumbnail khi file là image/video và có `fileHash`, qua `FileUtils.getThumbnailStreamUrl(fileHash)`. Nó **bỏ qua** field `thumbnail` của entity. Icon hiện ngay, thumbnail fade-in sau.

**`isAvailable`** = `deletedAt == null && space != privacy`. Giá trị tính từ dữ liệu wire, rồi được cập nhật lại sau `CheckShareTokenStatus`.

### 5.4 Giải share link (`resolveShareLink`), từng bước

| # | Bước | Nhóm | Kết quả |
|---|---|---|---|
| 1 | `parseShareKeyFromLink`: lấy segment đầu của `http(s)://host/{key}/{type}` | ⬜ | key |
| 2 | `CloudShareRepository.parseShortKey` → `ShortLinkService.getKeyValueFromServer` | ⬜ HTTP `/get_kv` | payload JSON (`token`, `file_name`, `access_code`, `attach_code`, …) |
| 3 | `checkShareTokenStatus(token)` | 🟦 `CheckShareTokenStatus` | `space`, `deletedAt`. Lỗi → `space = ''` |
| 4 | `space == 'normal'` → trả token luôn | — | public |
| 5 | Mọi space khác (`encryption`, `privacy`, `restore`, **`''`**): đọc session từ `CloudSessionTokenDB` → `verifySession` | ⬜ + 🟦 `VerifySession` | `valid` và có session → trả `sessionToken` |
| 6 | Không có session hợp lệ → `_askAccessCode`: push **màn full-screen** `PopupShareConfirmAccessCode` (MaterialPageRoute) | 🟦 `PublicSocialShareService/SocialVerifyShareEncrypt` (mỗi lần nhập; popup gọi thẳng `CloudSocialShareRepository`) | Đúng → trả **`accessCode`** = code vừa nhập; session **không** được lưu. Đóng màn → `token = null` |
| — | Mọi exception | — | `token = null` |

⚠️ Bước 6 **bỏ qua** `access_code` / `attach_code` có sẵn trong payload, dù item `encryption` được mint với `attachCode: true`. Xem rủi ro §10.2.

### 5.5 Trang Shared Folder

| Thành phần | File / chi tiết |
|---|---|
| Route | `SF/_shared/router/socialfi_route_paths.dart` (`sharedFolder = '/shared-folder'`), `social_fi_pages.dart`. `extra` không phải `SharedFolderArgs` → `NotFoundPage`. Tạo `getIt<SharedFolderBloc>(param1: args)` |
| Page | `SF/post/presentation/shared_folder/pages/shared_folder_page.dart`: badge "View only" (`sfCloudViewOnly`), pull-to-refresh, `PaginatedListView.sliver`, rỗng thì hiện `noData` (BR-16) |
| Row | `_SharedEntryRow` = `CloudAttachmentRow(thumbSize: 56, showItemDetails: true)`. Subtitle file: `"<Loại> - <size>"`. Folder: `"Folder - N items"` nếu có `itemCount`. Chỉ folder có trailing |
| Folder con | `_openFolder` → `context.pushNamed(SFRouteNames.sharedFolder)` (chồng được nhiều cấp), **dùng lại token**, `folderId` = `folder.remoteId` |
| File | `SharedFolderEvent.openFile` → `_onOpenFile` → `OpenSharedFolderFileUseCase(gallery: ảnh đã tải, galleryHasMore, galleryTotal, onGalleryLoadMore)` |
| Bloc | `blocs/shared_folder_bloc.dart`: `PaginatedBloc<CloudAttachmentEntity, SharedFolderAccessFilter>`, `fetchPage` → `SearchSharedFolderUseCase` |
| Phân trang | ES cursor: `pit` đi trong `PaginatedSearchKey.nextCursor`, `searchAfter` đi trong filter. Trang kế tiếp có khi `nextCursor = hasMore ? pit : null` khác rỗng. Vì `searchAfter` là list protobuf (không bao giờ null), trên thực tế `hasMore ≡ entries.isNotEmpty`, nên list chỉ dừng khi gặp một trang rỗng |
| Mapping | `SF/post/data/mapper/cloud_shared_entry_mapper.dart` (`CloudSharedEntryX.toCloudAttachment`): có size/thumbnail/width/height/duration/itemCount, **không** có space/link |
| Thứ tự | `created_at DESC`; file và folder xen kẽ, không gom folder lên đầu |

- **Không có tìm kiếm theo từ khoá** trong folder share. "Search" chỉ là tên RPC liệt kê; `filters` / `platforms` không được set.
- **Không có** save-to-my-cloud / favorite / download riêng cho từng đính kèm.

### 5.6 Xử lý lỗi và quyền

| Tình huống | Kết quả |
|---|---|
| `link == null` hoặc wire đã báo item không khả dụng | Tap không làm gì |
| Lỗi parse key / getKV / VerifySession, hoặc user đóng màn nhập code | Return im lặng (không toast, không loading) |
| `CheckShareTokenStatus` lỗi | Flow **không dừng**: `space = ''`, đi tiếp VerifySession và màn nhập code, **kể cả link public** |
| Có token nhưng item đã xoá hoặc thuộc privacy | `NotFoundFailure` → `openCloudItemFailure` → `_showFailureToast`: toast **info** với text `accountDeactivatedMessage` ("This account has been deactivated"). ⚠️ Sai ngữ cảnh (§10.2) |
| Transponder chưa đăng ký / `openFile` throw | Toast lỗi `somethingWentWrong` |
| `SearchSharedFolder` lỗi | Trạng thái lỗi của paginated list (không hiện là rỗng) |
| Link hết hạn | `resolveShareLink` **không** kiểm tra `expiredAt`. File vẫn mở được (theo hash); folder chỉ lộ lỗi khi `SearchSharedFolder` fail. (Link do post mint thì không có hạn) |

---

## 6. Các luồng liên quan

### 6.1 Lịch sử chỉnh sửa (edit history)

- Luồng gọi: nhãn "Edited" ở header post → `EditHistoryBottomSheet` → `EditHistoryBloc` → **một** lần gọi 🟩 `PostHandler/GetPostEditHistory` (`limit 9999`, không phân trang).
- Mapping: `PostEditHistoryMapper` → `changes.toProto3Json()` → `EditHistoryChangeEntity.fromJson`. Mỗi phần tử `sharedFiles.before/after` được decode bằng `PostSharedFile()..mergeFromProto3Json(entry)` → `toCloudAttachment()` (`SF/post/domain/entities/edit_history_entry_entity.dart`).
- `_changeRows` (`edit_history_rows.dart`) diff theo `attachment.id` và chỉ hiện **số lượng** file/folder thêm/bớt (`sfEditHistoryFileAdded/Removed`, `sfEditHistoryFolderAdded/Removed`):
  - không hiện tên, không tap được, không gọi Cloud;
  - đổi thứ tự không tính là thay đổi.

### 6.2 Favorite cả bài post (không phải đính kèm)

`FavoritePostUseCase` (`SF/post/domain/use_cases/favorite_post_use_case.dart`) chạy theo thứ tự:

1. 🟦 `pb.FavoriteConfigService/GetFavoriteLimitUsage` (qua `CloudFavoriteTransponder.getFavoriteLimitUsage`). Vượt hạn mức thì hiện `cloudFavoriteLimitPopup`.
2. `favFolderPickerSheet` (UI Cloud).
3. 🟩 `PostHandler/FavoritePost(postId, folderId)` hoặc `UnfavoritePost`.
4. `notifyExternalFavoriteChanged` (local, qua `FavoriteExternalBus`).

Luồng này **không** gọi `pb.ExternalDataService`. Mở lại post từ Favorites đi qua `SocialFiTransponder.postDetailPath` → 🟩 `GetPost`.

### 6.3 Deep link / thẻ share trong IM (luồng khác mở cùng loại link)

`DeepLinkService.handleDeepLinkOnHomePage` hoặc `MessageContentShareCubit.onOpenCloudFileLink` → `AppLinkCloudTransponder.handle(key)`:

1. ⬜ getKV.
2. Payload có `attach_code` + `access_code` → **mở thẳng**. Public cũng mở thẳng.
3. Còn lại: 🟦 VerifySession → màn nhập code. Popup dùng chung nên cũng verify bằng 🟦 `SocialVerifyShareEncrypt`, sau đó truyền code vừa nhập vào `GetShareLink` (xem §10.2 #16).
4. 🟦 `publicsvc.PublicShareService/GetShareLink` → kiểm tra `expiredAt` (`PopupShareExpired`) → `handleShareFile`.

So với luồng tap trong post:

- `handle()` **không** gọi `CheckShareTokenStatus`;
- `handle()` **có** dùng code nhúng sẵn và **có** kiểm tra hết hạn;
- folder mở bằng `launchUrl` ra **trình duyệt**, không vào `SharedFolderPage`.

### 6.4 Realtime

**Không có** sự kiện realtime riêng cho thay đổi đính kèm:

- SSE chỉ có `unread_count`, `post_deleted`, `post_status_updated`, `post_indicator`. Với `post_status_updated`, `PostSseChangeBridge` gọi lại 🟩 `GetPost` rồi emit `PostChange`.
- `PostPendingReconciler` poll 15s bằng 🟩 `ListPostByIDs` (seed bằng `MyPendingPosts`) cho các post đang `PostStatus.pending`.
- Khi Cloud đổi/xoá file (m2m `UpdatePostSharedFile` phía server), card chỉ cập nhật ở lần fetch sau. Kiểm tra "sống" duy nhất là `CheckShareTokenStatus` lúc tap.

---

## 7. Bảng tra: lúc nào gọi gRPC nào

Xếp theo thứ tự thời gian trong vòng đời một bài post.

| # | Thời điểm | Nhóm | RPC / cơ chế | Entry |
|---|---|---|---|---|
| 1 | Mở picker (trang đầu local trước), vào folder con/Discover/Encrypted, cuộn, gõ search, refresh, DB watcher | 🟦 CLOUD | `SearchService/SearchFilesInFolder` | `MyFileCubit` → `CloudMyFileRepositoryImpl.getFreshMore` |
| 2 | Vào File Restore trong picker | 🟦 CLOUD | `SearchService/SearchRecoveryFiles` | `MyFileCubit` → `SearchRecoveryFilesUseCase` |
| 3 | Mỗi `MyFileCubit.init` / refresh / DB thay đổi | 🟦 CLOUD | `FileService/GetFolderFileStats` | `MyFileCubit.getCountPrivacyAndSocialFi` |
| 4 | Tap Encrypted trong picker | 🟦 CLOUD | `EncFileService/GetEncSettings` | `EncryptedFileNavigator.openEncryptedFileInPicker` |
| 5 | Bấm confirm trong picker | ⬜ Native | `getFileInfo` (FFI) + thumbnail URL | `MyFilePickerCubit.prepareSelection` |
| 6 | Thêm/xoá item trong composer | — | chỉ state RAM (thumbnail vẫn qua ⬜ HTTP) | `_onUpdateCloudAttachments` |
| 7 | Lưu draft / mở composer (load draft) | ⬜ Local | ObjectBox | `DraftPostEntityMapper` / `resolveCloudAttachments` |
| 8 | Bấm Publish | ⬜ Local | Ghi `PendingPostRecord` | `insertPendingPost` / `insertPendingEdit` |
| 9 | Worker: upload media local | (SDK/HTTP) | `_mediaUploader.run` | `_submitPendingRecordInner` |
| 10 | Worker: làm mới item | ⬜ Local | `refreshPickedItems` | `resolveCloudAttachmentsForSubmit` |
| 11 | Worker: mint link (item available, chưa có link; tuần tự; **lặp lại mỗi lần retry**) | 🟦 CLOUD | `ShareService/CreatePublicLink` / `CreatePrivateLink` | `CloudShareTransponder.createShareLinks` |
| 11b | ngay sau mỗi lần #11 thành công | ⬜ HTTP | `/get_kv` (dò key) + `/op_kv` (ghi) | `CloudShareRepositoryImpl._createShortLinkCloud` / `_createShortLinkFolder` |
| 12 | Worker: tạo post | 🟩 SOCIAL | `PostHandler/CreatePost`, `PostHandler/CreateQuote` (hoặc `CommentHandler/CreateQuote` / `CreateComment`, không có `shared_files`) | `_submitPendingCreate` |
| 12' | Worker: sửa post | 🟩 SOCIAL | `PostHandler/UpdatePost`, `PostHandler/UpdateQuote` (hoặc `CommentHandler/UpdateComment`) | `_submitPendingEdit` |
| 13 | Worker: finalize | 🟩 SOCIAL | `PostHandler/GetPost` | `_finalizeSubmittedRecord` |
| 14 | Mở feed / detail / profile / search | 🟩 SOCIAL | `FeedHandler/GetFeed`, `PostHandler/GetPost`, `List*`, `SearchHandler/*` | feed / post / search data source |
| 15 | Render icon | ⬜ HTTP | `/thumbnail/{hash}` | `CloudTransponderUi` |
| 16 | Tap item: giải short key | ⬜ HTTP | `/get_kv` | `resolveShareLink` |
| 17 | Tap item: kiểm tra token | 🟦 CLOUD | `PublicShareService/CheckShareTokenStatus` | `resolveShareLink` |
| 18 | Tap item có `space != 'normal'` (kể cả `''`) | 🟦 CLOUD | `ShareService/VerifySession` | `resolveShareLink` |
| 19 | Không có session hợp lệ, user nhập code | 🟦 CLOUD | `PublicSocialShareService/SocialVerifyShareEncrypt` | `PopupShareConfirmAccessCode` (dùng chung cho post, deep link, IM) |
| 20 | Mở file | ⬜ HTTP | stream / download theo hash (không có token) | `CloudStorageTransponder.openFile` |
| 21 | Mở folder, cuộn, refresh, folder con, load-more gallery | 🟦 CLOUD | `PublicShareService/SearchSharedFolder` | `SharedFolderBloc.fetchPage` |
| 22 | Bấm Edit trên post | 🟩 SOCIAL | `PostHandler/CheckPostEditable` | `CheckEditPostEligibilityUseCase` |
| 23 | Xem lịch sử chỉnh sửa | 🟩 SOCIAL | `PostHandler/GetPostEditHistory` | `EditHistoryBloc` |
| 24 | SSE `post_status_updated` / reconciler poll 15s | 🟩 SOCIAL | `GetPost` / `ListPostByIDs`, `MyPendingPosts` | `PostSseChangeBridge` / `PostPendingReconciler` |
| — | Metadata file/folder đổi phía Cloud | server↔server | `post.v1.m2m.PostHandler/UpdatePostSharedFile` | **App không gọi** |

**Khi socialfi chuyển sang cầu social (§3.4)**:
- #11 đổi thành 🟦 `pb.SocialShareService/SocialCreatePublicLink` cho mọi space, không còn `CreatePrivateLink`.
- #21 đổi thành 🟦 `publicsvc.PublicSocialShareService/SocialSearchSharedFolder`.
- #19 đã là `SocialVerifyShareEncrypt` từ bây giờ.

**Mẹo nhớ**

- 🟩 **SOCIAL** = mọi thứ về **bài post**: ghi (Create/Update + GetPost finalize), đọc (Feed/GetPost/List/Search), quyền sửa (`CheckPostEditable`), lịch sử. Socialfi chỉ lưu **tham chiếu + link**.
- 🟦 **CLOUD** = mọi thứ về **file/folder và quyền chia sẻ**: duyệt/chọn (picker), mint link, giải link, liệt kê folder share. Socialfi luôn đi qua Transponder.
- ⬜ **Bytes** của file (ảnh/video/document/thumbnail) lấy qua **HTTP theo `fileHash`** từ storage node, **không kèm token**.

---

## 8. Data model và mapping

### 8.1 Chuỗi biến đổi

```
CREATE:
  CloudPickedItem ──toCloudAttachments()──▶ CloudAttachmentEntity ──encodeCloudAttachmentIds──▶ List<String> (DB/)
                                                   ▲                                                 │
                                                   └──── resolveCloudAttachments(ForSubmit) ─────────┘
                                                   │
                                                   └──toSharedFiles()──▶ PostSharedFile ──▶ 🟩 CreatePost / UpdatePost

VIEW:
  PostCard.sharedFiles ──toCloudAttachments()──▶ CloudAttachmentEntity ──toPickedItem()──▶ CloudPickedItem (vẽ icon/tên)
  CloudSharedEntry (folder share) ──toCloudAttachment()──▶ CloudAttachmentEntity
  PostEditHistory.changes.shared_files ──toProto3Json → mergeFromProto3Json → toCloudAttachment()──▶ Entity
```

### 8.2 Bảng mapper

Các file mapper nằm ở `SF/post/data/mapper/`.

| Tên | Loại | File | Từ → Đến |
|---|---|---|---|
| `CloudAttachmentPickedX.toCloudAttachment` | extension on `CloudPickedItem` | `cloud_picked_item_mapper.dart` | picked → entity (chưa có `link`; item bị xoá có `deletedAt = deleteAt ?? now`) |
| `CloudAttachmentPickedListX.toCloudAttachments` | extension on `List<CloudPickedItem>` | như trên | `sortOrder` = index |
| `CloudAttachmentPickedItemX.toPickedItem` | extension on `CloudAttachmentEntity` | như trên | entity → picked (chỉ để vẽ UI) |
| `cloudFileTypeFrom(String)` | top-level | như trên | chuỗi → `CloudPickedFileType` |
| `encodeCloudAttachmentIds`, `resolveCloudAttachments` (best-effort), `resolveCloudAttachmentsForSubmit` (throw + mint link) | top-level | `cloud_attachment_mapper.dart` | entity ↔ chuỗi lưu DB |
| `CloudAttachmentProtoX.toSharedFile`, `CloudAttachmentProtoListX.toSharedFiles` | extension | `post_shared_file_mapper.dart` | entity → proto |
| `PostSharedFileX.toCloudAttachment`, `PostSharedFileListX.toCloudAttachments` | extension | như trên | proto → entity |
| `CloudSharedEntryX.toCloudAttachment` | extension | `cloud_shared_entry_mapper.dart` | folder share → entity |
| `DraftPostEntityMapper` / `DraftPostRecordMapper`, `PendingPostModelMapper` | mapper | `draft_post_mapper.dart`, `pending_post_mapper.dart` | nơi gọi encode / resolve |

### 8.3 Entity chính

`SF/post/domain/entities/cloud/cloud_attachment_entity.dart` (freezed, sealed):

- `CloudFileAttachment`: name, fileHash, fileType, localId, remoteId, uniqueHash, ext, mimeType, size, thumbnail, localPath, width, height, duration, space, folderId, sortOrder, favorite, platform, **link**, metadata, updatedAt, createdAt, deletedAt.
- `CloudFolderAttachment`: name, localId, remoteId, uniqueHash, space, path, folderId, sortOrder, favorite, platform, **link**, itemCount, metadata, updatedAt, createdAt, deletedAt.
- Extension `CloudAttachmentEntityX`:
  - `id`: `remoteId` nếu **khác null và không rỗng**; nếu không thì `'local:$localId'` khi có `localId`; cuối cùng là `name`. Id local không phân biệt file/folder (§10.2).
  - `isFolder`.
  - `isAvailable = deletedAt == null && space != privacy`. Helper `isUnshareableCloudSpace` dùng để kiểm tra space privacy.
- `CloudAttachmentListX.available` / `hasUnavailable`.

`cloud_access_entity.dart` → `CloudAccessEntity{required String token, accessCode?, sessionToken?, space?, deletedAt?}`. Đây là "vé vào cửa" để liệt kê folder share; chỉ dùng ở luồng VIEW.

### 8.4 Proto `common.PostSharedFile`

File: `SF/_shared/data/proto_generated/common/post_file.pb.dart`.

| # | Field | # | Field |
|---|---|---|---|
| 1 | `id` (remoteId) | 10 | `file_mime_type` |
| 2 | `name` | 11 | `favorite` |
| 3 | `type` (`"file"` / `"folder"`) | 12 | `platform` (int64) |
| 4 | `space` | 13 | **`link`**: short link `{inviteUrl}/{key}/2` (§1.3), không phải token |
| 5 | `folder_id` | 14 | `metadata` (Struct) |
| 6 | `file_hash` | 15 | `sort_order` |
| 7 | `unique_hash` | 16 | `updated_at` |
| 8 | `file_type` | 17 | `deleted_at` |
| 9 | `file_ext` | | **không có** `created_at`, size, thumbnail, width/height/duration, path, itemCount |

---

## 9. Cách tìm kiếm nhanh

### 9.1 "Muốn tìm X thì mở file nào"

| Muốn tìm | File |
|---|---|
| Nút đính kèm + mở picker | `SF/post/presentation/create_post/pages/create_post_page.dart` (`_pickCloudAttachments`, `_splitPickable`, `_showAttachCloudFile`) |
| State / event trong composer | `SF/post/presentation/create_post/blocs/create_post/` |
| UI đính kèm trong composer | `SF/post/presentation/create_post/widgets/create_post_cloud_files.dart` |
| Tạo pending post / pending edit | `SF/post/data/repositories/post_repository_queue.dart` |
| Mint link + gửi RPC tạo/sửa post | `SF/post/data/repositories/post_repository_outbox.dart` (`_prepareSharedRequestFields`, `_submitPendingCreate`, `_submitPendingEdit`, `_finalizeSubmittedRecord`) |
| Encode / resolve đính kèm | `SF/post/data/mapper/cloud_attachment_mapper.dart` |
| Entity ↔ proto | `SF/post/data/mapper/post_shared_file_mapper.dart` |
| Entity ObjectBox | `DB/tables/social_fi/pending_post_model.dart`, `draft_post_record.dart` |
| Hiển thị trong post card | `SF/_shared/presentation/widgets/post_card/published_post/sections/post_cloud_section.dart`, `pending_post/pending_post_card.dart` |
| Widget đính kèm dùng chung | `SF/_shared/presentation/widgets/cloud_attachment/` |
| Xử lý tap item | `SF/post/presentation/feed/blocs/reaction/reaction_bloc.dart` (`_onOpenCloudItem`) + `SF/_shared/router/social_fi_shell.dart` |
| Trang folder share | `SF/post/presentation/shared_folder/` |
| Interface cầu nối | `MB/cloud_storage/*.dart`, `MB/app_link/app_link_cloud_transponder.dart` |
| Impl cầu nối | `CS/transponder/*_impl.dart` |
| Picker phía Cloud | `CS/shared/widgets/bottom_sheet/my_file_picker/`, `CS/pages/my_file/cubit/my_file_cubit.dart` |
| Tạo link / giải link / folder share (Cloud) | `CS/data/repository/shares/cloud_share_repository_impl.dart` |
| Wrapper gRPC Share | `CS/data/_grpc/repositories/share_service_repository_impl.dart` (`client` = ShareService, `publicClient` = PublicShareService) |
| Short link HTTP | `lib/app/core/services/short_link_service.dart` |
| Cầu social (interface + model `CloudSocialVerifyResult`) | `MB/cloud_storage/cloud_social_share_transponder.dart` |
| Impl cầu social | `CS/transponder/cloud_social_share_transponder_impl.dart` |
| Repo social | `CS/data/repository/shares/cloud_social_share_repository(_impl).dart` |
| Wrapper gRPC social | `CS/data/_grpc/repositories/social_share_service_repository(_impl).dart` (`client` = SocialShareService, `publicClient` = PublicSocialShareService) |

### 9.2 Keyword nên grep

| Chủ đề | Keyword |
|---|---|
| Entity / state | `CloudAttachmentEntity`, `CloudFileAttachment`, `CloudFolderAttachment`, `cloudAttachments`, `cloudAttachmentIds` |
| Proto / mapping | `sharedFiles`, `PostSharedFile`, `toSharedFiles`, `toCloudAttachment` |
| Cầu nối | `pickFromMyFile`, `refreshPickedItems`, `createShareLinks`, `searchSharedFolder`, `resolveShareLink`, `openFile` |
| Model bridge | `CloudPickedItem`, `CloudSharedEntry`, `CloudSharedFolderPage`, `CloudShareLinkAccess`, `CloudGalleryPage` |
| View | `openCloudItem`, `navigateToSharedFolder`, `SharedFolderArgs`, `sharedFolder` |
| Cloud nội bộ | `showMyFilePickerSheet`, `CloudSystemFolderType.social`, `StorageTypePlatform.socialFi` (platform `5`), `ShortLinkType.cloud`, `attachCode` |
| Rule nghiệp vụ trong comment | `BR-08`, `BR-11`, `BR-13`, `BR-14`, `BR-16`, `Q12` |

### 9.3 Lệnh grep mẫu (loại file generate)

```bash
# Mọi chỗ dùng đính kèm cloud trong socialfi
rg -n "cloudAttachments|sharedFiles" lib/features/socialfi \
   -g '!*.freezed.dart' -g '!*.g.dart' -g '!**/proto_generated/**'

# Ai dùng một transponder (grep theo tên interface; có caller không ghi <T>)
rg -n "CloudShareTransponder" lib/features/socialfi -g '!*.g.dart' -g '!*.freezed.dart' | rg -v import

# Liệt kê RPC path thật để biết thuộc nhóm nào
rg -n "'/(pb|publicsvc)\.\w+/" lib/features/cloud_storage/data/_grpc/proto_generated   # 🟦 CLOUD
rg -n "'/api\.v1\.authz\.\w+/" lib/features/socialfi/_shared/data/proto_generated      # 🟩 SOCIAL
```

**Quy tắc nhận diện nhanh theo package của RPC path**

| Package | Nhóm |
|---|---|
| `pb.<Service>` (một cấp) hoặc `publicsvc.*` | 🟦 CLOUD. Regex ở trên đã loại đúng `pb.m2m.*` |
| `api.v1.authz.*` | 🟩 SOCIAL mà tính năng này dùng. Proto socialfi còn `authorization.v1.*`, `api.v1.sdk`, `*.external.livestream`, nhưng không liên quan |
| `*.m2m.*` (kể cả `pb.m2m.*`, `storage.m2m.*`, `post.v1.m2m.*`) và `*.admin.*` | server-to-server / backoffice, **app không gọi** |

### 9.4 Quy ước đặt tên

- Interface là `XxxTransponder`, impl là `XxxTransponderImpl`.
- Cloud chia lớp như sau:

  ```
  proto_generated/
    → data/_grpc/repositories/*_service_repository_impl
    → data/repository/<area>/cloud_<area>_repository_impl
    → transponder hoặc cubit
  ```
- Mapper socialfi là extension tên `XxxX` / `XxxListX`. Hàm encode/resolve là hàm top-level.

---

## 10. Gotcha, rủi ro, comment lỗi thời

### 10.1 Hành vi dễ gây bất ngờ

1. **Picker thay thế chứ không append**, và sắp lại thứ tự. Cancel (kết quả rỗng) thì giữ nguyên. `maxCount <= 1` thì picker chạy single-select.
2. **Re-pick làm mất link cũ**: item được pre-tick rồi confirm sẽ thành ref local không có link, và khi submit được mint link mới. Item không có row local thì **bị mất** khi confirm.
3. **Quote một comment lọt đính kèm qua Draft**: nút đính kèm bị ẩn nhưng nút Drafts vẫn hiện. Chọn một draft có đính kèm thì panel vẫn render, worker **vẫn mint link**, rồi `toQuoteCommentRequest` bỏ `sharedFiles` đi mà không báo.
4. **`publishSuccess` xoá draft ngay khi row vào outbox**. Nếu worker fail về sau thì draft đã mất.
5. **Mở draft khi resolve lỗi** trả `[]` cho toàn bộ đính kèm. Nếu user lưu lại draft đó thì đính kèm **mất vĩnh viễn**.
6. **`CloudSpaceGuard` không tính đính kèm cloud** (đúng thiết kế).
7. **Mint link lỗi từng item không làm fail post**: item lên server với `link = null`, người xem tap vào không có phản hồi.
8. **Tap "im lặng"**: không có link, giải link lỗi, hoặc đóng màn nhập code thì không toast, không loading. Event `droppable()` nên tap tiếp trong lúc đang xử lý bị bỏ.
9. **Edit đang chờ gửi** không có card pending: card cũ vẫn hiện đính kèm CŨ cho tới khi finalize.
10. **Ảnh mở từ post có `gallery: []`**: không vuốt qua ảnh khác trong cùng post được.

### 10.2 Rủi ro / bug tiềm ẩn cần kiểm tra

| # | Rủi ro | Chi tiết |
|---|---|---|
| 1 | 🔴 **Đính kèm Encrypted bị hỏi access code** | Lúc CREATE, item `encryption` được mint private link với `attachCode: true` (code nằm sẵn trong payload để "recipient is let straight in"). Nhưng `resolveShareLink` **cố ý bỏ qua** code đó: không có session thì bắt người xem gõ một code do server sinh mà họ không biết. Cùng link đó mở qua `handle()` (deep link / IM) thì vào thẳng. Rủi ro này sẽ hết khi socialfi chuyển sang `socialCreateShareLinks`: link social không mang code, người xem nhập PIN chủ sở hữu qua `SocialVerifyShareEncrypt` |
| 2 | 🔴 **Mở file không cần token** | `openFile` chỉ dùng `fileHash`, mà `file_hash` có sẵn trên wire của post. Cổng access code của file encrypted vì vậy chỉ là UX phía client |
| 3 | 🟠 **Link không bao giờ bị thu hồi** | Link không có hạn. Bỏ item khi edit hoặc xoá post chỉ gỡ tham chiếu; không ai gọi `RevokeSharedLinks` |
| 4 | 🟠 **Mint lại link mỗi lần retry** | Link vừa mint không được ghi lại vào `PendingPostRecord`. Mỗi lần submit lại (RPC tạo post lỗi, user bấm Retry) sẽ tạo link + short link mới cho mọi ref local, để lại link mồ côi |
| 4b | 🟠 **Short link fallback là hash trần** | `ShortLinkService.createShortLink` hết key trống thì trả `hash` (không có `{inviteUrl}/…/2`). Chuỗi này vẫn được lưu vào `PostSharedFile.link`, nhưng `parseShareKeyFromLink` không parse được, nên đính kèm **hỏng vĩnh viễn** và tap im lặng. Nên trả URL đầy đủ, hoặc cho worker coi đây là lỗi |
| 4c | 🟡 **Payload short link đóng băng + lộ access code** | Tên, size, thumbnail, người chia sẻ trong KV không cập nhật theo Cloud. Với item encrypted, `access_code` nằm dạng rõ trong KV, ai có link đều đọc được qua `/get_kv` |
| 5 | 🟠 **Toast sai nội dung** | `NotFoundFailure` (item không khả dụng) hiện "This account has been deactivated" (`_showFailureToast` dùng chung) |
| 6 | 🟠 **`space` quyết định việc hỏi code** | `CheckShareTokenStatus` lỗi (`space = ''`) thì **link public cũng bị hỏi code**; nhập đúng code thì item vẫn mở được (vì `''` được coi như `normal`). Item privacy thì user thường không có code, đóng màn nhập code, và không nhận được thông báo nào |
| 7 | 🟡 **Soft-delete filter bị comment** | Trong `_liveInRequestedOrder` (dùng chung cho `refreshPickedItems` **và** pre-select của picker): row trong thùng rác/privacy vẫn được trả về và **được pre-tick**. Trong khi đó `createShareLinks._subjectsOf` **vẫn lọc** `isDeleted`, tức hai hàm của cầu nối xử lý không nhất quán. Socialfi đang dựa vào việc được trả về để hiện "No longer available" |
| 8 | 🟡 **Refresh `SharedFolderPage`** | Pull-to-refresh không reset `filter.searchAfter`, nên trang đầu gửi `pit = null` kèm `searchAfter` cũ, có thể ra sai trang |
| 9 | 🟡 **`totalImage` bị ghi đè null** từ trang 2 | `fetchPage` thay toàn bộ filter, nên `galleryTotal` = null sau khi load-more |
| 10 | 🟡 **Ngày trong image viewer** (bug #6324) | Wire không có `created_at`, nên ảnh mở từ post dùng `updatedAt` (và là giờ **UTC** vì không `toLocal`). Ảnh mở trong folder share có gallery thì **không có subtitle ngày**, vì `_galleryOf` không set `subTitle` |
| 11 | 🟡 **Dedupe va chạm id** | File và folder chưa sync (remoteId rỗng) mà cùng `localId` sẽ có cùng `id = 'local:x'`, nên `_onUpdateCloudAttachments` gộp làm một |
| 12 | 🟡 **`sortOrder` không dùng khi đọc** | Thứ tự hiển thị phụ thuộc hoàn toàn vào server |
| 13 | ⚪ `pickFromMyFile` default khác nhau | Interface để `showFilter` / `showViewModeSwitch = true`, impl để `false`. Dart dùng default của impl |
| 14 | ⚪ `favoriteSocialFi` / `unFavoriteSocialFi` | Chỉ `throw UnimplementedError`; đường thật là `CloudFavoriteTransponder.notifyExternalFavoriteChanged` |
| 15 | ⚪ `GetFolderFileStats` gọi quá nhiều | Mỗi `MyFileCubit` trong stack gọi một lần cho mỗi event DB (comment ghi "These counts are local") |
| 16 | 🔴 **Popup dùng chung đã verify bằng Social** | `PopupShareConfirmAccessCode` được mở từ `resolveShareLink` (post), `handle()` (deep link ngoài app) và thẻ share Cloud trong IM, và giờ **cả 3** đều verify qua `SocialVerifyShareEncrypt`. Ở `handle()`, code vừa được social chấp nhận lại truyền vào `GetShareLink(accessCode)`. Link Cloud thường (không phải đính kèm post) có thể bị endpoint social từ chối. **Cần BE xác nhận**; nếu không được thì phải tách popup, chỉ luồng post dùng bản social |
| 17 | 🟠 **Session không còn được lưu** | `verifyAccessCode` cũ lưu `sessionToken` vào `CloudSessionTokenDB`, còn popup bản social thì không. Vì vậy `VerifySession` ở lần mở sau không tìm thấy session, và người xem bị hỏi code **mỗi lần** mở |
| 18 | 🟠 **`SocialSearchSharedFolder` cần session** | Proto ghi rõ item encryption "requires encryption session". Nhưng `resolveShareLink` sau popup chỉ trả `accessCode`, không có `sessionToken`. Khi socialfi đổi sang `socialSearchSharedFolder`, folder encryption có thể không liệt kê được, nếu luồng không lấy `sessionToken` từ `socialVerifyShareEncrypt` |
| 19 | ⚪ **Code trùng lặp có chủ đích** | `_subjectsOf`, `_ShareSubject`, `_toSharedEntry` và phần map response trong cầu social là bản copy của code cũ, để không phải sửa code đang ổn định. Sửa logic bên này thì nhớ kiểm tra bên kia |

### 10.3 Comment / doc lỗi thời trong code

| Chỗ | Nói gì | Thực tế |
|---|---|---|
| `ReactionEvent.openCloudItem` và doc của `ReactionBloc._onOpenCloudItem` | File và folder cùng vào `SharedFolderPage` | File mở thẳng viewer |
| `SharedFolderArgs` | Nhắc `CloudAccessEntity.folderId` | Field này không tồn tại; folderId = `attachment.id` |
| `_PostCloudSection` | Tắt tap vì "id tạm thời" | `isPending` gồm cả post đã edit có id thật |
| `cloud_attachment_mapper.dart` | Nhắc `UnavailableCloudAttachment` | Class này không tồn tại |
| `cloud_attachment_mapper.dart` (`_refreshLocalRefs`) | Item chuyển vào Privacy sẽ vắng khỏi kết quả | Row vẫn được trả về với `space = privacy` |
| `cloud_picked_item_mapper.dart` | "Cloud Drive has not built share links yet" | Link đã được mint ở submit |
| Doc của `MB/cloud_file_picker_transponder.dart` + impl | Row trong thùng rác bị loại | Filter đang bị comment |
| `CloudShareTransponderImpl._subjectsOf` | "Same rule the picker applies" | Picker không còn lọc |
| `MB/app_link/app_link_cloud_transponder.dart`, `ResolveSharedAttachmentLinkUseCase` | Link hết hạn trả token null; use case trả entity có token null | Không kiểm tra expiry; use case trả `null`; `token` là `required String` |
| `app_link_cloud_transponder_impl.dart` (`resolveShareLink`) | "the sender chose not to attach it" | Link của post **luôn** `attachCode: true` với item encrypted |
| `MyFilePickerSheet` / `MyFilePickerContent` | System folder là "Privacy Space and SocialFi" | Thực tế là Encrypted, Discover, File Restore |
| `edit_history_mapper.dart`, `EditHistoryChangeEntity` | `changes` là `google.protobuf.Struct` | Là message có kiểu `PostEditHistoryChanges` |
| `FavoriteExternalBus` | Notify qua `favoriteSocialFi` | Đường thật là `notifyExternalFavoriteChanged` |
| Doc comment của `PendingPostRecord.cloudAttachmentIds` | Chỉ nhắc `<kind>:<localId>` | Còn có prefix `remote:` |
| Proto `UpdatePostRequest.shared_files` | "to add" | Client gửi **cả danh sách** (BR-14) |
| `create_post_page.dart` | Trích `docs/cloud-drive-post-attachment.md` | File này **không có** trong repo nào; các comment `BR-x` khác không nêu nguồn |
