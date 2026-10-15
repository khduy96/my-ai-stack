# Testing and debugging UI

Logic tests (use cases, cubits, SKU generator) belong to the `ms-test` agent. This file covers
checking that screens **look and behave** right.

## 1. Current test state

- `test/sku_generator_test.dart` - pure logic.
- `test/widget_test.dart` is still the Flutter template counter test and doesn't match `MyApp`
  (it needs dotenv, DI, Parse). Don't use it as a model; `pumpWidget(const MyApp())` won't work in
  tests without setup.

## 2. Widget tests for a single widget

Test leaf widgets in isolation with a theme, not the whole app:

```dart
Widget _wrap(Widget child, {AppThemeId theme = AppThemeId.basic, double scale = 1.0}) {
  return MaterialApp(
    theme: AppTheme.of(theme),
    home: MediaQuery(
      data: MediaQueryData(size: const Size(360, 720), textScaler: TextScaler.linear(scale)),
      child: Scaffold(body: child),
    ),
  );
}

testWidgets('InventoryItem does not overflow in senior theme', (tester) async {
  await tester.pumpWidget(_wrap(InventoryItem(inventory: fakeInventory),
      theme: AppThemeId.senior, scale: 1.25));
  expect(tester.takeException(), isNull);   // RenderFlex overflow surfaces here
  expect(find.text(fakeInventory.productItem.name), findsOneWidget);
});
```

Worth testing for UI:

- No overflow at `scale: 1.25` and 1.5 on width 320-360 for cards and rows with long product names.
- Status chip/label text and color for each `OrderStatus` / stock level.
- Empty and error states render the right message and a "Thử lại" button that calls back.
- Icon-only buttons expose their tooltip: `find.byTooltip('Đồng bộ dữ liệu')`.
- Tap target size: `expect(tester.getSize(find.byType(IconButton)).height, greaterThanOrEqualTo(48))`.
- Accessibility guidelines:
  `await expectLater(tester, meetsGuideline(androidTapTargetGuideline));` and
  `textContrastGuideline`.

Pages that call `getIt<...>()` in `initState` need DI registered with fakes before pumping - prefer
testing the extracted widgets instead.

## 3. Manual visual check (every UI change)

1. Run on Android: `flutter run`.
2. Cài đặt → Giao diện: check the screen in **Cơ bản**, **Hồng cute**, **Người lớn tuổi**.
3. With Người lớn tuổi active, look for yellow-black overflow stripes and clipped text, then open
   the keyboard on forms.
4. Turn on airplane mode: open the screen (cached data should show), try the write action (expect
   the "Cần kết nối internet..." message, input kept).
5. Long product names, zero/huge quantities and amounts (e.g. 2 tỉ) in the data.

## 4. Debugging layout

| Symptom | Likely cause | Fix |
|---|---|---|
| Yellow/black stripes, "RenderFlex overflowed" | Text in a `Row` without `Expanded`, fixed height | See typography-and-layout.md §2 |
| "Vertical viewport was given unbounded height" | `ListView` inside `Column` without `Expanded` | Wrap in `Expanded`, or `shrinkWrap` only for short lists |
| "setState() called after dispose()" / "Looking up a deactivated widget's ancestor" | Missing `mounted` check after `await` | `if (!mounted) return;` / capture messenger/navigator before `await` |
| Wrong color in pink/senior theme only | Hard-coded `Colors.*` | Use `colorScheme` |
| Data not updating after returning to a page | No reload after `push`, or missing `SyncTab` listener | navigation.md §2, screen-states.md §2 |
| Bottom sheet field hidden by keyboard | No `viewInsets` padding / `isScrollControlled: false` | typography-and-layout.md §5 |

Tools: Flutter Inspector (Select widget, "Show guidelines", layout explorer),
`debugPaintSizeEnabled = true` temporarily, DevTools Performance for jank, `adb logcat` /
Xcode console for native plugin errors (camera, image picker).

## 5. Before finishing

```bash
flutter analyze
dart run .claude/skills/mobile-design/scripts/ui_audit.dart <touched folder>
flutter test
```

Report any audit findings in touched files that you chose not to fix, with the reason.
