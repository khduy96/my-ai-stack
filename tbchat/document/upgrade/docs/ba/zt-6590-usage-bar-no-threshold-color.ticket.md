# [Cloud Drive] Purchase: Storage capacity bar color changes at the warning threshold
- Nguồn: zentao bug#6590 (https://zentao.oasoft.xyz:4433/zentao/bug-view-6590.html)
- Nguồn: figma https://www.figma.com/design/uzZlbeush4dz2Gtj6vcQg6/Cloud-Drive%EF%BC%88%E4%BA%91%E5%AD%98%E5%82%A8%EF%BC%89?node-id=25007-160601 (My Subscription, tham chiếu thêm)
- Loại: bug (codeerror)      - Ưu tiên: 3 · Severity: 3 · Status: active · Confirmed: no
- Người giao / deadline: Cat-VN-Test → Felix-VN-Flutter / không có

## Mô tả (nguyên văn, đã chuyển sang markdown)
**[Repro Steps]**
1. Open the Manage Storage screen.
2. Increase storage usage until it reaches the warning threshold.
3. Check the storage capacity bar color.

**[Results]**
The storage capacity bar changes color when the warning threshold is reached.
(ảnh file-read-28551.png)

**[Expectations]**
The storage capacity bar should not change color when the warning threshold is reached, as confirmed by BA.
(ảnh file-read-28555.png)

## Tiêu chí chấp nhận (nếu nguồn có)
- Thanh dung lượng không đổi màu khi chạm ngưỡng cảnh báo (BA đã xác nhận).

## Design / ảnh
- Ảnh ZenTao 1: dòng trong bảng hỏi đáp BA, ngày 2026-10-07, Mobile: "Storage warning 80% / 90% (US-13): Làm trong release này không?" → trả lời "out of scope now".
- Ảnh ZenTao 2: ô dung lượng trong app: "Used 2.9 GB", "5 GB Total" (chữ xanh lá), thanh sọc màu CAM ở 58%, "58% used", "2.1 GB Free", dòng "Manage Storage" bên dưới.
- Figma node 25007-160601 (My Subscription, gói Free): ô dung lượng ở 50% có thanh sọc màu XANH LÁ, "共 5GB" màu xanh lá.

## Bình luận / lịch sử quan trọng (tóm tắt)
- 2026-10-14: Cat-VN-Test tạo → JunNg → Victor_Tran → giao cho Felix. Chưa có comment nào.

## Thông tin còn thiếu
- Thứ tự 2 ảnh trong mô tả có thể bị đảo: ảnh thanh cam 58% giống "Results" (lỗi hiện tại) hơn là "Expectations"; ảnh bảng BA giống căn cứ của "Expectations".
- Không nói khi đầy 100% / vượt quota thì thanh có đổi màu (đỏ) không.
- "Manage Storage screen" trong repro: thực tế là ô dung lượng ở chân màn My Subscription (có dòng "Manage Storage"). Không nói có áp dụng cho thanh dung lượng ở Home không.
