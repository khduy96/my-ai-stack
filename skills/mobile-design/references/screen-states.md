# Screen states: loading, empty, error, offline, sync

Every view that shows async data has four visual states. Missing one is a bug, not a polish item.

## 1. Read path (lists, details)

```dart
BlocBuilder<XCubit, XState>(
  builder: (context, state) {
    if (state.status == XStatus.loading && state.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.status == XStatus.error) {
      return _MessageView(
        icon: Icons.error_outline,
        message: state.error ?? 'Đã xảy ra lỗi',
        onRetry: _cubit.load,                     // always offer "Thử lại"
      );
    }
    if (state.items.isEmpty) {
      return const _MessageView(icon: Icons.inventory_2_outlined, message: 'Không có sản phẩm nào');
    }
    return RefreshIndicator(onRefresh: _cubit.load, child: ListView.builder(...));
  },
)
```

| State | Look | Notes |
|---|---|---|
| Loading (first load) | Centered `CircularProgressIndicator` | Local cache is fast - keep it plain, no skeletons needed |
| Loading (refresh / more) | Keep showing old content; `RefreshIndicator` spinner or a list-footer spinner (warehouse `hasMore`) | Never blank the list during refresh |
| Empty | Icon (48, `onSurfaceVariant`) + one-line message, centered | Say what's empty in context: "Không có đơn hàng phù hợp" when a filter is active |
| Error | Icon `error_outline` + `error.toString()` + `ElevatedButton('Thử lại')` | |
| Content | List / detail | |

- Empty state inside `RefreshIndicator` must still be scrollable so pull-to-refresh works: wrap it
  in a `ListView` (orders pattern: `ListView(children: [SizedBox(height: 120), _Message(...)])`).
- Use the feature's existing message widget (`_MessageView` in warehouse, `_Message` in orders).
  When a third feature needs it, propose a shared widget rather than a third copy.
- Use `PageStatus` from `core/enum/page_status.dart` for new cubits (it has `empty`); existing
  cubits keep their own enums.

## 2. Local-first data and sync

Data is read from a local cache (`OfflineCache` / `LocalCache`) and refreshed by `SyncService`.

- Tab pages listen to their tick and reload; remove the listener in `dispose`:

```dart
late final ValueListenable<int> _syncTick;

@override
void initState() {
  super.initState();
  _cubit = getIt<XCubit>()..load();
  _syncTick = getIt<SyncService>().tick(SyncTab.orders)..addListener(_reloadFromSync);
}

void _reloadFromSync() { if (mounted) _cubit.load(); }

@override
void dispose() {
  _syncTick.removeListener(_reloadFromSync);
  _cubit.close();
  super.dispose();
}
```

- Put `const SyncButton(tab: SyncTab.x)` in the AppBar of tab pages. It shows its own spinner and
  SnackBars ("Đã đồng bộ dữ liệu" / "Không có mạng để đồng bộ" / "Đồng bộ thất bại: ...") - don't
  add another sync UI.
- `RefreshIndicator.onRefresh` reloads from the cache (`_cubit.load`). It is not a server sync.
- Settings shows "last synced" via `SyncService.lastSyncedAt` - reuse that if a screen needs to
  show data age.

## 3. Write path (create, update, status changes)

- Writes that need the server throw `NoInternetException` when offline. Its `toString()` is the
  user-facing message "Cần kết nối internet để thực hiện thao tác này" - show it as-is.
- While submitting: disable the button and show a small spinner in it; keep the form visible and
  editable after a failure so the user can retry without retyping.
- On success: pop with `true` (caller reloads) or show a SnackBar and reload in place.
- On failure: SnackBar with `error.toString()`, or inline error text under the button for forms.

```dart
final messenger = ScaffoldMessenger.of(context);
final ok = await _cubit.submit();
if (!mounted) return;
if (ok) {
  Navigator.of(context).pop(true);
} else {
  messenger.showSnackBar(SnackBar(content: Text(_cubit.state.error ?? 'Đã xảy ra lỗi')));
}
```

## 4. SnackBars

- Short, Vietnamese, no trailing period needed; one at a time: `messenger.hideCurrentSnackBar()`
  (or `clearSnackBars()`) before showing.
- Use `SnackBarBehavior.floating` + `action` for something the user can act on (reorder "Xem").
- Errors that block the task (form can't be submitted) belong inline, not only in a SnackBar that
  disappears.
- Capture `ScaffoldMessenger.of(context)` before `await` when the widget might be gone afterwards.

## 5. Attention banners

For conditions the user must notice on a list (late orders), use an inline banner above the list
(`_LateBanner` in `orders_page.dart`) rather than a dialog. Banners use a semantic color tint with
text that says the count and the problem.
