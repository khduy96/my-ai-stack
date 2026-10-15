# Android and iOS in one Flutter codebase

my_store ships one Material 3 UI on both platforms. Platform differences are handled where users
would notice them, not by building two designs.

## 1. Unify vs adapt

| Area | Decision for my_store |
|---|---|
| Visual design, components, icons | **Unified**: Material 3 + Material Icons on both. Don't mix Cupertino widgets into screens. |
| Fonts | Platform default (Roboto on Android, SF via Flutter on iOS) - don't add a custom font unless asked |
| Page transitions & back | **Adapted automatically** by `MaterialPageRoute` (slide + iOS edge-swipe back; Android predictive back) |
| Scroll physics | Adapted automatically (bounce on iOS, glow/stretch on Android) - don't force one |
| Switches / indicators | Use `.adaptive` constructors where they exist (`Switch.adaptive`, `CircularProgressIndicator.adaptive`) only if a screen should feel native; otherwise keep Material |
| Dialogs | Material `AlertDialog` on both (consistent with existing code). `showAdaptiveDialog` is acceptable for simple confirmations if the user asks for native feel |
| Date/time pickers | Material `showDatePicker` / `showTimePicker` on both |
| Business logic, layout, strings | Always unified |

When something truly must differ, branch with `Theme.of(context).platform`
(`TargetPlatform.iOS`) rather than `dart:io Platform` - it is testable and works in widget tests.

## 2. Back navigation

- Android: system back button/gesture pops routes and closes sheets/dialogs. Don't trap it except
  for unsaved forms (`PopScope`, see navigation.md).
- iOS: no back button - every pushed page must have the AppBar back arrow (default) and supports
  edge swipe. Full-screen pages without AppBar (scanner, viewer) need a visible close button
  (`IconButton(icon: Icon(Icons.close))` with tooltip) in a `SafeArea`.

## 3. Permissions (camera, photos)

Declared already:

- iOS `ios/Runner/Info.plist`: `NSCameraUsageDescription` (scan QR/barcode),
  `NSPhotoLibraryUsageDescription` (attach drawings) - in Vietnamese.
- Android: camera via `mobile_scanner`, photos via `image_picker` (Android Photo Picker, no storage
  permission needed on recent versions).

UI rules:

- Ask at the moment of use (tap "Quét" / "Thêm ảnh"), never on app start.
- If the permission is denied, show an inline message on the scanner/picker screen explaining how to
  enable it in Settings, with a button to go back - not a blank camera view.
- A new permission or plugin config (Info.plist / AndroidManifest / Gradle) is platform work: hand it
  to the `mobile-developer` agent; UI agents don't edit platform folders.

## 4. Safe areas and notches

- iOS home indicator and Android gesture bar: content at the very bottom (custom bottom bars,
  pinned buttons, sheets) goes inside `SafeArea`.
- Dynamic Island / notch: covered by `AppBar`; custom headers need `SafeArea(bottom: false)`.

## 5. Keyboard

- iOS number pad has no "Done" key: for number-only fields use
  `TextInputType.numberWithOptions(signed: false)` with `textInputAction` and make sure tapping
  outside dismisses the keyboard (`GestureDetector(onTap: FocusScope.of(context).unfocus)` around the
  form body, or `TextField(onTapOutside: (_) => FocusScope.of(context).unfocus())`).
- Android resizes the body by default (`resizeToAvoidBottomInset: true`) - keep it.

## 6. Text scaling differs

- Android users often set large system fonts; iOS users use Dynamic Type. Flutter applies both via
  `MediaQuery.textScaler`.
- In the `senior` theme the app replaces the system scale with a fixed 1.25 - in other themes the
  system scale can be larger than 1.25. Layouts must cope with both.

## 7. Testing on both

Before calling a UI change done, check on at least one Android device/emulator; for anything
involving camera, photos, keyboard or safe areas, also check an iOS simulator (or flag that it
wasn't checked).
