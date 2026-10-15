# Theme and color

Source of truth: `lib/core/theme/app_theme.dart`. The theme is chosen by `ThemeCubit` and applied
in `MaterialApp.router(theme: AppTheme.of(themeId))` in `lib/main.dart`.

## 1. The three themes

| Id | Label | Look | Notable overrides |
|---|---|---|---|
| `basic` | Cơ bản | Plain `ThemeData(useMaterial3: true)` (purple seed `0xFF6750A4`) | none |
| `pinkCute` | Hồng cute ✨ | Pink `0xFFFF4D8D`, background `0xFFFFF0F6`, radius 16 everywhere | AppBar pink/white, filled & elevated buttons pink, chips, inputs filled white with pink border, `NavigationBar` white with pink indicator |
| `senior` | Người lớn tuổi | Teal `0xFF00695C`, background `0xFFF4F6F5` | AppBar teal/white, icons 28, buttons `minimumSize: Size(0, 52)` + bigger padding, `textScaler 1.25` applied in `main.dart` |

Consequences:

- A widget that hard-codes colors looks right in `basic` and wrong in the others (e.g. a white
  card on pink background loses its edge; a grey label on teal AppBar is unreadable).
- AppBars are coloured in `pinkCute`/`senior`, so AppBar actions must use the inherited
  `foregroundColor` - don't set icon colors on AppBar icons unless it's a semantic signal
  (the reorder badge uses red/grey on purpose; check it stays visible on teal/pink).
- Only M3 components pick up the theme overrides. Prefer `FilledButton`, `Card`, `Chip`,
  `TextField` with default decoration over hand-built `Container`s.

## 2. Picking a color in widget code

```dart
final scheme = Theme.of(context).colorScheme;
```

| Need | Use |
|---|---|
| Screen background | nothing (Scaffold already uses `scaffoldBackgroundColor`) |
| Card / tile surface | `Card` default, or `scheme.surfaceContainerLow` / `surfaceContainerHighest` |
| Main text | default `Text` (inherits `onSurface`) |
| Secondary text, empty-state icon | `scheme.onSurfaceVariant` |
| Primary accent (selected, links, key numbers) | `scheme.primary` |
| Text/icon on primary fill | `scheme.onPrimary` |
| Subtle highlight background | `scheme.primaryContainer` + `onPrimaryContainer` |
| Error text / destructive | `scheme.error`, fill `scheme.errorContainer` |
| Borders, dividers | `scheme.outlineVariant` (or `Divider()` default) |
| Translucent tint | `color.withValues(alpha: 0.12)` - never `withOpacity` |

## 3. Semantic status colors (the allowed exception)

Some meaning must stay constant across themes - these keep fixed hues:

| Meaning | Current source | Colors |
|---|---|---|
| Order status | `orderStatusColor()` in `features/orders/presentation/widgets/order_status_chip.dart` | pending orange, ready teal, delivering blue, completed green, cancelled red |
| Stock level | `_statusColor()` in `features/warehouse/presentation/widgets/inventory_item.dart` | 0 → red, ≤ 1 → orange, else green |
| Order urgency | `_OrderCard` border in `orders_page.dart` | late → red, no deposit → orange |
| Reorder urgency | warehouse AppBar badge | needs attention → red, else grey |

Rules:

- Reuse these helpers; don't redefine the mapping in another widget.
- Never rely on color alone: pair it with text ("Hết hàng", status label) or an icon.
- Tinted background + saturated text (`color.withValues(alpha: 0.15)` bg, `color` text) is the
  existing chip style - keep it for new status chips.
- If a new semantic color is needed in more than one place, propose a small shared helper (or a
  `ThemeExtension` if it must vary per theme) instead of scattering `Colors.xxx`.

## 4. Adding or changing a theme

1. Add the value to `AppThemeId` and every `switch` in `AppThemeIdX` (`key`, `label`,
   `description`, `swatch`, `fromKey`) - the compiler enforces exhaustiveness.
2. Add the `ThemeData` in `AppTheme.of`. Start from `ColorScheme.fromSeed(seedColor: ...)` and
   override only what the brand needs.
3. Don't put raw `textStyle` with font sizes into button themes - `senior` relies on
   `MediaQuery.textScaler`; mixing both caused lerp errors when switching themes (see the comment
   in `_buildSenior`).
4. If the new theme needs a text scale, extend the `builder:` in `main.dart` instead of changing
   `TextTheme` sizes.
5. Check every tab in the new theme: AppBar contrast, FAB, chips, inputs, NavigationBar indicator,
   status chips, SnackBar.

## 5. Dark mode

Not implemented: `MaterialApp.router` has no `darkTheme`. If it is requested, it is a project-wide
change: add `darkTheme`/`themeMode`, then remove hard-coded `Colors.white` / `Colors.grey` /
`Colors.black` usages first (run the audit script) - otherwise cards render white on dark.

## 6. Contrast and outdoor use

- Text on colored fills must use the paired `onX` color.
- Keep body text at full `onSurface`; reserve `onSurfaceVariant` for genuinely secondary info.
- Warehouse lighting and sunlight wash out pastel tints - important numbers (stock quantity,
  money totals) should be bold and use a saturated color, not a pastel.
