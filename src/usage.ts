import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import type { Catalog, Options, Skill, UsageReport } from './types.js';
import { settings } from './files.js';

const MAX_BYTES = 256 * 1024 * 1024, MAX_FILE = 64 * 1024 * 1024;
const MAX_LINE = 2 * 1024 * 1024, MAX_FILES = 1000, MAX_EVENTS = 200000;
interface Invocation { id: string; time: string; files: string[]; names: string[]; commands?: string[]; cwd?: string }

function object(value: unknown): any {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value && typeof value === 'object' ? value : null;
}

// Recognize literal shell reads only, without expanding variables or running code.
// A successful && chain proves each read succeeded; semicolon/pipeline commands
// do not, so those commands are deliberately left unclassified.
function readFiles(command: string, cwd?: string): string[] {
  if (/[#\n\r;|<>`$]/.test(command)) return [];
  const files: string[] = [];
  for (const part of command.split('&&')) {
    const tokens: string[] = [];
    const expression = /\s*(?:'([^']*)'|"([^"\\]*)"|([^\s'"\\]+))/gy;
    let offset = 0;
    while (offset < part.length) {
      if (!part.slice(offset).trim()) break;
      if (tokens.length && !/\s/.test(part[offset])) return [];
      expression.lastIndex = offset;
      const match = expression.exec(part);
      if (!match) return [];
      tokens.push(match[1] ?? match[2] ?? match[3]); offset = expression.lastIndex;
    }
    if (!tokens.length) return [];
    const executable = path.basename(tokens[0]);
    let operands: string[];
    if (executable === 'cat') operands = tokens.slice(tokens[1] === '--' ? 2 : 1);
    else if (executable === 'sed' && tokens[1] === '-n' && /^\d+(?:,\d+)?p$/.test(tokens[2] ?? '')) operands = tokens.slice(3);
    else if (executable === 'head' && tokens[1] === '-n' && /^\d+$/.test(tokens[2] ?? '')) operands = tokens.slice(3);
    else return [];
    if (!operands.length || operands.some(p => p.startsWith('-') || /[&*?{}()]/.test(p))) return [];
    for (const file of operands) if (path.basename(file) === 'SKILL.md' && (path.isAbsolute(file) || cwd))
      files.push(path.resolve(cwd ?? '.', file));
  }
  return [...new Set(files)];
}

function literalObject(node: any): Record<string, unknown> | null {
  if (node?.type !== 'ObjectExpression') return null;
  const result: Record<string, unknown> = {};
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.computed || property.kind !== 'init' || property.value.type !== 'Literal') return null;
    const key = property.key.name ?? property.key.value;
    if (typeof key !== 'string') return null;
    result[key] = property.value.value;
  }
  return result;
}

function desktopCommands(source: string): { cmd: string; cwd?: string }[] | null {
  if (source.length > MAX_LINE) return null;
  let tree: any;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); } catch { return null; }
  const commands: { cmd: string; cwd?: string }[] = [];
  const bindings = new Set<string>();
  let unsupported = false;
  // Only unconditional expressions are inspected. Branches, loops, function
  // bodies and dynamic command construction cannot prove a call was executed.
  function expression(node: any, awaited = false): void {
    if (!node) return;
    if (node.type === 'AwaitExpression') { expression(node.argument, true); return; }
    if (node.type === 'ArrayExpression' && awaited) { node.elements.forEach((n: any) => expression(n, true)); return; }
    if (node.type === 'Identifier' && bindings.has(node.name)) return;
    if (node.type !== 'CallExpression') { unsupported = true; return; }
    const callee = node.callee;
    if (callee.type === 'MemberExpression' && callee.object.name === 'tools' && callee.property.name === 'exec_command' && !callee.computed) {
      if (!awaited) { unsupported = true; return; }
      const value = literalObject(node.arguments[0]);
      if (typeof value?.cmd !== 'string' || value.workdir !== undefined && typeof value.workdir !== 'string') { unsupported = true; return; }
      commands.push({ cmd: value.cmd, cwd: value.workdir as string | undefined }); return;
    }
    // text/notify and Promise.all/allSettled are known wrappers. Arbitrary
    // functions might not evaluate their command argument in the intended way.
    if (callee.type === 'Identifier' && ['text', 'notify'].includes(callee.name))
      node.arguments.forEach((arg: any) => expression(arg));
    else if (awaited && callee.type === 'MemberExpression' && callee.object.name === 'Promise' && ['all', 'allSettled'].includes(callee.property.name))
      node.arguments.forEach((arg: any) => expression(arg, true));
    else unsupported = true;
  }
  for (const statement of tree.body) {
    if (statement.type === 'ExpressionStatement') expression(statement.expression);
    else if (statement.type === 'VariableDeclaration') statement.declarations.forEach((d: any) => {
      const before = commands.length; expression(d.init);
      if (commands.length > before && d.id.type === 'Identifier') bindings.add(d.id.name);
    });
    else if (statement.type !== 'EmptyStatement') unsupported = true;
  }
  return unsupported ? null : commands;
}

function success(output: unknown): boolean {
  const value = object(output);
  if (value && Object.hasOwn(value, 'exit_code')) return value.exit_code === 0;
  if (typeof output === 'string') {
    // Older Codex terminal output keeps completion status in its header.
    const header = output.split(/\n(?:Output|Final output):/)[0];
    return /^Process exited with code 0\s*$/m.test(header);
  }
  return false;
}

export function observeUsage(options: Options, catalog: Catalog): void {
  const config = settings(options), end = Date.parse(catalog.scanned_at), start = end - 30 * 86400000;
  const report: UsageReport = { observation_start: new Date(start).toISOString(), observation_end: catalog.scanned_at,
    days: 30, logs_scanned: 0, bytes_scanned: 0, observed_calls: 0, read_issues: 0, limit_reached: false, coverage: 'partial' };
  catalog.usage = report;
  const byFile = new Map<string, Set<string>>(), byName = new Map<string, Set<string>>();
  const groups = new Map<string, Skill[]>();
  for (const skill of catalog.skills) {
    const key = skill.canonical_path;
    groups.set(key, [...(groups.get(key) ?? []), skill]);
    for (const file of [skill.skill_file, path.join(key, 'SKILL.md')]) {
      const identities = byFile.get(file) ?? new Set(); identities.add(key); byFile.set(file, identities);
    }
    // Native Claude Skill calls may use the publisher prefix for plugin names.
    const names = new Set([skill.name]);
    const cache = skill.path.split(path.sep).lastIndexOf('cache');
    if (skill.source === 'plugin' && cache >= 0) {
      const plugin = skill.path.split(path.sep)[cache + 2];
      if (plugin) names.add(`${plugin}:${skill.name}`);
    }
    for (const name of names) {
      if (skill.provider !== 'claude-code') continue;
      const identities = byName.get(name) ?? new Set(); identities.add(key); byName.set(name, identities);
    }
  }
  const counts = new Map<string, { count: number; last: string; sources: Set<string> }>();
  const seen = new Set<string>();
  function record(call: Invocation, source: string, files = call.files): void {
    const identities = new Set<string>();
    for (const file of files) for (const key of byFile.get(file) ?? []) identities.add(key);
    for (const name of call.names) {
      const matches = byName.get(name);
      if (matches?.size === 1) identities.add([...matches][0]);
    }
    if (!identities.size || seen.has(`${source}:${call.id}:${call.time}`)) return;
    seen.add(`${source}:${call.id}:${call.time}`); report.observed_calls++;
    for (const key of identities) {
      const entry = counts.get(key) ?? { count: 0, last: call.time, sources: new Set<string>() };
      entry.count++; if (call.time > entry.last) entry.last = call.time;
      entry.sources.add(source); counts.set(key, entry);
    }
  }
  const files: { file: string; source: string; modified: number }[] = [];
  let visited = 0;
  function discover(folder: string, source: string, depth = 0): void {
    if (++visited > 20000 || depth > 12) { report.limit_reached = true; return; }
    try {
      if (fs.lstatSync(folder).isSymbolicLink()) { report.read_issues++; return; }
      for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
        if (++visited > 20000) { report.limit_reached = true; break; }
        if (item.isSymbolicLink()) continue;
        const file = path.join(folder, item.name);
        if (item.isDirectory()) discover(file, source, depth + 1);
        else if (item.isFile() && item.name.endsWith('.jsonl')) {
          const stat = fs.statSync(file);
          // Old files can contain valid recent event timestamps; timestamps,
          // not mtimes, determine the observation window. mtime orders budgets.
          if (stat.size > MAX_FILE) { report.limit_reached = true; continue; }
          files.push({ file, source, modified: stat.mtimeMs });
        }
        if (visited > 20000) break;
      }
    } catch (error: any) { if (error.code !== 'ENOENT') report.read_issues++; }
  }
  discover(path.join(config.home, '.codex', 'sessions'), 'codex-session-log');
  discover(path.join(config.home, '.codex', 'archived_sessions'), 'codex-session-log');
  discover(path.join(config.home, '.claude', 'projects'), 'claude-session-log');
  files.sort((a, b) => b.modified - a.modified || a.file.localeCompare(b.file));
  let events = 0;
  for (const file of files) {
    if (report.logs_scanned >= MAX_FILES || report.bytes_scanned >= MAX_BYTES || events >= MAX_EVENTS) { report.limit_reached = true; break; }
    const calls = new Map<string, Invocation>();
    const completedSkills = new Map<string, Invocation>();
    const skillPaths = new Map<string, string>();
    let cwd: string | undefined;
    function event(line: string): void {
      if (++events > MAX_EVENTS) { report.limit_reached = true; return; }
      let value: any;
      try { value = JSON.parse(line); } catch { report.read_issues++; return; }
      const payload = value.payload;
      if (value.type === 'session_meta' && typeof payload?.cwd === 'string') cwd = payload.cwd;
      if (typeof value.cwd === 'string') cwd = value.cwd;
      const time = Date.parse(value.timestamp), inWindow = Number.isFinite(time) && time >= start && time <= end;
      const iso = inWindow ? new Date(time).toISOString() : '';
      if (file.source === 'codex-session-log' && payload) {
        const id = payload.call_id;
        if (typeof id !== 'string') return;
        if (['function_call', 'custom_tool_call'].includes(payload.type)) {
          if (!inWindow) return;
          const args = object(payload.arguments) ?? {};
          if (payload.name === 'exec_command' && typeof args.cmd === 'string') {
            calls.set(id, { id: id, time: iso, files: readFiles(args.cmd, args.workdir ?? cwd), names: [] });
          } else if (payload.name === 'read_file' && typeof (args.path ?? args.file_path) === 'string') {
            const filePath = args.path ?? args.file_path;
            calls.set(id, { id: id, time: iso, files: path.isAbsolute(filePath) ? [filePath] : cwd ? [path.resolve(cwd, filePath)] : [], names: [] });
          } else if (payload.name === 'exec' && typeof payload.input === 'string') {
            const commands = desktopCommands(payload.input);
            if (commands?.length) calls.set(id, { id: id, time: iso,
              files: commands.flatMap(c => readFiles(c.cmd, c.cwd ?? cwd)), names: [], commands: commands.map(c => c.cmd), cwd });
          }
        } else if (['function_call_output', 'custom_tool_call_output'].includes(payload.type)) {
          const call = calls.get(id); if (!call) return;
          calls.delete(id);
          if (call.commands) {
            const outputs: any[] = [];
            if (Array.isArray(payload.output)) for (const block of payload.output) {
              const result = object(block.text);
              const actual = result?.status === 'fulfilled' ? result.value : result;
              if (actual && Object.hasOwn(actual, 'exit_code')) outputs.push(actual);
            }
            // Correlation must be unambiguous; if a wrapper omitted/reordered
            // results or yielded, abstain instead of assigning success blindly.
            if (outputs.length === call.commands.length && outputs.every(success)) record(call, file.source);
          } else if (success(payload.output)) record(call, file.source);
        }
      } else if (file.source === 'claude-session-log') {
        const content = value.message?.content;
        // Claude emits the loaded skill directory as trusted meta linked to
        // the same tool-use ID. This disambiguates cached plugin versions.
        if (inWindow && value.isMeta === true && typeof value.sourceToolUseID === 'string') {
          const text = typeof content === 'string' ? content : Array.isArray(content)
            ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '';
          const match = /^Base directory for this skill: ([^\r\n]+)(?:\r?\n|$)/.exec(text);
          if (match && path.isAbsolute(match[1])) skillPaths.set(value.sourceToolUseID, path.join(match[1], 'SKILL.md'));
        }
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type === 'tool_use' && inWindow && typeof block.id === 'string') {
            const input = block.input ?? {};
            const call: Invocation = { id: block.id, time: iso, files: [], names: [] };
            if (block.name === 'Skill' && typeof input.skill === 'string') call.names = [input.skill];
            else if (block.name === 'Read' && typeof input.file_path === 'string' && (path.isAbsolute(input.file_path) || cwd)) call.files = [path.resolve(cwd ?? '.', input.file_path)];
            else if (block.name === 'Bash' && typeof input.command === 'string') call.files = readFiles(input.command, cwd);
            else continue;
            calls.set(block.id, call);
          } else if (block.type === 'tool_result') {
            const call = calls.get(block.tool_use_id); if (!call) continue;
            calls.delete(block.tool_use_id);
            if (block.is_error !== true) {
              if (call.names.length) completedSkills.set(block.tool_use_id, call);
              else record(call, file.source);
            }
          }
        }
      }
    }
    let fd: number | undefined;
    try {
      if (fs.lstatSync(file.file).isSymbolicLink()) { report.read_issues++; continue; }
      fd = fs.openSync(file.file, 'r'); report.logs_scanned++;
      const buffer = Buffer.alloc(65536);
      let pending = Buffer.alloc(0), dropping = false, n: number;
      while (report.bytes_scanned < MAX_BYTES && events < MAX_EVENTS && (n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, MAX_BYTES - report.bytes_scanned), null)) > 0) {
        report.bytes_scanned += n;
        let data = Buffer.concat([pending, buffer.subarray(0, n)]), offset = 0, newline: number;
        while ((newline = data.indexOf(10, offset)) !== -1) {
          const row = data.subarray(offset, newline);
          if (!dropping && row.length <= MAX_LINE && row.length) event(row.toString('utf8'));
          else if (!dropping && row.length > MAX_LINE) report.limit_reached = true;
          dropping = false; offset = newline + 1;
          if (events >= MAX_EVENTS) break;
        }
        pending = data.subarray(offset);
        if (pending.length > MAX_LINE) { pending = Buffer.alloc(0); dropping = true; report.limit_reached = true; }
      }
      if (!dropping && pending.length && events < MAX_EVENTS) event(pending.toString('utf8'));
      if (report.bytes_scanned >= MAX_BYTES || events >= MAX_EVENTS) report.limit_reached = true;
      for (const [id, call] of completedSkills) {
        const exact = skillPaths.get(id);
        record(exact ? { ...call, names: [], files: [exact] } : call, file.source);
      }
    } catch { report.read_issues++; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  const ranking = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]));
  for (const [index, [key, usage]] of ranking.entries()) for (const skill of groups.get(key) ?? []) {
    skill.usage_count = usage.count; skill.last_used_at = usage.last; skill.usage_rank = index + 1;
    skill.usage_source = [...usage.sources].sort().join(','); skill.coverage = 'partial';
    skill.observation_start = report.observation_start; skill.observation_end = report.observation_end;
  }
  catalog.skills.sort((a, b) => (a.usage_rank ?? Infinity) - (b.usage_rank ?? Infinity) || a.path.localeCompare(b.path));
}
