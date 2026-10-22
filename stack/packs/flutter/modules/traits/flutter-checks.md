---
id: flutter-checks
kind: trait
version: 0.1.1
kernel: ^1
description: The Flutter commands to verify a change, and code generation before them.
applies_to: [builder, verifier]
tags: [flutter, checks]
---
## Flutter checks

- After changing a file that uses code generation (`part '*.g.dart'`, `@JsonSerializable`, `@freezed`, `@injectable`…), run `dart run build_runner build --delete-conflicting-outputs` first. Never edit the generated files themselves.
- Run `flutter analyze` and deal with every new error and warning in the code you touched: fix them as a builder, report them as a verifier.
- Run `flutter test`, or `flutter test <path>` for the affected tests when the suite is slow, and report the result under `checks`.
- If the project wraps Flutter (fvm, melos, a Makefile or scripts), use its wrapper instead.
