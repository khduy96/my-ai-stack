# Backend — 2 server / 2 team riêng biệt

> Ghi chú ngày: 2026-10-05
> Phạm vi: `lib/features/cloud_storage/data/`

Module Cloud Storage nói chuyện với **2 server riêng biệt**, do **2 team BE khác nhau** phát triển.
Khi có bug / thay đổi API, phải xác định đúng code thuộc phía nào để báo đúng team.

| Team | Thư mục | Cách giao tiếp |
|---|---|---|
| **VN BE** | `lib/features/cloud_storage/data/_grpc` | gRPC (proto kéo từ Buf Schema Registry) |
| **HK BE** | `lib/features/cloud_storage/data/native_handle` | FFI → native SDK (`NativeBindings`) |

---

## 1. VN BE — `data/_grpc`

Gọi thẳng gRPC từ Dart. Contract là file `.proto` trên BSR, generate bằng `scripts/pull_buf_proto.dart`
(xem [pull_buf_proto.md](pull_buf_proto.md)).

Cấu trúc:

- `storage_generated/` — generate từ `buf.build/nexsoft/storage` (ref `dev`). **Không sửa tay.**
- `subscription_generated/` — generate từ `buf.build/nexsoft/subscription` (ref `dev`). **Không sửa tay.**
- `repositories/` — DataSource bọc client gRPC (`*_service_repository.dart` + `*_impl.dart`), log qua `CloudLogger.grpc`.
- `mapper/` — map proto ↔ model của app.

Client được tạo qua `shared/network/cloud_grpc_factories.dart` (`GrpcClientFactory`):

| Client | Proto module |
|---|---|
| `createFileClient` | storage |
| `createSearchClient` | storage |
| `createShareClient` / `createPublicShareClient` | storage |
| `createSocialShareClient` / `createPublicSocialShareClient` | storage |
| `createImFavoriteServiceClient` | storage |
| `createStoragePlanClient` | subscription |
| `createStorageOrderClient` | subscription |
| `createStorageUserSubscriptionClient` | subscription |

Commit proto hiện tại (file `.buf-commit`, lúc ghi note):

- storage: `02e9cc96eae5460284b904de0143cfc0` (generate 2026-10-01)
- subscription: `4dc136c932e546ebb27a536d08837d95` (generate 2026-10-01)

## 2. HK BE — `data/native_handle`

Không gọi server trực tiếp từ Dart — đi qua **native SDK** (FFI, `NativeBindings`). SDK do phía HK cung cấp
và tự nói chuyện với server HK (WebSocket, HTTP upload/download, P2P, on-chain).

Mỗi handler `extends EventHandler`. Các call bất đồng bộ dùng `NativeReceivePortHandle.event`
(timeout mặc định 20s, on-chain dùng `onChainTimeLimit` = 2 phút).

| Handler | Native binding |
|---|---|
| `connect_storage_ws_handler` | `StartWsClient` |
| `close_cloud_storage_ws_handler` | `CloseCloudConn` |
| `send_msg_web_socket_handle` | `SendMsgOfWs` |
| `cloud_storage_upload_init_handler` | `CleanCgoHandleByPort` |
| `cloud_socialfi_upload_init_handler` | `InitHttpSocialfiUpload`, `CleanCgoHandleByPort` |
| `get_upload_file_info_native_handle` | `GetUploadFileInfo` |
| `get_file_info_native_handle` | `GetFileInfo` |
| `http_save_file_native_handle(r)` | `HttpSaveFile` |
| `get_thumbnail_by_cloud_channel_native_handler` | `GetThumbnailByCloudChannel` |
| `get_del_file_sign_native_handle` | `GetDelFileSign` |
| `file_password_native_handle` | `CheckFilePwd`, `ResetFilePassword` |
| `approve_usdt_for_buy_space_handler` | `ApproveUsdtForBuySpace` (on-chain) |
| `buy_space_handler` | `BuySpace` (on-chain) |
| `set_cloud_proxy_handler` | `SetCloudProxy`, `SetLogLevel` |
| `run_cloud_p2p_native_handle` | `SetLogLevel`, `CleanMessageStructMemory` |
| `native_receive_port_handle` | helper chung (`CleanMessageStructMemoryByPort`) |

## 3. Quy tắc khi làm việc

- Lỗi / thiếu field ở response gRPC, proto thay đổi → báo **VN BE**.
- Lỗi upload/download, WebSocket, P2P, ký xoá file, thanh toán on-chain (approve/buy space) → báo **HK BE**.
- Một tính năng có thể dùng cả 2 phía (vd. luồng mua gói: tạo order qua gRPC `StorageOrder` của VN BE,
  rồi thanh toán on-chain qua `ApproveUsdtForBuySpace` / `BuySpace` của HK BE) → ghi rõ bước nào thuộc team nào khi báo bug.
- Code generated trong `_grpc/*_generated` không sửa tay — cần thay đổi thì yêu cầu VN BE cập nhật proto rồi pull lại.
