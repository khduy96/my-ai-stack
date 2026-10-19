# Cloud storage – Layer rules

Luật về chiều import giữa các layer của module `lib/features/cloud_storage`.
Nguồn gốc: `lib/features/cloud_storage/tool/check_layers.dart`. Nếu file này và script khác nhau thì **script đúng**.

## Nguyên tắc chung

- Mọi code mới trong `cloud_storage` **không được tạo vi phạm mới**. Push bị chặn nếu có.
- `tool/layer_baseline.txt` là nợ cũ (~505 dòng), **chỉ được giảm**:
  - Không tự thêm dòng vào baseline để push cho qua.
  - `--generate` chỉ dùng khi đổi luật trong script.
  - Sửa được vi phạm cũ → chạy script (không `--summary`) để nó tự xoá dòng, rồi commit baseline cùng phần sửa.
- Sau khi sửa code trong `cloud_storage`, chạy `dart tool/check_layers.dart --summary` để kiểm tra.

## Cấu trúc layer

| Folder | Vai trò |
|---|---|
| `domain/` | Dart thuần: entities, `repositories/` (interface), use cases |
| `data/` | Impl của repository, data source, gRPC (`data/_grpc/`) |
| `application/` | Điều phối domain |
| `model_view/` | View model cho UI |
| `pages/`, `transponder/` | Màn hình, cubit |
| `shared/widgets/`, `shared/presentation/` | Code presentation dùng chung |
| `shared/routes/`, `shared/utils/navigators/` | Routing (được phép biết pages) |
| `shared/network/` | Dựng client gRPC (được phép dùng `data/`, `getIt`) |
| `database/tables/cloud_storage/` (ngoài module) | Bản ghi ObjectBox `CloudFile` / `CloudFolder`, **đang dùng làm entity** |

## Các luật

### Import

| Rule | Áp dụng cho | Cấm import | Cách sửa |
|---|---|---|---|
| `domain` | `domain/` | `data/`, `application/`, `model_view/`, `shared/presentation/`, `pages/`, `transponder/`, `shared/widgets/`, `shared/routes/`, `package:flutter/`, `package:grpc/`, `package:tbchat_main/database/` (**trừ** `database/tables/cloud_storage/`) | Khai báo interface/kiểu trong `domain/`, implement hoặc map ở `data/` |
| `presentation` | `pages/`, `shared/widgets/`, `shared/presentation/` | `data/`, `package:grpc/` | Inject use case hoặc interface `domain/repositories/` vào cubit |
| `ui-entity` | `pages/`, `shared/widgets/`, `shared/presentation/`, `model_view/` | `package:tbchat_main/database/` (**trừ** `database/tables/cloud_storage/`) | Lấy dữ liệu qua repository / use case, không dùng `tbchat_database.dart` |
| `application` | `application/` | `pages/`, `transponder/`, `shared/widgets/`, `shared/routes/` | Đi qua `domain/`, để phần UI cho `pages/` |
| `data` | `data/` | `pages/`, `transponder/`, `shared/widgets/`, `shared/routes/`, `package:go_router/`, `flutter/material.dart`, `flutter/cupertino.dart` | Trả kết quả để `pages/` hiện UI / điều hướng. Cần `ValueNotifier`, `debugPrint` → dùng `flutter/foundation.dart` |
| `data-entity` | `data/` | `model_view/` | Trả `CloudFile` / `CloudFolder` (bọc `CloudItem` nếu lẫn cả hai), cubit tự dựng view model |
| `model_view` | `model_view/` | `pages/`, `transponder/` | Chuyển kiểu ra khỏi `pages/`, ví dụ vào `domain/entities/` |
| `shared` | `shared/` (**trừ** `shared/routes/`, `shared/utils/navigators/`) | `pages/`, `transponder/` | Chuyển code vào page cần nó, hoặc truyền vào qua tham số |
| `shared-data` | `shared/` (**trừ** `shared/widgets/`, `shared/presentation/`, `shared/network/`) | `data/` | Chuyển vào `data/` nếu là logic data, hoặc truyền vào qua tham số |
| `cross-feature` | toàn module | `package:tbchat_main/features/...` | Dùng interface feature đó cung cấp trong `lib/module_bridge/` |

### Repository

| Rule | Yêu cầu | Cách sửa |
|---|---|---|
| `repository-location` | Mọi `abstract class / interface class *Repository` phải nằm trong `domain/repositories/` | Chuyển interface sang `domain/repositories/`, giữ `*Impl` ở `data/`. Nếu chỉ bọc client gRPC/HTTP và chỉ dùng trong `data/` → đổi tên thành `*DataSource` |
| `repository-contract` | Body của interface không được dùng: kiểu proto (`data/_grpc/storage_generated/`), `Map<String, dynamic>`, `VoidCallback`, `ValueNotifier`, `ValueListenable`, `BuildContext`, `Widget`, `GrpcError`, `ResponseFuture` | Tạo entity / params class trong `domain/`, map proto/JSON trong Impl. Trả kết quả thay vì nhận callback |
| `data-entity` | Body của interface không được dùng kiểu khai báo trong `model_view/` | Như trên |

Lưu ý: check này đọc body của interface, nên áp dụng cả với file `part of` (không có import riêng).

### Service locator (`getIt`)

| Rule | Áp dụng cho | Yêu cầu | Cách sửa |
|---|---|---|---|
| `cubit-locator` | Bên trong class `extends *Cubit` / `*Bloc` | Không gọi `getIt` | Thêm vào tham số constructor; injectable tự truyền, test truyền bản giả |
| `widget-locator` | Code UI (`pages/`, `shared/widgets/`, `shared/presentation/`) ngoài cubit | Chỉ được `getIt<XxxCubit>()` / `getIt<XxxBloc>()` để tạo cubit; không lấy service | Chuyển lời gọi vào cubit và đọc từ state, hoặc truyền vào qua tham số |
| `shared-locator` | `shared/` (**trừ** `shared/routes/`, `shared/utils/navigators/`, `shared/network/`) | Không gọi `getIt` | Truyền dependency qua tham số, hoặc chuyển lời gọi lên cubit đang dùng helper |

Các dạng bị bắt: `getIt<T>()`, `getIt.get<T>()`, `getIt.getAsync<T>()`, `GetIt.I<T>()`, `GetIt.instance<T>()`, `getIt()`. Code trong comment không bị tính.

### Cấu trúc

| Rule | Yêu cầu | Cách sửa |
|---|---|---|
| `shared-structure` | Không có file nào trong `shared/domain/` hay `shared/data/` | Entity → `domain/entities/`, code data → `data/` |

## File được bỏ qua

- `tool/`
- `data/_grpc/storage_generated/` (proto sinh ra)
- `*.g.dart`, `*.freezed.dart`, `*.mocks.dart`, `*.gr.dart`

## Lệnh

Chạy từ `lib/features/cloud_storage`:

```sh
dart tool/check_layers.dart              # báo cáo + tự xoá dòng đã sửa khỏi baseline; exit 1 nếu có vi phạm mới
dart tool/check_layers.dart --summary    # chỉ đọc, không ghi file (hook, CI, kiểm tra sau khi sửa)
dart tool/check_layers.dart --list       # liệt kê vị trí mọi vi phạm đã biết
dart tool/check_layers.dart --list=data  # chỉ một rule
dart tool/check_layers.dart --generate   # dựng lại baseline – CHỈ khi đổi luật
```

Git hook pre-push (cài một lần, `cloud_storage` là git repo riêng):

```sh
git config core.hooksPath tool/githooks
```

Bỏ qua hook một lần: `git push --no-verify` (không khuyến khích).

## Checklist khi viết code mới

1. Cubit nhận repository / use case qua constructor, không `getIt`.
2. Widget chỉ dùng `getIt` để tạo cubit.
3. Interface repository đặt trong `domain/repositories/`, Impl trong `data/`.
4. Contract repository chỉ dùng kiểu của domain (không proto, `Map<String, dynamic>`, kiểu Flutter, callback).
5. `data/` trả `CloudFile` / `CloudFolder` / entity domain, không trả view model.
6. `shared/` không import `pages/`; model dùng chung đặt ở `domain/entities/` hoặc `model_view/`, không để trong `pages/`.
7. Gọi feature khác qua `lib/module_bridge/`.
8. Chạy `dart tool/check_layers.dart --summary` → phải ra `No new violations`.
