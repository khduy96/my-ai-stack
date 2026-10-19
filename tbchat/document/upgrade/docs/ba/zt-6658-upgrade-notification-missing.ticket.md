# [Cloud Drive] Purchase: Subscription upgrade notification is missing
- Nguồn: zentao bug#6658 (https://zentao.oasoft.xyz:4433/zentao/bug-view-6658.html)
- Loại: bug (codeerror)      - Ưu tiên: 3 · Severity: 3 · Status: active (chưa confirm)
- Người giao / deadline: Cat-VN-Test → Felix-VN-Flutter / không có deadline

## Mô tả (nguyên văn, đã chuyển sang markdown)
**[Repro Steps]**
1. Ensure a subscription plan is active.
2. Upgrade to another subscription plan successfully.
3. Open the notification list.

**[Results]**
No notification is displayed in the notification list after the subscription upgrade succeeds.

**[Expectations]**
A notification should be displayed in the notification list after the subscription upgrade succeeds.

## Tiêu chí chấp nhận (nếu nguồn có)
Ảnh đính kèm trích spec:
> AC-02 — Plan upgraded
> **Given** the user holds an active package **When** an upgrade reaches **Success** (US-07) **Then** the user receives a "Plan upgraded" notification. Its chip shows the new package's total storage.

## Design / ảnh
- `zt-6658-upgrade-notification-missing.assets/file-read-28901.png` — ảnh chụp đoạn spec AC-02 (nội dung như trên).

## Video
- `ba855c7ae58042da21337bf370aec12e (1).mp4` (7.34 MB) — người dùng chọn tự mô tả; chưa có mô tả.

## Bình luận / lịch sử quan trọng (tóm tắt)
- 2026-10-16 15:19 Cat-VN-Test tạo, giao JunNg → Victor_Tran → Felix (15:26). Không có comment nội dung.

## Thông tin còn thiếu
- Mô tả video (đang chờ người dùng).
- Server có tạo notification cho upgrade không, và với `type` nào (`STORAGE_PLAN_UPGRADED` hay `STORAGE_PLAN_NEW`/key khác) — cần log response `ListNotifications` sau khi upgrade hoặc BE xác nhận.
