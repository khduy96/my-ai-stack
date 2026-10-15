# Navigation

## 1. Structure

```
MaterialApp.router (go_router: '/' → HomePage, '/warehouse' → WarehousePage)
└── HomePage: Scaffold(body: IndexedStack, bottomNavigationBar: NavigationBar)
    ├── 0 Kho        WarehousePage   → AddStockPage, BulkAddStockPage, CreateProductPage,
    │                                  ProductDetailPage, ReorderPage, BarcodeScannerPage
    ├── 1 Đơn hàng   OrdersPage      → CreateOrderPage, OrderDetailPage → EditOrderItemsPage,
    │                                  DrawingViewerPage
    ├── 2 Báo cáo    StatsPage       → ProfitLossPage, ComparisonPage
    └── 3 Cài đặt    SettingsPage
```

- `IndexedStack` keeps every tab alive: scroll position, search text and cubit state persist across
  tab switches. Don't replace it with a rebuild-on-switch approach.
- `HomePage._onSelectTab` calls `SyncService.syncTab(tab)` (first open per session pulls data) and
  refreshes the reorder toast on the warehouse tab.
- Four tabs; five is the hard maximum. New areas become pushed pages or AppBar actions.

## 2. Pushing pages

Use `Navigator` with `MaterialPageRoute` (platform-correct transitions + iOS swipe back). go_router
is not used for in-app flows - don't add routes for normal screens.

```dart
Future<void> _openCreate() async {
  final navigator = Navigator.of(context);           // capture before await
  final created = await navigator.push<bool>(
    MaterialPageRoute(builder: (_) => const CreateOrderPage()),
  );
  if (!mounted) return;
  if (created == true) _cubit.load();                // reload only if something changed
}
```

- A page that creates/edits data pops with `Navigator.of(context).pop(true)` on success.
- Detail pages that may change data: reload unconditionally after `await push` (warehouse
  `ProductDetailPage`, orders `OrderDetailPage`).
- Pass entities/cubits via constructor (`ReorderPage(cubit: _reorder)`, `OrderDetailPage(order:)`),
  not via global state.
- Pushed page titles are sentence case ("Nhập thêm tồn kho"); tab titles are UPPERCASE.

## 3. Choosing the container

| Content | Use | Example |
|---|---|---|
| Choose one of 2-5 actions | `showModalBottomSheet` with `ListTile`s, returns an enum | warehouse "Thêm" menu (`_AddAction`) |
| Pick an item from a searchable list | `showModalBottomSheet(isScrollControlled: true, useSafeArea: true)` + `DraggableScrollableSheet` | `product_picker_sheet.dart` |
| Edit one or two values | `AlertDialog` with fields, returns value | `price_edit_dialog.dart` |
| Show a code / info | `AlertDialog` with "Đóng" | `product_code_dialog.dart` |
| Confirm an action | `AlertDialog` "Huỷ" / "Xác nhận" returning `bool` | `order_detail_page.dart` `_confirm` |
| Multi-field form, multi-step | Pushed page | `CreateOrderPage`, `CreateProductPage` |
| Full-screen camera / image | Pushed page | `BarcodeScannerPage`, `DrawingViewerPage` |

Bottom sheets and dialogs return values with `Navigator.of(sheetContext).pop(value)` - use the
builder's context, not the page's.

## 4. Back handling

- Android system back and iOS edge swipe both pop the top route - never disable them without a
  reason.
- Forms with unsaved input should guard back with `PopScope` (none exist yet - add when building or
  touching such a form):

```dart
PopScope(
  canPop: !_isDirty,
  onPopInvokedWithResult: (didPop, _) async {
    if (didPop) return;
    final leave = await _confirmDiscard();          // "Bỏ thay đổi?" Huỷ / Bỏ
    if (leave && context.mounted) Navigator.of(context).pop();
  },
  child: Scaffold(...),
)
```

- While a submit is in flight, don't let the user pop into an inconsistent state; either keep the
  button disabled and allow back (operation continues), or block back with `canPop: !submitting`.

## 5. Cross-tab signals

- Data changed elsewhere → `SyncService` bumps `tick(SyncTab.x)`; listening pages reload. Don't
  pass callbacks across tabs.
- The reorder reminder uses a floating `SnackBar` with action "Xem" from `HomePage`, plus a `Badge`
  on the warehouse AppBar. Follow this pattern for future "needs attention" signals instead of
  dialogs that interrupt.

## 6. Deep links

None today. If notifications or links are added later, that's when go_router routes for detail
pages make sense (`/orders/:id`). Keep pages constructible from an id to make that easy.
