import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, skill } from './helpers.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
function run(options, ...args) {
  return spawnSync(process.execPath, [cli, ...args, '--root', options.roots[0].path, '--data-dir', options.dataDir, '--home', options.home], { encoding: 'utf8' });
}
async function connect(t, options) {
  const client = new Client({ name: 'goblin-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cli, 'mcp', '--root', options.roots[0].path, '--data-dir', options.dataDir, '--home', options.home], stderr: 'pipe' });
  await client.connect(transport);
  t.after(async () => { await client.close(); });
  return client;
}
const data = result => JSON.parse(result.content[0].text);

test('CLI scan shows details and JSON omits skill bodies and reports unknown usage', t => {
  const { root, options } = fixture(t);
  const dir = skill(root, 'alpha', 'alpha', 'SECRET_BODY_MUST_STAY_LOCAL');
  const human = run(options, 'scan');
  assert.equal(human.status, 0, human.stderr);
  for (const label of ['ID', 'NAME', 'LAST USED', 'USES']) assert.ok(human.stdout.includes(label));
  assert.ok(!human.stdout.includes(dir));
  assert.ok(human.stdout.includes('unknown'));
  const json = run(options, 'scan', '--json');
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).skills[0].name, 'alpha');
  assert.equal(JSON.parse(json.stdout).skills[0].path, dir);
  assert.ok(!json.stdout.includes('SECRET_BODY_MUST_STAY_LOCAL'));
});

test('CLI remove dry-run does not write state and actual removal returns a usable change ID', t => {
  const { root, options } = fixture(t);
  const dir = skill(root, 'alpha');
  const dry = run(options, 'remove', 'alpha', '--dry-run', '--json');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(options.dataDir), false);
  const result = run(options, 'remove', 'alpha', '--json');
  assert.equal(result.status, 0, result.stderr);
  const id = JSON.parse(result.stdout).change_id;
  assert.equal(fs.existsSync(dir), false);
  const restored = run(options, 'restore', id);
  assert.equal(restored.status, 0, restored.stderr);
  assert.ok(fs.existsSync(dir));
});

test('CLI setup prints an absolute executable configuration and rejects unknown flags', t => {
  const { options } = fixture(t);
  const result = run(options, 'setup', 'claude-desktop', '--print');
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.mcpServers.goblin.command, process.execPath);
  assert.equal(config.mcpServers.goblin.args[0], cli);
  assert.equal(run(options, 'scan', '--not-a-flag').status, 1);
  assert.equal(run(options, 'least-used').status, 1);
});

test('MCP scan paginates metadata, tool definitions are fixed, and removal requires a plan', async t => {
  const { root, options } = fixture(t);
  for (let i = 0; i < 35; i++) skill(root, `skill-${i}`, `skill-${i}`, 'BODY_NOT_IN_CONTEXT');
  const client = await connect(t, options);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 7);
  const first = await client.callTool({ name: 'goblin_scan', arguments: {} });
  assert.equal(data(first).items.length, 20);
  assert.ok(data(first).next_cursor);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 8192);
  assert.ok(!JSON.stringify(first).includes('BODY_NOT_IN_CONTEXT'));
  const second = await client.callTool({ name: 'goblin_scan', arguments: { cursor: data(first).next_cursor } });
  assert.equal(data(second).items.length, 15);
  assert.equal(data(second).next_cursor, null);
  const p = data(await client.callTool({ name: 'goblin_plan', arguments: { action: 'remove', selector: 'skill-0' } }));
  assert.equal(fs.existsSync(path.join(root, 'skill-0')), true);
  const changed = data(await client.callTool({ name: 'goblin_apply', arguments: { plan_id: p.plan_id } }));
  assert.equal(changed.state, 'applied');
  assert.equal(fs.existsSync(path.join(root, 'skill-0')), false);
  await client.callTool({ name: 'goblin_restore', arguments: { change_id: changed.change_id } });
  assert.ok(fs.existsSync(path.join(root, 'skill-0')));
  assert.deepEqual((await client.listTools()).tools, tools.tools);
});

test('MCP rejects stale catalog cursors and bounds unusually long metadata', async t => {
  const { root, options } = fixture(t);
  for (let i = 0; i < 25; i++) skill(root, `long-${i}`, 'ก'.repeat(200));
  const client = await connect(t, options);
  const first = await client.callTool({ name: 'goblin_scan', arguments: {} });
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 8192);
  assert.ok(data(first).items.length < 20);
  assert.ok(data(first).next_cursor);
  skill(root, 'new');
  const next = await client.callTool({ name: 'goblin_scan', arguments: { cursor: data(first).next_cursor } });
  assert.equal(next.isError, true);
  assert.equal(data(next).error, 'STALE_CURSOR');
});
