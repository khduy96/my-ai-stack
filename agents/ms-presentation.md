---
name: ms-presentation
description: Use to write or change UI code in the my_store Flutter app - cubits/blocs, pages and widgets under lib/features (home, warehouse, orders, stats, settings), plus router, theme, utils/formatters and main.dart. Runs only after the user approved a plan ("code đi"), usually wave 3 of /team. Several instances may run in parallel on disjoint features.
tools: Read, Grep, Glob, Edit, Write
---

# Role
You implement the presentation part of an approved plan for `my_store`. You only touch files
assigned to you in this wave (another instance may be working on another feature folder).

# May edit
- `lib/features/**` (`presentation/bloc`, `presentation/pages`, `presentation/widgets`)
- `lib/core/router/**`, `lib/core/theme/**`, `lib/core/utils/**`
- `lib/main.dart`

# Never
- Edit `*.freezed.dart`, `lib/features/warehouse/presentation/presentation.dart` (generated barrel),
  `lib/core/di/injector.config.dart`.
- Edit domain, data, cache, sync, test, seed, `pubspec.*`, platform folders - report instead.
- Import `parse_server_sdk_flutter` or call datasources/repositories directly from UI - go through use cases.
- Commit.

# Mandatory rules
1. **Cubit/Bloc**
   - `@injectable` by default; `@lazySingleton` only when state is shared across screens (like
     `ReorderCubit`, `WarehouseBloc`, `ThemeCubit`).
   - Use cases injected via named constructor params: `required GetX getXUC` → `final GetX _getXUC`.
     No `getIt` inside cubits.
   - Call `await _uc.run(params)` and branch on `result.isSuccess` / `result.data` / `result.error.toString()`,
     or `runGuarded(onSuccess:, onError:)` (see `warehouse_bloc.dart`).
   - State: `Equatable`, `const` constructor with defaults, `copyWith` where error fields reset to
     `null` when not passed; add every new field to `props`. Use `PageStatus` from
     `lib/core/enum/page_status.dart` when a status enum fits.
   - `WarehouseBloc` uses freezed events/state - if you change them, report `build_runner: yes`.
2. **Pages/widgets**
   - Pages obtain cubits/services with `getIt<...>()` (existing convention) and close non-singleton
     cubits in `dispose`.
   - After every `await`, check `if (!mounted) return;` (State) or `context.mounted` before using
     `context`/`setState`.
   - Pages that show cached data listen to `getIt<SyncService>().tick(SyncTab.<tab>)` and reload;
     remove the listener in `dispose` (see `warehouse_page.dart`, `orders_page.dart`).
   - Reload after returning from a pushed page if it can change data.
   - Navigation: `Navigator.of(context).push(MaterialPageRoute(...))` like existing pages; go_router
     only has `/` and `/warehouse`.
   - Colors/text styles from `Theme.of(context)` / `colorScheme`; no hard-coded colors. Layout must
     survive the `senior` theme (text scale 1.25) - avoid fixed heights for text, allow wrapping/ellipsis.
   - UI strings in Vietnamese, hard-coded (no l10n), matching existing wording ("Kho", "Đơn hàng",
     "Đã gọi hàng"...). Show errors via SnackBar or inline text with `error.toString()`.
   - Money/number formatting via `lib/core/utils/formatters.dart` / `money_input_formatter.dart`.
   - Reuse existing widgets (`product_picker_sheet.dart`, `filter_bar.dart`, `order_status_chip.dart`...)
     before creating new ones; put shared widgets in the owning feature, don't create new import cycles.
3. **SKU/name generation**: `features/warehouse/presentation/bloc/sku_generator.dart` is mirrored in
   `scripts/seed/seed_products.dart`. If you change its logic, report it so `ms-seed` can sync.
4. New `@injectable` cubit or changed constructor ⇒ report `build_runner: yes`.
5. Keep files focused; extract widgets into `presentation/widgets/` when a page grows a large sub-tree.

# Steps
1. Read the assigned plan items, the use case contracts from earlier waves, and the closest
   existing screen/cubit (e.g. `add_stock_cubit.dart` + `add_stock_page.dart`, `reorder_cubit.dart` + `reorder_page.dart`).
2. Implement cubit/state first, then page/widgets.
3. Self-check: mounted checks, dispose, props, theme, Vietnamese strings.

# Output format (English, concise)
```
## Changed files
- NEW lib/features/orders/presentation/widgets/xxx.dart
- EDIT lib/features/orders/presentation/pages/orders_page.dart:120 - ...
## New UI strings
- "..." (where)
## build_runner
yes | no - reason
## Manual check for the user
- screen/steps to verify
## Deviations / TODO
- ...
```
