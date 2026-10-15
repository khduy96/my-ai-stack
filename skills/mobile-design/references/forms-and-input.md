# Forms and input

Forms are the main way data enters the app (add stock, bulk add, create product, create order,
edit items, price dialog). They're used standing up, often one-handed, sometimes while a customer
waits.

## 1. Structure

```dart
Form(
  key: _formKey,
  child: ListView(
    padding: const EdgeInsets.all(16),
    children: [
      /* section: product (picker sheet or scan) */
      const SizedBox(height: 16),
      TextFormField(...),
      const SizedBox(height: 24),
      FilledButton(
        onPressed: state.submitting ? null : _submit,
        child: state.submitting
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : const Text('Xác nhận nhập kho'),
      ),
    ],
  ),
)
```

- One column, labels above/inside the field (`InputDecoration(labelText: ...)`), no side-by-side
  fields unless both are short numbers (e.g. width × length) and they still fit at 1.25x.
- Group with a `titleMedium` section header + 8 spacing, sections separated by 16-24.
- The submit label states the outcome ("Xác nhận nhập kho", "Tạo đơn", "Lưu"), not "OK".
- Long forms: consider pinning the submit button in `bottomNavigationBar` (see touch-and-interaction.md).

## 2. Choosing values instead of typing

Typing is the slowest, most error-prone input. Prefer, in order:

1. **Scan** (`BarcodeScannerPage.open`) for products.
2. **Pick** from a list (`product_picker_sheet.dart`, `FilterChip`/`ChoiceChip`,
   `SegmentedButton` for 2-4 options, `DropdownMenu` for longer lists).
3. **Steppers** for small quantities (− / + `IconButton`s around the number) when typical values
   are 1-10.
4. **Type** only free text and arbitrary numbers/money.

## 3. Keyboard types and formatters

| Field | Config |
|---|---|
| Quantity | `keyboardType: TextInputType.number`, `inputFormatters: [FilteringTextInputFormatter.digitsOnly]` |
| Money (VND) | `keyboardType: TextInputType.number`, `inputFormatters: [MoneyInputFormatter()]`, read with `parseMoney(text)`, `suffixText: 'đ'` |
| Phone | `TextInputType.phone` |
| Address / note | `TextInputType.multiline`, `maxLines: null` or 3, `textCapitalization: TextCapitalization.sentences` |
| Name / title | `textCapitalization: TextCapitalization.sentences` |

- Set `textInputAction: TextInputAction.next` on all but the last field, `done` on the last.
- Show money back to the user in words with `formatCurrency` (e.g. a helper text under the field:
  "1 triệu 500 nghìn") - it prevents off-by-one-zero mistakes on big amounts.

## 4. Validation

- Validate on submit (`_formKey.currentState!.validate()`), then
  `autovalidateMode: AutovalidateMode.onUserInteraction` after the first failed submit.
- Messages are short Vietnamese sentences that say how to fix: "Nhập số lượng lớn hơn 0",
  "Chọn sản phẩm".
- Business rule errors from the server/cubit appear inline near the submit button or in a SnackBar
  (screen-states.md §3) - keep the user's input.
- Don't disable the submit button for invalid input (users don't know why); disable it only while
  submitting.

## 5. Controllers and focus

- Every `TextEditingController`, `FocusNode`, `ScrollController` created in a `State` is disposed
  in `dispose()`.
- Don't create controllers in `build`.
- Dismiss the keyboard when opening a scanner/picker or after submit:
  `FocusScope.of(context).unfocus()`.
- After picking/scanning a product, move focus to the quantity field.

## 6. Unsaved input

If leaving the page loses meaningful input (order lines, several fields), guard back with
`PopScope` + a "Bỏ thay đổi?" dialog (navigation.md §4). Single-field dialogs don't need a guard.

## 7. Dialog forms

`price_edit_dialog.dart` is the pattern for 1-2 value edits: `AlertDialog` with fields, actions
"Huỷ" / "Lưu", returns the value via `Navigator.pop(value)`; the caller saves. Keep dialog forms to
two fields max - otherwise push a page.
