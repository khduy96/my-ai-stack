# Typography and layout

## 1. Text styles come from the theme

```dart
final text = Theme.of(context).textTheme;

Text('KHO HÀNG')                                   // AppBar title: default AppBar style
Text(product.name, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w600))
Text(subtitle, style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant))
Text(formatCurrency(total), style: text.titleLarge?.copyWith(fontWeight: FontWeight.bold))
Text('Dữ liệu', style: text.titleMedium)          // section header (settings_page.dart)
```

| Role | Style |
|---|---|
| Section header inside a page | `titleMedium` |
| Card title / product name | `titleMedium` + w600 |
| Body, list subtitle | `bodyMedium` (default `Text`) |
| Secondary meta (date, SKU) | `bodySmall` + `onSurfaceVariant` |
| Key number (qty, total) | `titleLarge` / `headlineSmall` + bold + semantic color |
| Chip / badge label | `labelMedium` / `labelSmall` |

Many existing cards use `TextStyle(fontSize: 16)` literals. They still scale with `textScaler`, but
they ignore the theme's type ramp and drift apart over time. New code uses `textTheme`.

## 2. The `senior` text scale (most common source of bugs)

`main.dart` wraps the app in `MediaQuery(textScaler: TextScaler.linear(1.25))` when the theme is
`senior`. In other themes the **system** font-size setting applies, which can be even larger.
So every screen must handle text 1.25x+ larger than in the design.

Rules:

- **No fixed height around text.** `SizedBox(height: 40, child: Text(...))` clips. Use padding and
  let height follow content; use `minHeight` constraints if a minimum is needed.
- **Every `Text` inside a `Row` is wrapped** in `Expanded`/`Flexible` and has `maxLines` +
  `overflow: TextOverflow.ellipsis`, or is allowed to wrap.
- **Long product names wrap** (up to 2-3 lines) rather than ellipsize at 1 line - the attribute
  tail (size, brand) is what distinguishes products.
- **Numbers next to labels:** put the label in `Expanded` and the number at its intrinsic width,
  so the number never gets truncated.
- **Rows with ≥ 3 items** (label, value, button) - consider `Wrap` or stacking on two lines.
- Don't scale icons with text manually; `senior` already sets `IconThemeData(size: 28)`.
- Don't clamp the text scaler to "fix" overflow - fix the layout.

```dart
// ✅ Survives 1.25x
Row(
  children: [
    Expanded(
      child: Text(product.name, maxLines: 2, overflow: TextOverflow.ellipsis,
          style: text.titleMedium),
    ),
    const SizedBox(width: 8),
    QuantityBadge(quantity: qty), // intrinsic width
  ],
)
```

## 3. Spacing

The codebase uses multiples of 4 - stick to these values:

| Use | Value |
|---|---|
| Between label and value, icon and text | 4-8 |
| Inside cards / tiles | 12 (padding) |
| Between list cards (`separatorBuilder`) | 12 |
| Page padding (`ListView` / form) | 16 |
| Between form sections, before submit button | 24 |

Use `const SizedBox(height: x)` / `width: x` for gaps; `Padding` for insets. Don't use `Spacer`
inside scrollables.

## 4. Screen structure

```dart
Scaffold(
  appBar: AppBar(title: const Text('TÊN TAB'), actions: [ ... , const SyncButton(tab: SyncTab.x)]),
  floatingActionButton: FloatingActionButton.extended(icon: ..., label: const Text('Thêm'), onPressed: ...),
  body: Column(
    children: [
      /* fixed header: search bar, filter chips, banners */
      Expanded(child: /* RefreshIndicator + ListView.builder */),
    ],
  ),
)
```

- Tab pages (inside `HomePage`'s `IndexedStack`) own their `Scaffold` + `AppBar`.
- Pushed pages: plain `AppBar(title: Text('Sentence case title'))` with the default back button.
- Leave room at the end of lists so the FAB doesn't cover the last item: bottom padding ≈ 88.
- Forms: `SingleChildScrollView` or `ListView` with `padding: EdgeInsets.all(16)`, submit button
  last.

## 5. Safe area and keyboard

- `Scaffold` + `AppBar` + `NavigationBar` already handle top/bottom insets.
- Bottom sheets: `showModalBottomSheet(useSafeArea: true, isScrollControlled: true, ...)` and wrap
  content in `SafeArea` (warehouse "Thêm" menu, `product_picker_sheet.dart`).
- Sheets with text fields: add `EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom)`
  so the keyboard doesn't cover the field (see orders `product_picker_sheet.dart`).
- Full-screen custom layouts without AppBar (e.g. scanner, drawing viewer) need explicit
  `SafeArea`.
- Test forms with the keyboard open at 1.25x: the focused field and the submit button must be
  reachable by scrolling.

## 6. Screen sizes

Portrait phones only. Design for 360 dp width (common small Android) and check 320 dp does not
crash (overflow stripes are acceptable only if content stays usable). No tablet layout is needed;
if added later, cap content width with `ConstrainedBox(maxWidth: 600)` rather than designing a new
layout.
