import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { fixture, skill } from './helpers.mjs';
import { apply, history, plan, restore } from '../dist/changes.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const runner = fileURLToPath(new URL('./terminal-runner.py', import.meta.url));
function terminal(options, keys, extra = {}) {
  const argv = [process.execPath, ...(extra.node_args ?? []), cli, 'scan', '--root', options.roots[0].path,
    '--home', options.home, '--data-dir', options.dataDir];
  const result = spawnSync('python3', [runner], { input: JSON.stringify({ argv, keys, ...extra }), encoding: 'utf8', timeout: 16000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// Regressions: applying only the last checkbox, writing before Enter, or
// restoring config snapshots in the wrong order must fail these tests.
test('terminal scan selects two skills and submits once, preserving files and undoing in reverse order', t => {
  const { root, options, home } = fixture(t);
  const a = skill(root, 'alpha'), b = skill(root, 'beta');
  const result = terminal(options, ' \u001b[B \r');
  assert.ok(result.sent, result.output);
  assert.equal(result.status, 0, result.output);
  const config = parse(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'));
  assert.equal(config.skills.config.length, 2);
  assert.ok(config.skills.config.every(s => s.enabled === false));
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
  assert.match(result.output, /Disabled 2/);
  const ids = [...result.output.matchAll(/goblin restore (chg_[0-9a-f-]+)/g)].map(m => m[1]);
  assert.equal(ids.length, 2);
  for (const id of ids) restore(options, id);
  assert.equal(fs.existsSync(path.join(home, '.codex/config.toml')), false);
});

test('Escape and Ctrl+C cancel checked items without writing state or config', t => {
  const { root, options, home } = fixture(t);
  skill(root, 'alpha');
  for (const keys of [' \u001b', ' \u0003']) {
    const result = terminal(options, keys);
    assert.ok(result.sent, result.output);
    assert.equal(result.status, 0, result.output);
    assert.equal(fs.existsSync(options.dataDir), false);
    assert.equal(fs.existsSync(path.join(home, '.codex/config.toml')), false);
  }
});

test('managed and already disabled rows cannot be checked', t => {
  const { root, options, home } = fixture(t);
  const a = skill(root, 'alpha');
  const b = skill(root, 'beta');
  fs.writeFileSync(path.join(a, 'manifest.json'), '{}');
  fs.mkdirSync(path.join(home, '.codex'));
  const before = `[[skills.config]]\npath = ${JSON.stringify(path.join(b, 'SKILL.md'))}\nenabled = false\n`;
  fs.writeFileSync(path.join(home, '.codex/config.toml'), before);
  const result = terminal(options, ' \u001b[B \r');
  assert.ok(result.sent, result.output);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /managed/i);
  assert.match(result.output, /already disabled/i);
  assert.equal(history(options).length, 0);
  assert.equal(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'), before);
});

test('a skill changed while the selector is open blocks the submission before any write', t => {
  const { root, options, home } = fixture(t);
  const a = skill(root, 'alpha'); skill(root, 'beta');
  const result = terminal(options, ' \u001b[B \r', { edit: { path: path.join(a, 'SKILL.md'), text: '\nChanged' } });
  assert.ok(result.sent, result.output);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /STALE/);
  assert.equal(fs.existsSync(options.dataDir), false);
  assert.equal(fs.existsSync(path.join(home, '.codex/config.toml')), false);
});

test('the selector scrolls to a skill beyond the first screen and changes only that skill', t => {
  const { root, options, home } = fixture(t);
  for (let i = 0; i < 30; i++) skill(root, `skill-${String(i).padStart(2, '0')}`);
  const result = terminal(options, '\u001b[B'.repeat(29) + ' \r');
  assert.equal(result.status, 0, result.output);
  const config = parse(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'));
  assert.equal(config.skills.config.length, 1);
  assert.equal(config.skills.config[0].path, path.join(root, 'skill-29', 'SKILL.md'));
  assert.equal(config.skills.config[0].enabled, false);
});

test('empty submission makes no changes, and no-interactive bypasses the selector in a terminal', t => {
  const { root, options } = fixture(t);
  skill(root, 'alpha');
  const empty = terminal(options, '\r');
  assert.equal(empty.status, 0, empty.output);
  assert.equal(fs.existsSync(options.dataDir), false);
  const plain = terminal(options, '', { extra_args: ['--no-interactive'] });
  assert.equal(plain.status, 0, plain.output);
  assert.equal(plain.sent, false);
  assert.match(plain.output, /LAST USED/);
  assert.equal(fs.existsSync(options.dataDir), false);
});

test('unsupported config is caught during preflight without partially disabling the selection', t => {
  const { root, options, home } = fixture(t);
  skill(root, 'alpha'); skill(root, 'beta');
  fs.mkdirSync(path.join(home, '.codex'));
  const before = 'note = """Keep this multi-line setting"""\n';
  fs.writeFileSync(path.join(home, '.codex/config.toml'), before);
  const result = terminal(options, ' \u001b[B \r');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /UNSUPPORTED_CONFIG_FORMAT/);
  assert.equal(fs.existsSync(options.dataDir), false);
  assert.equal(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'), before);
});

test('checking a real skill and its shared alias succeeds without reporting our own config change as stale', t => {
  const { root: fixtureRoot, options, home } = fixture(t);
  const root = fs.realpathSync(fixtureRoot);
  options.roots[0].path = root;
  const a = skill(root, 'alpha');
  fs.symlinkSync(a, path.join(root, 'beta'));
  const result = terminal(options, ' \u001b[B \r');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Disabled 2/);
  assert.ok(fs.lstatSync(path.join(root, 'beta')).isSymbolicLink());
  const config = parse(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'));
  assert.equal(config.skills.config.length, 1);
  assert.equal(config.skills.config[0].enabled, false);
});

test('an interrupted final journal write prints recovery before earlier restore commands', t => {
  const { root, options, home } = fixture(t);
  skill(root, 'alpha'); skill(root, 'beta');
  const fault = fileURLToPath(new URL('./fail-final-journal.mjs', import.meta.url));
  const result = terminal(options, ' \u001b[B \r', { node_args: ['--import', fault] });
  assert.equal(result.status, 1, result.output);
  const pending = history(options).find(c => c.state === 'applying');
  assert.ok(pending);
  const ids = [...result.output.matchAll(/goblin restore (chg_[0-9a-f-]+)/g)].map(m => m[1]);
  assert.equal(ids.length, 2, result.output);
  assert.equal(ids[0], pending.id);
  for (const id of ids) restore(options, id);
  assert.equal(fs.existsSync(path.join(home, '.codex/config.toml')), false);
});

test('an older interrupted change does not produce a restore command for a nonexistent new change', t => {
  const { root, options, home } = fixture(t);
  skill(root, 'alpha'); skill(root, 'beta'); skill(root, 'gamma');
  const old = apply(options, plan(options, 'disable', 'gamma'));
  old.state = 'applying';
  fs.writeFileSync(path.join(options.dataDir, 'changes', `${old.id}.json`), JSON.stringify(old));
  const before = fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8');
  const result = terminal(options, ' \r');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /RECOVERY_REQUIRED/);
  assert.equal([...result.output.matchAll(/goblin restore (chg_[0-9a-f-]+)/g)].length, 0, result.output);
  assert.equal(history(options).length, 1);
  assert.equal(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'), before);
});
