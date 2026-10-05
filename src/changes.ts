import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { audit, inspect, scan } from './catalog.js';
import { atomicWrite, digest, exists, fingerprint, GoblinError, inside, physical, readOptional, settings } from './files.js';
import type { Action, Change, ChangePlan, Move, Options, Settings } from './types.js';

function validId(id: string): void {
  if (!/^chg_[0-9a-f-]{36}$/.test(id)) throw new GoblinError('INVALID_CHANGE_ID');
}
function safeParent(config: Settings, file: string): boolean {
  // macOS /var and /tmp are system aliases. Compare within the configured root,
  // while still refusing additional symlinked ancestors inside that root.
  return config.roots.some(r => inside(r.path, file)
    && physical(path.dirname(file)) === path.join(physical(r.path), path.relative(r.path, path.dirname(file))));
}
function configPatch(before: string | null, skillFile: string, enabled: boolean): string {
  const text = before ?? '';
  // This release preserves text rather than reserializing TOML. Multiline
  // strings can contain table/key-looking lines; refuse instead of patching them.
  if (text.includes('"""') || text.includes("'''")) throw new GoblinError('UNSUPPORTED_CONFIG_FORMAT', 'Multiline TOML strings require a token-aware editor.');
  let parsed: any;
  try { parsed = parseToml(text); } catch { throw new GoblinError('INVALID_CODEX_CONFIG'); }
  const matching = (parsed.skills?.config ?? []).filter((v: any) => v.path === skillFile);
  if (matching.length > 1) throw new GoblinError('DUPLICATE_CONFIG_ENTRY');
  const sections = [...text.matchAll(/^\s*\[\[skills\.config\]\][^\n]*(?:\n|$)/gm)];
  for (const section of sections) {
    const start = section.index!;
    const rest = text.slice(start + section[0].length);
    const next = /^\s*\[/m.exec(rest);
    const end = next ? start + section[0].length + next.index : text.length;
    const block = text.slice(start, end);
    const value = (parseToml(block) as any).skills.config[0];
    if (value.path !== skillFile) continue;
    const replaced = /^\s*enabled\s*=\s*(true|false)[^\n]*$/m.test(block)
      ? block.replace(/^(\s*enabled\s*=\s*)(true|false)([^\n]*)$/m, `$1${enabled}$3`)
      : `${block}${block.endsWith('\n') ? '' : '\n'}enabled = ${enabled}\n`;
    const result = text.slice(0, start) + replaced + text.slice(end);
    parseToml(result);
    return result;
  }
  if (matching.length) throw new GoblinError('UNSUPPORTED_CONFIG_FORMAT', 'Use a [[skills.config]] table for this skill.');
  const result = `${text}${text.endsWith('\n') || !text ? '' : '\n'}\n[[skills.config]]\npath = ${JSON.stringify(skillFile)}\nenabled = ${enabled}\n`;
  try { parseToml(result); } catch { throw new GoblinError('UNSUPPORTED_CONFIG_FORMAT'); }
  return result;
}

export function plan(options: Options, action: Action, selector: string): ChangePlan {
  if (!['remove', 'disable', 'enable'].includes(action)) throw new GoblinError('INVALID_ACTION');
  const config = settings(options), catalog = scan(options), selected = inspect(catalog, selector);
  if (catalog.incomplete) throw new GoblinError('SCAN_INCOMPLETE', 'Mutations require a complete catalog.');
  const group = action === 'remove' ? catalog.skills.filter(s => s.canonical_path === selected.canonical_path) : [selected];
  if (group.some(s => s.managed || !s.fingerprint)) throw new GoblinError('MANAGED_SOURCE', selected.path);
  for (const item of group) {
    if (config.roots.some(r => item.path === r.path)) throw new GoblinError('ROOT_IS_SKILL');
    if (!safeParent(config, item.path)) throw new GoblinError('SYMLINK_PARENT', item.path);
  }
  const id = `chg_${crypto.randomUUID()}`;
  const affected = group.map(s => ({ id: s.id, path: s.path, provider: s.provider })).sort((a, b) => a.path.localeCompare(b.path));
  // Move references first and restore their target first by reversing the journal.
  const ordered = group.slice().sort((a, b) => Number(b.is_link) - Number(a.is_link) || a.path.localeCompare(b.path));
  const moves: Move[] = action === 'remove' ? ordered.map((s, i) => ({
    from: s.path, to: path.join(config.dataDir, 'archive', id, String(i)),
    fingerprint: fingerprint(s.path), is_link: s.is_link,
  })) : [];
  let patch: ChangePlan['config'];
  if (action !== 'remove') {
    if (selected.provider !== 'codex') throw new GoblinError('UNSUPPORTED_PROVIDER', 'Native enable/disable is available for Codex only.');
    if (exists(config.configPath) && fs.lstatSync(config.configPath).isSymbolicLink()) throw new GoblinError('SYMLINK_CONFIG');
    const before = readOptional(config.configPath);
    patch = { path: config.configPath, before, after: configPatch(before, selected.skill_file, action === 'enable') };
  }
  const snapshot = digest(JSON.stringify({ action, affected, fingerprints: group.map(s => [s.path, s.fingerprint, s.link_target]), patch, roots: config.roots, dataDir: config.dataDir }));
  return { id, action, created_at: new Date().toISOString(), skill_id: selected.id, name: selected.name,
    affected, moves, config: patch, roots: config.roots, data_dir: config.dataDir, snapshot };
}

function validatePaths(config: Settings, p: ChangePlan): void {
  validId(p.id);
  if (p.data_dir !== config.dataDir || JSON.stringify(p.roots) !== JSON.stringify(config.roots)) throw new GoblinError('INVALID_PLAN', 'Settings changed.');
  if (!['remove', 'disable', 'enable'].includes(p.action) || !Array.isArray(p.moves)) throw new GoblinError('INVALID_PLAN');
  for (const [i, move] of p.moves.entries()) {
    if (!config.roots.some(r => move.from !== r.path && inside(r.path, move.from))
      || move.to !== path.join(config.dataDir, 'archive', p.id, String(i))
      || physical(path.dirname(move.to)) !== path.dirname(move.to)
      || !/^[0-9a-f]{64}$/.test(move.fingerprint)
      || !safeParent(config, move.from)) throw new GoblinError('INVALID_PLAN');
  }
  if (p.config && p.config.path !== config.configPath) throw new GoblinError('INVALID_PLAN');
  if (p.config && exists(config.configPath) && fs.lstatSync(config.configPath).isSymbolicLink()) throw new GoblinError('SYMLINK_CONFIG');
}

function withLock<T>(config: Settings, fn: () => T): T {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const lock = path.join(config.dataDir, 'lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (e: any) {
    if (e.code === 'EEXIST') throw new GoblinError('LOCKED', 'Another operation may be active. Check history before recovering a stale lock.');
    throw e;
  }
  try { atomicWrite(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })); return fn(); }
  finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
function journalPath(config: Settings, id: string) { validId(id); return path.join(config.dataDir, 'changes', `${id}.json`); }
function writeJournal(config: Settings, change: Change): void {
  atomicWrite(journalPath(config, change.id), JSON.stringify(change, null, 2));
}
export function history(options: Options = {}): Change[] {
  const config = settings(options), dir = path.join(config.dataDir, 'changes');
  if (!exists(dir)) return [];
  try {
    return fs.readdirSync(dir).filter(f => /^chg_[0-9a-f-]{36}\.json$/.test(f))
      .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Change)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch { throw new GoblinError('STATE_CORRUPT', dir); }
}
function requireClean(options: Options): void {
  if (history(options).some(c => c.state === 'applying' || c.state === 'restoring'))
    throw new GoblinError('RECOVERY_REQUIRED', 'Use history, then restore the interrupted change.');
}

function moveVerified(move: Move): void {
  if (exists(move.to)) throw new GoblinError('DESTINATION_EXISTS', move.to);
  fs.mkdirSync(path.dirname(move.to), { recursive: true, mode: 0o700 });
  try { fs.renameSync(move.from, move.to); } catch (e: any) {
    if (e.code !== 'EXDEV') throw e;
    const stage = `${move.to}.copy`;
    if (exists(stage)) throw new GoblinError('RECOVERY_REQUIRED', stage);
    fs.cpSync(move.from, stage, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false });
    if (fingerprint(stage) !== move.fingerprint) throw new GoblinError('COPY_VERIFY_FAILED', stage);
    fs.renameSync(stage, move.to);
    if (fingerprint(move.from) !== move.fingerprint) throw new GoblinError('STALE_PLAN', move.from);
    fs.rmSync(move.from, { recursive: true });
  }
}

export function apply(options: Options, p: ChangePlan): Change {
  const config = settings(options);
  validatePaths(config, p);
  return withLock(config, () => {
    requireClean(options);
    let fresh: ChangePlan;
    try { fresh = plan(options, p.action, p.skill_id); } catch { throw new GoblinError('STALE_PLAN'); }
    const expectedMoves = fresh.moves.map((m, i) => ({ ...m, to: path.join(config.dataDir, 'archive', p.id, String(i)) }));
    if (fresh.snapshot !== p.snapshot) throw new GoblinError('STALE_PLAN');
    if (JSON.stringify(expectedMoves) !== JSON.stringify(p.moves) || JSON.stringify(fresh.config) !== JSON.stringify(p.config)) throw new GoblinError('INVALID_PLAN');
    if (exists(journalPath(config, p.id))) throw new GoblinError('CHANGE_EXISTS');
    for (const move of p.moves) if (exists(move.to)) throw new GoblinError('DESTINATION_EXISTS');
    const change: Change = { ...p, state: 'applying', updated_at: new Date().toISOString() };
    writeJournal(config, change);
    try {
      for (const move of p.moves) moveVerified(move);
      if (p.config) {
        const mode = exists(p.config.path) ? fs.statSync(p.config.path).mode & 0o777 : 0o600;
        if (readOptional(p.config.path) !== p.config.before) throw new GoblinError('STALE_PLAN');
        atomicWrite(p.config.path, p.config.after, mode);
      }
      change.state = 'applied'; change.updated_at = new Date().toISOString(); writeJournal(config, change);
      return change;
    } catch (e: any) {
      throw new GoblinError('RECOVERY_REQUIRED', `${p.id}: ${e.code ?? 'operation failed'}; use restore.`);
    }
  });
}

export function restore(options: Options, id: string, dryRun = false): Change {
  const config = settings(options);
  validId(id);
  const run = (): Change => {
    const text = readOptional(journalPath(config, id));
    if (!text) throw new GoblinError('CHANGE_NOT_FOUND');
    let change: Change;
    try { change = JSON.parse(text); } catch { throw new GoblinError('STATE_CORRUPT'); }
    validatePaths(config, change);
    if (change.state === 'restored') return change;
    if (!['applying', 'applied', 'restoring'].includes(change.state)) throw new GoblinError('STATE_CORRUPT');
    for (const move of change.moves) {
      const fromExists = exists(move.from), toExists = exists(move.to);
      if (toExists && fingerprint(move.to) !== move.fingerprint) throw new GoblinError('ARCHIVE_CHANGED', move.to);
      if (fromExists && (change.state === 'applied' || fingerprint(move.from) !== move.fingerprint)) throw new GoblinError('RESTORE_CONFLICT', move.from);
      if (!fromExists && !toExists) throw new GoblinError('RECOVERY_REQUIRED', `Missing both copies: ${move.from}`);
    }
    if (change.config) {
      const now = readOptional(change.config.path);
      if (now !== change.config.after && !(change.state !== 'applied' && now === change.config.before)) throw new GoblinError('RESTORE_CONFLICT', change.config.path);
    }
    if (dryRun) return change;
    change.state = 'restoring'; change.updated_at = new Date().toISOString(); writeJournal(config, change);
    try {
      for (const move of change.moves.slice().reverse()) {
        if (exists(move.to)) {
          if (exists(move.from)) fs.rmSync(move.to, { recursive: true });
          else moveVerified({ ...move, from: move.to, to: move.from });
        }
      }
      if (change.config) {
        if (change.config.before === null) { if (exists(change.config.path)) fs.unlinkSync(change.config.path); }
        else atomicWrite(change.config.path, change.config.before, exists(change.config.path) ? fs.statSync(change.config.path).mode & 0o777 : 0o600);
      }
      change.state = 'restored'; change.updated_at = new Date().toISOString(); writeJournal(config, change);
      return change;
    } catch (e: any) { throw new GoblinError('RECOVERY_REQUIRED', `${id}: ${e.code ?? 'restore failed'}`); }
  };
  return dryRun ? run() : withLock(config, run);
}

export function savePlan(options: Options, p: ChangePlan): void {
  const config = settings(options); validatePaths(config, p);
  withLock(config, () => atomicWrite(path.join(config.dataDir, 'plans', `${p.id}.json`), JSON.stringify(p)));
}
export function readPlan(options: Options, id: string): ChangePlan {
  validId(id);
  const config = settings(options), text = readOptional(path.join(config.dataDir, 'plans', `${id}.json`));
  if (!text) throw new GoblinError('PLAN_NOT_FOUND');
  let p: ChangePlan;
  try { p = JSON.parse(text); } catch { throw new GoblinError('STATE_CORRUPT'); }
  validatePaths(config, p); return p;
}
