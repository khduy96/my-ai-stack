---
name: mobile-design
description: Thiết kế UI/UX mobile cho app Flutter quản lý kho + đơn hàng (kho/ = my_store, anhDung/ = anh_dung; Android + iOS). Dùng khi thiết kế hoặc sửa màn hình, widget, theme, form, bottom sheet, dialog, trạng thái loading/rỗng/lỗi/offline, hoặc khi review giao diện trong lib/features. Flutter UI design for the warehouse + order app - Material 3, three themes (basic / pinkCute / senior with 1.25 text scale), Cubit/Bloc pages, local-first sync, Vietnamese strings. Teaches the project's conventions and the reasoning behind them, plus a Dart audit script.
allowed-tools: Read, Glob, Grep, Bash
---

# Mobile Design - kho / anhDung (Flutter)

> Design for the real user: a shop owner or staff member, standing in a warehouse or at the
> counter, phone in one hand, possibly older (the `senior` theme exists for them), on a shaky
> connection. Every screen must still work at text scale 1.25, offline, and one-handed.

This skill is about **how screens look and behave**. Layer rules (use cases, DI, cache keys) live
in the `ms-*` agents and `/team`; Flutter language/API depth lives in `flutter-expert`.

---

## 1. Project facts (do not ask the user about these)

The workspace `D:\Felix\AppDemo` has two copies of the same app: `kho/` (package `my_store`, title
"Warehouse App") and `anhDung/` (package `anh_dung`, title / label "Anh Dũng", forked 2026-10-15).
UI code is identical; work in the folder the task names (ask if unclear). Paths below are relative
to that app folder.

| Aspect | Fact | Where |
|---|---|---|
| Platforms | Android + iOS phones, **portrait only** | `lib/main.dart` (`setPreferredOrientations`) |
| Design system | Material 3 (`useMaterial3: true`), Material Icons | `lib/core/theme/app_theme.dart` |
| Themes | `basic` (default M3), `pinkCute` (pink, radius 16), `senior` (teal, buttons min height 52, icons 28, **textScaler 1.25**) | `app_theme.dart`, `main.dart` `builder:` |
| Theme switching | `ThemeCubit` (`@lazySingleton`, persisted in `LocalCache` key `app_theme`) | `features/settings/presentation/bloc/theme_cubit.dart` |
| Dark mode | **Not supported** - only light themes exist | - |
| Top-level nav | `NavigationBar` + `IndexedStack`: Kho · Đơn hàng · Báo cáo · Cài đặt | `features/home/home_page.dart` |
| Sub-navigation | `Navigator.of(context).push(MaterialPageRoute(...))`, often `push<bool>` → reload when `true` | every page |
| go_router | Only `/` and `/warehouse` - not used for in-app flows | `core/router/app_router.dart` |
| State | Cubit/Bloc (`flutter_bloc`), obtained with `getIt<...>()` in the page `State` | `features/*/presentation/bloc` |
| Status enum | `PageStatus { initial, ready, loading, success, empty, error }` (WarehouseBloc); older cubits have their own `XxxStatus { initial, loading, success, error }` | `core/enum/page_status.dart` |
| Data freshness | Local-first cache + `SyncService`; pages listen to `tick(SyncTab.x)`; AppBar `SyncButton` | `core/sync/` |
| Offline writes | Throw `NoInternetException` ("Cần kết nối internet...") → show its `toString()` | `core/error/no_internet_exception.dart` |
| Strings | Vietnamese, hard-coded, no l10n. AppBar titles of tabs are UPPERCASE ("KHO HÀNG", "ĐƠN HÀNG", "CÀI ĐẶT") | pages |
| Money / dates | `formatCurrency` ("1 triệu 500 nghìn"), `formatMillion`, `formatDateTime` (dd/MM/yyyy HH:mm), `MoneyInputFormatter` + `parseMoney` | `core/utils/` |
| Camera / photos | `mobile_scanner` (`BarcodeScannerPage.open`), `image_picker`, Cloudinary for drawings | warehouse / orders |

---

## 2. Which reference to read

Read only what the task touches - each file is self-contained.

| Task | Read |
|---|---|
| New screen or big redesign | [design-thinking.md](references/design-thinking.md) first, then the rows below that apply |
| Colors, theme, adding/changing a theme, status colors | [theme-and-color.md](references/theme-and-color.md) |
| Text styles, spacing, overflow, `senior` scale, SafeArea, keyboard | [typography-and-layout.md](references/typography-and-layout.md) |
| Buttons, tap targets, FAB, gestures, destructive actions, haptics | [touch-and-interaction.md](references/touch-and-interaction.md) |
| Tabs, push/pop, bottom sheets, dialogs, back handling | [navigation.md](references/navigation.md) |
| Loading / empty / error / offline / sync / snackbars | [screen-states.md](references/screen-states.md) |
| Forms, number & money input, validation, submit | [forms-and-input.md](references/forms-and-input.md) |
| Long lists, rebuilds, images, jank | [performance.md](references/performance.md) |
| Android vs iOS differences, permissions, camera | [platform.md](references/platform.md) |
| Widget tests for UI, debugging layout, DevTools | [testing-and-debugging.md](references/testing-and-debugging.md) |

---

## 3. Golden rules (apply to every UI change)

1. **Theme first.** Colors from `Theme.of(context).colorScheme`, text from `textTheme`. No new
   `Colors.white` / `Colors.grey` / hex for surfaces or text. Semantic status colors (stock level,
   order status) are the only exception - reuse the existing helpers (`orderStatusColor`, the
   thresholds in `inventory_item.dart`) instead of inventing new ones.
2. **Survive `senior`.** No fixed heights around text, no single-line `Row`s of text without
   `Expanded`/`Flexible` + `maxLines`/`overflow`. Check the screen at textScaler 1.25.
3. **Four states per async view:** loading, empty, error (with "Thử lại"), content. Writes that
   need the server must handle `NoInternetException`.
4. **Thumb zone.** The primary action of a tab is the `FloatingActionButton.extended` (bottom
   right). Form submit is a full-width `FilledButton` at the end of the form. Destructive actions
   are never the easiest tap and always confirm.
5. **Tap targets ≥ 48×48 dp.** Use `IconButton` (has it by default), `ListTile`, `InkWell` with
   enough padding. Every icon-only button gets a Vietnamese `tooltip`.
6. **After `await`, check `mounted`** (or `context.mounted`) before `setState`, `Navigator`,
   `ScaffoldMessenger`. Capture `Navigator.of(context)` / `ScaffoldMessenger.of(context)` before
   the `await` when you need them after.
7. **Lists are lazy:** `ListView.builder` / `.separated` for data lists; `ListView(children:)` only
   for short static content (settings, forms).
8. **Reuse before creating:** `SyncButton`, `product_picker_sheet.dart`, `filter_bar.dart`,
   `search_bar.dart`, `order_status_chip.dart`, `drawing_thumbnails.dart`, `price_edit_dialog.dart`,
   `BarcodeScannerPage.open`.
9. **Vietnamese UI text**, consistent with existing wording ("Thêm", "Tạo đơn", "Thử lại",
   "Đã đồng bộ dữ liệu", dialog buttons "Huỷ" / "Xác nhận" / "Lưu" / "Đóng" - note the spelling
   "Huỷ"). Errors: `error.toString()` in a SnackBar or inline.
10. **Deprecated API:** use `color.withValues(alpha: x)`, not `withOpacity` (older files still use
    it - don't copy it into new code).

---

## 4. Known design debt in the codebase

Don't copy these patterns into new code. Fix them only when the task touches that file, or when
the user asks for a UI cleanup.

| Debt | Example | Better |
|---|---|---|
| Hard-coded card surface `Colors.white` + manual shadow | `warehouse/.../inventory_item.dart` | `Card` / `colorScheme.surfaceContainerLow` |
| `Colors.grey` for secondary text/icons | `_MessageView` in `warehouse_page.dart`, `_Message` in `orders_page.dart` | `colorScheme.onSurfaceVariant` |
| `TextStyle(fontSize: ...)` literals | many cards | `textTheme.titleMedium` etc. + `copyWith(fontWeight:)` |
| `withOpacity(...)` | `order_status_chip.dart`, `inventory_item.dart` | `withValues(alpha: ...)` |
| Duplicated message/empty views per page | `_MessageView`, `_Message` | Same pattern is fine; if a 3rd copy is needed, propose one shared widget |
| No `Semantics` anywhere, few haptics | - | Add `tooltip`/`semanticLabel` on icon-only controls in new code |
| No unsaved-changes guard on forms | create/edit pages | `PopScope` when a form holds unsaved data (see navigation.md) |

---

## 5. Audit script

```bash
# run from the app folder (the script reads ./lib); the skill lives one level up
cd kho        # or: cd anhDung
dart run ../.claude/skills/mobile-design/scripts/ui_audit.dart lib/features
dart run ../.claude/skills/mobile-design/scripts/ui_audit.dart lib/features/orders --only-errors
```

Heuristic, regex-based (comments and string contents are ignored). Rules:

| Severity | Rules |
|---|---|
| error | `print` |
| warning | `hardcoded-color` (white/black/grey), `hex-color`, `with-opacity`, `eager-list`, `icon-tooltip`, `tap-target`, `image-error`, `not-disposed` (controllers/focus nodes), `not-closed` (non-singleton cubit from `getIt`), `mounted-after-await` |
| info | `semantic-color` (red/orange/green...), `font-size-literal`, `fixed-height-text`, `image-size`, `gesture-button` |

Options: `--min=warning`, `--only-errors`, `--json`. Exit code 1 if any error. The existing
codebase has ~160 warnings (mostly debt from section 4) - judge **new/touched code**, not the total.
Treat output as leads to inspect, not as truth.

---

## 6. Checkpoint before writing UI code

Fill this in (mentally or in the reply) before coding a screen:

```
Screen:        <name, feature folder, pushed from where, returns what (bool?)>
User & moment: <who, where, one-handed? gloves? scanning?>
Primary action:<one thing; where it sits (FAB / bottom button)>
States:        loading / empty / error / offline-write / content - how each looks
Data refresh:  SyncTab listener? reload after push? pull-to-refresh?
Senior check:  which rows could overflow at 1.25x, how they wrap
Reuse:         existing widgets/helpers used
```

## 7. Pre-merge UI checklist

- [ ] All colors/text via theme (except the shared status color helpers)
- [ ] Looks right in **basic, pinkCute, senior** (switch in Cài đặt → Giao diện)
- [ ] No overflow stripes at textScaler 1.25 and with keyboard open
- [ ] Loading / empty / error+retry / offline handled
- [ ] Primary action in thumb zone; destructive action confirmed via dialog
- [ ] Icon-only buttons have `tooltip`; targets ≥ 48 dp
- [ ] `mounted` checks after every `await`; controllers / non-singleton cubits disposed
- [ ] Data lists use builders; images have `cacheWidth` or a Cloudinary-sized URL
- [ ] Vietnamese strings match existing wording; money via `formatCurrency` / `MoneyInputFormatter`
- [ ] `flutter analyze` clean; audit script shows no new errors in touched files
