# Touch and interaction

## 1. Tap targets

A fingertip covers ~7-10 mm; the minimum target is **48×48 dp** (Material). Visual size can be
smaller as long as the hit area is not.

| Widget | Hit area | Note |
|---|---|---|
| `IconButton` | 48×48 by default | Don't set `constraints: BoxConstraints()` or `visualDensity: compact` + `padding: zero` - that shrinks it |
| `ListTile` | ≥ 56 high | Best choice for tappable rows / menu items |
| `InkWell` on a card | size of the card | Give the card ≥ 12 padding; set `borderRadius` equal to the card's so the ripple matches |
| `TextButton` / `FilledButton` | min 40-48 high (52 in `senior`) | Fine |
| `Checkbox`, `Radio` | 48 via `materialTapTargetSize` | Prefer `CheckboxListTile` / `RadioListTile` so the label is tappable too |
| `GestureDetector` | only the child's painted area, no ripple, no semantics | Avoid for buttons; use `InkWell`/buttons |

- Keep ≥ 8 dp between adjacent targets (e.g. QR button next to the quantity badge).
- Icon-only buttons need `tooltip:` in Vietnamese (`'Đồng bộ dữ liệu'`, `'Mã QR / mã vạch'`,
  `'Hàng cần gọi'`). The tooltip is also the screen-reader label.

## 2. Thumb zone in this app

```
┌──────────────────────────────┐
│ AppBar: title · badge · sync │  hard to reach → rare/secondary actions only
├──────────────────────────────┤
│ search bar · filter chips    │  OK - used once per visit
│                              │
│ list content                 │  natural zone - tap cards
│                         [FAB]│  easiest - the tab's primary action
├──────────────────────────────┤
│ Kho | Đơn hàng | Báo cáo | ⚙ │  easiest - tab switch
└──────────────────────────────┘
```

- Each tab has at most one FAB, `FloatingActionButton.extended` with icon + short label
  ("Thêm", "Tạo đơn"). If there are several "add" variants, the FAB opens a bottom sheet of
  `ListTile`s (warehouse pattern) - don't stack multiple FABs.
- Form pages: submit is a full-width `FilledButton` at the end. For long forms consider
  `bottomNavigationBar: SafeArea(child: Padding(padding: EdgeInsets.all(16), child: FilledButton(...)))`
  so it stays reachable.
- Destructive or irreversible actions (cancel order, delete product, mark delivered) live away from
  the primary action, use `TextButton`/`OutlinedButton` or `scheme.error` color, and confirm.

## 3. Feedback

Every tap must answer within ~100 ms:

| Action | Feedback |
|---|---|
| Tap card / tile | Ink ripple (`InkWell`, `ListTile`, `Card` + `InkWell`) |
| Submit that awaits the server | Disable the button + small `CircularProgressIndicator(strokeWidth: 2)` inside it (`add_stock_page.dart` pattern: `onPressed: state.submitting ? null : _submit`) |
| Background action done | `SnackBar` with a short Vietnamese message |
| Long sync | `SyncButton` spinner (driven by `SyncService.isSyncing`) |
| Scan success | Close scanner and act immediately (search / fill field) |

Prevent double submits: the disabled-while-submitting button is mandatory for create/update
actions.

## 4. Confirmations

Use the dialog pattern from `order_detail_page.dart`:

```dart
final confirmed = await showDialog<bool>(
  context: context,
  builder: (dialogContext) => AlertDialog(
    title: Text(title),
    content: Text(message),
    actions: [
      TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Huỷ')),
      FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Xác nhận')),
    ],
  ),
);
if (confirmed != true || !mounted) return;
```

- Confirm: status changes that move stock (ready/delivering/cancel), deletions, bulk changes.
- Don't confirm: reversible, cheap actions (toggle filter, expand card).
- Message says what will happen in business terms ("Đơn sẽ trừ tồn kho ..."), not "Bạn có chắc?".

## 5. Gestures

- Supported implicitly: pull-to-refresh (`RefreshIndicator`), scroll, Android back, iOS edge swipe
  back (from `MaterialPageRoute`).
- Any extra gesture (swipe to delete/mark, long-press) must have a visible button alternative -
  older users don't discover gestures.
- `Dismissible` for destructive swipes must use `confirmDismiss` with the dialog above.
- Long-press is acceptable only as a shortcut (e.g. copy SKU), never as the only path.

## 6. Haptics

Not used yet. If added, keep it rare and meaningful (`import 'package:flutter/services.dart'`):

| Event | Call |
|---|---|
| Barcode scanned successfully | `HapticFeedback.mediumImpact()` |
| Confirmed destructive action | `HapticFeedback.heavyImpact()` |
| Toggle / selection change | `HapticFeedback.selectionClick()` |

No haptics on every tap or on scroll.

## 7. Scanning flow

`BarcodeScannerPage.open(context, title: ...)` returns the code or `null`.

```dart
final messenger = ScaffoldMessenger.of(context);   // capture before await
final code = await BarcodeScannerPage.open(context, title: 'Quét mã sản phẩm');
if (code == null || !mounted) return;              // user cancelled
// not found → SnackBar 'Không tìm thấy sản phẩm với mã đã quét'
```

The scan entry point is a visible icon in the search bar / form field, not hidden in a menu.
