# Đặc tả chức năng — Thùng rác (Recycle Bin) — Cloud Module

> Tài liệu này là bản đặc tả tiếng Việt biên soạn lại từ **FRS — Recycle Bin (Cloud module) v0.8 (Draft)** do BA cung cấp.
> Đây là **tài liệu yêu cầu** (mô tả tính năng mục tiêu), độc lập với tài liệu implementation `recycle_bin.md`.
> Các mã định danh gốc (FR-xx, US-xxx, AC-xxx, SC-xx, BRule-xx) được giữ nguyên để truy vết ngược về FRS.

---

## 1. Thông tin tài liệu

| Mục | Nội dung |
|-----|----------|
| Tên tài liệu | FRS — Recycle Bin (Cloud module) |
| Phiên bản gốc | v0.8 (Draft) — Status: Draft, for review |
| Tác giả | BA (biên soạn cùng AI assistant) |
| BRD liên quan | Không có — FRS đứng độc lập |
| Cập nhật | 2026-07-16 (v0.8: File Restore fallback; item hiển thị origin path + đếm ngược; vào từ home; retention 7 ngày; restore đổi tên; filter chips; sort = gần hết hạn nhất trước; SC-06 xác nhận xóa folder + SC-08 xác nhận dùng chung; không còn open question) |

---

## 2. Tổng quan & mục đích

Recycle Bin là tính năng **an toàn dữ liệu** của Cloud module (module quản lý dữ liệu của Web3 super app, tương tự Quark). Khi người dùng xóa file/folder, mục đó được **chuyển vào Thùng rác (soft delete)** thay vì bị xóa ngay. Trong khoảng thời gian lưu giữ (retention window), người dùng có thể **khôi phục** hoặc **xóa vĩnh viễn**; hết hạn thì hệ thống **tự động dọn sạch**. Mục nằm trong Thùng rác **không tính vào quota dung lượng** của người dùng.

Tài liệu đặc tả hành vi chức năng, user story, tiêu chí chấp nhận (AC) và màn hình. Tính năng khôi phục theo gói **Membership (SVIP) nằm ngoài phạm vi**. Đây là bản nâng cấp (enhancement) của app hiện có nên các thành phần sẵn có (dialog xác nhận xóa, search) được **tái sử dụng nguyên trạng**. Phạm vi theo từng ví (per-wallet) kế thừa từ app hiện có; GDPR không bắt buộc ở bản phát hành này.

### Định nghĩa thuật ngữ

| Thuật ngữ | Ý nghĩa |
|-----------|---------|
| **Retention Window** | Khoảng thời gian cố định giữ mục đã xóa trước khi tự động xóa vĩnh viễn — **7 ngày**. |
| **File Restore** | Thư mục dự phòng dùng chung trong Files chính, nơi đặt mục được khôi phục khi đường dẫn gốc không còn tồn tại. |
| **hash** | Trường search có sẵn kế thừa từ app hiện tại (hash nội dung file). |

---

## 3. Phạm vi chức năng

### Trong phạm vi (In scope)
- Soft-delete file/folder vào Thùng rác và **loại khỏi quota** dung lượng.
- Khôi phục về **đường dẫn gốc**, có **vị trí dự phòng** khi đường dẫn gốc không còn.
- Xóa vĩnh viễn: từng mục, nhiều mục đã chọn, và **"Empty all"** — mỗi hành động đều có xác nhận.
- **Tự động dọn** khi hết Retention Window.
- Duyệt thùng rác: danh sách mục, empty state, duyệt folder; **lọc** theo loại, **sắp xếp**, **tìm kiếm** (theo tên / hash / folder).
- Chế độ **chọn nhiều** và các action sheet per-item / hàng loạt; sheet trợ giúp **"Recycle Bin Rules"**.

### Ngoài phạm vi (Out of scope)
- **Membership (SVIP)**: dịch vụ File Recovery trả phí (giữ 180 ngày), toggle opt-out trong Privacy Settings, mọi bề mặt upsell SVIP.
- **Gia hạn retention** (vd "Extend to 30 days") — gắn với membership.
- **Mã hóa file** (loại trừ tường minh khỏi tài liệu này).

### Không cover ở bản này (kế thừa / không bắt buộc)
- Hành vi mức ví Web3 của thùng rác (per-wallet scoping, đổi tài khoản, khôi phục seed-phrase, offline, dọn khi logout) — kế thừa từ app hiện có, không đặc tả mới.
- Xử lý xóa theo **GDPR** — không bắt buộc ở bản này (quyết định của PO).

---

## 4. Actor / vai trò

| Actor | Mô tả | Quyền chính |
|-------|-------|-------------|
| **User** | Chủ sở hữu dữ liệu Cloud đã xác thực bằng ví; toàn bộ dữ liệu bin gắn theo ví. | Xem, khôi phục, xóa vĩnh viễn mục trong Thùng rác. |
| **System** | Ứng dụng / back-end. | Tự động dọn các mục đã hết Retention Window. |

---

## 5. Yêu cầu chức năng (Functional Requirements)

| ID | Yêu cầu | Ưu tiên |
|----|---------|---------|
| **FR-01** | Hệ thống chuyển file/folder bị xóa vào Thùng rác (soft delete) thay vì xóa ngay. | Must |
| **FR-02** | Mục trong Thùng rác được loại khỏi quota dung lượng của người dùng. | Must |
| **FR-03** | Hệ thống tự động xóa vĩnh viễn mỗi mục khi hết Retention Window (7 ngày). | Must |
| **FR-04** | Hệ thống hiển thị banner cố định thông báo mục đã xóa không dùng dung lượng và tự xóa sau 7 ngày. | Must |
| **FR-05** | Hệ thống khôi phục mục đã chọn về đường dẫn gốc. | Must |
| **FR-06** | Nếu đường dẫn gốc không còn, hệ thống khôi phục mục vào thư mục dùng chung **"Files > File Restore"**. | Must |
| **FR-07** | Hệ thống xóa vĩnh viễn mục đã chọn. | Must |
| **FR-08** | Hệ thống xóa vĩnh viễn toàn bộ qua **"Empty all"** (icon thùng rác trên header). | Must |
| **FR-09** | Mọi hành động xóa vĩnh viễn đều cần dialog xác nhận trước khi thực thi: xóa **một folder** (từ màn folder-detail) dùng dialog riêng (SC-06); xóa **file / nhiều mục / "Empty all"** dùng dialog dùng chung sẵn có của app (SC-08). | Must |
| **FR-10** | Hệ thống liệt kê mục đã xóa kèm icon/thumbnail, tên, thời điểm xóa, đường dẫn gốc và **đồng hồ đếm ngược số ngày còn lại**. | Must |
| **FR-11** | Hệ thống lọc danh sách bằng chip (chọn đơn, mặc định 'All'): 'All', 'Folders', 'Images', 'Videos', 'Audio', 'Documents', 'Others'. Chip loại file chỉ hiện file loại đó và ẩn folder; 'Folders' chỉ hiện folder; 'All' hiện tất cả. | Should |
| **FR-12** | Hệ thống sắp xếp danh sách, **mặc định theo số ngày còn lại — gần hết hạn nhất (sắp bị xóa vĩnh viễn) lên đầu**; người dùng có thể đổi tiêu chí và chiều qua sheet Sort settings. | Should |
| **FR-13** | Hệ thống cho tìm kiếm trong Thùng rác theo tên file, hash và folder, **tái sử dụng nguyên trạng** search của app hiện tại. | Must |
| **FR-14** | Khi thùng rác rỗng, hệ thống hiển thị empty state **"No deleted records yet"**. | Must |
| **FR-15** | Hệ thống vào chế độ chọn nhiều khi long-press một mục hoặc chạm menu (⋮) cạnh icon thùng rác trên header. | Must |
| **FR-16** | Trong chế độ chọn nhiều, hệ thống hiển thị số mục đã chọn và cung cấp **Select All** và **Close**. | Must |
| **FR-17** | Trong chế độ chọn nhiều, hệ thống cung cấp **Restore** và **Delete** qua bottom sheet **"More"**. | Must |
| **FR-18** | Khi chạm vào một mục, hệ thống hiển thị sheet **"Options"** gồm Restore và Delete. | Must |
| **FR-19** | Hệ thống cho mở folder đã xóa để duyệt nội dung (breadcrumb, sort, empty state 'No file' / 'This folder is empty.'). | Should |
| **FR-21** | Hệ thống hiển thị bottom sheet **"Recycle Bin Rules"** (Restore Rules, Storage Usage) qua nút trợ giúp (?). | Should |

> Lưu ý: FRS gốc không có FR-20 (đánh số nhảy từ FR-19 → FR-21).

---

## 6. User stories & tiêu chí chấp nhận (AC)

### US-001 — Chuyển mục đã xóa vào Thùng rác
*Traces to: FR-01, FR-02 · Ưu tiên: Must*
Là người dùng Cloud, tôi muốn file/folder bị xóa vào Thùng rác thay vì biến mất, để có thể khôi phục nếu lỡ xóa nhầm.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-001.1 | File/folder tồn tại trong Cloud | người dùng xóa nó | hệ thống chuyển vào Thùng rác và nó không còn ở vị trí gốc |
| AC-001.2 | Mục vừa chuyển vào Thùng rác | người dùng xem dung lượng | kích thước mục không bị tính vào quota |

**Edge / lưu ý:** Hành vi offline theo app hiện có (ngoài phạm vi). Xóa file tự động gỡ Favorite của nó — do tính năng Favorite xử lý (Favorite chỉ lưu tham chiếu). Thùng rác được vào từ **home page**; hành động xóa được kích hoạt từ Cloud file browser (không có wireframe).

### US-002 — Duyệt các mục đã xóa
*Traces to: FR-10, FR-14, FR-19 · Ưu tiên: Must*
Là người dùng Cloud, tôi muốn thấy mọi thứ đã xóa ở một nơi để tìm mục cần khôi phục hoặc xóa hẳn.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-002.1 | Bin có mục | mở Thùng rác | liệt kê mỗi mục kèm icon/thumbnail, tên, thời điểm xóa, đường dẫn gốc, đếm ngược ngày; sắp xếp theo ngày còn lại — gần hết hạn nhất trước |
| AC-002.2 | Bin rỗng | mở Thùng rác | hiển thị empty state 'No deleted records yet' |
| AC-002.3 | Folder đã xóa có nội dung nằm trong list | mở nó | hiển thị các con trực tiếp dưới breadcrumb 'Recycle Bin / \<folder\>' |
| AC-002.4 | Folder rỗng đã xóa nằm trong list | mở nó | hiển thị empty state 'No file' / 'This folder is empty.' |

**Edge / lưu ý:** Tên file rất dài / thiếu thumbnail — cần xác nhận cách hiển thị. Hàng mục hiển thị origin path + đếm ngược ngày. Chi tiết folder ở SC-07.

### US-003 — Tìm và sắp xếp mục đã xóa
*Traces to: FR-11, FR-12, FR-13 · Ưu tiên: Should*
Là người dùng Cloud, tôi muốn lọc, sắp xếp và tìm kiếm trong Thùng rác để nhanh chóng tìm một mục cụ thể.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-003.1 | List có cả folder và nhiều loại file | chọn chip loại file (vd 'Images') | chỉ hiện file loại đó và ẩn folder |
| AC-003.2 | Mở Thùng rác | màn hiển thị (chưa đổi sort) | list sắp xếp theo ngày còn lại — gần hết hạn nhất trước |
| AC-003.3 | Đã có mục bị xóa | tìm theo tên file, hash hoặc folder | trả về mục khớp trong Thùng rác |
| AC-003.4 | List có folder | chọn chip 'Folders' | chỉ hiện folder |
| AC-003.5 | List đang hiển thị | mở Sort settings và đổi tiêu chí hoặc chiều | list sắp xếp lại tương ứng |

**Edge / lưu ý:** Không có kết quả khi search/filter theo hành vi của search hiện có (tái dùng nguyên trạng). Nhãn chip nên khớp từ vựng loại file của module Files (số nhiều, nhất quán).

### US-004 — Khôi phục một mục đã xóa
*Traces to: FR-05, FR-06 · Ưu tiên: Must*
Là người dùng Cloud, tôi muốn khôi phục mục đã xóa để lấy lại file/folder.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-004.1 | Mục có đường dẫn gốc còn tồn tại | khôi phục | trả về đúng đường dẫn gốc và gỡ khỏi bin |
| AC-004.2 | Mục có đường dẫn gốc không còn | khôi phục | đặt vào 'Files > File Restore' |
| AC-004.3 | Đường dẫn đích đã có mục trùng tên | khôi phục | khôi phục kèm hậu tố ' (n)' vào tên (n = số khả dụng kế tiếp) |

**Edge / lưu ý:** Khôi phục khi offline theo app hiện có (ngoài phạm vi). Đích dự phòng là thư mục dùng chung 'File Restore' (dùng cho mọi file được khôi phục mà đường dẫn gốc đã mất).

### US-005 — Xóa vĩnh viễn hoặc dọn sạch bin
*Traces to: FR-07, FR-08, FR-09 · Ưu tiên: Must*
Là người dùng Cloud, tôi muốn xóa vĩnh viễn mục hoặc dọn sạch cả bin để xóa file chắc chắn không còn cần.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-005.1 | Đã chọn một mục | chọn Delete và xác nhận | hệ thống xóa vĩnh viễn, không thể khôi phục |
| AC-005.2 | Bin có mục | chạm 'Empty all' (thùng rác header) và xác nhận | xóa vĩnh viễn mọi mục trong bin |
| AC-005.3 | Một hành động xóa vĩnh viễn được kích hoạt | thấy dialog xác nhận và bấm hủy | không mục nào bị xóa |

**Edge / lưu ý:** Dọn/xóa khi offline theo app hiện có (ngoài phạm vi). Có **hai dialog xác nhận**: (1) xác nhận xóa **folder** — chỉ mở từ màn folder-detail (SC-06); (2) dialog dùng chung sẵn có cho xóa file / nhiều mục / 'Empty all' (SC-08).

### US-006 — Thao tác nhiều mục cùng lúc
*Traces to: FR-15, FR-16, FR-17, FR-18 · Ưu tiên: Must*
Là người dùng Cloud, tôi muốn chọn nhiều mục và khôi phục/xóa cùng lúc, khỏi phải làm từng cái.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-006.1 | List đang hiển thị | long-press một mục hoặc chạm menu cạnh icon thùng rác | vào chế độ chọn nhiều: hiện số đã chọn, Select All, Close |
| AC-006.2 | Chế độ chọn nhiều có mục được chọn | mở sheet 'More' và chọn Restore/Delete | áp dụng cho mọi mục đã chọn (Delete cần xác nhận) |
| AC-006.3 | List đang hiển thị | chạm một mục đơn | hiện sheet 'Options' gồm Restore và Delete |

**Edge / lưu ý:** Select All rồi bỏ chọn một mục — số đếm cập nhật đúng. Khôi phục hàng loạt khi vài mục mất đường dẫn gốc — hỗn hợp đường dẫn gốc + 'File Restore' (xem US-004).

### US-007 — Hiểu quy tắc lưu giữ & dung lượng
*Traces to: FR-03, FR-04, FR-21 · Ưu tiên: Should*
Là người dùng Cloud, tôi muốn hiểu mục đã xóa được giữ bao lâu và có tốn dung lượng không, để biết khi nào cần hành động.

| ID | Given | When | Then |
|----|-------|------|------|
| AC-007.1 | Màn Thùng rác hiển thị | mở màn | hiện banner nói mục không dùng dung lượng và tự xóa sau 7 ngày |
| AC-007.2 | Mục đã ở bin đủ Retention Window | hết hạn | hệ thống tự động xóa vĩnh viễn |
| AC-007.3 | Màn Thùng rác hiển thị | chạm nút trợ giúp (?) | hiện sheet 'Recycle Bin Rules' gồm Restore Rules và Storage Usage |

**Edge / lưu ý:** Ranh giới retention (đúng thời điểm hết hạn) — cần xác nhận thời điểm purge. Retention Window = 7 ngày (đã chốt). Hiển thị đếm ngược ngày cho từng mục.

---

## 7. Business Rules

| ID | Quy tắc | Áp dụng cho |
|----|---------|-------------|
| **BRule-01** | Mục đã xóa được loại khỏi quota dung lượng. | FR-02 |
| **BRule-02** | Retention Window = 7 ngày. Hết hạn thì mục bị xóa vĩnh viễn, không thể khôi phục. | FR-03 |
| **BRule-03** | Đích khôi phục là đường dẫn gốc; nếu không còn, dự phòng là thư mục dùng chung 'Files > File Restore'. | FR-05, FR-06 |
| **BRule-05** | Xóa vĩnh viễn (đơn, nhiều, empty all) là không thể hoàn tác và luôn cần xác nhận tường minh. | FR-07, FR-08, FR-09 |
| **BRule-06** | Khôi phục file theo Membership (SVIP, 180 ngày) và gia hạn retention nằm ngoài phạm vi bản này. | — |
| **BRule-07** | Khi khôi phục, nếu đích đã có mục trùng tên, hệ thống thêm hậu tố ' (n)' vào tên (n = số khả dụng kế tiếp). | FR-05 |

> Lưu ý: FRS gốc không có BRule-04 (đánh số nhảy từ BRule-03 → BRule-05).

---

## 8. Luồng người dùng chính

### 7.0 Điều kiện vào
Trigger: người dùng mở Thùng rác từ **home page**. Tiền điều kiện: đã xác thực (ví), bin có thể chứa 0 hoặc nhiều mục đã xóa trước đó.

### 7.1 Luồng chính (Main flow)
| Bước | Actor | Hành động | Phản hồi hệ thống |
|------|-------|-----------|-------------------|
| 1 | User | Mở Thùng rác | Hiện danh sách mục đã xóa, sắp xếp theo ngày còn lại (gần hết hạn nhất trước) |
| 2 | User | Chạm một mục (hoặc long-press để chọn nhiều) | Hiện action sheet (Options / More) gồm Restore và Delete |
| 3 | User | Chạm Restore | Khôi phục về đường dẫn gốc, gỡ khỏi bin, quay lại list đã cập nhật |

### 7.2 Luồng thay thế & lỗi (theo bước)
| Ở bước | Điều kiện | Hành vi | Kết thúc / tiếp tục |
|--------|-----------|---------|---------------------|
| 1 | Bin rỗng | Hiện empty state 'No deleted records yet' | kết thúc |
| 2 | Long-press / chọn nhiều mục | Vào chế độ chọn nhiều (số đếm, Select All); action áp cho tất cả đã chọn | tiếp → 3 |
| 3 | Restore: đường dẫn gốc không còn | Khôi phục vào 'Files > File Restore' | tiếp (xong) |
| 3 | Chọn Delete thay vì Restore | Hiện dialog xác nhận; Confirm → xóa vĩnh viễn, Cancel → giữ mục | Confirm → xong · Cancel → về bước 2 |
| bất kỳ | Hết retention window | Hệ thống tự dọn (nền); mục biến mất khỏi bin | kết thúc |
| bất kỳ | Offline | Delete / restore / empty theo hành vi offline của app hiện có (ngoài phạm vi) | tiếp tục |

### 7.3 Hậu điều kiện
Mục đã chọn hoặc quay lại Files (khôi phục về đường dẫn gốc hoặc 'File Restore'), hoặc bị xóa vĩnh viễn. Quota không bị ảnh hưởng bởi các mục còn trong bin.

---

## 9. Ma trận truy vết (Traceability)

Không có BRD nên bỏ cột BR. Một US có thể trải nhiều FR (N:N).

| FR | US | AC | Status |
|----|----|----|--------|
| FR-01 | US-001 | AC-001.1, AC-001.2 | draft (vào từ home page) |
| FR-02 | US-001, US-007 | AC-001.2, AC-007.1 | draft |
| FR-03 | US-007 | AC-007.2 | draft |
| FR-04 | US-007 | AC-007.1 | draft |
| FR-05 | US-004 | AC-004.1, AC-004.3 | draft |
| FR-06 | US-004 | AC-004.2 | draft |
| FR-07 | US-005 | AC-005.1 | draft |
| FR-08 | US-005 | AC-005.2 | draft |
| FR-09 | US-005 | AC-005.3 | draft |
| FR-10 | US-002 | AC-002.1 | draft |
| FR-11 | US-003 | AC-003.1, AC-003.4 | draft |
| FR-12 | US-003 | AC-003.2, AC-003.5 | draft |
| FR-13 | US-003 | AC-003.3 | draft (tái dùng search) |
| FR-14 | US-002 | AC-002.2 | draft |
| FR-15 | US-006 | AC-006.1 | draft |
| FR-16 | US-006 | AC-006.1 | draft |
| FR-17 | US-006 | AC-006.2 | draft |
| FR-18 | US-006 | AC-006.3 | draft |
| FR-19 | US-002 | AC-002.3, AC-002.4 | draft |
| FR-21 | US-007 | AC-007.3 | draft |

---

## 10. Giả định, câu hỏi mở & xung đột

Retention cố định 7 ngày. Các quyết định đã chốt được phản ánh trong yêu cầu/màn hình ở trên và không còn theo dõi ở đây.

### Giả định
| ID | Giả định | Cần xác nhận với |
|----|----------|------------------|
| AS-01 | Search là search sẵn có của app (tên/hash/folder), tái dùng nguyên trạng; wireframe không vẽ lại search bar. | PO / design |
| AS-02 | Không có tính năng gia hạn retention; retention là một cửa sổ phẳng duy nhất (7 ngày) cho mọi user. | PO |
| AS-03 | Mọi hành động xóa vĩnh viễn đều qua dialog xác nhận (tái dùng dialog sẵn có). | PO / design |
| AS-04 | Recycle Bin theo mẫu UX của tính năng Favorite (optimistic update, offline sync) trừ khi có quy định khác. | PO / engineering |
| AS-05 | Action dùng optimistic update (không có loading state riêng); xử lý lỗi theo hành vi app hiện có. | engineering |

### Câu hỏi mở
- Không còn câu hỏi mở — tất cả đã giải quyết trong các phiên làm việc.
- Hành vi mức ví Web3 kế thừa từ app hiện có; GDPR không bắt buộc ở bản này (quyết định PO); cả hai không đặc tả thành yêu cầu chức năng ở đây.

---

## Phụ lục — Tham chiếu chéo với implementation hiện tại

Tài liệu này là **yêu cầu (target)**, không phải trạng thái code hiện tại. Để đối chiếu với những gì đã build, xem `recycle_bin.md` (mô tả code) và `recycle_bin_v_0.0.1.md` (changelog implementation đang làm). Một số điểm FRS **chưa có** trong code hiện tại đáng chú ý khi triển khai:

- **FR-06 / BRule-03** — thư mục dự phòng "File Restore" khi mất đường dẫn gốc.
- **FR-07 / AC-004.3 / BRule-07** — hậu tố ' (n)' khi khôi phục trùng tên.
- **FR-11** — filter chips theo loại (hiện code mới chỉ chừa chỗ `// filter`).
- **FR-19 / SC-06 / SC-07** — duyệt folder đã xóa + dialog xóa folder riêng (code hiện có `folder_navigator.dart` là dead code).
- **FR-21 / SC-04** — sheet "Recycle Bin Rules".
- **FR-12** — mặc định sort là *gần hết hạn nhất trước* (cần kiểm tra `RecycleBinSortOptions` hiện tại đang latest/oldest).

> Đây chỉ là gợi ý nhanh; nếu cần bản gap-analysis đầy đủ FR-by-FR vs code, tạo tài liệu riêng.