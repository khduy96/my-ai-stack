// UI audit for the kho / anhDung Flutter app (heuristic, regex-based). Run from the app folder.
//
// Usage (from the repo root):
//   dart run .claude/skills/mobile-design/scripts/ui_audit.dart [paths...] [options]
//
// Paths default to `lib`. Options:
//   --min=error|warning|info   lowest severity to report (default: info)
//   --only-errors              same as --min=error
//   --json                     machine-readable output
//
// Exit code 1 when any error-level finding is reported.
// ignore_for_file: avoid_print

import 'dart:convert';
import 'dart:io';

enum Severity { error, warning, info }

class Finding {
  final String file;
  final int line;
  final Severity severity;
  final String rule;
  final String message;

  Finding(this.file, this.line, this.severity, this.rule, this.message);

  Map<String, Object> toJson() => {
    'file': file,
    'line': line,
    'severity': severity.name,
    'rule': rule,
    'message': message,
  };
}

const _generatedSuffixes = ['.g.dart', '.freezed.dart', '.config.dart'];
const _generatedFiles = ['lib/features/warehouse/presentation/presentation.dart'];

final _neutralColor = RegExp(r'^(white|black|grey|white\d+|black\d+)$');
final _contextUse = RegExp(
  r'\bsetState\s*\(|'
  r'\b(Navigator|ScaffoldMessenger|Theme|MediaQuery|Scaffold|FocusScope)\.of\(\s*context\s*\)|'
  r'\bcontext\.(read|watch|select|push|pop|go)\b|'
  r'\bcontext:\s*context\b',
);
final _disposable = RegExp(
  r'\b(TextEditingController|ScrollController|FocusNode|AnimationController|'
  r'TabController|PageController|MobileScannerController)\??\s+(_\w+)\s*[;=]',
);
final _disposableInit = RegExp(
  r'\b(_\w+)\s*=\s*(TextEditingController|ScrollController|FocusNode|'
  r'AnimationController|TabController|PageController|MobileScannerController)\(',
);
final _getItCubit = RegExp(r'\b(_\w+)\s*=\s*getIt<(\w+(?:Cubit|Bloc))>\(\)');
final _singletonClass = RegExp(
  r'@(?:lazySingleton|singleton|LazySingleton\([^)]*\)|Singleton\([^)]*\))\s+class\s+(\w+)',
);

void main(List<String> args) {
  final asJson = args.contains('--json');
  var minSeverity = Severity.info;
  if (args.contains('--only-errors')) minSeverity = Severity.error;
  for (final a in args.where((a) => a.startsWith('--min='))) {
    minSeverity = Severity.values.firstWhere(
      (s) => s.name == a.substring(6),
      orElse: () => Severity.info,
    );
  }
  final roots = args.where((a) => !a.startsWith('--')).toList();
  if (roots.isEmpty) roots.add('lib');

  final files = <File>[];
  for (final root in roots) {
    final type = FileSystemEntity.typeSync(root);
    if (type == FileSystemEntityType.file && root.endsWith('.dart')) {
      files.add(File(root));
    } else if (type == FileSystemEntityType.directory) {
      files.addAll(
        Directory(root)
            .listSync(recursive: true)
            .whereType<File>()
            .where((f) => f.path.endsWith('.dart')),
      );
    } else {
      stderr.writeln('Path not found: $root');
      exit(2);
    }
  }

  final targets = files.where((f) => !_isGenerated(_rel(f.path))).toList()
    ..sort((a, b) => a.path.compareTo(b.path));
  final singletons = _collectSingletons([...targets, ..._libFiles()]);

  final findings = <Finding>[];
  for (final f in targets) {
    findings.addAll(auditFile(_rel(f.path), f.readAsStringSync(), singletons));
  }
  final reported = findings
      .where((f) => f.severity.index <= minSeverity.index)
      .toList();

  if (asJson) {
    print(const JsonEncoder.withIndent('  ').convert({
      'scannedFiles': targets.length,
      'findings': reported.map((f) => f.toJson()).toList(),
    }));
  } else {
    _printText(reported, targets.length);
  }
  exit(reported.any((f) => f.severity == Severity.error) ? 1 : 0);
}

String _rel(String path) {
  final cwd = Directory.current.path.replaceAll('\\', '/');
  final p = File(path).absolute.path.replaceAll('\\', '/');
  return p.startsWith('$cwd/') ? p.substring(cwd.length + 1) : p;
}

bool _isGenerated(String rel) =>
    _generatedSuffixes.any(rel.endsWith) || _generatedFiles.contains(rel);

Iterable<File> _libFiles() {
  final lib = Directory('lib');
  if (!lib.existsSync()) return const [];
  return lib
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart') && !_isGenerated(_rel(f.path)));
}

Set<String> _collectSingletons(Iterable<File> files) {
  final names = <String>{};
  for (final f in files) {
    for (final m in _singletonClass.allMatches(f.readAsStringSync())) {
      names.add(m.group(1)!);
    }
  }
  return names;
}

List<Finding> auditFile(String path, String source, Set<String> singletons) {
  final code = maskCommentsAndStrings(source);
  final lineStarts = <int>[0];
  for (var i = 0; i < code.length; i++) {
    if (code.codeUnitAt(i) == 10) lineStarts.add(i + 1);
  }
  int lineOf(int offset) {
    var lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      final mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  }

  final out = <Finding>[];
  final seen = <String>{};
  void add(int offset, Severity s, String rule, String msg) {
    final line = lineOf(offset);
    if (seen.add('$line|$rule')) out.add(Finding(path, line, s, rule, msg));
  }

  /// Text of the call starting at [match] (from its opening paren to the matching one).
  String block(Match match) {
    final open = code.indexOf('(', match.start);
    if (open < 0) return '';
    final close = _matchParen(code, open);
    return close < 0 ? code.substring(open) : code.substring(open, close + 1);
  }

  final isTheme = path.contains('core/theme/');

  // --- Theme & color -------------------------------------------------------
  if (!isTheme) {
    for (final m in RegExp(r'\bColors\.(\w+)').allMatches(code)) {
      final name = m.group(1)!;
      if (name == 'transparent') continue;
      if (_neutralColor.hasMatch(name)) {
        add(m.start, Severity.warning, 'hardcoded-color',
            'Colors.$name breaks pinkCute/senior - use colorScheme (surface*, onSurfaceVariant, outlineVariant).');
      } else {
        add(m.start, Severity.info, 'semantic-color',
            'Colors.$name - OK only for status meaning; reuse orderStatusColor / stock helpers.');
      }
    }
    for (final m in RegExp(r'\bColor\(\s*0x[0-9A-Fa-f]+\s*\)').allMatches(code)) {
      add(m.start, Severity.warning, 'hex-color',
          'Hex color outside lib/core/theme - move it into the theme or use colorScheme.');
    }
  }
  for (final m in RegExp(r'\.withOpacity\(').allMatches(code)) {
    add(m.start, Severity.warning, 'with-opacity',
        'withOpacity is deprecated - use withValues(alpha: ...).');
  }

  // --- Typography ----------------------------------------------------------
  for (final m in RegExp(r'\bfontSize:\s*[\d.]+').allMatches(code)) {
    add(m.start, Severity.info, 'font-size-literal',
        'Literal fontSize - prefer textTheme.* (copyWith for weight/color).');
  }
  for (final m in RegExp(r'\b(SizedBox|Container)\(').allMatches(code)) {
    final b = block(m);
    if (RegExp(r'(^|[(,\s])height:').hasMatch(b) &&
        RegExp(r'\bchild:\s*(const\s+)?Text\(').hasMatch(b)) {
      add(m.start, Severity.info, 'fixed-height-text',
          'Fixed height around Text may clip at textScaler 1.25 (senior theme).');
    }
  }

  // --- Lists & performance ---------------------------------------------------
  for (final m in RegExp(r'\bListView\(').allMatches(code)) {
    // Only the ListView's own `children:` - static sections with a nested
    // loop (forms, settings) are fine.
    final children = _topLevelArg(block(m), 'children:');
    if (children != null &&
        RegExp(r'^\s*([\w.?]+\.map\(|\[\s*(for\s*\(|\.\.\.\s*[\w.?]+\.map\())')
            .hasMatch(children)) {
      add(m.start, Severity.warning, 'eager-list',
          'ListView(children:) built from data - use ListView.builder/separated.');
    }
  }
  for (final m in RegExp(r'\bImage\.(network|file)\(').allMatches(code)) {
    final b = block(m);
    if (!b.contains('errorBuilder')) {
      add(m.start, Severity.warning, 'image-error',
          'Image.${m.group(1)} without errorBuilder - broken link/offline shows nothing useful.');
    }
    if (!b.contains('cacheWidth') && !b.contains('cacheHeight')) {
      add(m.start, Severity.info, 'image-size',
          'No cacheWidth/cacheHeight - decodes full size; also consider a Cloudinary w_/h_ transform.');
    }
  }
  for (final m in RegExp(r'(?<![\w.])print\(').allMatches(code)) {
    add(m.start, Severity.error, 'print', 'print() in app code - remove or use debugPrint in dev only.');
  }

  // --- Touch -----------------------------------------------------------------
  for (final m in RegExp(r'\bIconButton(\.\w+)?\(').allMatches(code)) {
    final b = block(m);
    if (!b.contains('tooltip:')) {
      add(m.start, Severity.warning, 'icon-tooltip',
          'Icon-only button without tooltip (Vietnamese) - no label for long-press/screen readers.');
    }
    if (b.contains('BoxConstraints()') ||
        RegExp(r'padding:\s*(const\s+)?EdgeInsets\.zero').hasMatch(b) ||
        b.contains('VisualDensity.compact')) {
      add(m.start, Severity.warning, 'tap-target',
          'IconButton shrunk below 48dp (constraints/padding/density).');
    }
  }
  for (final m in RegExp(r'MaterialTapTargetSize\.shrinkWrap').allMatches(code)) {
    add(m.start, Severity.warning, 'tap-target', 'shrinkWrap tap target - keep 48dp minimum.');
  }
  for (final m in RegExp(r'\bGestureDetector\(').allMatches(code)) {
    if (block(m).contains('onTap:')) {
      add(m.start, Severity.info, 'gesture-button',
          'GestureDetector as a button has no ripple/semantics - prefer InkWell or a Material button.');
    }
  }

  // --- Lifecycle ---------------------------------------------------------------
  final disposables = <String, int>{};
  for (final m in _disposable.allMatches(code)) {
    disposables.putIfAbsent(m.group(2)!, () => m.start);
  }
  for (final m in _disposableInit.allMatches(code)) {
    disposables.putIfAbsent(m.group(1)!, () => m.start);
  }
  disposables.forEach((name, offset) {
    if (!RegExp('\\b${RegExp.escape(name)}\\??\\.dispose\\(').hasMatch(code)) {
      add(offset, Severity.warning, 'not-disposed', '$name is never disposed.');
    }
  });
  for (final m in _getItCubit.allMatches(code)) {
    final name = m.group(1)!, type = m.group(2)!;
    if (singletons.contains(type)) continue;
    if (!RegExp('\\b${RegExp.escape(name)}\\??\\.close\\(').hasMatch(code)) {
      add(m.start, Severity.warning, 'not-closed',
          '$name ($type, not a singleton) is never closed in dispose.');
    }
  }
  _checkMountedAfterAwait(code, lineStarts, add);

  out.sort((a, b) => a.line.compareTo(b.line));
  return out;
}

/// Flags context/setState use after an `await` in the same block without a
/// `mounted` check in between.
void _checkMountedAfterAwait(
  String code,
  List<int> lineStarts,
  void Function(int, Severity, String, String) add,
) {
  final lines = code.split('\n');
  int indentOf(String l) => l.length - l.trimLeft().length;
  int lineIndexOf(int offset) {
    var i = 0;
    while (i + 1 < lineStarts.length && lineStarts[i + 1] <= offset) {
      i++;
    }
    return i;
  }

  for (final m in RegExp(r'\bawait\b').allMatches(code)) {
    final end = _statementEnd(code, m.end);
    if (end < 0) continue;
    final startLine = lineIndexOf(m.start);
    final baseIndent = indentOf(lines[startLine]);
    for (var i = lineIndexOf(end) + 1; i < lines.length; i++) {
      final l = lines[i];
      if (l.trim().isEmpty) continue;
      if (indentOf(l) < baseIndent) break;
      if (l.contains('mounted')) break;
      if (_contextUse.hasMatch(l)) {
        add(lineStarts[i] + indentOf(l), Severity.warning, 'mounted-after-await',
            'context/setState used after await without a mounted check '
            '(await on line ${startLine + 1}).');
        break;
      }
      if (RegExp(r'\bawait\b').hasMatch(l)) break;
    }
  }
}

int _statementEnd(String code, int from) {
  var depth = 0;
  for (var i = from; i < code.length; i++) {
    final c = code[i];
    if (c == '(' || c == '[' || c == '{') depth++;
    if (c == ')' || c == ']' || c == '}') {
      depth--;
      if (depth < 0) return i; // e.g. `=> await x)` - expression ended
    }
    if (c == ';' && depth == 0) return i;
  }
  return -1;
}

/// Text following [name] when it is a direct argument of the call in [block]
/// (depth 1 inside the call's parentheses), or null.
String? _topLevelArg(String block, String name) {
  var depth = 0;
  for (var i = 0; i < block.length; i++) {
    final c = block[i];
    if (c == '(' || c == '[' || c == '{') depth++;
    if (c == ')' || c == ']' || c == '}') depth--;
    if (depth == 1 && block.startsWith(name, i)) {
      return block.substring(i + name.length);
    }
  }
  return null;
}

int _matchParen(String code, int open) {
  var depth = 0;
  for (var i = open; i < code.length; i++) {
    final c = code[i];
    if (c == '(') depth++;
    if (c == ')') {
      depth--;
      if (depth == 0) return i;
    }
  }
  return -1;
}

/// Replaces comment text and string contents with spaces, keeping offsets and
/// newlines, so regexes only see code.
String maskCommentsAndStrings(String src) {
  final out = StringBuffer();
  var i = 0;
  void blank(int n) {
    for (var k = 0; k < n && i < src.length; k++, i++) {
      out.write(src[i] == '\n' ? '\n' : ' ');
    }
  }

  while (i < src.length) {
    final c = src[i];
    final next = i + 1 < src.length ? src[i + 1] : '';
    if (c == '/' && next == '/') {
      while (i < src.length && src[i] != '\n') {
        blank(1);
      }
      continue;
    }
    if (c == '/' && next == '*') {
      final end = src.indexOf('*/', i + 2);
      blank((end < 0 ? src.length : end + 2) - i);
      continue;
    }
    if (c == "'" || c == '"') {
      final raw = i > 0 && src[i - 1] == 'r';
      final quote = src.startsWith(c * 3, i) ? c * 3 : c;
      out.write(quote);
      i += quote.length;
      while (i < src.length && !src.startsWith(quote, i)) {
        if (quote.length == 1 && src[i] == '\n') break;
        if (!raw && src[i] == r'\') {
          blank(2);
          continue;
        }
        blank(1);
      }
      if (src.startsWith(quote, i)) {
        out.write(quote);
        i += quote.length;
      }
      continue;
    }
    out.write(c);
    i++;
  }
  return out.toString();
}

void _printText(List<Finding> findings, int scanned) {
  if (findings.isEmpty) {
    print('UI audit: no findings in $scanned files.');
    return;
  }
  final byFile = <String, List<Finding>>{};
  for (final f in findings) {
    byFile.putIfAbsent(f.file, () => []).add(f);
  }
  for (final entry in byFile.entries) {
    print(entry.key);
    for (final f in entry.value) {
      final sev = f.severity.name.padRight(7);
      print('  ${f.line.toString().padLeft(4)}  $sev ${f.rule.padRight(20)} ${f.message}');
    }
  }
  final counts = {for (final s in Severity.values) s: 0};
  final rules = <String, int>{};
  for (final f in findings) {
    counts[f.severity] = counts[f.severity]! + 1;
    rules[f.rule] = (rules[f.rule] ?? 0) + 1;
  }
  print('');
  print('Summary: ${counts[Severity.error]} error, ${counts[Severity.warning]} warning, '
      '${counts[Severity.info]} info in ${byFile.length}/$scanned files');
  final sorted = rules.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
  print('By rule: ${sorted.map((e) => '${e.key}=${e.value}').join(', ')}');
  print('Heuristic checks - verify each finding before changing code.');
}
