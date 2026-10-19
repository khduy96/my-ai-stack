// Read-only helper for the /l10n skill. Never writes a file, never touches git state.
//
// Usage (run from anywhere inside the repo):
//   dart arb_tool.dart info    [--modules cloud|a,b|all]
//   dart arb_tool.dart detect  [--module cloud] [key …]
//   dart arb_tool.dart width   [--w <W>] <text> [<text> …]
//   dart arb_tool.dart check   [--modules …] [--locales en,ja,…] [--limit 30] [--include-social-fi]
//   dart arb_tool.dart find    [--modules …] [--locales …] [--in all|key|value] <query …>
//
// `--modules all` skips social_fi unless --include-social-fi is given.
// Exit codes: 0 ok, 1 error, 4 check found problems.

import 'dart:convert';
import 'dart:io';

const modulesRel = 'lib/app/global/languages/modules';
const socialFi = 'social_fi';

late String root;

Never fail(String msg, [int code = 1]) {
  stderr.writeln('❌ $msg');
  exit(code);
}

// ───────────────────────────── args ─────────────────────────────

class Opts {
  Opts(this.cmd, this.values, this.flags, this.rest);

  final String cmd;
  final Map<String, String> values;
  final Set<String> flags;
  final List<String> rest;

  static Opts parse(List<String> args) {
    if (args.isEmpty) fail('Thiếu lệnh: info | detect | width | check | find');
    final values = <String, String>{}, flags = <String>{}, rest = <String>[];
    const valued = {'modules', 'module', 'locales', 'limit', 'in', 'w'};
    for (var i = 1; i < args.length; i++) {
      final a = args[i];
      if (!a.startsWith('--')) {
        rest.add(a);
        continue;
      }
      final eq = a.indexOf('=');
      final name = a.substring(2, eq < 0 ? a.length : eq);
      if (valued.contains(name)) {
        values[name] = eq >= 0 ? a.substring(eq + 1) : (++i < args.length ? args[i] : fail('Thiếu giá trị cho --$name'));
      } else {
        flags.add(name);
      }
    }
    return Opts(args.first, values, flags, rest);
  }
}

// ───────────────────────────── modules / locales ─────────────────────────────

/// Locale group tag of a locale code: en/en_US → en, zh/zh_CN → zh, zh_TW → tw, zh_HK → hk.
String groupOf(String locale) {
  switch (locale) {
    case 'en':
    case 'en_US':
      return 'en';
    case 'zh':
    case 'zh_CN':
      return 'zh';
    case 'zh_TW':
      return 'tw';
    case 'zh_HK':
      return 'hk';
  }
  return locale.split('_').first;
}

/// Normalises a user tag (`cn`, `en_US`, `zh_TW`, `TW` …) to a group tag.
String normTag(String t) {
  final s = t.trim();
  if (s.toLowerCase() == 'cn') return 'zh';
  final parts = s.split(RegExp('[_-]'));
  final code = parts.length > 1 ? '${parts[0].toLowerCase()}_${parts[1].toUpperCase()}' : s.toLowerCase();
  if (['tw', 'hk'].contains(code)) return code;
  return groupOf(code);
}

class ArbFile {
  ArbFile(this.name, this.locale, this.text);

  final String name, locale, text;
  String get group => groupOf(locale);
  ArbDoc? doc;
  String? error;
  bool markers = false;
}

class Module {
  Module(this.name, this.template, this.outputClass, this.files);

  final String name, template, outputClass;
  final List<ArbFile> files;

  String get accessor => outputClass.isEmpty ? '' : outputClass[0].toLowerCase() + outputClass.substring(1);
  ArbFile get templateFile => files.firstWhere((f) => f.name == template, orElse: () => files.first);
  ArbFile get enFile => files.firstWhere((f) => f.locale == 'en', orElse: () => templateFile);
  List<String> get groups => files.map((f) => f.group).toSet().toList();
}

List<String> allModuleNames() => Directory('$root/$modulesRel')
    .listSync()
    .whereType<Directory>()
    .map((d) => d.uri.pathSegments.where((s) => s.isNotEmpty).last)
    .where((n) => File('$root/$modulesRel/$n/l10n.yaml').existsSync())
    .toList()
  ..sort();

List<String> resolveModules(Opts o, {String key = 'modules'}) {
  final arg = o.values[key] ?? o.values['module'] ?? 'cloud';
  final all = allModuleNames();
  if (arg == 'all') {
    if (o.flags.contains('include-social-fi')) return all;
    if (all.contains(socialFi)) stderr.writeln('⚠️  Bỏ qua $socialFi (module của team khác — cần --include-social-fi).');
    return all.where((n) => n != socialFi).toList();
  }
  final names = arg.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
  for (final n in names) {
    if (!all.contains(n)) fail('Module "$n" không tồn tại. Có: ${all.join(', ')}');
  }
  return names;
}

String yamlValue(List<String> lines, String key) {
  final line = lines.firstWhere((l) => l.trimLeft().startsWith('$key:'), orElse: () => '');
  return line.split(':').skip(1).join(':').trim();
}

Module loadModule(String name) {
  final yaml = File('$root/$modulesRel/$name/l10n.yaml').readAsLinesSync();
  final arbDir = yamlValue(yaml, 'arb-dir').isEmpty ? 'l10n' : yamlValue(yaml, 'arb-dir');
  final dir = Directory('$root/$modulesRel/$name/$arbDir');
  final files = <ArbFile>[];
  for (final f in dir.listSync().whereType<File>().where((f) => f.path.endsWith('.arb'))) {
    final fname = f.uri.pathSegments.last;
    final text = f.readAsStringSync();
    final m = RegExp(r'"@@locale"\s*:\s*"([^"]+)"').firstMatch(text);
    final fromName = RegExp(r'_([a-z]{2,3}(?:_[A-Z]{2})?)\.arb$').firstMatch(fname)?.group(1) ?? fname;
    final af = ArbFile(fname, m?.group(1) ?? fromName, text);
    af.markers = RegExp(r'^(<<<<<<<|=======|>>>>>>>)( |$)', multiLine: true).hasMatch(text);
    try {
      af.doc = ArbParser(text).parseDoc();
    } on FormatException catch (e) {
      af.error = '${e.message} (offset ${e.offset})';
    }
    files.add(af);
  }
  files.sort((a, b) => a.name.compareTo(b.name));
  if (files.isEmpty) fail('Module $name không có file ARB.');
  return Module(name, yamlValue(yaml, 'template-arb-file'), yamlValue(yaml, 'output-class'), files);
}

Set<String>? parseLocales(Opts o) {
  final l = o.values['locales'];
  if (l == null || l.trim().isEmpty) return null;
  return l.split(',').where((s) => s.trim().isNotEmpty).map(normTag).toSet();
}

// ───────────────────────────── JSON (keeps duplicate top-level keys) ─────────────────────────────

class ArbDoc {
  final entries = <MapEntry<String, Object?>>[];
  final dups = <String>{};
  final map = <String, Object?>{};
}

class ArbParser {
  ArbParser(this.s);

  final String s;
  int i = 0;

  ArbDoc parseDoc() {
    ws();
    if (i < s.length && s.codeUnitAt(i) == 0xFEFF) i++;
    ws();
    expect('{');
    final doc = ArbDoc();
    ws();
    if (peek() == '}') {
      i++;
    } else {
      while (true) {
        ws();
        final k = str();
        ws();
        expect(':');
        final v = value();
        if (doc.map.containsKey(k)) doc.dups.add(k);
        doc.map[k] = v;
        doc.entries.add(MapEntry(k, v));
        ws();
        if (peek() == ',') {
          i++;
          continue;
        }
        expect('}');
        break;
      }
    }
    ws();
    if (i != s.length) throw FormatException('Dư ký tự sau "}"', s, i);
    return doc;
  }

  String peek() => i < s.length ? s[i] : '';

  void ws() {
    while (i < s.length && ' \t\r\n'.contains(s[i])) {
      i++;
    }
  }

  void expect(String c) {
    if (peek() != c) throw FormatException('Cần "$c"', s, i);
    i++;
  }

  Object? value() {
    ws();
    final c = peek();
    if (c == '"') return str();
    if (c == '{') {
      i++;
      final m = <String, Object?>{};
      ws();
      if (peek() == '}') {
        i++;
        return m;
      }
      while (true) {
        ws();
        final k = str();
        ws();
        expect(':');
        m[k] = value();
        ws();
        if (peek() == ',') {
          i++;
          continue;
        }
        expect('}');
        return m;
      }
    }
    if (c == '[') {
      i++;
      final l = <Object?>[];
      ws();
      if (peek() == ']') {
        i++;
        return l;
      }
      while (true) {
        l.add(value());
        ws();
        if (peek() == ',') {
          i++;
          continue;
        }
        expect(']');
        return l;
      }
    }
    final m = RegExp(r'-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null').matchAsPrefix(s, i);
    if (m == null) throw FormatException('Giá trị không hợp lệ', s, i);
    i = m.end;
    return jsonDecode(m.group(0)!);
  }

  String str() {
    if (peek() != '"') throw FormatException('Cần chuỗi', s, i);
    final start = i;
    i++;
    while (i < s.length) {
      final c = s[i];
      if (c == '\\') {
        i += 2;
        continue;
      }
      if (c == '"') {
        i++;
        return jsonDecode(s.substring(start, i)) as String;
      }
      if (c == '\n') throw FormatException('Chuỗi bị xuống dòng', s, i);
      i++;
    }
    throw FormatException('Chuỗi không đóng', s, start);
  }
}

// ───────────────────────────── ICU message: placeholders + display width ─────────────────────────────

class Msg {
  final names = <String>{};
  int width = 0;
}

const _branchTypes = {'plural', 'select', 'selectordinal'};

/// Scans a gen-l10n message. Placeholder tokens are excluded from the width; for
/// plural/select the widest branch counts.
Msg scanMessage(String s) {
  final out = Msg();
  var i = 0;
  int scan(int depth) {
    var w = 0;
    while (i < s.length) {
      final c = s[i];
      if (c == '{') {
        final close = s.indexOf(RegExp('[},]'), i + 1);
        if (close < 0) {
          w += displayWidth(s.substring(i));
          i = s.length;
          break;
        }
        final name = s.substring(i + 1, close).trim();
        if (!RegExp(r'^[A-Za-z_]\w*$').hasMatch(name)) {
          w += displayWidth(c);
          i++;
          continue;
        }
        out.names.add(name);
        if (s[close] == '}') {
          i = close + 1;
          continue;
        }
        final typeEnd = s.indexOf(RegExp('[},]'), close + 1);
        final type = typeEnd < 0 ? '' : s.substring(close + 1, typeEnd).trim();
        if (typeEnd >= 0 && _branchTypes.contains(type) && s[typeEnd] == ',') {
          i = typeEnd + 1;
          var widest = 0;
          while (i < s.length) {
            while (i < s.length && s[i] != '{' && s[i] != '}') {
              i++;
            }
            if (i >= s.length || s[i] == '}') {
              i++;
              break;
            }
            i++; // branch '{'
            final bw = scan(depth + 1);
            if (bw > widest) widest = bw;
          }
          w += widest;
        } else {
          var d = 1;
          i = close + 1;
          while (i < s.length && d > 0) {
            if (s[i] == '{') d++;
            if (s[i] == '}') d--;
            i++;
          }
        }
        continue;
      }
      if (c == '}' && depth > 0) {
        i++;
        return w;
      }
      final cu = s.codeUnitAt(i);
      if (cu >= 0xD800 && cu <= 0xDBFF && i + 1 < s.length) {
        w += runeWidth(0x10000 + ((cu - 0xD800) << 10) + (s.codeUnitAt(i + 1) - 0xDC00));
        i += 2;
      } else {
        w += runeWidth(cu);
        i++;
      }
    }
    return w;
  }

  out.width = s.isEmpty ? 0 : scan(0);
  return out;
}

int displayWidth(String s) => s.runes.fold(0, (a, r) => a + runeWidth(r));

bool _in(int r, int a, int b) => r >= a && r <= b;

int runeWidth(int r) {
  // Zero width: Lao / Devanagari / Arabic combining marks, ZW chars, variation selectors.
  if (r == 0x0EB1 || _in(r, 0x0EB4, 0x0EBC) || _in(r, 0x0EC8, 0x0ECD)) return 0;
  if (_in(r, 0x0900, 0x0902) || r == 0x093A || r == 0x093C || _in(r, 0x0941, 0x0949) || r == 0x094D ||
      _in(r, 0x0951, 0x0957) || _in(r, 0x0962, 0x0963)) {
    return 0;
  }
  if (_in(r, 0x064B, 0x065F) || r == 0x0670 || _in(r, 0x06D6, 0x06ED)) return 0;
  if (_in(r, 0x200B, 0x200F) || r == 0xFEFF || _in(r, 0xFE00, 0xFE0F)) return 0;
  // Double width: CJK, Kana, Hangul, full-width forms and punctuation, emoji.
  if (_in(r, 0x1100, 0x115F) ||
      _in(r, 0x2E80, 0x303E) ||
      _in(r, 0x3041, 0x33FF) ||
      _in(r, 0x3400, 0x4DBF) ||
      _in(r, 0x4E00, 0x9FFF) ||
      _in(r, 0xA960, 0xA97F) ||
      _in(r, 0xAC00, 0xD7A3) ||
      _in(r, 0xF900, 0xFAFF) ||
      _in(r, 0xFE30, 0xFE4F) ||
      _in(r, 0xFF01, 0xFF60) ||
      _in(r, 0xFFE0, 0xFFE6) ||
      _in(r, 0x1F300, 0x1FAFF) ||
      _in(r, 0x20000, 0x3FFFD)) {
    return 2;
  }
  return 1;
}

int hardCap(int w) {
  final a = (w * 1.15).floor();
  return a > w + 4 ? a : w + 4;
}

// ───────────────────────────── commands ─────────────────────────────

void cmdInfo(Opts o) {
  for (final name in resolveModules(o)) {
    final m = loadModule(name);
    stdout.writeln('## $name — template ${m.template}, class ${m.outputClass}, accessor context.${m.accessor}');
    stdout.writeln('| File | Locale | Nhóm |');
    stdout.writeln('|---|---|---|');
    for (final f in m.files) {
      stdout.writeln('| ${f.name} | ${f.locale} | ${f.group} |');
    }
    stdout.writeln('Nhóm: ${m.groups.join(', ')}');
    stdout.writeln();
  }
}

void cmdDetect(Opts o) {
  final name = resolveModules(o, key: 'module').single;
  final m = loadModule(name);
  final gitDir = Process.runSync('git', ['-C', root, 'rev-parse', '--absolute-git-dir'], stdoutEncoding: utf8);
  final gd = (gitDir.stdout as String).trim();
  String? mode;
  if (File('$gd/MERGE_HEAD').existsSync()) mode = 'merge';
  if (Directory('$gd/rebase-merge').existsSync() || Directory('$gd/rebase-apply').existsSync()) mode = 'rebase';
  if (File('$gd/CHERRY_PICK_HEAD').existsSync()) mode = 'cherry-pick';
  final unmerged = Process.runSync('git', ['-C', root, 'ls-files', '-u', '--', '$modulesRel/$name/'],
      stdoutEncoding: utf8);
  final conflicted = (unmerged.stdout as String)
      .split('\n')
      .where((l) => l.contains('\t') && l.trim().endsWith('.arb'))
      .map((l) => l.split('\t').last.trim().split('/').last)
      .toSet();
  stdout.writeln('module: $name');
  stdout.writeln('git: ${mode ?? 'none'}');
  stdout.writeln('conflicted_arb: ${conflicted.isEmpty ? '-' : conflicted.join(', ')}');
  final tpl = m.templateFile.doc;
  for (final k in o.rest) {
    stdout.writeln('key $k: ${tpl != null && tpl.map.containsKey(k) ? 'exists' : 'missing'}');
  }
}

void cmdWidth(Opts o) {
  final w = o.values['w'] == null ? null : int.tryParse(o.values['w']!);
  final cap = w == null ? null : hardCap(w);
  if (w != null) stdout.writeln('W = $w · hard cap = $cap');
  for (final t in o.rest) {
    final m = scanMessage(t);
    final flag = cap == null ? '' : (m.width > cap ? '  ⚠ vượt trần' : (m.width > w! ? '  (vượt mục tiêu)' : '  ✓'));
    stdout.writeln('${m.width}\t$t$flag');
  }
}

String preview(String s, [int max = 48]) {
  final one = s.replaceAll('\n', '⏎');
  return one.length > max ? '${one.substring(0, max)}…' : one;
}

void cmdCheck(Opts o) {
  final limit = int.tryParse(o.values['limit'] ?? '') ?? 30;
  final only = parseLocales(o);
  var total = 0;
  for (final name in resolveModules(o)) {
    final m = loadModule(name);
    final files = m.files.where((f) => only == null || only.contains(f.group)).toList();
    // problem type → rows
    final probs = <String, List<String>>{};
    void add(String type, String row) => probs.putIfAbsent(type, () => []).add(row);

    for (final f in files) {
      if (f.markers) add('Conflict marker', '| — | ${f.name} | còn `<<<<<<<` / `=======` / `>>>>>>>` |');
      if (f.error != null) add('JSON lỗi', '| — | ${f.name} | ${f.error} |');
      for (final d in f.doc?.dups ?? <String>{}) {
        add('Key trùng', '| `$d` | ${f.name} | xuất hiện > 1 lần |');
      }
    }

    final parsed = m.files.where((f) => f.doc != null).toList();
    bool isMsgKey(String k) => !k.startsWith('@');
    final allKeys = <String>{
      for (final f in parsed) ...f.doc!.map.keys.where(isMsgKey),
    };
    final tplKeys = m.templateFile.doc?.map.keys.where(isMsgKey).toSet() ?? <String>{};

    for (final k in (allKeys.toList()..sort())) {
      final missingIn = files.where((f) => f.doc != null && !f.doc!.map.containsKey(k)).map((f) => f.locale).toList();
      if (missingIn.isNotEmpty) {
        final note = tplKeys.contains(k) ? '' : ' (không có trong template ${m.template})';
        add('Thiếu key ở locale', '| `$k` | ${missingIn.join(', ')} | thiếu$note |');
      }

      final enRaw = m.enFile.doc?.map[k];
      final enMsg = enRaw is String ? scanMessage(enRaw) : null;
      final sets = <String, Set<String>>{};
      for (final f in files.where((f) => f.doc != null)) {
        final v = f.doc!.map[k];
        if (v is! String) continue;
        final msg = scanMessage(v);
        sets[f.locale] = msg.names;

        final meta = f.doc!.map['@$k'];
        if (meta is Map && meta['placeholders'] is Map) {
          final declared = (meta['placeholders'] as Map).keys.cast<String>().toSet();
          final missing = msg.names.difference(declared), extra = declared.difference(msg.names);
          if (missing.isNotEmpty || extra.isNotEmpty) {
            add('@key placeholder lệch', '| `$k` | ${f.locale} | '
                '${missing.isNotEmpty ? 'thiếu khai báo ${missing.join(', ')}' : ''}'
                '${missing.isNotEmpty && extra.isNotEmpty ? '; ' : ''}'
                '${extra.isNotEmpty ? 'khai báo thừa ${extra.join(', ')}' : ''} |');
          }
        } else if (f.name == m.template && msg.names.isNotEmpty) {
          add('@key placeholder lệch', '| `$k` | ${f.locale} | template có placeholder ${msg.names.join(', ')} nhưng thiếu block `@$k` |');
        }

        if (enMsg != null && f.locale != m.enFile.locale && f.group != 'en' && enMsg.width > 0) {
          final w = enMsg.width, cap = hardCap(w);
          if (msg.width > cap) {
            final type = w > 80 ? 'Vượt trần (body, chỉ tham khảo)' : 'Vượt trần độ rộng';
            add(type, '| `$k` | ${f.locale} | ${msg.width} > $cap (W=$w) — ${preview(v)} |');
          }
        }
      }
      final distinct = sets.values.map((s) => (s.toList()..sort()).join(',')).toSet();
      if (distinct.length > 1) {
        final byLoc = sets.entries.map((e) => '${e.key}{${e.value.join(',')}}').join(' ');
        add('Placeholder khác nhau giữa locale', '| `$k` | — | ${preview(byLoc, 120)} |');
      }

      // Mirror groups (en/en_US, zh/zh_CN) must hold the same value.
      for (final g in ['en', 'zh']) {
        final vals = files
            .where((f) => f.group == g && f.doc != null && f.doc!.map[k] is String)
            .map((f) => f.doc!.map[k] as String)
            .toSet();
        if (vals.length > 1) add('Nhóm mirror lệch (info)', '| `$k` | $g | ${vals.map(preview).join(' ≠ ')} |');
      }
    }

    stdout.writeln('## $name (${files.length} file, template ${m.template})');
    if (probs.isEmpty) {
      stdout.writeln('✅ Không có vấn đề.');
      stdout.writeln();
      continue;
    }
    stdout.writeln('| Loại | Số lượng |');
    stdout.writeln('|---|---|');
    probs.forEach((t, rows) => stdout.writeln('| $t | ${rows.length} |'));
    stdout.writeln();
    probs.forEach((t, rows) {
      if (!t.contains('(info)') && !t.contains('tham khảo')) total += rows.length;
      stdout.writeln('### $t');
      stdout.writeln('| Key | File / locale | Chi tiết |');
      stdout.writeln('|---|---|---|');
      for (final r in rows.take(limit)) {
        stdout.writeln(r);
      }
      if (rows.length > limit) stdout.writeln('| … | | và ${rows.length - limit} dòng khác (tăng --limit) |');
      stdout.writeln();
    });
  }
  stdout.writeln(total == 0 ? '✅ Không có lỗi (chỉ còn mục info/tham khảo nếu có).' : '--- $total vấn đề ---');
  if (total > 0) exit(4);
}

void cmdFind(Opts o) {
  if (o.rest.isEmpty) fail('Thiếu chuỗi cần tìm.');
  final q = o.rest.join(' ').toLowerCase();
  final where = o.values['in'] ?? 'all';
  final only = parseLocales(o);
  var hits = 0;
  for (final name in resolveModules(o)) {
    final m = loadModule(name);
    final en = m.enFile.doc?.map ?? {};
    final rows = <String>[];
    final keys = <String>{
      for (final f in m.files.where((f) => f.doc != null)) ...f.doc!.map.keys.where((k) => !k.startsWith('@')),
    }.toList()
      ..sort();
    for (final k in keys) {
      final keyHit = where != 'value' && k.toLowerCase().contains(q);
      final valHits = <String>[];
      if (where != 'key') {
        for (final f in m.files.where((f) => f.doc != null && (only == null || only.contains(f.group)))) {
          final v = f.doc!.map[k];
          if (v is String && v.toLowerCase().contains(q)) valHits.add('${f.locale}: ${preview(v, 40)}');
        }
      }
      if (!keyHit && valHits.isEmpty) continue;
      final enVal = en[k] is String ? preview(en[k] as String) : '—';
      final match = valHits.isEmpty ? '(tên key)' : valHits.take(3).join(' · ') + (valHits.length > 3 ? ' · +${valHits.length - 3}' : '');
      rows.add('| `$k` | $enVal | $match |');
    }
    if (rows.isEmpty) continue;
    hits += rows.length;
    stdout.writeln('## $name — ${rows.length} key (context.${m.accessor}.<key>)');
    stdout.writeln('| Key | en | Khớp |');
    stdout.writeln('|---|---|---|');
    rows.forEach(stdout.writeln);
    stdout.writeln();
  }
  stdout.writeln(hits == 0 ? 'Không tìm thấy key nào khớp "$q".' : 'Tổng: $hits key.');
}

void main(List<String> args) {
  final o = Opts.parse(args);
  final top = Process.runSync('git', ['rev-parse', '--show-toplevel'], stdoutEncoding: utf8);
  if (top.exitCode != 0) fail('Không ở trong git repo.');
  root = (top.stdout as String).trim();

  switch (o.cmd) {
    case 'info':
      cmdInfo(o);
    case 'detect':
      cmdDetect(o);
    case 'width':
      cmdWidth(o);
    case 'check':
      cmdCheck(o);
    case 'find':
      cmdFind(o);
    default:
      fail('Lệnh không hợp lệ: ${o.cmd}');
  }
}
