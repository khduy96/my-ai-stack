# Performance (Flutter)

Targets: smooth 60 fps scrolling on low-end Android, no visible jank when switching tabs or themes,
images that don't blow up memory.

## 1. Lists

| Do | Don't |
|---|---|
| `ListView.builder` / `ListView.separated` for any data list | `ListView(children: items.map(...).toList())` or `Column` in `SingleChildScrollView` for data |
| Extract the item into its own `StatelessWidget` with a `const` constructor (`InventoryItem`) | Big inline closures building the whole card |
| `ValueKey(item.id)` on items when the list can reorder/filter and items have state (expand) | Index keys |
| Pagination / incremental reveal for large data (`WarehouseBloc.loadMore` near the end, 400 px threshold) | Rendering thousands of rows at once |
| Fixed `itemExtent` / `prototypeItem` only if rows are truly fixed height | `itemExtent` with text that grows at 1.25x |

Short static content (settings, form sections) can use `ListView(children:)`.

## 2. Rebuilds

- `const` constructors and `const` widgets wherever possible (`flutter_lints` will remind you).
- Narrow the rebuild area:
  - `BlocSelector` when a widget needs one field (warehouse search bar uses `sortLowStock`).
  - `buildWhen: (a, b) => a.items != b.items` on `BlocBuilder` for heavy subtrees.
  - `ValueListenableBuilder` for `SyncService.isSyncing` and similar notifiers (`SyncButton`).
- Don't call `setState` on the whole page for a small change in one card - give the card its own
  state (`_OrderCard` holds its expanded flag).
- Don't compute heavy derived lists in `build` on every frame. Sorting/filtering a few hundred
  orders is fine; anything heavier belongs in the cubit (computed once per state).
- `DateTime.now()` once per build (orders page pattern: `final now = DateTime.now();`), not per item.

## 3. Images

The app shows Cloudinary drawings (`drawing_thumbnails.dart`, `drawing_viewer_page.dart`) and
local picks (`local_image_preview.dart`).

- Thumbnails currently download the **full-size** image. For new code (or when touching these
  files), request a small rendition:
  - Cloudinary URL transform: insert `w_<px>,h_<px>,c_fill,q_auto,f_auto` after `/upload/`, or
  - `Image.network(url, cacheWidth: (size * MediaQuery.devicePixelRatioOf(context)).round())`.
- `Image.file` previews: also set `cacheWidth` - camera photos are 12+ MP.
- Always provide `errorBuilder` (broken link / offline) and `loadingBuilder` for network images.
- Full-screen viewer can load full size; use `InteractiveViewer` for zoom.
- Compress before upload with `image_picker`'s `maxWidth` / `imageQuality`.

## 4. Tabs and memory

- `IndexedStack` keeps all four tab pages alive - that's intended (state persistence). Keep each
  tab's idle cost low: no running timers/animations/streams while not visible.
- Dispose controllers, close non-singleton cubits, remove `SyncService` listeners in `dispose`.
- Singleton cubits (`ReorderCubit`, `WarehouseBloc`, `ThemeCubit`) are never closed by pages.

## 5. Animations

- Prefer implicit animations (`AnimatedContainer`, `AnimatedSwitcher`, `AnimatedOpacity`) for small
  state changes (expand card, switch spinner/label).
- Animate opacity/transform, not layout size, in long lists.
- Keep durations 150-300 ms; don't animate on every list item at first load.

## 6. Scanner and camera

- `mobile_scanner` holds the camera - the scanner page must stop/dispose its controller when
  popped and must not stay alive in a tab.
- Return the first valid code and close; ignore duplicates while closing.

## 7. Measuring

- Run in **profile mode** on a real Android device: `flutter run --profile`.
- DevTools → Performance (frame chart, "Track widget rebuilds"), Memory (image cache growth).
- `debugProfileBuildsEnabled` / Flutter Inspector "Highlight repaints" to spot rebuild storms.
- Don't judge performance in debug mode or on a desktop build.
