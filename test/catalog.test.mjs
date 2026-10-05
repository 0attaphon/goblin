import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, skill } from './helpers.mjs';
import { scan, inspect, audit } from '../dist/catalog.js';

test('scan returns stable metadata and unknown usage without changing skills or creating state', t => {
  const { root, options } = fixture(t);
  const dir = skill(root, 'alpha');
  const original = fs.readFileSync(path.join(dir, 'SKILL.md'));
  const first = scan(options);
  const again = scan(options);
  assert.equal(first.skills.length, 1);
  const item = first.skills[0];
  assert.equal(item.name, 'alpha');
  assert.equal(item.path, dir);
  assert.equal(item.last_used_at, null);
  assert.equal(item.usage_count, null);
  assert.equal(item.usage_source, null);
  assert.equal(item.id, again.skills[0].id);
  assert.ok(!JSON.stringify(item).includes('Do the task.'));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'SKILL.md')), original);
  assert.equal(fs.existsSync(options.dataDir), false);
});

test('shared aliases are distinguished from physically duplicated skills', t => {
  const { root, options } = fixture(t);
  const dir = skill(root, 'alpha');
  fs.symlinkSync('alpha', path.join(root, 'alias'));
  fs.cpSync(dir, path.join(root, 'copy'), { recursive: true });
  const result = scan(options);
  assert.equal(result.skills.length, 3);
  const findings = audit(result);
  assert.ok(findings.some(x => x.kind === 'shared_reference' && x.ids.length === 2));
  assert.ok(findings.some(x => x.kind === 'exact_duplicate'));
  assert.throws(() => inspect(result, 'alpha'), /AMBIGUOUS_SKILL/);
});

test('fingerprints include resources and do not follow embedded symlinks', t => {
  const { root, options, home } = fixture(t);
  const a = skill(root, 'a', 'same');
  const b = skill(root, 'b', 'same');
  fs.writeFileSync(path.join(a, 'resource.txt'), 'first');
  fs.writeFileSync(path.join(b, 'resource.txt'), 'second');
  fs.writeFileSync(path.join(home, 'secret.txt'), 'secret');
  fs.symlinkSync(path.join(home, 'secret.txt'), path.join(a, 'external'));
  const before = scan(options);
  assert.notEqual(before.skills[0].fingerprint, before.skills[1].fingerprint);
  fs.writeFileSync(path.join(home, 'secret.txt'), 'changed');
  const after = scan(options);
  assert.equal(before.skills[0].fingerprint, after.skills[0].fingerprint);
});

test('nested synced sources and broken links are surfaced without allowing mutation', t => {
  const { root, options } = fixture(t);
  skill(root, 'synced/pdf', 'pdf');
  fs.writeFileSync(path.join(root, 'synced', 'manifest.json'), '{}');
  fs.symlinkSync('missing', path.join(root, 'broken'));
  const result = scan(options);
  assert.equal(result.skills[0].managed, true);
  assert.ok(result.issues.some(x => x.code === 'BROKEN_LINK'));
});

test('an alias outside configured roots is reported and not read', t => {
  const { root, options, home } = fixture(t);
  skill(home, 'outside', 'outside');
  fs.symlinkSync('../outside', path.join(root, 'alias'));
  const result = scan(options);
  assert.equal(result.skills.length, 0);
  assert.ok(result.issues.some(x => x.code === 'OUTSIDE_ROOT'));
});

test('invalid frontmatter is reported and oversized discovery stays bounded', t => {
  const { root, options } = fixture(t);
  const bad = skill(root, 'bad');
  fs.writeFileSync(path.join(bad, 'SKILL.md'), '---\nname: [broken\n---\nbody');
  const result = scan(options);
  assert.equal(result.skills[0].metadata_valid, false);
  assert.ok(audit(result).some(x => x.kind === 'metadata_invalid'));
});

test('plugin cache scans skill directories without treating package fixtures as installed skills', t => {
  const { root, options } = fixture(t);
  skill(root, 'publisher/plugin/1.0.0/skills/actual', 'actual');
  skill(root, 'publisher/plugin/1.0.0/packages/cli/tests/fixtures/skills/fake', 'fake');
  const c = scan({ ...options, roots: [{ path: root, source: 'plugin', provider: 'codex', managed: true }] });
  assert.deepEqual(c.skills.map(s => s.name), ['actual']);
  assert.equal(c.skills[0].status, 'unknown');
  assert.equal(c.incomplete, false);
});

test('external SKILL.md symlinks are not read as metadata', t => {
  const { root, options, home } = fixture(t);
  const dir = skill(root, 'alpha');
  fs.writeFileSync(path.join(home, 'external.md'), '---\nname: MUST_NOT_READ_EXTERNAL\ndescription: external\n---\n');
  fs.unlinkSync(path.join(dir, 'SKILL.md'));
  fs.symlinkSync(path.join(home, 'external.md'), path.join(dir, 'SKILL.md'));
  const c = scan(options);
  assert.ok(!JSON.stringify(c).includes('MUST_NOT_READ_EXTERNAL'));
  assert.ok(c.issues.some(i => i.code === 'OUTSIDE_SKILL_METADATA'));
});
