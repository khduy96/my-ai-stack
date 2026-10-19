---
name: build
description: Run build_runner scoped to ONE generator instead of the full (slow) codegen. Takes a flag arg - "-obj" regenerates only the ObjectBox files (objectbox.g.dart + objectbox-model.json); "-get" regenerates only the getIt/injectable DI file (service_locator.config.dart). Use when the user changed an @Entity or an @injectable/@LazySingleton and wants a fast targeted rebuild. Invoked as "/build -obj" or "/build -get".
---

# build

Run `build_runner` for a **single** target via `--build-filter`, skipping every other
generator (freezed / json_serializable / retrofit / l10n / theme / etc.). Much faster
than a full `dart run build_runner build`.

## Argument → target

Parse the flag passed to the skill:

| Arg     | Target            | Regenerates |
|---------|-------------------|-------------|
| `-obj`  | ObjectBox         | `lib/database/object_box_models/objectbox.g.dart` + `objectbox-model.json` |
| `-get`  | getIt / injectable| `lib/app/core/di/service_locator.config.dart` |

If no arg (or an unknown one) is given, ask which target to build (`-obj` or `-get`)
rather than guessing.

## Commands

Run from the project root, in the background (`run_in_background: true`) — each can take
1-3 minutes. Windows PowerShell: keep it on a single line (no `\` continuation).

### `-obj` — ObjectBox only

```
dart run build_runner build --delete-conflicting-outputs --build-filter="lib/database/object_box_models/objectbox.g.dart" --build-filter="lib/database/object_box_models/objectbox-model.json"
```

Output dir comes from `pubspec.yaml` (`objectbox: output_dir: database/object_box_models`).
`lib/database/tbchat_database.dart` re-exports the `.g.dart`.

### `-get` — getIt / injectable only

```
dart run build_runner build --delete-conflicting-outputs --build-filter="lib/app/core/di/service_locator.config.dart"
```

The injectable config builder aggregates the per-library `.injectable.json` intermediates
(under `.dart_tool/build/...`) into `service_locator.config.dart`; build_runner rebuilds
the stale intermediates needed for that output.

## Procedure

1. Map the arg to the command above.
2. Run it in the background and wait for completion.
3. Surface the result:
   - **Success** (exit 0 and no `[SEVERE]`/`E ` builder errors in output): report
     `succeeded` and which file(s) were regenerated.
   - **Failure**: show the build_runner error output and the offending file. Note that a
     **syntax error in any source file** makes the resolver fail for *every* builder
     (you'll see the same `lib/.../foo.dart:line` error repeated across generators) — fix
     that source file first, then re-run. Other common causes: duplicate ObjectBox
     `@Entity` id/uid (`-obj`), or a missing dependency for an `@injectable` class (`-get`).
4. Do **not** fall back to the full `dart run build_runner build` unless the user asks.

### `-get` caveat

If a brand-new `@injectable`/`@LazySingleton` class still isn't registered in
`service_locator.config.dart` after a `-get` run, run it once more (the config builder
sometimes needs the freshly-generated intermediate from the first pass). Only if it still
doesn't appear, fall back to a full build — and tell the user that's what you're doing.

## Notes

- Keep `objectbox-model.json` committed; it tracks the stable schema IDs/UIDs.
- These commands only regenerate code; they do not run DB migrations.
