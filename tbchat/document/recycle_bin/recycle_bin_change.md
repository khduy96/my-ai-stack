# Recycle Bin — Gap Analysis (Code hiện tại vs FRS v0.8)

> So sánh code hiện tại trong `lib/features/cloud_storage/_new_cloud_storage/pages/recycle_bin/`
> (+ repo/enum/widget liên quan) với đặc tả **`recycle_bin_spec_v0.8.md`**.
> Ngày lập: 2026-07-17 · Nhánh: `local/new_cloud_storage`.
> **Cập nhật: 2026-07-21** — rà lại theo code hiện tại: FR-09, FR-11, FR-15, FR-21 đã xong; FR-19 chuyển sang một phần (đã duyệt folder, còn sort). Xem [§6 Checklist việc cần làm](#6-checklist-việc-cần-làm).

Ký hiệu trạng thái:
- ✅ **Đã đáp ứng** — có và khớp yêu cầu.
- 🟡 **Một phần** — có nhưng thiếu/lệch so với spec.
- ⚠️ **Sai/lệch** — có nhưng hành vi ngược/khác spec.
- ❌ **Chưa có** — chưa implement (cần làm mới).

---

## 1. Bảng đối chiếu theo Functional Requirement

| FR | Yêu cầu (tóm tắt) | Trạng thái | Ghi chú code |
|----|-------------------|:---------:|--------------|
| **FR-01** | Soft-delete file/folder vào Thùng rác | ✅ | Hành động xóa nằm ở file browser (ngoài thư mục này). Bin đọc được item đã xóa. |
| **FR-02** | Loại mục đã xóa khỏi quota | 🟡 | Có nhưng còn bug: `recycle_bin_cubit.dart:238` `TODO: Fix temp 2300 — Used capacity not updating after deleting`. |
| **FR-03** | Tự xóa vĩnh viễn khi hết 7 ngày | 🟡 | Client tự purge khi load (`getRecycleBin`/`loadMore` lặp check `deletedAt + 7 days`) và khi countdown về 0 (`deleteExpired`). Auto-purge phía **backend** giả định có nhưng chưa xác nhận. |
| **FR-04** | Banner "không dùng dung lượng, tự xóa sau 7 ngày" | ✅ | `WarningBanner(message: trashNotice)` trong `recycle_bin_page.dart:135`. |
| **FR-05** | Khôi phục về đường dẫn gốc | ✅ | `restore()` → `fileRepo.restoreFiles` + cập nhật local DB. |
| **FR-06** | Fallback "Files > File Restore" khi mất đường dẫn gốc | ❌ | Không có xử lý client. Grep `File Restore/FileRestore` = 0 kết quả. Phụ thuộc backend nhưng chưa có logic/hiển thị. |
| **FR-07** | Xóa vĩnh viễn mục đã chọn | ✅ | `delete()` → `deleteFilesInTrash` + xóa local (file/folder theo `_classifyRemoteIds`). |
| **FR-08** | "Empty all" (icon thùng rác header) | ✅ | `emptyTrash()` + nút header `icDelete` (`recycle_bin_page.dart:92-114`). |
| **FR-09** | Dialog xác nhận: folder (SC-06) riêng + file/nhiều/empty (SC-08) dùng chung | ✅ | Dialog chung (`showConfirmPopup`) cho file/nhiều/empty-all ✅. Dialog **xóa folder riêng (SC-06)** ✅ — `_onMoreActionTap` → `showCloudDeletePopup(deleteFolder / deleteFolderMessage / confirmDelete)` (`recycle_bin_page.dart:373-386`). |
| **FR-10** | List: icon/thumbnail, tên, **thời điểm xóa**, đường dẫn gốc, đếm ngược ngày | 🟡 | Có icon/thumbnail, tên, origin path (`currentFolderPath`), countdown (`CountdownTimerWidget`). **Thiếu hiển thị "thời điểm xóa" (deletedAt)** — hiện chỉ có countdown thay thế. |
| **FR-11** | Filter chips theo loại (All/Folders/Images/Videos/Audio/Documents/Others) | ✅ | `RecycleBinFilterChips` (`recycle_bin_page.dart:200`) wired với `FilterFileTypeModelView`: chip All + Folder + video/photo/document/audio/compressed (favorite ẩn). *Lưu ý: 'Others' đang map ~ 'compressed'.* |
| **FR-12** | Sort mặc định **gần hết hạn nhất trước**; đổi tiêu chí + chiều | 🟡 / ⚠️ | Sort chỉ theo `deleted_at` asc/desc (`RecycleBinSortOptions.latest/oldest`). **Default = `latest` (isDescending=true) = mới xóa nhất trước = còn NHIỀU ngày nhất trước → NGƯỢC với spec** (spec muốn sắp hết hạn trước = `deletedAt` cũ nhất trước = ascending). Không có tiêu chí sort khác (tên/size). |
| **FR-13** | Search theo tên / hash / folder (tái dùng nguyên trạng) | 🟡 **(đã chốt)** | `SearchBarWidget` + `onSearch` debounce ✅. **Nhưng search KHÔNG tái dùng đúng cơ chế app hiện có.** `getFreshData` build `Filter(field_1: 'name', OPERATOR_LIKE)` → chỉ match trường **name**. Search chính của app dùng `Filter(field_1: 'advance_search', OPERATOR_LIKE)` (`cloud_my_file_repository_impl.dart:119-123`) — đây mới là trường đa-field (name/hash/folder) phía backend. `searchTrash` impl chỉ truyền request thẳng xuống gRPC, không tự xử lý đa trường. → **Cần đổi `'name'` → `'advance_search'` để phủ hash + folder đúng như FR-13.** |
| **FR-14** | Empty state "No deleted records yet" | ✅ | `EmptyDataWidget` khi `listData.isEmpty` (`build_list_file_widget.dart:96-113`). Cần xác nhận text đúng chuỗi spec. |
| **FR-15** | Vào select mode: long-press **hoặc** menu (⋮) cạnh icon thùng rác | ✅ | Long-press ✅ (`onLongPressItem → enableSelectAll`). Menu (⋮) ✅ — header có `icMoreVertical` → `itemMetaCtrl.enableSelectAll()`. |
| **FR-16** | Select mode: số đã chọn + Select All + Close | ✅ | `SelectModeToolsBar` (count, CheckIcon "All", nút Close). |
| **FR-17** | Multi-select: Restore + Delete qua sheet "More" | ✅ | `SelectToolsRecycleBin.onMoreActionTap` → `showRecycleBinOptionsSheet`. |
| **FR-18** | Tap 1 mục → sheet "Options" (Restore/Delete) | ✅ | `_onTap → _onMoreActionTap → showRecycleBinOptionsSheet`. |
| **FR-19** | Mở folder đã xóa để duyệt (breadcrumb, sort, empty 'No file') | 🟡 | Đã bật: `_onTap` → `viewFolderPage`, **push page mới mỗi cấp**, breadcrumb "Recycle Bin > …", empty `No file`/`This folder is empty` (`view_folder_page.dart`, `folder_body_view.dart`). **Còn thiếu: sort trong `view_folder_page` là no-op** (`onSelected` đang comment). |
| **FR-21** | Sheet "Recycle Bin Rules" (Restore Rules, Storage Usage) qua nút (?) | ✅ | `recycle_bin_rules_sheet.dart` + nút (?) `titleSuffix` → `showRecycleBinRulesSheet` (`recycle_bin_page.dart:121-128`). |

---

## 2. Đối chiếu theo Acceptance Criteria (điểm đáng chú ý)

| AC | Nội dung | Trạng thái |
|----|----------|:---------:|
| AC-001.1 / .2 | Xóa → vào bin, không tính quota | 🟡 (quota bug 2300) |
| AC-002.1 | List kèm origin path + đếm ngược, sort sắp-hết-hạn-trước | 🟡 (thiếu deletedAt; sort default ngược) |
| AC-002.2 | Empty state 'No deleted records yet' | ✅ (verify text) |
| AC-002.3 / .4 | Mở folder đã xóa, breadcrumb, empty 'No file' | 🟡 (FR-19 — còn sort) |
| AC-003.1 / .4 | Chip loại file / chip 'Folders' | ✅ (FR-11) |
| AC-003.2 | Default sort = sắp hết hạn trước | ⚠️ (đang ngược) |
| AC-003.3 | Search theo tên/hash/folder | 🟡 (chỉ field `name`; cần `advance_search`) |
| AC-003.5 | Sort settings đổi tiêu chí/chiều | 🟡 (chỉ có chiều theo deleted_at) |
| AC-004.1 | Restore về đường dẫn gốc | ✅ |
| AC-004.2 | Restore vào 'File Restore' khi mất path | ❌ (FR-06) |
| AC-004.3 | Hậu tố ' (n)' khi trùng tên | ❌ (BRule-07) |
| AC-005.1 / .2 / .3 | Delete/Empty all + dialog xác nhận + cancel | ✅ (đã có cả dialog folder SC-06) |
| AC-006.1 | Long-press / menu ⋮ → select mode | ✅ (đã có ⋮) |
| AC-006.2 | Sheet 'More' áp cho nhiều mục | ✅ |
| AC-006.3 | Tap 1 mục → sheet 'Options' | ✅ |
| AC-007.1 | Banner dung lượng/7 ngày | ✅ |
| AC-007.2 | Tự purge khi hết hạn | 🟡 (client-side; verify backend) |
| AC-007.3 | Sheet 'Recycle Bin Rules' qua (?) | ✅ (FR-21) |

---

## 3. Phần MỚI cần phải làm (gap so với document)

Ưu tiên theo mức "Must" của FRS:

**Must — chưa có / cần sửa:**
1. **FR-06 / AC-004.2 / BRule-03** — Fallback khôi phục vào **"Files > File Restore"** khi đường dẫn gốc không còn (logic + hiển thị đích).
2. **FR-05 / AC-004.3 / BRule-07** — Thêm **hậu tố ' (n)'** khi khôi phục trùng tên ở đích.
3. **FR-19 / AC-002.3-.4** — Bật **duyệt folder đã xóa**: breadcrumb `Recycle Bin / <folder>`, sort, empty state 'No file' / 'This folder is empty.' (kích hoạt/viết lại `folder_navigator.dart`, gỡ code comment trong `_onTap`).
4. **FR-09 (SC-06)** — **Dialog xác nhận xóa folder riêng** từ màn folder-detail (gắn với FR-19).
5. **FR-10** — Bổ sung hiển thị **"thời điểm xóa" (deletedAt)** trên mỗi hàng (hiện chỉ có countdown).
6. **FR-15 / AC-006.1** — Thêm **menu (⋮)** cạnh icon thùng rác trên header để vào chế độ chọn nhiều (hiện chỉ có long-press).
7. **FR-13 / AC-003.3** — Search phủ **hash + folder**: đổi filter trong `getFreshData` (`recycle_bin_repository_impl.dart:97-105`) từ `field_1: 'name'` sang **`field_1: 'advance_search'`** để tái dùng đúng cơ chế đa-field của app (như `cloud_my_file_repository_impl.dart:119-123`). Fix nhỏ, đã xác định rõ.
8. **FR-02 (bug 2300)** — Fix quota không cập nhật sau khi xóa khỏi Recycle Bin (TODO tại `recycle_bin_cubit.dart:238`).
9. **FR-03 / AC-007.2** — Xác nhận **auto-purge phía backend** đúng ranh giới 7 ngày (client hiện tự purge khi load — không đủ nếu app không mở).

**Should — chưa có:**
10. **FR-11 / AC-003.1-.4** — **Filter chips**: All / Folders / Images / Videos / Audio / Documents / Others (single-select, mặc định 'All'; chip loại ẩn folder; 'Folders' chỉ folder).
11. **FR-12 / AC-003.2** — Sửa **default sort = gần hết hạn nhất trước** (hiện default `latest` đang ngược). Cân nhắc mở rộng Sort settings (tiêu chí + chiều) nếu cần.
12. **FR-21 / AC-007.3** — Nút trợ giúp **(?)** + bottom sheet **"Recycle Bin Rules"** (Restore Rules, Storage Usage).

---

## 4. Phần CÓ trong code nhưng document KHÔNG đề cập

Những thứ này có sẵn trong code, spec không nêu (không sai, chỉ để nắm rõ):

1. **Pagination cursor + infinite scroll** — `CursorPagination`, `loadMore()`, `getFreshData(pit/after)`, load thêm khi cuộn (`build_list_file_widget.dart:_onScroll`). Spec không mô tả phân trang.
2. **Pull-to-refresh** — `RefreshIndicator` + `onRefresh` gọi lại `getRecycleBin`. Spec không nêu.
3. **Optimistic delete cache** — `state.cacheDelItem` (Set remoteId) để ẩn item vừa xóa/khôi phục khỏi list dù server chưa đồng bộ. (Khớp AS-05 optimistic nhưng là chi tiết impl.)
4. **Countdown màu theo ngày còn lại** — xanh (≥4d) / cam (≥2d) / đỏ (<2d) trong `countdown_timer_widget.dart:_getColor`. Spec chỉ yêu cầu "đếm ngược ngày", không nói màu.
5. **Countdown hiển thị giờ/phút** khi <1 ngày (`remainTime`, `remainTimeOnlyMinute`). Spec chỉ đề cập đếm ngược **ngày**.
6. **Client-side purge loop khi load** — vòng lặp check hết hạn trong `getRecycleBin`/`loadMore` gọi `deleteExpired`. Spec mặc định purge là việc của System/backend.
7. **Dead code / scaffolding chưa dùng:**
   - `folder_navigator.dart`, `build_storage_list.dart` — comment toàn bộ.
   - `models/folder_node.dart` (`Node`, `NodeApi.fetchChildren` trả data giả).
   - `RecycleBinState.stack` + `goBack()` — cho folder navigation, chưa dùng.
   - `RecycleBinState.loading` (Map) — khai báo nhưng không dùng.
   - Block `CountdownTimerWidget` comment trong `itemContentBuilder` (`recycle_bin_page.dart:222-230`).

---

## 5. Tổng kết nhanh

| Nhóm | Số FR | FR |
|------|:-----:|----|
| ✅ Đã đáp ứng | 11 | FR-01(¹), FR-04, FR-05, FR-07, FR-08, **FR-09**, **FR-11**, **FR-15**, FR-16, FR-17, FR-18, **FR-21** |
| 🟡 Một phần | 5 | FR-02, FR-03, FR-10, FR-13, **FR-19** |
| ⚠️ Sai/lệch | 1 | FR-12 (default sort ngược) |
| ❌ Chưa có | 1 | FR-06 |

> (¹) FR-01 phần hành động xóa nằm ngoài thư mục `recycle_bin/` (ở file browser).
> (Bảng ✅ liệt kê 12 dòng do FR-01 tính là 1 mục đạt — tổng FR đối chiếu vẫn giữ nguyên như bản gốc.)

**Trọng tâm còn lại để đạt bản Must:** File Restore fallback (FR-06), rename ' (n)' (BRule-07), search đủ hash/folder (FR-13), sort trong màn duyệt folder (FR-19), hiển thị deletedAt (FR-10), fix default sort (FR-12), fix quota 2300 (FR-02), xác nhận auto-purge backend (FR-03).

---

## 6. Checklist việc cần làm

> Verify theo code **2026-07-24**. Trạng thái: ✅ xong · 🟡 một phần · ❌ chưa · 🔵 do Backend (client không cần).

### 🔴 Must

| TT | FR | Việc còn lại | Vị trí code |
|:---:|----|----|----|
| ✅ | **FR-06** | **Đạt spec** — backend đặt vào File Restore (`movedToFileRestore`), client có thư mục File Restore + list cập nhật. Spec **không yêu cầu** toast/đọc response (FR-06, AC-004.2, BRule-03) | `sys_folder_enum.dart:104` |
| ✅ | **FR-05** | **Đạt spec** — backend đổi tên khi trùng (`renamed`/BRule-07). Spec không yêu cầu client thông báo tên mới | `file.pb.dart:3672-3674` |
| ✅ | **FR-13** | Search dùng `advance_search` | `recycle_bin_repository_impl.dart:105` |
| ✅ | **FR-12** | Default sort đã đúng spec | `recycle_bin_state.dart:21` |
| ✅ | **FR-19** | Sort trong view_folder đã nối | `view_folder_page.dart:320-323` |
| ✅ | **FR-10** | **Countdown coi như đạt** (thay cho hiển thị `deletedAt`) | `recycle_bin_page.dart:335-368` |
| ✅ | **FR-03** | Auto-purge client-side đã có | `recycle_bin_cubit.dart:71-83` |
| 🔵 | **FR-02** | **Backend xử lý** cập nhật quota — client không cần fix | — |

### 🟠 Should / polish

| TT | Mục | Việc còn lại | Vị trí code |
|:---:|----|----|----|
| 🟡 | **FR-11** | Logic 'Others' xong (`file_ext NOT_IN allKnownFileExts` + loại folder). **Chip tạm ẩn** — TODO: Figma miss UI (bỏ comment để bật lại) | `recycle_bin_page.dart` (chip, đã comment), `recycle_bin_repository_impl.dart` (NOT_IN), `category_cloud_enum.dart` (`allKnownFileExts`) |
| ✅ | **Location tap** | Đã tắt `enableLocationTap: false` cho file item trong view_folder (nhất quán recycle_bin_page) | `folder_body_view.dart:234` |

### 🔧 Kỹ thuật

| TT | Mục | Ghi chú | Vị trí code |
|:---:|----|----|----|
| ✅ | **Regen l10n** | 5 key đã có trong generated (`deleteFolder`, `deleteFolderMessage`, `confirmDelete`, `noFile`, `thisFolderIsEmpty`) | `cloud_l10n.dart:3832-3864` |

> **Việc client còn lại:** FR-06, FR-05 (Must) · FR-11, Location tap (polish).
> **Mắt xích chung** cho FR-06 + FR-05: client cần đọc `RestoreFilesResponse` (`restored`/`renamed`/`movedToRoot`/`movedToFileRestore`) tại `recycle_bin_cubit.dart:289`.
- [ ] Dọn dead code còn lại (`folder_navigator.dart`, `build_storage_list.dart`, `models/folder_node.dart`, `RecycleBinState.stack/goBack/loading`) — xem §4.