# /team - Hướng dẫn sử dụng

`/team <việc>` là lệnh điều phối chạy ở phiên chính. Nó phân loại việc của bạn, giao cho các
subagent `ms-*` trong `.claude/agents/`, chờ bạn duyệt kế hoạch rồi mới sửa code, cuối cùng chạy
build_runner / `flutter analyze` / `flutter test` và báo cáo bằng tiếng Việt.

> Claude Code không cho subagent gọi subagent khác → mọi việc điều phối nằm ở skill `/team`,
> các agent chỉ làm phần việc của mình và trả kết quả về.

## Chọn app

Workspace `D:\Felix\AppDemo` có 2 app (mỗi app là 1 git repo riêng, dùng chung backend Back4App):

| Thư mục | Package | Tên app | Nhánh gốc |
|---|---|---|---|
| `kho/` | `my_store` | Warehouse App | `remake` (không dùng `dev`/`master` - code cũ) |
| `anhDung/` | `anh_dung` | Anh Dũng | `main` |

Ghi tên app trong yêu cầu (`kho`, `anhDung`/`Anh Dũng`) hoặc mở một file của app đó trong IDE.
Không rõ thì `/team` sẽ hỏi: `kho` / `anhDung` / `Cả hai`. Chọn `Cả hai` thì làm xong app đầu
rồi hỏi bạn trước khi port sang app còn lại.

## Sơ đồ cây

```mermaid
flowchart TD
    T["/team &lt;việc&gt;<br/>(phiên chính)"] --> A{Chọn app<br/>kho / anhDung}
    A --> C{Phân loại}

    C -->|explain| EX[ms-explainer]
    C -->|review| RV[ms-reviewer]
    C -->|bug| DB[ms-debugger]
    C -->|feature| PL[ms-planner]

    DB --> G{{Chờ 'code đi'}}
    PL --> G

    G --> W1[Wave 1: ms-domain]
    W1 --> W2[Wave 2: ms-data]
    W2 --> W3a[Wave 3: ms-presentation]
    W2 --> W3b[Wave 3: ms-seed]
    W3a --> W4[Wave 4: ms-test]
    W3b --> W4
    W4 --> RV2[ms-reviewer]
    RV2 --> I[Tích hợp: build_runner · flutter analyze · flutter test]
    I --> R[Báo cáo tiếng Việt]
```

Bản ASCII:

```
/team <việc>   (chọn app: kho / anhDung / cả hai)
├── explain ──► ms-explainer ──────────────────────────────► trả lời
├── review  ──► ms-reviewer ───────────────────────────────► báo cáo phát hiện
├── bug     ──► ms-debugger ─┐
└── feature ──► ms-planner ──┴─► [chờ "code đi"]
                                  ├─ wave 1: ms-domain
                                  ├─ wave 2: ms-data
                                  ├─ wave 3: ms-presentation ∥ ms-seed
                                  ├─ wave 4: ms-test
                                  ├─ ms-reviewer
                                  └─ tích hợp ─► báo cáo
```

## Loại việc → chuỗi agent

| Loại | Chuỗi agent | Có sửa file? |
|---|---|---|
| `explain` | `ms-explainer` | Không |
| `review` | `ms-reviewer` | Không |
| `bug` | `ms-debugger` → ⏸ "code đi" → agent code theo lớp liên quan → `ms-reviewer` → tích hợp | Có, sau khi duyệt |
| `feature` | `ms-planner` → ⏸ "code đi" → `ms-domain` → `ms-data` → (`ms-presentation` ∥ `ms-seed`) → `ms-test` → `ms-reviewer` → tích hợp | Có, sau khi duyệt |

Wave nào không có việc thì bỏ qua. Trong một wave có thể chạy nhiều `ms-presentation` song song
nếu sửa các feature khác nhau (vd một cho `features/warehouse`, một cho `features/orders`).

## Thư mục → agent sở hữu

| Thư mục | Agent |
|---|---|
| `lib/core/domain/**`, `lib/core/enum/**`, `lib/core/error/**` | `ms-domain` |
| `lib/core/data/**`, `lib/core/{cache,sync,network,parse,services,config}/**`, `lib/core/di/injector.dart` | `ms-data` |
| `lib/features/**`, `lib/core/{router,theme,utils}/**`, `lib/main.dart` | `ms-presentation` |
| `scripts/seed/**` | `ms-seed` |
| `test/**` | `ms-test` |
| `cloud/**` ở thư mục workspace (Cloud Code Back4App, dùng chung 2 app) | `ms-cloud` - chạy song song với `ms-domain` ở wave 1 |
| `injector.config.dart`, `*.freezed.dart`, barrel `presentation.dart` | Không ai - sinh bằng build_runner |
| `android/`, `ios/`, `pubspec.yaml`, `.env.example` | `mobile-developer` - ngoài các wave, chỉ chạy khi bạn đồng ý |
| `.env`, `pubspec.lock` | Không ai sửa tay |

Đường dẫn trong bảng tính từ thư mục app (`kho/` hoặc `anhDung/`).
Agent chỉ đọc: `ms-planner`, `ms-debugger`, `ms-reviewer`, `ms-explainer`.

`mobile-developer` cũng dùng riêng được, ví dụ: "dùng mobile-developer thêm quyền INTERNET cho
bản release của anhDung".

## Ví dụ

```text
# feature
/team anhDung: thêm lọc đơn hàng theo khoảng ngày trên tab Đơn hàng

# bug
/team kho: thêm hàng xong quay lại tab Kho vẫn hiện số lượng cũ

# review
/team review kho: nhánh giai-doan-0 so với remake

# explain
/team giải thích luồng đổi trạng thái đơn và trừ/hoàn tồn kho của anhDung

# cả hai app
/team cả hai: thêm cột ghi chú cho đơn hàng
```

## Lưu ý
- `feature` và `bug` luôn dừng ở bước trình kế hoạch. Gõ **`code đi`** để bắt đầu sửa; góp ý thêm
  thì `/team` sẽ chỉnh kế hoạch và hỏi lại.
- `/team` không commit, không push, không chạy seed lên Back4App - các bước đó được liệt kê trong
  mục "Việc bạn cần làm thủ công" ở báo cáo cuối.
- 2 app dùng **chung** Back4App: thêm cột/class hoặc seed từ app này thì app kia cũng thấy dữ liệu đó.
  Sửa `scripts/seed/` ở một app thì nên đồng bộ sang app kia trước khi seed.
- Lỗi analyzer chặn build ở bước tích hợp được sửa bằng giá trị mặc định an toàn + `// TODO(team)`.
