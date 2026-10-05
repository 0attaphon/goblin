import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, skill } from './helpers.mjs';
import { scan } from '../dist/catalog.js';
import { plan, apply, restore, history } from '../dist/changes.js';

test('remove and restore preserve skill bytes and shared relative links without touching unrelated skills', t => {
  const { root, options } = fixture(t);
  const dir = skill(root, 'alpha');
  const other = skill(root, 'other');
  const untouched = fs.readFileSync(path.join(other, 'SKILL.md'));
  fs.symlinkSync('alpha', path.join(root, 'alias'));
  const selected = scan(options).skills.find(s => s.path === dir);
  const p = plan(options, 'remove', selected.id);
  assert.equal(p.affected.length, 2);
  assert.equal(fs.existsSync(options.dataDir), false, 'planning alone is read-only');
  const change = apply(options, p);
  assert.equal(change.state, 'applied');
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(path.join(root, 'alias')), false);
  assert.deepEqual(fs.readFileSync(path.join(other, 'SKILL.md')), untouched);
  const restored = restore(options, change.id);
  assert.equal(restored.state, 'restored');
  assert.equal(fs.readlinkSync(path.join(root, 'alias')), 'alpha');
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), '---\nname: alpha\ndescription: Test skill\n---\nDo the task.\n');
  assert.equal(history(options)[0].state, 'restored');
});

test('stale plans refuse removal after a resource changes', t => {
  const { root, options } = fixture(t);
  const dir = skill(root, 'alpha');
  const p = plan(options, 'remove', 'alpha');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'changed');
  assert.throws(() => apply(options, p), /STALE_PLAN/);
  assert.ok(fs.existsSync(dir));
});

test('restore refuses to overwrite a new skill and refuses modified archive data', t => {
  const { root, options } = fixture(t);
  const dir = skill(root, 'alpha');
  const p = plan(options, 'remove', 'alpha');
  apply(options, p);
  skill(root, 'alpha', 'new-alpha');
  assert.throws(() => restore(options, p.id), /RESTORE_CONFLICT/);
  fs.rmSync(dir, { recursive: true });
  fs.writeFileSync(path.join(p.moves[0].to, 'SKILL.md'), 'tampered');
  assert.throws(() => restore(options, p.id), /ARCHIVE_CHANGED/);
});

test('ambiguous names and managed sources refuse mutation', t => {
  const { root, options } = fixture(t);
  skill(root, 'a', 'same');
  skill(root, 'b', 'same');
  assert.throws(() => plan(options, 'remove', 'same'), /AMBIGUOUS_SKILL/);
  skill(root, 'synced/pdf', 'pdf');
  fs.writeFileSync(path.join(root, 'synced', 'manifest.json'), '{}');
  assert.throws(() => plan(options, 'remove', 'pdf'), /MANAGED_SOURCE/);
});

test('state cannot sit inside discovery roots and an existing lock blocks mutation', t => {
  const { root, options } = fixture(t);
  skill(root, 'alpha');
  assert.throws(() => scan({ ...options, dataDir: path.join(root, 'state') }), /UNSAFE_DATA_DIR/);
  const p = plan(options, 'remove', 'alpha');
  fs.mkdirSync(options.dataDir);
  fs.mkdirSync(path.join(options.dataDir, 'lock'));
  assert.throws(() => apply(options, p), /LOCKED/);
  assert.ok(fs.existsSync(path.join(root, 'alpha')));
});

test('Codex disable preserves unrelated config bytes and enable restores prior state', t => {
  const { root, options, home } = fixture(t);
  const dir = skill(root, 'alpha');
  fs.mkdirSync(path.join(home, '.codex'));
  const cp = path.join(home, '.codex', 'config.toml');
  const original = '# Preserve this comment\nmodel = "example"\n\n[mcp_servers.other]\ncommand = "other"\n';
  fs.writeFileSync(cp, original);
  const p = plan(options, 'disable', 'alpha');
  apply(options, p);
  assert.ok(fs.readFileSync(cp, 'utf8').startsWith(original));
  assert.equal(scan(options).skills[0].status, 'disabled');
  assert.equal(fs.existsSync(dir), true);
  apply(options, plan(options, 'enable', 'alpha'));
  assert.equal(scan(options).skills[0].status, 'enabled');
  assert.ok(fs.readFileSync(cp, 'utf8').startsWith(original));
});

test('config restoration refuses to discard later config edits', t => {
  const { root, options, home } = fixture(t);
  skill(root, 'alpha');
  const p = plan(options, 'disable', 'alpha');
  apply(options, p);
  fs.appendFileSync(path.join(home, '.codex', 'config.toml'), '\n# New edit\n');
  assert.throws(() => restore(options, p.id), /RESTORE_CONFLICT/);
});

test('invalid change IDs and forged move destinations are rejected', t => {
  const { root, options } = fixture(t);
  skill(root, 'alpha');
  assert.throws(() => restore(options, '../outside'), /INVALID_CHANGE_ID/);
  const p = plan(options, 'remove', 'alpha');
  p.moves[0].to = path.join(root, 'bad');
  assert.throws(() => apply(options, p), /INVALID_PLAN/);
  assert.ok(fs.existsSync(path.join(root, 'alpha')));
});

test('recovery restores an interrupted move and prevents new operations until recovered', t => {
  const { root, options } = fixture(t);
  skill(root, 'alpha');
  const p = plan(options, 'remove', 'alpha');
  const change = apply(options, p);
  const journal = path.join(options.dataDir, 'changes', `${p.id}.json`);
  fs.writeFileSync(journal, JSON.stringify({ ...change, state: 'applying' }));
  skill(root, 'beta');
  assert.throws(() => apply(options, plan(options, 'remove', 'beta')), /RECOVERY_REQUIRED/);
  restore(options, p.id);
  assert.ok(fs.existsSync(path.join(root, 'alpha')));
});

test('native config changes refuse multiline strings instead of altering unrelated values', t => {
  const { root, options, home } = fixture(t);
  const dir = skill(root, 'alpha');
  fs.mkdirSync(path.join(home, '.codex'));
  const cp = path.join(home, '.codex', 'config.toml');
  const text = `[[skills.config]]\npath = ${JSON.stringify(path.join(dir, 'SKILL.md'))}\nnote = """\nenabled = true\n"""\nenabled = true\n`;
  fs.writeFileSync(cp, text);
  assert.throws(() => plan(options, 'disable', 'alpha'), /UNSUPPORTED_CONFIG_FORMAT/);
  assert.equal(fs.readFileSync(cp, 'utf8'), text);
});

test('native config changes refuse symlinked config without replacing its identity', t => {
  const { root, options, home } = fixture(t);
  skill(root, 'alpha');
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, 'dotfile.toml'), 'model = "example"\n');
  const cp = path.join(home, '.codex', 'config.toml');
  fs.symlinkSync('../dotfile.toml', cp);
  assert.throws(() => plan(options, 'disable', 'alpha'), /SYMLINK_CONFIG/);
  assert.equal(fs.readlinkSync(cp), '../dotfile.toml');
});

test('unreadable discovery directories block removal of incompletely enumerated shared skills', t => {
  const { root, options } = fixture(t);
  skill(root, 'alpha');
  const hidden = path.join(root, 'hidden');
  fs.mkdirSync(hidden);
  fs.symlinkSync('../alpha', path.join(hidden, 'alias'));
  fs.chmodSync(hidden, 0o000);
  try {
    const c = scan(options);
    assert.equal(c.incomplete, true);
    assert.throws(() => plan(options, 'remove', 'alpha'), /SCAN_INCOMPLETE/);
    assert.ok(fs.existsSync(path.join(root, 'alpha')));
  } finally { fs.chmodSync(hidden, 0o700); }
});

test('restore rejects a discovery root redirected after removal', t => {
  const { root, options, home } = fixture(t);
  skill(root, 'alpha');
  const p = plan(options, 'remove', 'alpha');
  apply(options, p);
  const elsewhere = path.join(home, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.renameSync(root, path.join(home, 'original-root'));
  fs.symlinkSync('elsewhere', root);
  assert.throws(() => restore(options, p.id), /INVALID_PLAN/);
  assert.equal(fs.existsSync(path.join(elsewhere, 'alpha')), false);
});

test('alias resolution permission errors are not mistaken for harmless broken links', t => {
  const { root, options, home } = fixture(t);
  const dir = skill(root, 'alpha');
  const bridge = path.join(home, 'bridge');
  fs.mkdirSync(bridge);
  fs.symlinkSync(dir, path.join(bridge, 'target'));
  fs.symlinkSync(path.join(bridge, 'target'), path.join(root, 'alias'));
  fs.chmodSync(bridge, 0o000);
  try {
    const c = scan(options);
    assert.equal(c.incomplete, true);
    assert.ok(c.issues.some(i => i.code === 'EACCES' || i.code === 'EPERM'));
    assert.throws(() => plan(options, 'remove', 'alpha'), /SCAN_INCOMPLETE/);
  } finally { fs.chmodSync(bridge, 0o700); }
});
