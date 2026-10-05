import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { audit, inspect, scan } from './catalog.js';
import { apply, history, plan, readPlan, restore, savePlan } from './changes.js';
import { digest, GoblinError } from './files.js';
import type { Options, Skill } from './types.js';

const MAX_BYTES = 8192;
function result(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}
function size(value: unknown) { return Buffer.byteLength(JSON.stringify(result(value))); }
function bounded(value: unknown) {
  if (size(value) > MAX_BYTES - 128) throw new GoblinError('RESPONSE_TOO_LARGE', 'Use paginated scan/history instead.');
  return result(value);
}
function guard(fn: () => unknown) {
  try { return bounded(fn()); }
  catch (e: any) { return result({ error: e instanceof GoblinError ? e.code : 'OPERATION_FAILED', message: String(e.message ?? 'Operation failed').slice(0, 240) }, true); }
}
function metadata(s: Skill) {
  return { id: s.id, name: s.name, path: s.path, source: s.source, provider: s.provider,
    status: s.status, managed: s.managed, last_used_at: s.last_used_at, usage_count: s.usage_count };
}
function page(items: unknown[], cursor?: string, limit = 20, extra: Record<string, unknown> = {}) {
  const snapshot = digest(JSON.stringify(items));
  let offset = 0;
  if (cursor) {
    if (cursor.length > 512) throw new GoblinError('INVALID_CURSOR');
    let parsed: any;
    try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new GoblinError('INVALID_CURSOR'); }
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > items.length) throw new GoblinError('INVALID_CURSOR');
    if (parsed.snapshot !== snapshot) throw new GoblinError('STALE_CURSOR');
    offset = parsed.offset;
  }
  const rows = items.slice(offset, offset + limit);
  const response = () => ({ ...extra, items: rows, total: items.length,
    next_cursor: offset + rows.length < items.length
      ? Buffer.from(JSON.stringify({ offset: offset + rows.length, snapshot })).toString('base64url') : null });
  while (rows.length && size(response()) > MAX_BYTES - 128) rows.pop();
  if (!rows.length && offset < items.length) throw new GoblinError('ROW_TOO_LARGE', 'Inspect the local CLI output.');
  return response();
}
const paging = { cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(20).optional() };
const readOnly = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export async function startMcp(options: Options): Promise<void> {
  const server = new McpServer({ name: 'goblin', version: '0.0.1' });
  server.registerTool('goblin_scan', { description: 'Scan local skills; paginated metadata, usage unknown without evidence.', inputSchema: paging, annotations: readOnly },
    ({ cursor, limit }) => guard(() => { const c = scan(options); return page(c.skills.map(metadata), cursor, limit, { scanned_at: c.scanned_at, issue_count: c.issues.length, incomplete: c.incomplete }); }));
  server.registerTool('goblin_inspect', { description: 'Inspect one skill by ID or unique name; metadata only.', inputSchema: { selector: z.string().min(1).max(4096) }, annotations: readOnly },
    ({ selector }) => guard(() => { const s = inspect(scan(options), selector); return { ...metadata(s), canonical_path: s.canonical_path, link_target: s.link_target, metadata_valid: s.metadata_valid, usage_source: null, coverage: 'unknown' }; }));
  server.registerTool('goblin_tidy', { description: 'Find duplicates, shared references and broken metadata; no changes.', inputSchema: paging, annotations: readOnly },
    ({ cursor, limit }) => guard(() => page(audit(scan(options)), cursor, limit)));
  server.registerTool('goblin_plan', { description: 'Plan a reversible skill change. Returns affected paths; does not change skills.',
    inputSchema: { action: z.enum(['remove', 'disable', 'enable']).optional(), selector: z.string().min(1).max(4096).optional(), plan_id: z.string().max(64).optional(), ...paging }, annotations: write },
    ({ action, selector, plan_id, cursor, limit }) => guard(() => {
      let p;
      if (plan_id) p = readPlan(options, plan_id);
      else {
        if (!action || !selector || cursor) throw new GoblinError('INVALID_ARGUMENT', 'Provide action and selector, or plan_id to page an existing plan.');
        p = plan(options, action, selector); savePlan(options, p);
      }
      return page(p.affected, cursor, limit, { plan_id: p.id, action: p.action, name: p.name, reversible: true, config_change: !!p.config });
    }));
  server.registerTool('goblin_apply', { description: 'Apply the reviewed plan ID; stale plans are rejected.', inputSchema: { plan_id: z.string().max(64) }, annotations: write },
    ({ plan_id }) => guard(() => { const c = apply(options, readPlan(options, plan_id)); return { change_id: c.id, state: c.state, affected_count: c.affected.length, restart_codex: !!c.config }; }));
  server.registerTool('goblin_restore', { description: 'Restore a change ID, including interrupted changes; never overwrite conflicts.',
    inputSchema: { change_id: z.string().max(64), dry_run: z.boolean().optional() }, annotations: write },
    ({ change_id, dry_run }) => guard(() => { const c = restore(options, change_id, dry_run); return { change_id: c.id, state: c.state, dry_run: !!dry_run, affected_count: c.affected.length }; }));
  server.registerTool('goblin_history', { description: 'List compact change history, including changes needing recovery.', inputSchema: paging, annotations: readOnly },
    ({ cursor, limit }) => guard(() => page(history(options).map(c => ({ change_id: c.id, action: c.action, name: c.name, state: c.state, created_at: c.created_at, affected_count: c.affected.length })), cursor, limit)));
  await server.connect(new StdioServerTransport());
}
