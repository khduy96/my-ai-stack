# Design thinking for my_store screens

Read before designing a new screen or reworking an existing one. The goal is to design from the
user's situation, not from a memorised "nice app" template.

## 1. Who uses this app, and when

| User | Situation | Consequence for UI |
|---|---|---|
| Shop owner | At the counter, talking to a customer while creating an order | Order entry must be fast, forgiving, resumable; big money fields; no deep menus |
| Staff in the warehouse | Standing, one hand holds goods, scanning barcodes | Scan button reachable, results readable at arm's length, no tiny targets |
| Older family member | Prefers `senior` theme: text 1.25x, buttons 52 high | Nothing may clip or overflow; fewer items per row; clear labels instead of icon-only |
| Anyone, anywhere | Weak 3G/4G, sometimes offline | Reads come from local cache; writes may fail with `NoInternetException`; never block the UI forever |

The products are bulky goods described by attributes (material, line, width × length × thickness,
form, brand) - names are long. Plan for wrapping text, not for short labels.

## 2. Decompose the screen before coding

For every new screen, answer in order:

1. **Job** - the one sentence the user would say ("nhập thêm 3 tấm nệm vào kho").
2. **Entry and exit** - pushed from where? Does it return `bool` so the caller reloads? What does
   back do with unsaved input?
3. **Primary action** - exactly one. Where does it sit (FAB on a tab, full-width `FilledButton` at
   the end of a form, bottom sheet action)?
4. **Data** - which cubit/use case, which `SyncTab` tick to listen to, local-first or server-only?
5. **States** - loading, empty, error, offline write, content (see screen-states.md).
6. **Density** - what is visible without scrolling at 1.25x text on a 360-dp-wide phone?
7. **Reuse** - which existing widget already does part of this?

## 3. Question the default pattern

| Default reflex | Ask instead |
|---|---|
| "Add a new tab" | There are 4 tabs; a 5th is the maximum. Can it be a pushed page from an existing tab or an AppBar action (like "Hàng cần gọi" badge)? |
| "Add a dialog" | Is it a choice of several actions (→ bottom sheet like the warehouse "Thêm" menu), a short edit (→ dialog like `price_edit_dialog.dart`), or a full form (→ pushed page)? |
| "Swipe to delete" | Gestures are invisible. Provide a visible button; if a swipe is added, it is an extra shortcut and still confirms. |
| "Show everything in the card" | Cards in lists show name + the one number that matters (stock qty, order total/status). Details go to the detail page. |
| "Icon-only toolbar" | Fine for well-known icons (sync, search, QR) with tooltip; otherwise use a labelled button. |
| "Custom fancy widget" | Material 3 component first (`Card`, `ListTile`, `FilterChip`, `SegmentedButton`, `Badge`, `SearchBar`). Themes only style M3 components - custom widgets miss theme styling. |
| "Load from server on open" | Data is local-first. Read from cache, refresh on `SyncTab` tick or pull-to-refresh. |

## 4. Context-based priorities per feature

| Feature | Priority |
|---|---|
| Kho (warehouse) | Find a product fast: search, scan, filter chips, low-stock sort. Quantity is the most prominent number, coloured by level. |
| Đơn hàng (orders) | Spot what needs attention: late orders (red border), no-deposit risk (orange), custom items. Status chip always visible. |
| Hàng cần gọi (reorder) | Act on a list: mark called / received, overdue highlighted. Reached from a badge on the warehouse AppBar and a SnackBar. |
| Báo cáo (stats) | Read numbers at a glance; use `formatMillion` for large values; avoid dense tables at 1.25x. |
| Cài đặt (settings) | Few, labelled options; theme picker shows a swatch + description. |

## 5. Spirit over checklist

Passing the checklist in SKILL.md is necessary but not enough. Before finishing, imagine:

- holding the phone in the right hand only and doing the main task;
- the senior theme on a small Android phone with the keyboard open;
- losing connection right after tapping the submit button;
- coming back to the screen after another tab synced new data.

If any of these feels broken, the design is not done.
