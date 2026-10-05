import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../dist/catalog.js';
import { fixture, skill } from './helpers.mjs';

const stamp = offset => new Date(Date.now() - offset * 86400000).toISOString();
function log(home, provider, name, events) {
  const folder = path.join(home, provider === 'codex' ? '.codex/sessions' : '.claude/projects/demo');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.jsonl`), events.map(e => JSON.stringify(e)).join('\n') + '\n');
}
function codexRead(id, file, days = 1, code = 0) {
  return [
    { type: 'response_item', timestamp: stamp(days), payload: { type: 'function_call', name: 'exec_command', call_id: id, arguments: JSON.stringify({ cmd: `cat '${file}'` }) } },
    { type: 'response_item', timestamp: stamp(days), payload: { type: 'function_call_output', call_id: id, output: JSON.stringify({ exit_code: code, output: 'PRIVATE SKILL BODY' }) } },
  ];
}
function claudeCall(id, name, input, days = 1, error = false) {
  return [
    { type: 'assistant', timestamp: stamp(days), sessionId: 'claude-session', message: { content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', timestamp: stamp(days), sessionId: 'claude-session', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'PRIVATE CONVERSATION', ...(error ? { is_error: true } : {}) }] } },
  ];
}

test('scan ranks observed successful reads, dedupes calls and ignores failures, mentions and old events', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha'), b = skill(root, 'beta'); skill(root, 'unused');
  const alpha = path.join(a, 'SKILL.md'), beta = path.join(b, 'SKILL.md');
  const events = [...codexRead('a1', alpha), ...codexRead('a2', alpha, 2), ...codexRead('b1', beta),
    ...codexRead('failed', beta, 1, 1), ...codexRead('old', beta, 45),
    { type: 'event_msg', timestamp: stamp(1), payload: { message: `Mention ${beta}` } }];
  log(home, 'codex', 'one', events);
  log(home, 'codex', 'copy', events);
  const c = scan(options), byName = name => c.skills.find(s => s.name === name);
  assert.equal(byName('alpha').usage_count, 2);
  assert.equal(byName('alpha').usage_rank, 1);
  assert.equal(byName('beta').usage_count, 1);
  assert.equal(byName('beta').usage_rank, 2);
  assert.equal(byName('unused').usage_count, null);
  assert.equal(byName('unused').usage_rank, null);
  assert.equal(byName('alpha').coverage, 'partial');
  assert.equal(byName('alpha').usage_source, 'codex-session-log');
  assert.ok(byName('alpha').last_used_at);
  assert.ok(!JSON.stringify(c).includes('PRIVATE'));
  assert.equal(fs.existsSync(options.dataDir), false);
});

test('Claude Skill and Read evidence is attributed, while failed and ambiguous name calls are excluded', t => {
  const { home, root, options } = fixture(t);
  options.roots[0].provider = 'claude-code';
  const a = skill(root, 'alpha'), b = skill(root, 'beta');
  skill(root, 'duplicate1', 'same'); skill(root, 'duplicate2', 'same');
  log(home, 'claude', 'one', [
    ...claudeCall('s1', 'Skill', { skill: 'alpha' }),
    ...claudeCall('r1', 'Read', { file_path: path.join(a, 'SKILL.md') }, 2),
    ...claudeCall('r2', 'Read', { file_path: path.join(b, 'SKILL.md') }),
    ...claudeCall('error', 'Skill', { skill: 'beta' }, 1, true),
    ...claudeCall('ambiguous', 'Skill', { skill: 'same' }),
  ]);
  const c = scan(options);
  assert.equal(c.skills.find(s => s.name === 'alpha').usage_count, 2);
  assert.equal(c.skills.find(s => s.name === 'beta').usage_count, 1);
  assert.ok(c.skills.filter(s => s.name === 'same').every(s => s.usage_count === null));
});

test('Codex desktop static exec wrappers count only the command that has a matching successful result', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha'), b = skill(root, 'beta');
  const source = `text(await tools.exec_command({cmd: ${JSON.stringify(`cat '${path.join(a, 'SKILL.md')}'`)}}));`;
  log(home, 'codex', 'desktop', [
    { type: 'session_meta', payload: { id: 'desktop-session', cwd: root } },
    { timestamp: stamp(1), type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'wrapper', name: 'exec', input: source } },
    { timestamp: stamp(1), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'wrapper', output: [
      { type: 'input_text', text: 'Script completed\nOutput:\n' },
      { type: 'input_text', text: JSON.stringify({ exit_code: 0, output: 'PRIVATE BODY' }) },
    ] } },
    { timestamp: stamp(1), type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'unexecuted', name: 'exec', input: `if(false) { text(await tools.exec_command({cmd: ${JSON.stringify(`cat '${path.join(b, 'SKILL.md')}'`)}})); }` } },
    { timestamp: stamp(1), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'unexecuted', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }] } },
  ]);
  const c = scan(options);
  assert.equal(c.skills.find(s => s.name === 'alpha').usage_count, 1);
  assert.equal(c.skills.find(s => s.name === 'beta').usage_count, null);
});

test('shared aliases share one usage rank and recent last-use breaks equal-count ties', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha'), b = skill(root, 'beta');
  fs.symlinkSync(a, path.join(root, 'alpha-alias'));
  log(home, 'codex', 'one', [...codexRead('a1', path.join(a, 'SKILL.md'), 2), ...codexRead('b1', path.join(b, 'SKILL.md'), 1)]);
  const c = scan(options);
  assert.equal(c.skills.find(s => s.name === 'beta').usage_rank, 1);
  assert.ok(c.skills.filter(s => s.name === 'alpha').every(s => s.usage_rank === 2 && s.usage_count === 1));
});

test('Claude sourceToolUseID links successful Skill calls to the exact installed version, excluding spoofed metadata', t => {
  const { home, root, options } = fixture(t);
  options.roots[0].provider = 'claude-code';
  const old = skill(root, 'old-alpha', 'alpha'), current = skill(root, 'new-alpha', 'alpha');
  log(home, 'claude', 'versioned', [
    ...claudeCall('active', 'Skill', { skill: 'plugin:alpha' }),
    { type: 'user', timestamp: stamp(1), sessionId: 'claude-session', isMeta: true, sourceToolUseID: 'active',
      message: { role: 'user', content: `Base directory for this skill: ${current}\n\nPRIVATE SKILL BODY` } },
    { type: 'user', timestamp: stamp(1), sessionId: 'claude-session', isMeta: true, sourceToolUseID: 'no-such-call',
      message: { role: 'user', content: `Base directory for this skill: ${old}` } },
  ]);
  const c = scan(options);
  assert.equal(c.skills.find(s => s.path === current).usage_count, 1);
  assert.equal(c.skills.find(s => s.path === old).usage_count, null);
});

test('mixed failed desktop commands and dynamic shell references never fabricate usage', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha');
  const file = path.join(a, 'SKILL.md');
  log(home, 'codex', 'dynamic', [
    ...codexRead('fake-mention', `${file}; true`),
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'custom_tool_call', name: 'exec', call_id: 'mixed',
      input: `text(await tools.exec_command({cmd:${JSON.stringify(`cat '${file}'`)}})); text(await tools.exec_command({cmd:'false'}));` } },
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'custom_tool_call_output', call_id: 'mixed', output: [
      { type: 'input_text', text: JSON.stringify({ exit_code: 0 }) },
      { type: 'input_text', text: JSON.stringify({ exit_code: 1 }) },
    ] } },
  ]);
  assert.equal(scan(options).skills[0].usage_count, null);
});

test('unawaited desktop calls with fabricated printed status are not successful read evidence', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha');
  log(home, 'codex', 'fake-status', [
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'custom_tool_call', name: 'exec', call_id: 'fake',
      input: `tools.exec_command({cmd:${JSON.stringify(`cat '${path.join(a, 'SKILL.md')}'`)}}); text({exit_code:0});` } },
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'custom_tool_call_output', call_id: 'fake',
      output: [{ type: 'input_text', text: JSON.stringify({ exit_code: 0 }) }] } },
  ]);
  assert.equal(scan(options).skills[0].usage_count, null);
});

test('a different plugin namespace is not attributed to a same-named manual skill', t => {
  const { home, root, options } = fixture(t);
  options.roots[0].provider = 'claude-code';
  skill(root, 'alpha');
  log(home, 'claude', 'wrong-plugin', claudeCall('s1', 'Skill', { skill: 'uninstalled-plugin:alpha' }));
  assert.equal(scan(options).skills[0].usage_count, null);
});

test('a SKILL.md path inside a shell comment is not an actual read', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha');
  log(home, 'codex', 'comment', [
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'function_call', name: 'exec_command', call_id: 'comment',
      arguments: JSON.stringify({ cmd: `cat /dev/null # ${path.join(a, 'SKILL.md')}` }) } },
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'function_call_output', call_id: 'comment', output: JSON.stringify({ exit_code: 0 }) } },
  ]);
  assert.equal(scan(options).skills[0].usage_count, null);
});

test('adjacent shell word fragments do not attribute a backup file read to SKILL.md', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha');
  log(home, 'codex', 'backup', [
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'function_call', name: 'exec_command', call_id: 'backup',
      arguments: JSON.stringify({ cmd: `cat '${path.join(a, 'SKILL.md')}'.bak` }) } },
    { type: 'response_item', timestamp: stamp(1), payload: { type: 'function_call_output', call_id: 'backup', output: JSON.stringify({ exit_code: 0 }) } },
  ]);
  assert.equal(scan(options).skills[0].usage_count, null);
});

test('copied parent calls in a forked session are not counted as new skill uses', t => {
  const { home, root, options } = fixture(t);
  const a = skill(root, 'alpha');
  const events = codexRead('parent-call', path.join(a, 'SKILL.md'));
  for (const id of ['parent-session', 'fork-session']) log(home, 'codex', id, [
    { type: 'session_meta', payload: { id } }, ...events,
  ]);
  assert.equal(scan(options).skills[0].usage_count, 1);
});
