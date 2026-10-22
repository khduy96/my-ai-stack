---
id: flutter-practices
kind: trait
version: 0.1.1
kernel: ^1
description: Flutter habits that prevent the usual lifecycle, rebuild and state bugs while writing code.
applies_to: [builder]
tags: [flutter, discipline]
---
## Flutter practices

- Dispose everything you create: controllers, focus nodes, animation controllers, stream subscriptions, timers.
- After an `await` in a widget or `State`, check `mounted` (or `context.mounted`) before using `context` or calling `setState`.
- Keep `build` pure and cheap: no I/O, no heavy computation; use `const` constructors wherever possible, and stable keys where list identity matters.
- Follow the state-management pattern the project already uses (Bloc/Cubit, Provider, Riverpod…) and its layering; do not introduce another one, and never emit or notify after close or dispose.
- Put user-facing strings where the project keeps them (l10n files or string constants), unless the project writes them inline.
