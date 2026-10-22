---
id: lens-flutter
kind: trait
version: 0.1.1
kernel: ^1
description: Review focus on Flutter-specific failure modes.
applies_to: [verifier]
slot: lens
tags: [flutter, lens]
---
## Focus: Flutter

- **Lifecycle:** controllers, focus nodes, stream subscriptions, timers or listeners never disposed; `setState` or `context` used after an `await` without a `mounted` (or `context.mounted`) check; work in `initState` that needs an inherited widget.
- **Rebuilds:** I/O or heavy work in `build`; a broad `setState`, `BlocBuilder` or `Consumer` that rebuilds a whole screen for a small change; missing `const`; missing or unstable keys in lists.
- **State:** emitting or notifying after `close`/`dispose`; state mutated instead of copied (`copyWith`); streams and subscriptions never cancelled; business logic in widgets that belongs in the state or data layer.
- **Async and errors:** futures that can fail silently (unawaited, no `catchError`), missing error and empty states in the UI, loading states that never end.
- **Platform:** missing permissions or manifest/Info.plist entries for a plugin, platform calls without checks, Android/iOS differences the change ignores.
- **Layout:** unbounded constraints in scrollables, overflow on small screens or with a large text scale.

Name the widget or class and the user-visible effect for each finding.
