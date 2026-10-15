# Xây cây subagent cho my_store (app quản lý kho + đơn hàng)

## Mục tiêu
Tạo một **cây subagent Claude Code** cho dự án: một lệnh điều phối `/team <việc>` ở gốc, giao việc
cho 9 agent chuyên môn trong `.claude/agents/`, dùng được cho cả 4 loại việc — **code tính năng
mới, fix bug, review code, giải thích code**.

## Bối cảnh
- App Flutter `my_store` ("Warehouse App"), repo `D:\Felix\AppDemo\appDemo`, branch làm việc `dev-kho`
  (branch chính `dev`). Dart SDK `^3.9.2`, package import dạng `package:my_store/...`.
- Một app đơn khối, **không** chia module/package. Cấu trúc thật:
  - `lib/core/domain/` — `entities/`, `repositories/` (interface), `use_cases/<nhóm>/` (category,
    inventory, order, product) + `use_cases/use_case.dart` (`UseCase<T, Params>`,
    `NoParamsUseCase<T>`, `Result<T>`).
  - `lib/core/data/` — `datasources/<nhóm>/` (`x_datasource.dart` + `x_datasource_impl.dart`),
    `parse/` (`XParse extends ParseObject implements ParseCloneable`, `parse_paging.dart` với
    `fetchAllPages`), `models/` (`XModel extends X` entity, `fromParse`, `empty()`),
    `repositories/` (`*_repository_impl.dart`).
  - `lib/core/cache/` (`LocalCache` = sembast, `OfflineCache` = local-first read + write guard),
    `lib/core/sync/` (`SyncService`, `SyncTab`, `sync_button.dart`), `lib/core/network/`
    (`ConnectivityService`), `lib/core/parse/parse_init.dart`, `lib/core/services/cloudinary_service.dart`,
    `lib/core/config/`, `lib/core/error/` (`NoInternetException`), `lib/core/enum/`
    (`PageStatus`, `product_enum.dart`), `lib/core/di/` (get_it + injectable), `lib/core/router/`
    (go_router, chỉ có `/` và `/warehouse`), `lib/core/theme/` (`AppTheme`, `AppThemeId`, theme
    `senior` phóng chữ 1.25), `lib/core/utils/` (formatters, `money_input_formatter`).
  - `lib/features/<tab>/presentation/{bloc,pages,widgets}` — 5 feature: `home` (bottom nav +
    IndexedStack + toast "hàng cần gọi"), `warehouse` (Kho), `orders` (Đơn hàng, hàng cần gọi lại),
    `stats` (Báo cáo: lãi/lỗ, so sánh), `settings` (Cài đặt: theme, đồng bộ toàn bộ).
  - `lib/main.dart` — load `.env`, `setupInjector()`, `ParseConfig.init()`, `SyncService.loadLastSynced()`.
  - `test/` (`sku_generator_test.dart`, `widget_test.dart`), `scripts/seed/` (seed Back4App qua
    Parse REST API, Dart thuần, có `README.md`).
- **Backend:** Parse Server trên **Back4App** (`parse_server_sdk_flutter`), ảnh bản vẽ đơn hàng
  upload lên **Cloudinary** (unsigned preset). Cấu hình đọc từ `.env` qua `flutter_dotenv`.
- **Nghiệp vụ chính** (để agent hiểu từ vựng): `Category` → `CategoryAttribute` → `AttributeOption`;
  `Product` + `ProductAttributeValue` (tên + SKU sinh bởi `sku_generator.dart`); `Inventory` +
  `InventoryTransaction` (IN/OUT, `balanceAfter`); `Order` + `OrderItem` (dòng custom, bản vẽ,
  `isOrdered`/received, giá nhập/giá bán); `ReorderItem` (tính toán, không lưu — hàng thiếu cần
  gọi, quá hạn theo `kReorderOverdueThreshold`). Đơn chuyển sang trạng thái có `deductsStock`
  (giao/hoàn thành) → `deductStock` trừ kho; rời trạng thái đó (huỷ/mở lại) → `addStock` hoàn kho
  (`OrderRepositoryImpl.updateStatus`). Dòng custom không đụng tồn kho.
- **Không có** l10n/ARB: chuỗi UI và thông báo lỗi viết **tiếng Việt hard-code**.
- **Không có** script kiểm tra lớp; quy ước lấy từ code hiện có (mục "Quy ước bắt buộc" bên dưới).
- `.claude/skills/` hiện chỉ có `token-usage`, `prompt-token-count` — **không sửa**.
  Chưa có `.claude/agents/` và chưa có `CLAUDE.md` ở gốc repo.
- Giới hạn kỹ thuật của Claude Code: **subagent không gọi được subagent khác** → việc điều phối
  phải chạy ở phiên chính, qua skill `/team`.

## Quy ước bắt buộc (rút từ code hiện có — agent phải theo, không "sửa cho đẹp")
Mô tả đúng hiện trạng; **không refactor** các chỗ đang chạy ổn chỉ để "đúng kiến trúc".

**Domain (`lib/core/domain`)**
- Không import `parse_server_sdk_flutter`, `sembast`, `package:flutter/material.dart`/widgets.
  Chỉ cho phép `package:flutter/foundation.dart` (như `use_case.dart`).
- Hiện trạng chấp nhận: interface repository và use case **trả về `XModel`** từ
  `core/data/models` (26 file đang làm vậy) — code mới theo cùng kiểu cho nhất quán.
- Use case: 1 file / 1 class, `@injectable`, `extends UseCase<T, Params>` hoặc
  `NoParamsUseCase<T>`; class `XxxParams` (const constructor) đặt cùng file; field
  `final XRepository repository;` inject qua constructor.

**Data (`lib/core/data` + cache/sync)**
- Datasource: abstract `XDataSource` + `XDataSourceImpl` với `@Injectable(as: XDataSource)`.
  Truy vấn danh sách dùng `fetchAllPages(() => QueryBuilder(...)..orderByAscending('createdAt'))`
  (builder mới mỗi lần, thứ tự ổn định). Lỗi → `throw Exception('<thông báo tiếng Việt>')`.
- Parse object: `XParse() : super('<ClassName>')`, `XParse.clone()`, `clone(map)`, getter/setter
  theo tên cột; pointer lồng nhau clone bằng `toJson(full: true)`.
- Model: `XModel extends X`, `factory XModel.fromParse(...)` bọc try/catch → `XModel.empty()`,
  có `isEmpty`/`isNotEmpty`.
- Repository impl: `@LazySingleton(as: XRepository)`. **Đọc** qua
  `OfflineCache.readList(key: ..., fetch:, createParse:, toModel:, forceRefresh:)`.
  **Ghi**: `await cache.ensureOnline()` trước → gọi remote → `cache.invalidate([...])` /
  `invalidatePrefix('orderItems:')` đúng các key bị ảnh hưởng (`categories`, `products`,
  `inventories`, `txns:<productId>`, `orders`, `orderItems:<orderId>`,
  `product_attribute_values`…). Quên invalidate = bug dữ liệu cũ.
- Thêm tài nguyên cache mới → cập nhật `SyncService._fetchFor` / `syncAll`. `SyncService` được
  đăng ký **tay** trong `lib/core/di/injector.dart` (không qua codegen).

**Presentation (`lib/features`)**
- Không import `parse_server_sdk_flutter` (hiện 0 file) — chỉ đi qua use case.
- Cubit/Bloc: `@injectable` (hoặc `@lazySingleton` khi state dùng chung: `ReorderCubit`,
  `WarehouseBloc`, `ThemeCubit`); constructor nhận use case bằng named `required xxxUC`;
  gọi `useCase.run(...)` → `Result` (`isSuccess`/`data`/`error`) hoặc `runGuarded(onSuccess:, onError:)`.
  State `Equatable` + `copyWith` (field lỗi reset về null khi không truyền). `WarehouseBloc` dùng
  `freezed` cho event/state.
- Page lấy cubit/service bằng `getIt<...>()` (quy ước hiện tại của features); cubit/use case/repo
  **không** gọi `getIt` mà inject qua constructor.
- Điều hướng chủ yếu `Navigator.of(context).push(MaterialPageRoute(...))`; trang cần reload khi
  sync thì nghe `getIt<SyncService>().tick(SyncTab.x)`.
- Màu/kiểu chữ lấy từ `Theme.of(context)` (đừng hard-code màu — phải đúng cả theme `senior`).
- Feature được import lẫn nhau như hiện có (`warehouse` ↔ `orders`, `home` → tất cả) nhưng
  **ưu tiên** đưa widget dùng chung vào feature sở hữu, không tạo vòng import mới.

**Chung**
- File sinh tự động — **không sửa tay**: `lib/core/di/injector.config.dart`, `*.freezed.dart`,
  `lib/features/warehouse/presentation/presentation.dart` (barrel). Đổi annotation
  `@injectable`/`@lazySingleton`/`@freezed` → phiên chính chạy build_runner.
- Không đọc/in/commit `.env`; `PARSE_REST_API_KEY` chỉ dùng trong `scripts/seed`, không bao giờ vào app.
- Thao tác ghi khi offline phải ném `NoInternetException` (qua `ensureOnline`), UI hiển thị `error.toString()`.

## Yêu cầu

### 1. Skill điều phối — `.claude/skills/team/SKILL.md` (+ `USAGE.md` tiếng Việt)
`/team <việc>` chạy ở phiên chính:
1. **Phân loại** việc: `feature` · `bug` · `review` · `explain` (không chắc → hỏi người dùng).
2. **Định tuyến:**
   - `explain` → `ms-explainer` → trả lời.
   - `review` → `ms-reviewer` → báo cáo phát hiện (mặc định review `git diff dev...HEAD` + thay đổi chưa commit).
   - `bug` → `ms-debugger` tìm nguyên nhân + đề xuất cách sửa → trình kế hoạch → **chờ "code đi"**
     → agent code theo lớp → `ms-reviewer`.
   - `feature` → `ms-planner` lập kế hoạch (wave, agent nào, file nào, cache key nào bị ảnh hưởng,
     có cần build_runner không) → trình kế hoạch → **chờ "code đi"** → chạy agent code theo wave
     → `ms-reviewer`.
3. **Thứ tự wave mặc định khi code:** `ms-domain` → `ms-data` → (`ms-presentation` ∥ `ms-seed`)
   → `ms-test`. Agent cùng wave chạy song song, **mỗi file chỉ thuộc đúng 1 agent** trong một wave.
   Được gọi **nhiều instance** cùng một agent trong 1 wave nếu tập file tách rời (vd 2 ×
   `ms-presentation`: một cho `features/warehouse`, một cho `features/orders`).
4. **Bước tích hợp** (phiên chính làm, không giao subagent):
   - `dart run build_runner build --delete-conflicting-outputs` nếu thêm/đổi `@injectable`,
     `@LazySingleton`, `@freezed`, hoặc constructor của class đã đăng ký DI.
   - `flutter analyze` (toàn repo) và `flutter test`.
   - Lỗi analyzer chặn build → sửa bằng giá trị mặc định an toàn + `// TODO`, không hỏi.
     Không thêm `// ignore:` để né lỗi.
5. **Báo cáo cuối** bằng tiếng Việt: file đã đổi, TODO, kết quả build_runner/analyze/test,
   việc người dùng phải tự làm ngoài code (vd thêm cột trên Back4App dashboard, chạy seed).

### 2. Chín agent — mỗi agent một file `.claude/agents/<name>.md`

| Agent | Vai trò | Được sửa | Tools |
|---|---|---|---|
| `ms-planner` | Phân tích yêu cầu → kế hoạch: wave, agent, file sở hữu, cache key, DI/codegen, rủi ro | không | Read, Grep, Glob |
| `ms-debugger` | Truy bug xuyên lớp (UI → cubit → use case → repo → cache/datasource → Parse) → nguyên nhân gốc + đề xuất sửa (`file:line`) | không | Read, Grep, Glob, Bash |
| `ms-reviewer` | Review diff theo "Quy ước bắt buộc": lớp, invalidate cache, offline guard, null-safety, `mounted` sau `await`, file sinh tự động; chạy `flutter analyze` / `flutter test` | không | Read, Grep, Glob, Bash |
| `ms-explainer` | Giải thích luồng (thêm hàng, đổi trạng thái đơn & trừ/hoàn kho, hàng cần gọi lại, đồng bộ local-first, upload bản vẽ, sinh SKU…), kiến trúc; trích `file:line` | không | Read, Grep, Glob |
| `ms-domain` | `lib/core/domain/**` (entities, `repositories/` interface, `use_cases/`) + `lib/core/enum/**`, `lib/core/error/**` | có | Read, Grep, Glob, Edit, Write |
| `ms-data` | `lib/core/data/**` (datasource, parse, model, repository impl) + `lib/core/{cache,sync,network,parse,services,config}/**` + `lib/core/di/injector.dart` | có | Read, Grep, Glob, Edit, Write, Bash |
| `ms-presentation` | `lib/features/**` (bloc/cubit, pages, widgets) + `lib/core/{router,theme,utils}/**` + `lib/main.dart` | có | Read, Grep, Glob, Edit, Write |
| `ms-seed` | `scripts/seed/**` — giữ seed (catalog, sản phẩm mẫu) khớp schema Parse khi thêm class/cột/option; cập nhật `scripts/seed/README.md` | có | Read, Grep, Glob, Edit, Write, Bash |
| `ms-test` | `test/**` — unit test cho logic thuần (generator, entity getter, state), cubit với fake use case/repository viết tay | có | Read, Grep, Glob, Edit, Write, Bash |

Mỗi file agent gồm:
- Frontmatter: `name`, `description` (tiếng Anh, nói rõ **khi nào** nên giao việc cho agent này),
  `tools` (đúng danh sách trên — tối thiểu cần thiết). **Không** đặt `model`.
- Body (tiếng Anh): vai trò · thư mục được đọc / được sửa · luật bắt buộc · cách làm từng bước ·
  **định dạng kết quả trả về** cho phiên chính (ngắn, có `file:line`, danh sách file đã đổi,
  có cần build_runner không, cache key đã invalidate).
- Luật riêng theo lớp lấy từ mục "Quy ước bắt buộc" ở trên (chép phần liên quan vào từng agent,
  kèm 1 file mẫu để agent đọc trước khi viết — vd `use_cases/inventory/add_stock.dart`,
  `repositories/inventory_repository_impl.dart`, `datasources/inventory/inventory_datasource_impl.dart`,
  `features/warehouse/presentation/bloc/add_stock_cubit.dart`, `features/orders/presentation/bloc/reorder_cubit.dart`).
- Agent dùng Bash: chỉ lệnh đọc/kiểm tra (`git diff`, `git log`, `flutter analyze`, `flutter test`,
  `dart format --output=none --set-exit-if-changed`); `ms-seed` **không tự chạy** seed lên Back4App
  (ghi vào dữ liệu thật) — chỉ đề xuất lệnh cho người dùng.

### 3. Sơ đồ cây
Trong `USAGE.md` của `/team`: sơ đồ (mermaid hoặc ASCII) gốc `/team` → 9 agent, bảng "loại việc →
chuỗi agent", bảng "thư mục → agent sở hữu", và 4 ví dụ lệnh (mỗi loại việc 1 ví dụ, dùng nghiệp
vụ thật), ví dụ:
- feature: `/team thêm lọc đơn hàng theo khoảng ngày trên tab Đơn hàng`
- bug: `/team thêm hàng xong quay lại tab Kho vẫn hiện số lượng cũ`
- review: `/team review thay đổi trên dev-kho so với dev`
- explain: `/team giải thích luồng đổi trạng thái đơn và trừ/hoàn tồn kho`

## Ràng buộc
- **Chỉ** sửa/tạo code trong `lib/`, `test/`, `scripts/seed/`. **Không** sửa: `android/`, `ios/`,
  `linux/`, `macos/`, `web/`, `windows/`, `.env`, `.env.example`, `pubspec.lock`, file sinh tự động.
- `pubspec.yaml`: không tự thêm/đổi dependency — cần package mới thì ghi vào kế hoạch và hỏi người dùng.
- Không đổi schema Parse theo kiểu phá vỡ dữ liệu cũ (đổi tên/xoá cột, đổi kiểu). Thêm cột mới thì
  phải đọc an toàn khi thiếu (`get<T>(...) ?? default`), và nêu trong báo cáo cuối.
- Ưu tiên **thêm code mới** thay vì sửa code đang ổn định; không refactor ngoài phạm vi việc được giao.
- **Không sửa file khi chưa có "code đi"** của người dùng.
- Không commit, push, tạo branch/MR.
- Không sửa các skill có sẵn (`token-usage`, `prompt-token-count`).
- **Không** đặt file `.md` nào khác ngoài agent trong `.claude/agents/` (Claude Code coi mọi `.md`
  ở đó là agent) — tài liệu đặt trong `.claude/skills/team/`.
- Không cố định model cho agent nào.
- Mọi output cho người dùng bằng tiếng Việt; code, path, identifier, nội dung file agent bằng tiếng Anh.
  Chuỗi UI/thông báo lỗi trong code viết tiếng Việt (theo hiện trạng).

## Đầu ra mong muốn
```
.claude/
├── agents/
│   ├── ms-planner.md      ├── ms-domain.md
│   ├── ms-debugger.md     ├── ms-data.md
│   ├── ms-reviewer.md     ├── ms-presentation.md
│   ├── ms-explainer.md    ├── ms-seed.md
│   └── ms-test.md
└── skills/team/
    ├── SKILL.md
    └── USAGE.md
```
Kèm một báo cáo ngắn (tiếng Việt): danh sách file đã tạo, chỗ nào đã tự quyết định (giả định).

## Tiêu chí hoàn thành
- [ ] 9 file agent có frontmatter hợp lệ (`name`, `description`, `tools`), không có `model`.
- [ ] Phạm vi "được sửa" của các agent code **không chồng nhau** và phủ hết `lib/` (trừ file sinh tự động).
- [ ] `/team` xuất hiện trong danh sách skill; 9 agent xuất hiện trong `/agents`.
- [ ] Chạy thử khô 4 câu ví dụ (1 mỗi loại) → `/team` phân loại và định tuyến đúng chuỗi agent.
- [ ] Luồng `feature` và `bug` dừng chờ "code đi" trước khi sửa file.
- [ ] Không có thay đổi nào ngoài `.claude/agents/` và `.claude/skills/team/`.

## Giả định
- Tiền tố `ms-` = `my_store`.
- `lib/core/enum` và `lib/core/error` giao cho `ms-domain` (kiểu dùng chung, cả domain lẫn UI dùng).
- `lib/core/sync` giao cho `ms-data` (gọi trực tiếp repository + cache); `sync_button.dart` nằm
  trong đó nên cũng thuộc `ms-data` — muốn đổi giao diện nút thì planner ghi rõ.
- `lib/core/di/injector.dart` (đăng ký tay) giao cho `ms-data`; `injector.config.dart` chỉ sinh
  bằng build_runner ở bước tích hợp.
- `lib/core/utils` (formatter tiền/ngày) giao cho `ms-presentation` vì chỉ UI dùng.
- `CloudinaryService` thuộc `ms-data`; việc page gọi `getIt<CloudinaryService>()` là hiện trạng, không bắt buộc chuyển vào use case.
- Bước tích hợp (build_runner, analyze, test) do phiên chính chạy, không giao subagent.
- `ms-test` không thêm package test (mocktail/bloc_test) — dùng fake viết tay; cần package thì hỏi.
