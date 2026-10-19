# [Cloud Drive] Purchase: Old storage capacity is displayed after a successful purchase
- Nguồn: zentao bug#6625 (https://zentao.oasoft.xyz:4433/zentao/bug-view-6625.html)
- Loại: bug (codeerror)      - Ưu tiên: 2 · Severity: 3 · Status: active · Confirmed: no
- Người giao / deadline: Cat-VN-Test → Felix-VN-Flutter / không có

## Mô tả (nguyên văn, đã chuyển sang markdown)
**[Repro Steps]**
1. Purchase a subscription with a larger storage capacity.
2. After the purchase succeeds, tap **View my plan** on the success popup.
3. Check the displayed storage capacity.
4. Open **Manage Storage** and check the storage capacity again.

**[Results]**
The old storage capacity is displayed on both the View My Plan screen and the Manage Storage screen after the purchase succeeds.
(ảnh file-read-28771.png)

**[Expectations]**
The newly purchased storage capacity should be displayed correctly on both the View My Plan screen and the Manage Storage screen.

## Tiêu chí chấp nhận (nếu nguồn có)
- Sau khi mua gói thành công, màn View My Plan (My Subscription) hiển thị đúng tổng dung lượng mới.
- Màn Manage Storage cũng hiển thị đúng tổng dung lượng mới.

## Design / ảnh
- Ảnh ZenTao `zt-6625-old-storage-after-purchase.assets/images/file-read-28771.png`: màn **My Subscription**, gói **Lite · Active**, "1 x Monthly · $1.00 paid", card xanh "**10 GB** Your plan storage", Started 15 Oct 2026 / Expired on 14 Nov 2026 / Days left 30 days. Ô dung lượng ở đáy (khoanh đỏ): "Used 0 GB", "**5 GB Total**", "0% used", "**5 GB Free**" → vẫn là dung lượng cũ (5 GB gói Free) trong khi gói mới là 10 GB. Bên dưới: "Manage Storage >", nút "Upgrade".
- Không có link Figma.

## Video
- `a8be03fa0cd65b6dd516ddba689a9794 (1).mp4` (4.81 MB, file id 28772) → **bỏ qua** (người dùng chọn không xem).

## Bình luận / lịch sử quan trọng (tóm tắt)
- 2026-10-15: Cat-VN-Test tạo → JunNg-VN-Flutter → Victor_Tran giao cho Felix. Chưa có comment nào.

## Thông tin còn thiếu
- Video repro bị bỏ qua — không rõ có pull-to-refresh / thoát vào lại màn hình hay không, và sau bao lâu dung lượng mới mới hiện (hay không bao giờ hiện).
- Không rõ dung lượng mới đến từ đâu (BE trả quota sau khi mua ngay lập tức hay có độ trễ xử lý / webhook store).
- Không rõ backend đang test là VN (gRPC) hay HK (native handler).
- Không rõ nền tảng (iOS/Android) — ảnh nhìn giống Android.
