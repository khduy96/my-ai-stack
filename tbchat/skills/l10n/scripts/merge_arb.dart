// Key-level 3-way merge for ARB files while a git merge / rebase / cherry-pick is stopped
// on conflicts. Reads base/mine/upstream straight from git (never from conflict markers),
// merges per unit (key + its @key block), keeps every entry's original text, and writes
// only the module's ARB files.
//
// Usage (run from anywhere inside the repo):
//   dart merge_arb.dart plan    [--modules cloud|a,b|all] [--include-social-fi] [--force]
//   dart merge_arb.dart apply   [--decide mod:key=mine|upstream|keep|delete,...] [--flip mod:key,...]
//   dart merge_arb.dart check   [--modules ...]
//   dart merge_arb.dart summary
//   dart merge_arb.dart done
//   dart merge_arb.dart abort   [--restore]
//
// Exit codes: 0 ok, 1 error, 2 decisions pending, 3 another session holds the lock,
// 4 check found new problems.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

const modulesRel = 'lib/app/global/languages/modules';
const socialFi = 'social_fi';
const lockTtl = Duration(minutes: 30);

late String root;
late String gitDir;

Never fail(String msg, [int code = 1]) {
  stderr.writeln('❌ $msg');
  exit(code);
}

ProcessResult git(List<String> args, {bool check = true}) {
  final r = Process.runSync('git', ['-C', root, ...args], stdoutEncoding: utf8, stderrEncoding: utf8);
  if (check && r.exitCode != 0) fail('git ${args.join(' ')}\n${r.stderr}');
  return r;
}

String gitOut(List<String> args) => (git(args).stdout as String).trim();

String? verifyCommit(String ref) {
  final r = git(['rev-parse', '-q', '--verify', '$ref^{commit}'], check: false);
  return r.exitCode == 0 ? (r.stdout as String).trim() : null;
}

/// Reads many blobs (`<rev>:<path>`, `:<stage>:<path>`) through one `git cat-file --batch`.
Future<Map<String, String?>> catFiles(List<String> specs) async {
  final res = <String, String?>{};
  if (specs.isEmpty) return res;
  final p = await Process.start('git', ['-C', root, 'cat-file', '--batch']);
  final bytes = <int>[];
  final reading = p.stdout.listen(bytes.addAll).asFuture<void>();
  unawaited(p.stderr.drain<void>());
  p.stdin.add(utf8.encode(specs.map((s) => '$s\n').join()));
  await p.stdin.close();
  await reading;
  await p.exitCode;
  var i = 0;
  for (final s in specs) {
    final nl = bytes.indexOf(10, i);
    final header = utf8.decode(bytes.sublist(i, nl));
    i = nl + 1;
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
      res[s] = null;
      continue;
    }
    final size = int.parse(header.split(' ')[2]);
    res[s] = utf8.decode(bytes.sublist(i, i + size));
    i += size + 1;
  }
  return res;
}

// ───────────────────────────── ARB scanner ─────────────────────────────

class Entry {
  Entry(this.key, this.raw, String rawValue) : value = jsonDecode(rawValue);

  final String key;

  /// `"key": value` exactly as written in the source (LF line endings).
  final String raw;
  final Object? value;
}

class Unit {
  Entry? val;
  Entry? meta;
}

class Arb {
  Arb(this.entries, this.indent, this.trailingNl) {
    for (final e in entries) {
      final u = units.putIfAbsent(unitName(e.key), Unit.new);
      final isMeta = e.key != unitName(e.key);
      if ((isMeta ? u.meta : u.val) != null) dups.add(e.key);
      if (isMeta) {
        u.meta = e;
      } else {
        u.val = e;
      }
    }
  }

  Arb.empty() : this([], '  ', false);

  final List<Entry> entries;
  final String indent;
  final bool trailingNl;
  final units = <String, Unit>{};
  final dups = <String>{};

  List<String> get order => entries.map((e) => e.key).toList();
}

String unitName(String key) => key.startsWith('@') && !key.startsWith('@@') ? key.substring(1) : key;

String lf(String t) {
  var s = t.replaceAll('\r\n', '\n');
  if (s.startsWith('﻿')) s = s.substring(1);
  return s;
}

Arb parseArb(String text) {
  final t = lf(text);
  var i = 0;
  void ws() {
    while (i < t.length && ' \t\n\r'.contains(t[i])) {
      i++;
    }
  }

  ws();
  if (i >= t.length || t[i] != '{') throw FormatException('expected "{"', t, i);
  i++;
  final entries = <Entry>[];
  String? indent;
  ws();
  if (i < t.length && t[i] == '}') {
    i++;
  } else {
    while (true) {
      ws();
      if (i >= t.length || t[i] != '"') throw FormatException('expected a key', t, i);
      final start = i;
      indent ??= t.substring(t.lastIndexOf('\n', start - 1) + 1, start);
      i = _skipString(t, i);
      final key = jsonDecode(t.substring(start, i)) as String;
      ws();
      if (i >= t.length || t[i] != ':') throw FormatException('expected ":"', t, i);
      i++;
      ws();
      final vStart = i;
      i = _skipValue(t, i);
      entries.add(Entry(key, t.substring(start, i), t.substring(vStart, i)));
      ws();
      if (i < t.length && t[i] == ',') {
        i++;
        continue;
      }
      if (i < t.length && t[i] == '}') {
        i++;
        break;
      }
      throw FormatException('expected "," or "}"', t, i);
    }
  }
  ws();
  if (i != t.length) throw FormatException('content after the closing "}"', t, i);
  return Arb(entries, indent ?? '  ', t.endsWith('\n'));
}

int _skipString(String t, int i) {
  i++;
  while (i < t.length) {
    final c = t[i];
    if (c == '\\') {
      i += 2;
      continue;
    }
    if (c == '"') return i + 1;
    i++;
  }
  throw FormatException('unterminated string', t, i);
}

int _skipValue(String t, int i) {
  if (i >= t.length) throw FormatException('expected a value', t, i);
  final c0 = t[i];
  if (c0 == '"') return _skipString(t, i);
  if (c0 == '{' || c0 == '[') {
    var depth = 0;
    while (i < t.length) {
      final c = t[i];
      if (c == '"') {
        i = _skipString(t, i);
        continue;
      }
      if (c == '{' || c == '[') depth++;
      if (c == '}' || c == ']') {
        depth--;
        if (depth == 0) return i + 1;
      }
      i++;
    }
    throw FormatException('unterminated object', t, i);
  }
  final m = RegExp(r'-?[0-9][0-9.eE+-]*|true|false|null').matchAsPrefix(t, i);
  if (m == null) throw FormatException('invalid value', t, i);
  return m.end;
}

final _markerRe = RegExp(r'^(<{7}|={7}|>{7}|\|{7})', multiLine: true);

bool hasMarkers(String text) => _markerRe.hasMatch(text);

String describeFormatError(Object e) {
  if (e is FormatException && e.source is String && e.offset != null) {
    final src = e.source as String;
    final line = '\n'.allMatches(src.substring(0, e.offset!.clamp(0, src.length))).length + 1;
    return '${e.message} (line $line)';
  }
  return e.toString();
}

bool deepEq(Object? a, Object? b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final k in a.keys) {
      if (!b.containsKey(k) || !deepEq(a[k], b[k])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!deepEq(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

bool unitEq(Unit? a, Unit? b) {
  if (a == null || b == null) return a == null && b == null;
  return (a.val == null) == (b.val == null) &&
      (a.meta == null) == (b.meta == null) &&
      deepEq(a.val?.value, b.val?.value) &&
      deepEq(a.meta?.value, b.meta?.value);
}

Set<String> placeholders(Unit? u) {
  final m = u?.meta?.value;
  if (m is Map && m['placeholders'] is Map) return (m['placeholders'] as Map).keys.cast<String>().toSet();
  return {};
}

bool sameSet(Set<String> a, Set<String> b) => a.length == b.length && a.containsAll(b);

Object? shown(Unit? u) => u?.val?.value;

// ───────────────────────────── state ─────────────────────────────

class FileState {
  FileState(this.name, this.path, this.conflicted, this.base, this.mine, this.up, this.working);

  FileState.fromJson(Map<String, dynamic> j)
      : this(j['name'], j['path'], j['conflicted'], j['base'], j['mine'], j['up'], j['working']);

  final String name;
  final String path;
  final bool conflicted;
  final String? base, mine, up, working;

  late Arb b, m, u;
  Arb? w;
  final errors = <String>[];

  void parse() {
    Arb load(String? text, String label) {
      if (text == null) return Arb.empty();
      try {
        return parseArb(text);
      } catch (e) {
        errors.add('$name ($label): ${describeFormatError(e)}');
        return Arb.empty();
      }
    }

    b = load(base, 'base');
    m = load(mine, 'mine');
    u = load(up, 'upstream');
    if (conflicted && mine == null) errors.add('$name: bị xoá ở bên mine nhưng bên kia vẫn sửa');
    if (conflicted && up == null) errors.add('$name: bị xoá ở bên upstream nhưng bên kia vẫn sửa');
    if (working != null && !hasMarkers(working!)) {
      try {
        w = parseArb(working!);
      } catch (_) {}
    }
  }

  Map<String, dynamic> toJson() => {
        'name': name,
        'path': path,
        'conflicted': conflicted,
        'base': base,
        'mine': mine,
        'up': up,
        'working': working,
      };
}

class ModuleState {
  ModuleState(this.name, this.refFile, this.files, this.dates);

  ModuleState.fromJson(Map<String, dynamic> j)
      : this(
          j['name'],
          j['refFile'],
          (j['files'] as List).map((f) => FileState.fromJson(f)..parse()).toList(),
          (j['dates'] as Map).cast<String, dynamic>(),
        );

  final String name;
  final String refFile;
  final List<FileState> files;

  /// dates[side][file][unit] = {at, hash, author, bulk}
  final Map<String, dynamic> dates;

  Map<String, dynamic>? dateOf(String side, String file, String key) =>
      ((dates[side] as Map?)?[file] as Map?)?[key] as Map<String, dynamic>?;

  Map<String, dynamic> toJson() =>
      {'name': name, 'refFile': refFile, 'files': files.map((f) => f.toJson()).toList(), 'dates': dates};
}

class State {
  State(this.data, this.modules);

  final Map<String, dynamic> data;
  final List<ModuleState> modules;

  Map<String, String> get decisions => (data['decisions'] as Map? ?? {}).cast<String, String>();
  Set<String> get flips => (data['flips'] as List? ?? []).cast<String>().toSet();
  Map<String, String> get written => (data['written'] as Map? ?? {}).cast<String, String>();

  static File get file => File('$gitDir/l10n-resolve/state.json');

  static State? load() {
    if (!file.existsSync()) return null;
    final j = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    return State(j, (j['modules'] as List).map((m) => ModuleState.fromJson(m)).toList());
  }

  void save() {
    data['modules'] = modules.map((m) => m.toJson()).toList();
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(jsonEncode(data));
  }

  static void clear() {
    final d = Directory('$gitDir/l10n-resolve');
    if (d.existsSync()) d.deleteSync(recursive: true);
  }
}

// ───────────────────────────── git context ─────────────────────────────

class GitContext {
  GitContext(this.mode, this.head, this.other, this.mineRef, this.upRef, this.baseRef, this.dateBase);

  final String mode; // merge | rebase | cherry-pick
  final String head, other, mineRef, upRef, baseRef, dateBase;

  int get mineStage => mode == 'rebase' ? 3 : 2;
  int get upStage => mode == 'rebase' ? 2 : 3;

  static GitContext detect() {
    final head = verifyCommit('HEAD') ?? fail('Không tìm thấy HEAD.');
    final inRebase =
        Directory('$gitDir/rebase-merge').existsSync() || Directory('$gitDir/rebase-apply').existsSync();
    String mergeBase(String a, String b) => gitOut(['merge-base', a, b]);
    if (inRebase) {
      final rh = verifyCommit('REBASE_HEAD') ?? fail('Đang rebase nhưng không có REBASE_HEAD (không dừng vì conflict?).');
      final parent = verifyCommit('$rh^') ?? fail('Commit đang replay không có parent.');
      return GitContext('rebase', head, rh, rh, head, parent, mergeBase(rh, head));
    }
    final mh = verifyCommit('MERGE_HEAD');
    if (mh != null) {
      final base = mergeBase(head, mh);
      return GitContext('merge', head, mh, head, mh, base, base);
    }
    final cp = verifyCommit('CHERRY_PICK_HEAD');
    if (cp != null) {
      final parent = verifyCommit('$cp^') ?? fail('Commit cherry-pick không có parent.');
      return GitContext('cherry-pick', head, cp, head, cp, parent, mergeBase(head, cp));
    }
    fail('Không ở trong merge / rebase / cherry-pick nào — không có gì để resolve.');
  }
}

// ───────────────────────────── commit dates per key ─────────────────────────────

/// Latest commit (newest first) in `from..to` that really changed each top-level key,
/// per file. A line that only gained/lost a trailing comma does not count as a change.
Map<String, Map<String, Map<String, Object>>> keyDates(
    String from, String to, String dirRel, Map<String, int> lineCounts) {
  final r = git([
    'log', '-p', '-U0', '--no-color', '--no-renames', '--no-ext-diff', //
    '--format=%x01C %H %at %an', '$from..$to', '--', dirRel,
  ]);
  final res = <String, Map<String, Map<String, Object>>>{};
  final keyRe = RegExp(r'^[+-](?: {1,2}|\t)"((?:[^"\\]|\\.)*)"\s*:(.*)$');
  String? hash, file;
  var at = 0, author = '';
  final plus = <String, String>{}, minus = <String, String>{};
  var plusCount = 0, minusCount = 0;

  void flush() {
    if (hash != null && file != null) {
      final lines = lineCounts[file] ?? 0;
      final changed = plusCount > minusCount ? plusCount : minusCount;
      final bulk = lines > 0 && changed > lines / 2;
      final perFile = res.putIfAbsent(file, () => {});
      for (final k in {...plus.keys, ...minus.keys}) {
        if (plus[k] == minus[k]) continue;
        perFile.putIfAbsent(
            unitName(k), () => {'at': at, 'hash': hash!.substring(0, 9), 'author': author, 'bulk': bulk});
      }
    }
    plus.clear();
    minus.clear();
    plusCount = minusCount = 0;
  }

  for (final raw in LineSplitter.split(r.stdout as String)) {
    final line = raw.replaceAll('\r', '');
    if (line.startsWith('\x01C ')) {
      flush();
      file = null;
      final p = line.substring(3).split(' ');
      hash = p[0];
      at = int.parse(p[1]);
      author = p.skip(2).join(' ');
    } else if (line.startsWith('diff --git ')) {
      flush();
      file = line.substring(line.lastIndexOf(' b/') + 3).split('/').last;
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    } else if (line.startsWith('+') || line.startsWith('-')) {
      final isPlus = line[0] == '+';
      isPlus ? plusCount++ : minusCount++;
      final m = keyRe.firstMatch(line);
      if (m == null) continue;
      var v = m[2]!.trim();
      if (v.endsWith(',')) v = v.substring(0, v.length - 1).trimRight();
      final key = jsonDecode('"${m[1]}"') as String;
      (isPlus ? plus : minus)[key] = v;
    }
  }
  flush();
  return res;
}

// ───────────────────────────── resolution ─────────────────────────────

class ModuleResult {
  /// picks[file][unit] = 'mine' | 'up' | 'none'
  final picks = <String, Map<String, String>>{};
  final counts = <String, int>{};
  final pending = <Map<String, dynamic>>[];
  final c1 = <Map<String, dynamic>>[];
  final c4 = <Map<String, dynamic>>[];
  final a4 = <Map<String, dynamic>>[];
  final decided = <Map<String, dynamic>>[];
  final errors = <String>[];
  final droppedDups = <String, Set<String>>{}; // duplicated key -> files where copies were merged
  final gitDups = <String>[]; // duplicates git's clean merge produced on its own
  final writes = <String>[];

  void count(String code) => counts[code] = (counts[code] ?? 0) + 1;
}

String fmtDate(int at) {
  final d = DateTime.fromMillisecondsSinceEpoch(at * 1000);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
}

Map<String, dynamic>? describeDate(Map<String, dynamic>? d) => d == null
    ? null
    : {'date': fmtDate(d['at'] as int), 'author': d['author'], 'hash': d['hash'], 'bulk': d['bulk']};

/// Newer side by author date; ties and unknown dates go to upstream.
String newer(Map<String, dynamic>? mine, Map<String, dynamic>? up) =>
    ((mine?['at'] as int?) ?? -1) > ((up?['at'] as int?) ?? -1) ? 'mine' : 'up';

String other(String side) => side == 'mine' ? 'up' : 'mine';

ModuleResult resolveModule(ModuleState ms, Map<String, String> decisions, Set<String> flips) {
  final r = ModuleResult();
  for (final f in ms.files) {
    r.errors.addAll(f.errors);
    r.picks[f.name] = {};
  }
  if (r.errors.isNotEmpty) return r;

  final ref = ms.files.firstWhere((f) => f.name == ms.refFile, orElse: () => ms.files.first);
  final keys = <String>{};
  for (final f in ms.files) {
    keys
      ..addAll(f.b.units.keys)
      ..addAll(f.m.units.keys)
      ..addAll(f.u.units.keys);
  }

  Unit? unitOf(FileState f, String side, String k) =>
      side == 'mine' ? f.m.units[k] : (side == 'up' ? f.u.units[k] : null);

  // Per file: same | up (only upstream changed) | mine (only mine changed) | conflict
  String cls(FileState f, String k) {
    final b = f.b.units[k], m = f.m.units[k], u = f.u.units[k];
    if (unitEq(m, u)) return 'same';
    if (unitEq(b, m)) return 'up';
    if (unitEq(b, u)) return 'mine';
    return 'conflict';
  }

  for (final k in keys) {
    final id = '${ms.name}:$k';
    final perFile = {for (final f in ms.files) f.name: cls(f, k)};
    final conflictFiles = ms.files.where((f) => perFile[f.name] == 'conflict').toList();

    void pickAll(String side) {
      for (final f in ms.files) {
        r.picks[f.name]![k] = unitOf(f, side, k) == null ? 'none' : side;
      }
    }

    // C3 — modified on one side, deleted on the other.
    final modDel = conflictFiles.where((f) => f.m.units[k] == null || f.u.units[k] == null).toList();
    if (modDel.isNotEmpty) {
      final f0 = modDel.first;
      final deleter = f0.m.units[k] == null ? 'mine' : 'up';
      final keeper = other(deleter);
      final decision = decisions[id];
      if (decision == null) {
        r.pending.add({
          'id': id,
          'key': k,
          'code': 'C3',
          'deletedBy': deleter == 'up' ? 'upstream' : 'mine',
          'modifiedValue': shown(unitOf(ref, keeper, k)) ?? shown(unitOf(f0, keeper, k)),
          'baseValue': shown(ref.b.units[k]) ?? shown(f0.b.units[k]),
          'files': modDel.map((f) => f.name).toList(),
          'choices': ['keep', 'delete'],
        });
        continue;
      }
      if (decision == 'keep') {
        pickAll(keeper);
      } else if (decision == 'delete') {
        for (final f in ms.files) {
          r.picks[f.name]![k] = 'none';
        }
      } else {
        r.errors.add('$id: quyết định "$decision" không hợp lệ cho C3 (keep|delete)');
        continue;
      }
      r.count('C3');
      r.decided.add({'id': id, 'code': 'C3', 'decision': decision});
      continue;
    }

    // C2 — both sides changed the placeholders differently.
    final phConflict =
        conflictFiles.where((f) => !sameSet(placeholders(f.m.units[k]), placeholders(f.u.units[k]))).toList();
    if (phConflict.isNotEmpty) {
      final f0 = phConflict.contains(ref) ? ref : phConflict.first;
      final decision = decisions[id];
      if (decision == null) {
        r.pending.add({
          'id': id,
          'key': k,
          'code': 'C2',
          'file': f0.name,
          'base': {'value': shown(f0.b.units[k]), 'placeholders': placeholders(f0.b.units[k]).toList()},
          'mine': {'value': shown(f0.m.units[k]), 'placeholders': placeholders(f0.m.units[k]).toList()},
          'upstream': {'value': shown(f0.u.units[k]), 'placeholders': placeholders(f0.u.units[k]).toList()},
          'choices': ['mine', 'upstream'],
        });
        continue;
      }
      if (decision != 'mine' && decision != 'upstream') {
        r.errors.add('$id: quyết định "$decision" không hợp lệ cho C2 (mine|upstream)');
        continue;
      }
      pickAll(decision == 'mine' ? 'mine' : 'up');
      r.count('C2');
      r.decided.add({'id': id, 'code': 'C2', 'decision': decision});
      continue;
    }

    final refCls = perFile[ref.name]!;

    // C1 — the reference (en) value conflicts: newest change wins for every locale.
    if (refCls == 'conflict') {
      final dm = ms.dateOf('mine', ref.name, k), du = ms.dateOf('up', ref.name, k);
      final auto = newer(dm, du);
      final flipped = flips.contains(id);
      final side = flipped ? other(auto) : auto;
      pickAll(side);
      r.count('C1');
      r.c1.add({
        'id': id,
        'key': k,
        'base': shown(ref.b.units[k]),
        'mine': {'value': shown(ref.m.units[k]), ...?describeDate(dm)},
        'upstream': {'value': shown(ref.u.units[k]), ...?describeDate(du)},
        'auto': auto == 'up' ? 'upstream' : 'mine',
        'chosen': side == 'up' ? 'upstream' : 'mine',
        'flipped': flipped,
      });
      for (final f in ms.files) {
        if (f == ref) continue;
        final chosen = unitOf(f, side, k), rival = unitOf(f, other(side), k), base = f.b.units[k];
        if (unitEq(chosen, base) && !unitEq(rival, base)) {
          r.c4.add({'key': k, 'file': f.name, 'from': 'C1', 'untranslated': true});
        }
      }
      continue;
    }

    // C4 — only one side (X) changed the reference value: locales follow X.
    if (refCls == 'up' || refCls == 'mine') {
      final x = refCls;
      for (final f in ms.files) {
        final c = perFile[f.name]!;
        if (c == 'conflict' || c == other(x)) {
          final side = unitOf(f, x, k) == null ? 'none' : x;
          r.picks[f.name]![k] = side;
          final untranslated = unitEq(unitOf(f, x, k), f.b.units[k]);
          r.count('C4');
          r.c4.add({
            'key': k,
            'file': f.name,
            'takenFrom': x == 'up' ? 'upstream' : 'mine',
            'untranslated': untranslated,
          });
        } else {
          r.picks[f.name]![k] = _simplePick(f, k, c, r);
        }
      }
      continue;
    }

    // Reference agrees → plain per-file rules, A4 for locale-only conflicts.
    for (final f in ms.files) {
      final c = perFile[f.name]!;
      if (c != 'conflict') {
        r.picks[f.name]![k] = _simplePick(f, k, c, r);
        continue;
      }
      final dm = ms.dateOf('mine', f.name, k), du = ms.dateOf('up', f.name, k);
      final side = newer(dm, du);
      r.picks[f.name]![k] = side;
      r.count('A4');
      r.a4.add({
        'key': k,
        'file': f.name,
        'mine': {'value': shown(f.m.units[k]), ...?describeDate(dm)},
        'upstream': {'value': shown(f.u.units[k]), ...?describeDate(du)},
        'chosen': side == 'up' ? 'upstream' : 'mine',
      });
    }
  }
  return r;
}

String _simplePick(FileState f, String k, String c, ModuleResult r) {
  final b = f.b.units[k], m = f.m.units[k], u = f.u.units[k];
  switch (c) {
    case 'same':
      if (!unitEq(b, m)) r.count(b == null ? 'A3' : 'A1');
      return u == null ? 'none' : 'up';
    case 'up':
      r.count('A2');
      return u == null ? 'none' : 'up';
    default: // 'mine'
      r.count('A2');
      return m == null ? 'none' : 'mine';
  }
}

// ───────────────────────────── rendering ─────────────────────────────

List<String> orderKeys(Set<String> want, List<String> primary, List<List<String>> secondaries) {
  final list = <String>[];
  final placed = <String>{};
  for (final k in primary) {
    if (want.contains(k) && placed.add(k)) list.add(k);
  }
  for (final sec in secondaries) {
    String? prev;
    for (final k in sec) {
      if (!want.contains(k)) continue;
      if (placed.contains(k)) {
        prev = k;
        continue;
      }
      final idx = prev != null ? list.indexOf(prev) + 1 : (list.isNotEmpty && list.first == '@@locale' ? 1 : 0);
      list.insert(idx, k);
      placed.add(k);
      prev = k;
    }
  }
  for (final k in want) {
    if (placed.contains(k)) continue;
    final valueIdx = k != unitName(k) ? list.indexOf(unitName(k)) : -1;
    valueIdx >= 0 ? list.insert(valueIdx + 1, k) : list.add(k);
    placed.add(k);
  }
  return list;
}

String render(List<String> keys, Map<String, String> raw, String indent, bool trailingNl, bool crlf) {
  final body = keys.map((k) => '$indent${raw[k]}').join(',\n');
  var t = '{\n$body\n}${trailingNl ? '\n' : ''}';
  if (crlf) t = t.replaceAll('\n', '\r\n');
  return t;
}

bool autoCrlf() => (git(['config', 'core.autocrlf'], check: false).stdout as String).trim() == 'true';

/// Order of [doc]'s entries. Earlier occurrences of a duplicated key (the last one wins in
/// gen-l10n) become synthetic slots carrying their raw text when [keep] allows, so
/// pre-existing duplicates nobody touched stay byte-for-byte; otherwise they are dropped.
List<String> primaryOrder(Arb doc, Map<String, String> want, bool Function(String key) keep,
    void Function(String key) dropped) {
  final last = <String, int>{};
  for (var i = 0; i < doc.entries.length; i++) {
    last[doc.entries[i].key] = i;
  }
  final order = <String>[];
  for (var i = 0; i < doc.entries.length; i++) {
    final e = doc.entries[i];
    if (last[e.key] == i) {
      order.add(e.key);
    } else if (keep(e.key)) {
      want['\u0000$i'] = e.raw;
      order.add('\u0000$i');
    } else {
      dropped(e.key);
    }
  }
  return order;
}

/// Returns the new file content, or null when the working file already matches.
String? renderFile(FileState f, Map<String, String> picks, ModuleResult r) {
  final want = <String, String>{}; // entry key -> raw
  for (final e in picks.entries) {
    if (e.value == 'none') continue;
    final unit = (e.value == 'mine' ? f.m : f.u).units[e.key];
    if (unit?.val != null) want[unit!.val!.key] = unit.val!.raw;
    if (unit?.meta != null) want[unit!.meta!.key] = unit.meta!.raw;
  }
  final crlf = f.working != null ? f.working!.contains('\r\n') : autoCrlf();
  void dropped(String key) => r.droppedDups.putIfAbsent(key, () => {}).add(f.name);

  final w = f.w;
  if (!f.conflicted && w != null) {
    // Cleanly merged by git: leave it alone unless the key-level result differs
    // or git silently produced a duplicate key that neither side had.
    final newDups = w.dups.difference({...f.m.dups, ...f.u.dups});
    final differs = {...w.units.keys, ...picks.keys}.any((k) {
      final p = picks[k];
      final chosen = p == null || p == 'none' ? null : (p == 'mine' ? f.m : f.u).units[k];
      return !unitEq(w.units[k], chosen);
    });
    if (!differs && newDups.isEmpty) return null;
    for (final d in newDups) {
      r.gitDups.add('${f.name}: $d');
    }
    String? workingRaw(String k) {
      final wu = w.units[unitName(k)];
      return (k == unitName(k) ? wu?.val : wu?.meta)?.raw;
    }

    for (final k in want.keys.toList()) {
      final p = picks[unitName(k)];
      final raw = workingRaw(k);
      if (raw != null && unitEq(w.units[unitName(k)], (p == 'mine' ? f.m : f.u).units[unitName(k)])) want[k] = raw;
    }
    final primary = primaryOrder(w, want, (k) => !newDups.contains(k) && want[k] != null && want[k] == workingRaw(k),
        (k) => newDups.contains(k) ? null : dropped(k));
    final keys = orderKeys(want.keys.toSet(), primary, [f.u.order, f.m.order]);
    return render(keys, want, w.indent, w.trailingNl, crlf);
  }

  final primary = primaryOrder(f.u, want, (k) => picks[unitName(k)] == 'up' && want.containsKey(k), dropped);
  for (final d in f.m.dups.difference(f.u.dups)) {
    dropped(d);
  }
  final keys = orderKeys(want.keys.toSet(), primary, [f.m.order]);
  return render(keys, want, f.u.entries.isEmpty ? f.m.indent : f.u.indent, f.u.trailingNl, crlf);
}

// ───────────────────────────── commands ─────────────────────────────

class Opts {
  Opts(this.cmd, this.values, this.flags);

  final String cmd;
  final Map<String, String> values;
  final Set<String> flags;

  static Opts parse(List<String> args) {
    if (args.isEmpty) fail('Thiếu lệnh: plan | apply | check | summary | done | abort');
    final values = <String, String>{}, flags = <String>{};
    const valued = {'modules', 'decide', 'flip'};
    for (var i = 1; i < args.length; i++) {
      final a = args[i];
      if (!a.startsWith('--')) fail('Tham số không hợp lệ: $a');
      final eq = a.indexOf('=');
      final name = a.substring(2, eq < 0 ? a.length : eq);
      if (valued.contains(name)) {
        values[name] = eq >= 0 ? a.substring(eq + 1) : (++i < args.length ? args[i] : fail('Thiếu giá trị cho --$name'));
      } else {
        flags.add(name);
      }
    }
    return Opts(args.first, values, flags);
  }
}

List<String> resolveModules(Opts o, {required bool onlyConflicted}) {
  final arg = o.values['modules'] ?? 'cloud';
  final dir = Directory('$root/$modulesRel');
  final all = dir
      .listSync()
      .whereType<Directory>()
      .map((d) => d.uri.pathSegments.where((s) => s.isNotEmpty).last)
      .where((n) => File('$root/$modulesRel/$n/l10n.yaml').existsSync())
      .toList()
    ..sort();
  if (arg != 'all') {
    final names = arg.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
    for (final n in names) {
      if (!all.contains(n)) fail('Module "$n" không tồn tại. Có: ${all.join(', ')}');
    }
    return names;
  }
  var names = all;
  if (onlyConflicted) {
    final unmerged = (git(['ls-files', '-u', '--', modulesRel]).stdout as String);
    names = all.where((n) => unmerged.contains('$modulesRel/$n/l10n/')).toList();
  }
  if (!o.flags.contains('include-social-fi') && names.contains(socialFi)) {
    stderr.writeln('⚠️  Bỏ qua $socialFi (cần --include-social-fi).');
    names = names.where((n) => n != socialFi).toList();
  }
  return names;
}

String refFileOf(String module, List<String> names) {
  final en = names.where((n) => n.endsWith('_en.arb')).toList();
  if (en.isNotEmpty) return en.first;
  final yaml = File('$root/$modulesRel/$module/l10n.yaml').readAsLinesSync();
  final line = yaml.firstWhere((l) => l.startsWith('template-arb-file:'), orElse: () => '');
  final tpl = line.split(':').skip(1).join(':').trim();
  return tpl.isNotEmpty && names.contains(tpl) ? tpl : names.first;
}

Future<void> cmdPlan(Opts o) async {
  final existing = State.file;
  if (existing.existsSync()) {
    final age = DateTime.now().difference(existing.lastModifiedSync());
    if (age < lockTtl && !o.flags.contains('force')) {
      fail('Đang có một phiên /l10n resolve khác (cập nhật ${age.inMinutes} phút trước). '
          'Dùng "abort" để huỷ, hoặc "plan --force" nếu chính bạn tạo nó.', 3);
    }
    if (age >= lockTtl) stderr.writeln('⚠️  Lock cũ hơn ${lockTtl.inMinutes} phút — ghi đè.');
  }

  final ctx = GitContext.detect();
  final modules = resolveModules(o, onlyConflicted: true);
  if (modules.isEmpty) fail('Không có module nào có file ARB bị conflict.');

  final unmerged = (git(['ls-files', '-u', '--', modulesRel]).stdout as String)
      .split('\n')
      .where((l) => l.contains('\t'))
      .map((l) => l.split('\t').last.trim())
      .toSet();

  final states = <ModuleState>[];
  for (final mod in modules) {
    final dirRel = '$modulesRel/$mod/l10n';
    final paths = (git(['ls-files', '--', dirRel]).stdout as String)
        .split('\n')
        .map((s) => s.trim())
        .where((s) => s.endsWith('.arb'))
        .toSet()
        .toList()
      ..sort();
    if (paths.isEmpty) fail('Module $mod không có file ARB nào được track.');

    final specs = <String>[];
    String spec(String p, String which) {
      final conflicted = unmerged.contains(p);
      final s = switch (which) {
        'base' => conflicted ? ':1:$p' : '${ctx.baseRef}:$p',
        'mine' => conflicted ? ':${ctx.mineStage}:$p' : '${ctx.mineRef}:$p',
        _ => conflicted ? ':${ctx.upStage}:$p' : '${ctx.upRef}:$p',
      };
      return s;
    }

    for (final p in paths) {
      specs.addAll([spec(p, 'base'), spec(p, 'mine'), spec(p, 'up')]);
    }
    final blobs = await catFiles(specs);

    final files = <FileState>[];
    for (final p in paths) {
      final wf = File('$root/$p');
      files.add(FileState(
        p.split('/').last,
        p,
        unmerged.contains(p),
        blobs[spec(p, 'base')],
        blobs[spec(p, 'mine')],
        blobs[spec(p, 'up')],
        wf.existsSync() ? wf.readAsStringSync() : null,
      )..parse());
    }

    int lines(String? t) => t == null ? 0 : '\n'.allMatches(lf(t)).length + 1;
    final dates = {
      'mine': keyDates(ctx.dateBase, ctx.mineRef, dirRel, {for (final f in files) f.name: lines(f.mine)}),
      'up': keyDates(ctx.dateBase, ctx.upRef, dirRel, {for (final f in files) f.name: lines(f.up)}),
    };
    states.add(ModuleState(mod, refFileOf(mod, files.map((f) => f.name).toList()), files, dates));
  }

  final state = State({
    'version': 1,
    'created': DateTime.now().toIso8601String(),
    'mode': ctx.mode,
    'head': ctx.head,
    'other': ctx.other,
    'decisions': <String, String>{},
    'flips': <String>[],
    'written': <String, String>{},
  }, states);
  state.save();

  final mineDart = gitOut(['diff', '--name-only', ctx.dateBase, ctx.mineRef, '--', '*.dart'])
      .split('\n')
      .where((s) => s.isNotEmpty && !s.contains('/generated/') && !s.endsWith('.g.dart'))
      .toList();

  final report = {
    'mode': ctx.mode,
    'mine': ctx.mineRef.substring(0, 9),
    'upstream': ctx.upRef.substring(0, 9),
    'mineChangedDart': mineDart,
    'modules': [for (final ms in states) moduleReport(ms, resolveModule(ms, {}, {}), plan: true)],
  };
  stdout.writeln(const JsonEncoder.withIndent('  ').convert(report));
}

Map<String, dynamic> moduleReport(ModuleState ms, ModuleResult r, {required bool plan}) => {
      'module': ms.name,
      'refFile': ms.refFile,
      'conflicted': ms.files.where((f) => f.conflicted).map((f) => f.name).toList(),
      'counts': r.counts,
      if (r.errors.isNotEmpty) 'errors': r.errors,
      'pending': r.pending,
      'decided': r.decided,
      'c1': r.c1,
      'c4': r.c4,
      'a4': r.a4,
      if (r.droppedDups.isNotEmpty) 'droppedDups': r.droppedDups.map((k, v) => MapEntry(k, v.toList())),
      if (r.gitDups.isNotEmpty) 'gitDups': r.gitDups,
      if (!plan) 'written': r.writes,
    };

State requireState(GitContext? ctx) {
  final s = State.load() ?? fail('Chưa có plan. Chạy "plan" trước.');
  if (ctx != null && (s.data['head'] != ctx.head || s.data['other'] != ctx.other)) {
    fail('HEAD / ${ctx.mode} đã thay đổi kể từ lúc plan. Chạy lại "plan --force".');
  }
  return s;
}

void cmdApply(Opts o) {
  final ctx = GitContext.detect();
  final s = requireState(ctx);

  final decisions = s.decisions;
  for (final d in (o.values['decide'] ?? '').split(',').where((e) => e.trim().isNotEmpty)) {
    final eq = d.lastIndexOf('=');
    if (eq < 0) fail('--decide cần dạng module:key=giá_trị, nhận "$d"');
    decisions[_qualify(d.substring(0, eq).trim(), s)] = d.substring(eq + 1).trim();
  }
  final flips = s.flips;
  for (final f in (o.values['flip'] ?? '').split(',').where((e) => e.trim().isNotEmpty)) {
    final id = _qualify(f.trim(), s);
    flips.contains(id) ? flips.remove(id) : flips.add(id);
  }
  s.data['decisions'] = decisions;
  s.data['flips'] = flips.toList();

  // Fingerprint: refuse if someone else touched the files since plan / our last apply.
  final written = s.written;
  final touched = <String>[];
  for (final ms in s.modules) {
    for (final f in ms.files) {
      final wf = File('$root/${f.path}');
      final now = wf.existsSync() ? wf.readAsStringSync() : null;
      if (now != f.working && now != written[f.path]) touched.add(f.path);
    }
  }
  if (touched.isNotEmpty) {
    fail('Các file sau đã bị thay đổi bởi phiên khác kể từ lúc plan:\n  ${touched.join('\n  ')}\n'
        'Chạy lại "plan --force".');
  }

  final results = <ModuleState, ModuleResult>{for (final ms in s.modules) ms: resolveModule(ms, decisions, flips)};
  final pending = results.values.expand((r) => r.pending).toList();
  final errors = results.values.expand((r) => r.errors).toList();
  final knownC1 = results.values.expand((r) => r.c1).map((c) => c['id']).toSet();
  final strayFlips = flips.where((f) => !knownC1.contains(f)).toList();

  if (errors.isNotEmpty) fail('Không thể apply:\n  ${errors.join('\n  ')}');
  if (pending.isNotEmpty) {
    s.save();
    stdout.writeln(const JsonEncoder.withIndent('  ').convert({'pending': pending}));
    fail('Còn ${pending.length} quyết định C2/C3 chưa có. Truyền --decide.', 2);
  }
  if (strayFlips.isNotEmpty) stderr.writeln('⚠️  --flip chỉ áp dụng cho key C1, bỏ qua: $strayFlips');

  for (final e in results.entries) {
    for (final f in e.key.files) {
      final text = renderFile(f, e.value.picks[f.name]!, e.value);
      if (text == null) {
        // Result equals git's clean merge: undo an earlier patch (e.g. after a flip).
        if (written.containsKey(f.path) && f.working != null) {
          File('$root/${f.path}').writeAsStringSync(f.working!);
          written.remove(f.path);
        }
        continue;
      }
      File('$root/${f.path}').writeAsStringSync(text);
      written[f.path] = text;
      e.value.writes.add(f.name);
    }
  }
  s.data['written'] = written;
  s.data['result'] = [for (final e in results.entries) moduleReport(e.key, e.value, plan: false)];
  s.save();
  stdout.writeln(const JsonEncoder.withIndent('  ').convert({'modules': s.data['result']}));
}

String _qualify(String id, State s) {
  if (id.contains(':')) return id;
  if (s.modules.length == 1) return '${s.modules.first.name}:$id';
  fail('Có nhiều module — cần ghi rõ module:key cho "$id"');
}

void cmdCheck(Opts o) {
  final s = State.load();
  final modules = s != null && o.values['modules'] == null
      ? s.modules.map((m) => m.name).toList()
      : resolveModules(o, onlyConflicted: false);
  var newProblems = 0;

  for (final mod in modules) {
    final dir = Directory('$root/$modulesRel/$mod/l10n');
    final files = dir.listSync().whereType<File>().where((f) => f.path.endsWith('.arb')).toList()
      ..sort((a, b) => a.path.compareTo(b.path));
    final ms = s?.modules.where((m) => m.name == mod).firstOrNull;
    final keysNow = <String, Set<String>>{};
    stdout.writeln('## $mod');

    for (final f in files) {
      final name = f.uri.pathSegments.last;
      final text = f.readAsStringSync();
      if (hasMarkers(text)) {
        stdout.writeln('❌ $name: còn conflict marker');
        newProblems++;
        continue;
      }
      final Arb arb;
      try {
        arb = parseArb(text);
        jsonDecode(lf(text));
      } catch (e) {
        stdout.writeln('❌ $name: JSON lỗi — ${describeFormatError(e)}');
        newProblems++;
        continue;
      }
      keysNow[name] = arb.units.keys.where((k) => k != '@@locale' && arb.units[k]!.val != null).toSet();
      if (arb.dups.isNotEmpty) {
        final fs = ms?.files.where((x) => x.name == name).firstOrNull;
        // Without a plan there is no baseline: report duplicates as warnings only.
        final fresh = fs == null ? <String>{} : arb.dups.difference({...fs.m.dups, ...fs.u.dups});
        if (fresh.isNotEmpty) {
          stdout.writeln('❌ $name: key trùng mới $fresh');
          newProblems++;
        }
        if (arb.dups.length > fresh.length) {
          stdout.writeln('⚠️  $name: ${arb.dups.length - fresh.length} key trùng có sẵn từ trước');
        }
      }
    }

    // Locale parity: a key missing now is a problem only if both sides had it in that file.
    final all = keysNow.values.expand((k) => k).toSet();
    keysNow.forEach((name, keys) {
      final missing = all.difference(keys);
      if (missing.isEmpty) return;
      final fs = ms?.files.where((x) => x.name == name).firstOrNull;
      final fresh = fs == null
          ? <String>{}
          : missing.where((k) => fs.m.units[k]?.val != null && fs.u.units[k]?.val != null).toSet();
      if (fresh.isNotEmpty) {
        stdout.writeln('❌ $name: mất key mà cả hai bên đều có $fresh');
        newProblems++;
      }
      if (missing.length > fresh.length) {
        stdout.writeln('⚠️  $name: thiếu ${missing.length - fresh.length} key so với locale khác '
            '(${missing.difference(fresh).take(5).join(', ')}${missing.length - fresh.length > 5 ? ', …' : ''})');
      }
    });
  }
  stdout.writeln(newProblems == 0 ? '✅ ARB OK' : '--- $newProblems vấn đề mới cần sửa ---');
  if (newProblems > 0) exit(4);
}

void cmdSummary() {
  final s = requireState(null);
  final result = (s.data['result'] as List?)?.cast<Map<String, dynamic>>() ?? fail('Chưa apply.');
  final b = StringBuffer();
  String v(Object? x) => x == null ? '—' : jsonEncode(x);
  String when(Map side) => side['date'] == null
      ? 'không rõ ngày'
      : '${side['date']} · ${side['author']} · ${side['hash']}${side['bulk'] == true ? ' ⚠ commit sửa hàng loạt' : ''}';

  for (final m in result) {
    b.writeln('### Module `${m['module']}` (tham chiếu: ${m['refFile']})');
    b.writeln();
    final counts = (m['counts'] as Map).entries.map((e) => '${e.key}=${e.value}').join(' · ');
    b.writeln('Đã xử lý: ${counts.isEmpty ? 'không có thay đổi' : counts}');
    b.writeln('File đã ghi: ${(m['written'] as List).isEmpty ? '—' : (m['written'] as List).join(', ')}');
    b.writeln();

    final c1 = (m['c1'] as List).cast<Map<String, dynamic>>();
    if (c1.isNotEmpty) {
      b.writeln('**⚠ C1 — ${c1.length} key chọn theo thay đổi mới nhất, cần xác nhận:**');
      b.writeln();
      b.writeln('| # | Key | mine | upstream | Đã chọn |');
      b.writeln('|---|---|---|---|---|');
      for (var i = 0; i < c1.length; i++) {
        final c = c1[i];
        final mine = c['mine'] as Map, up = c['upstream'] as Map;
        b.writeln('| ${i + 1} | `${c['key']}` | ${v(mine['value'])}<br>${when(mine)} | '
            '${v(up['value'])}<br>${when(up)} | **${c['chosen']}**${c['flipped'] == true ? ' (đã đảo)' : ''} |');
      }
      b.writeln();
    }

    final decided = (m['decided'] as List).cast<Map<String, dynamic>>();
    if (decided.isNotEmpty) {
      b.writeln('**C2/C3 đã quyết định:** ${decided.map((d) => '`${d['id']}` ${d['code']}→${d['decision']}').join(', ')}');
      b.writeln();
    }

    final warn = (m['c4'] as List).cast<Map<String, dynamic>>().where((c) => c['untranslated'] == true).toList();
    if (warn.isNotEmpty) {
      b.writeln('**⚠ Chưa dịch theo en mới (C4):**');
      final byKey = <String, List<String>>{};
      for (final w in warn) {
        byKey.putIfAbsent(w['key'], () => []).add(w['file']);
      }
      byKey.forEach((k, files) => b.writeln('- `$k`: ${files.join(', ')}'));
      b.writeln();
    }

    final a4 = (m['a4'] as List).cast<Map<String, dynamic>>();
    if (a4.isNotEmpty) {
      b.writeln('**A4 (chỉ locale khác nhau, chọn mới nhất):** '
          '${a4.map((a) => '`${a['key']}`@${a['file']}→${a['chosen']}').join(', ')}');
      b.writeln();
    }
    final gitDups = (m['gitDups'] as List? ?? []);
    if (gitDups.isNotEmpty) b.writeln('- ℹ️ Git merge tự sinh key trùng, đã gộp: ${gitDups.join(', ')}');
    final dropped = (m['droppedDups'] as Map? ?? {});
    if (dropped.isNotEmpty) {
      b.writeln('- ℹ️ Key trùng có sẵn đã gộp còn 1 bản (giá trị cuối): '
          '${dropped.entries.map((e) => '`${e.key}` (${(e.value as List).length} file)').join(', ')}');
    }
  }
  stdout.write(b.toString());
}

void cmdDone() {
  final ctx = GitContext.detect();
  final s = requireState(ctx);
  final written = s.written;
  final unresolved = [
    for (final ms in s.modules)
      for (final f in ms.files)
        if (f.conflicted && !written.containsKey(f.path)) f.path
  ];
  if (unresolved.isNotEmpty) fail('Các file conflict chưa được apply:\n  ${unresolved.join('\n  ')}');
  final changed = written.keys.where((p) => File('$root/$p').readAsStringSync() != written[p]).toList();
  if (changed.isNotEmpty) fail('File đã bị sửa sau apply (chạy "check" rồi "apply" lại):\n  ${changed.join('\n  ')}');
  if (written.isNotEmpty) git(['add', '--', ...written.keys]);
  State.clear();
  stdout.writeln('✅ Đã stage ${written.length} file:');
  for (final p in written.keys) {
    stdout.writeln('  $p');
  }
  stdout.writeln('Tiếp theo: kiểm tra rồi chạy "git ${ctx.mode} --continue".');
}

void cmdAbort(Opts o) {
  final s = State.load();
  if (s == null) {
    stdout.writeln('Không có phiên nào đang chạy.');
    return;
  }
  if (o.flags.contains('restore')) {
    final written = s.written;
    for (final ms in s.modules) {
      for (final f in ms.files) {
        final wf = File('$root/${f.path}');
        if (!written.containsKey(f.path) || f.working == null) continue;
        if (wf.readAsStringSync() == written[f.path]) {
          wf.writeAsStringSync(f.working!);
          stdout.writeln('↩  ${f.path}');
        } else {
          stdout.writeln('⚠️  ${f.path} đã bị sửa sau apply — giữ nguyên');
        }
      }
    }
  }
  State.clear();
  stdout.writeln('Đã huỷ phiên /l10n resolve.');
}

Future<void> main(List<String> args) async {
  final o = Opts.parse(args);
  final top = Process.runSync('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir'], stdoutEncoding: utf8);
  if (top.exitCode != 0) fail('Không ở trong git repo.');
  final lines = (top.stdout as String).trim().split('\n').map((l) => l.trim()).toList();
  root = lines[0];
  gitDir = lines[1];

  switch (o.cmd) {
    case 'plan':
      await cmdPlan(o);
    case 'apply':
      cmdApply(o);
    case 'check':
      cmdCheck(o);
    case 'summary':
      cmdSummary();
    case 'done':
      cmdDone();
    case 'abort':
      cmdAbort(o);
    default:
      fail('Lệnh không hợp lệ: ${o.cmd}');
  }
}
