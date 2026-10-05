#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, inspect, scan } from './catalog.js';
import { apply, history, plan, restore } from './changes.js';
import { GoblinError, settings } from './files.js';
import type { Options, Provider, Skill } from './types.js';

const help = `Goblin 0.0.1 — Your little skill keeper.

Usage: goblin <command> [arguments] [options]

  scan / list                  Show ID, name, path, last use and count
  inspect <name-or-id>          Show metadata, shared target and capabilities
  tidy                         Report duplicates and broken references
  remove / stash <name-or-id>   Remove from discovery, retaining recoverable files
  restore <change-id>           Restore a removed/changed skill
  disable / enable <name-or-id> Change native Codex skill state
  history                      Show change IDs and recovery state
  mcp                          Start local stdio MCP server
  setup codex|claude-desktop --print  Print connection configuration

Options:
  --root <path>                Scan only this root (repeatable)
  --project <path>             Include this project's skill roots
  --provider / --app <name>     codex, claude-code, or custom
  --data-dir <path>            Archive/history directory outside skill roots
  --home <path>                Override home for testing or portable setups
  --json                       Machine-readable output
  --dry-run                    Preview remove/restore/disable/enable
  --version                    Print version

Unknown usage is not zero. No hooks or skill text are added.
`;

function clean(value: unknown): string { return String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' '); }
function table(skills: Skill[]): void {
  console.log(['ID', 'NAME', 'PATH', 'LAST USED', 'USES', 'STATUS', 'SOURCE'].join('\t'));
  for (const s of skills) console.log([s.id, s.name, s.path, 'unknown', 'unknown', s.status, s.source].map(clean).join('\t'));
}
function printJson(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--version')) { console.log('0.0.1'); return; }
  if (!args.length || args.includes('--help') || args[0] === 'help') { console.log(help); return; }
  const options: Options = {}, roots: string[] = [], positional: string[] = [];
  let json = false, dryRun = false, print = false, provider: Provider | undefined;
  const valueFlags = new Set(['--root', '--data-dir', '--home', '--project', '--provider', '--app']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (valueFlags.has(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new GoblinError('INVALID_ARGUMENT', `Missing value for ${arg}`);
      if (arg === '--root') roots.push(path.resolve(value));
      if (arg === '--data-dir') options.dataDir = value;
      if (arg === '--home') options.home = value;
      if (arg === '--project') options.project = value;
      if (arg === '--provider' || arg === '--app') {
        if (!['codex', 'claude-code', 'custom'].includes(value)) throw new GoblinError('INVALID_PROVIDER');
        provider = value as Provider;
      }
    } else if (arg === '--json') json = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--print') print = true;
    else if (arg.startsWith('-')) throw new GoblinError('INVALID_ARGUMENT', `Unknown option ${arg}`);
    else positional.push(arg);
  }
  const [command, target] = positional;
  if (positional.length > 2) throw new GoblinError('INVALID_ARGUMENT', 'Too many arguments.');
  if (roots.length) options.roots = roots.map(p => ({ path: p, provider: provider ?? 'codex', source: 'manual', managed: false }));
  settings(options);
  if (dryRun && !['remove', 'stash', 'restore', 'disable', 'enable'].includes(command)) throw new GoblinError('INVALID_ARGUMENT', '--dry-run is for changes only.');
  if (print && command !== 'setup') throw new GoblinError('INVALID_ARGUMENT', '--print is for setup only.');
  if (command === 'mcp') {
    if (target || json || dryRun || print) throw new GoblinError('INVALID_ARGUMENT');
    const { startMcp } = await import('./mcp.js'); await startMcp(options); return;
  }
  if (command === 'setup') {
    if (!print || !['codex', 'claude-desktop'].includes(target)) throw new GoblinError('INVALID_ARGUMENT', 'Use setup codex|claude-desktop --print.');
    const serverArgs = [fileURLToPath(import.meta.url), 'mcp'];
    for (const r of roots) serverArgs.push('--root', r);
    if (options.dataDir) serverArgs.push('--data-dir', path.resolve(options.dataDir));
    if (options.home) serverArgs.push('--home', path.resolve(options.home));
    if (options.project) serverArgs.push('--project', path.resolve(options.project));
    if (provider) serverArgs.push('--provider', provider);
    if (target === 'claude-desktop') printJson({ mcpServers: { goblin: { command: process.execPath, args: serverArgs } } });
    else console.log(`[mcp_servers.goblin]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(serverArgs)}`);
    return;
  }
  if (['scan', 'list', 'tidy'].includes(command)) {
    if (target) throw new GoblinError('INVALID_ARGUMENT');
    const catalog = scan(options);
    if (provider) catalog.skills = catalog.skills.filter(s => s.provider === provider);
    if (command === 'tidy') {
      const findings = audit(catalog);
      if (json) printJson({ findings, incomplete: catalog.incomplete });
      else { for (const f of findings) console.log([f.kind, f.ids.join(', '), f.path ?? ''].map(clean).join('\t')); console.log(`${findings.length} findings. No changes made.`); }
    } else if (json) printJson(catalog);
    else {
      table(catalog.skills);
      console.log(`\n${catalog.skills.length} entries. Usage: unknown (no verified usage adapter in 0.0.1).`);
      if (catalog.issues.length) console.error(`${catalog.issues.length} scan issues; use tidy or --json for details.`);
      if (catalog.incomplete) console.error('Scan incomplete: discovery limits reached.');
    }
    return;
  }
  if (command === 'inspect') {
    if (!target) throw new GoblinError('INVALID_ARGUMENT', 'Provide a name or ID.');
    const s = inspect(scan(options), target); printJson(s); return;
  }
  if (command === 'history') {
    if (target) throw new GoblinError('INVALID_ARGUMENT');
    const changes = history(options).map(c => ({ change_id: c.id, action: c.action, name: c.name, state: c.state, created_at: c.created_at, affected_count: c.affected.length }));
    if (json) printJson(changes); else { for (const c of changes) console.log([c.change_id, c.action, c.name, c.state].map(clean).join('\t')); if (!changes.length) console.log('No changes recorded.'); }
    return;
  }
  if (['remove', 'stash', 'disable', 'enable'].includes(command)) {
    if (!target) throw new GoblinError('INVALID_ARGUMENT', 'Provide a name or ID.');
    const action = command === 'stash' ? 'remove' : command as 'remove' | 'disable' | 'enable';
    if (provider && action !== 'remove' && provider !== 'codex') throw new GoblinError('UNSUPPORTED_PROVIDER');
    const p = plan(options, action, target);
    if (dryRun) { printJson({ dry_run: true, action, name: p.name, affected: p.affected, reversible: true, config_change: !!p.config }); return; }
    const c = apply(options, p);
    if (json) printJson({ change_id: c.id, state: c.state, affected: c.affected, reversible: true });
    else { console.log(`${action}: ${clean(c.name)} (${c.affected.length} entries). Recoverable.\nChange: ${c.id}\nUndo: goblin restore ${c.id}`); if (c.config) console.log('Restart Codex to load the new skill state.'); }
    return;
  }
  if (command === 'restore') {
    if (!target) throw new GoblinError('INVALID_ARGUMENT', 'Provide a change ID.');
    const c = restore(options, target, dryRun);
    if (json || dryRun) printJson({ change_id: c.id, state: c.state, dry_run: dryRun, affected: c.affected });
    else { console.log(`Restored ${clean(c.name)}. Change: ${c.id}`); if (c.config) console.log('Restart Codex to load the restored skill state.'); }
    return;
  }
  throw new GoblinError('UNKNOWN_COMMAND', `${command}. Run goblin --help.`);
}

main().catch((error: any) => {
  console.error(clean(error.message ?? 'Operation failed.'));
  process.exitCode = 1;
});
