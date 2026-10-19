# [Cloud Drive] Purchase: Chinese text on the My Subscription screen does not match Figma
- Nguồn: zentao bug#6567 (https://zentao.oasoft.xyz:4433/zentao/bug-view-6567.html)
- Nguồn: figma https://www.figma.com/design/uzZlbeush4dz2Gtj6vcQg6/Cloud-Drive%EF%BC%88%E4%BA%91%E5%AD%98%E5%82%A8%EF%BC%89?node-id=25007-160601
- Loại: bug (codeerror)      - Ưu tiên: P3 · Severity 3 · Status: active (chưa confirm)
- Người giao / deadline: Cat-VN-Test → Felix-VN-Flutter / không có deadline

## Mô tả (nguyên văn, đã chuyển sang markdown)
[Repro Steps]
1. Open the My Subscription screen.
2. Check the Chinese text.

[Results]
The Chinese text does not match the Figma design.

[Expectations]
The Chinese text should match the Figma design.

| EN | CN | TW |
|---|---|---|
| Your free plan | 您的免费套餐 | 您的免費套餐 |
| Your plan storage | 您的套餐存储空间 | 您的方案儲存空間 |
| You’re on the Free plan | 您正在使用免费套餐 | 您正在使用免費方案 |
| 5GB storage included. Upgrade anytime to get more space for photos, files and backups. | 包含 5GB 存储空间。您可随时升级，为照片、文件和备份获取更多空间。 | 包含 5GB 儲存空間。您可隨時升級，為照片、檔案和備份取得更多空間 |
| Active | 使用中 | 使用中 |
| …paid | 已支付 | 已支付 |
| Started | 开始日期 | 開始日期 |
| Expried on | 到期日期 | 到期日期 |
| Used | 已使用 | 已使用 |
| Button | 升级 | 升級 |

(Cập nhật lần 2 lúc 2026-10-14 17:23 — tester thêm các dòng của màn gói trả phí + screenshot file-read-28529.png)

## Tiêu chí chấp nhận (nếu nguồn có)
- Text tiếng Trung (CN, TW) trên màn My Subscription khớp Figma theo bảng trên.

## Design / ảnh
- ZenTao screenshot (app hiện tại, CN): `tool-results/mcp-zentao-blob-1791969325410-qncm6q.png` — khoanh đỏ: badge "免费套餐", tiêu đề "您当前使用 免费 套餐" + mô tả "含 5 GB…随时升级…", "已用 3.2 GB", "已用 64%", nút "升级空间".
- Figma screenshot (CN, node 25007:160601): `tool-results/mcp-claude_ai_Figma-blob-1791969376192-konghh.png` — "您的免费套餐", "您正在使用免费套餐", "包含 5GB 存储空间。您可随时升级，为照片、文件和备份获取更多空间。", "已使用 2.5 GB", "已使用 50%", nút "升级".

## Mapping key hiện tại (codebase)
| Text | Key | zh / zh_CN hiện tại | zh_TW hiện tại | Dùng ở |
|---|---|---|---|---|
| Your free plan | `yourFreePlan` | 免费套餐 | 免費方案 | plan_storage_card.dart (chỉ My Subscription) |
| You're on the {plan} plan | `youAreOnPlan` (+ `freePlanName` = 免费/免費) | 您当前使用 {plan} 套餐 | 您目前使用 {plan} 方案 | free_plan_info.dart (chỉ My Subscription) |
| {limit} storage included… | `planStorageIncludedDesc` | 含 {limit} 存储空间。随时升级，… | 含 {limit} 儲存空間。隨時升級，… | free_plan_info.dart (chỉ My Subscription) |
| Used | `storageLimitUsed` | 已用 | 已使用 | plan_bottom_panel.dart **+ storage_limit_popup.dart** |
| {percent}% used | `storagePercentUsed` | 已用 {percent}% | 已使用 {percent}% | plan_bottom_panel.dart (chỉ My Subscription) |
| Upgrade (button) | `upgradeButton` | 升级空间 | 升級空間 | my_subscription_page.dart **+ UpgradeButton mặc định (Home, Storage management)** |
| Your plan storage | `yourPlanStorage` | 套餐存储空间 | 方案儲存空間 | plan_storage_card.dart |
| Active | `subscriptionActive` | 生效中 | 生效中 | plan_status_badge.dart |
| {amount} paid | `amountPaid` | 已付 {amount} | 已付 {amount} | plan_header.dart |
| Started | `started` | 开始 | 開始 | my_subscription_page.dart |
| Expired on | `expiredOn` | 到期于 | 到期於 | my_subscription_page.dart (2 chỗ) |
| (không trong ticket) Paid | `paid` | 已付 | 已付 | my_subscription_page.dart:416 — giữ nguyên |

## Quyết định đã chốt với user
- Làm đúng nguyên văn bảng Expectations của tester (kể cả TW: 套餐/方案, câu mô tả TW không có "。").
- `upgradeButton`: tạo key mới chỉ cho My Subscription; Home/Storage management giữ "升级空间".
- `storageLimitUsed`: sửa tại chỗ (zh/zh_CN → 已使用; popup storage limit cũng đổi theo).
- Bỏ qua BA.

## Bình luận / lịch sử quan trọng (tóm tắt)
- Tạo 2026-10-14 bởi Cat-VN-Test, chuyển JunNg → Victor_Tran → Felix. Không có comment nội dung.

## Thông tin còn thiếu
- `upgradeButton` và `storageLimitUsed` dùng chung với màn khác — sửa tại chỗ hay tách key riêng cho My Subscription?
- TW không nhất quán trong Figma: "您的免費套餐" (套餐) vs "您正在使用免費方案" (方案).
- TW câu mô tả trong Figma thiếu dấu "。" cuối câu (CN có).
- Figma ghi "5GB" (không cách), app hiển thị "5 GB" do formatter dung lượng — không thuộc phạm vi text tiếng Trung.
