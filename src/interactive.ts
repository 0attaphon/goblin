import readline from 'node:readline';
import { scan } from './catalog.js';
import { apply, plan } from './changes.js';
import { GoblinError } from './files.js';
import type { Catalog, Change, ChangePlan, Options, Skill } from './types.js';

const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

function blocked(catalog: Catalog, skill: Skill, allowDisabled = false): string | null {
  if (catalog.incomplete) return 'scan incomplete';
  if (catalog.issues.some(i => i.code === 'INVALID_CODEX_CONFIG')) return 'invalid Codex config';
  if (skill.managed) return 'managed / system / synced';
  if (skill.provider !== 'codex') return 'native disable supports Codex only';
  if (skill.status === 'disabled' && !allowDisabled) return 'already disabled';
  if (!skill.fingerprint || !skill.metadata_valid) return 'unreadable or invalid skill';
  return null;
}

async function selectSkills(catalog: Catalog): Promise<Skill[] | null> {
  const input = process.stdin, output = process.stdout;
  if (!catalog.skills.length) { console.log('No skills found. No changes made.'); return []; }
  if ((output.columns ?? 80) < 30 || (output.rows ?? 24) < 12)
    throw new GoblinError('TERMINAL_TOO_SMALL', 'Enlarge the terminal or use scan --no-interactive.');
  const reasons = catalog.skills.map(s => blocked(catalog, s));
  const selected = new Set<number>();
  let cursor = 0;
  const wasRaw = input.isRaw, wasFlowing = input.readableFlowing === true;
  return new Promise((resolve, reject) => {
    // Bound every rendered line: names and paths may contain terminal controls.
    function line(text: string): string {
      const limit = Math.max(10, (output.columns ?? 80) - 2);
      let width = 0, result = '';
      for (const char of clean(text)) {
        const code = char.codePointAt(0)!;
        const size = code >= 0x1100 && (code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7af || code >= 0xf900 && code <= 0xfaff || code >= 0xff01 && code <= 0xff60 || code >= 0x1f000) ? 2 : 1;
        if (width + size > limit - 1) return result + '…';
        result += char; width += size;
      }
      return result;
    }
    function render(): void {
      const height = Math.max(1, (output.rows ?? 24) - 9);
      const start = Math.min(Math.max(0, cursor - Math.floor(height / 2)), Math.max(0, catalog.skills.length - height));
      const current = catalog.skills[cursor];
      const lines = [
        'Goblin — Select skills to disable in Codex',
        `Selected: ${selected.size} | ${cursor + 1}/${catalog.skills.length} | Usage: 30 days, partial evidence`,
        '↑↓ Move · Space Check · Enter Submit · Esc Cancel',
        '',
        ...catalog.skills.slice(start, start + height).map((s, index) => {
          const i = start + index, mark = reasons[i] ? '–' : selected.has(i) ? 'x' : ' ';
          return `${i === cursor ? '>' : ' '} [${mark}] ${s.usage_rank ? `#${s.usage_rank} ` : ''}${s.name} (${s.usage_count ?? 'unknown'} calls, ${s.status})${reasons[i] ? ` — ${reasons[i]}` : ''}`;
        }),
        '',
        `ID: ${current.id} | ${current.provider} / ${current.source}`,
        `Path: ${current.path}`,
        `Last used: ${current.last_used_at ?? 'unknown'} | Observed calls: ${current.usage_count ?? 'unknown'}`,
        `Enter disables ${selected.size} selected. Restart Codex afterward.`,
      ];
      output.write('\x1b[H\x1b[2J' + lines.map(line).join('\r\n'));
    }
    function cleanup(): void {
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      output.removeListener('resize', render);
      input.setRawMode(wasRaw);
      if (!wasFlowing) input.pause();
      output.write('\x1b[?25h\x1b[?1049l');
    }
    function onEnd(): void { cleanup(); resolve(null); }
    function onError(error: Error): void { cleanup(); reject(error); }
    function onKey(_: string, key: { name?: string; ctrl?: boolean }): void {
      if (key.name === 'escape' || key.ctrl && key.name === 'c') { onEnd(); return; }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup(); resolve([...selected].sort((a, b) => a - b).map(i => catalog.skills[i])); return;
      }
      if (key.name === 'up') cursor = Math.max(0, cursor - 1);
      if (key.name === 'down') cursor = Math.min(catalog.skills.length - 1, cursor + 1);
      if (key.name === 'space' && !reasons[cursor]) {
        if (selected.has(cursor)) selected.delete(cursor); else selected.add(cursor);
      }
      render();
    }
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.on('end', onEnd);
    input.on('error', onError);
    output.on('resize', render);
    input.resume();
    output.write('\x1b[?1049h\x1b[?25l');
    render();
  });
}

function assertFresh(options: Options, selected: Skill[], disabledByUs = new Set<string>()): Catalog {
  const fresh = scan(options, false);
  for (const old of selected) {
    const current = fresh.skills.find(s => s.id === old.id);
    const covered = disabledByUs.has(old.canonical_path) && current?.status === 'disabled';
    if (!current || current.fingerprint !== old.fingerprint || current.canonical_path !== old.canonical_path
      || current.skill_file !== old.skill_file || !covered && current.status !== old.status || blocked(fresh, current, covered))
      throw new GoblinError('STALE_SELECTION', 'Skills changed while selecting. Scan again.');
  }
  return fresh;
}

export async function interactiveScan(options: Options, catalog: Catalog): Promise<void> {
  const selected = await selectSkills(catalog);
  if (selected === null) { console.log('Cancelled. No changes made.'); return; }
  if (!selected.length) { console.log('Nothing selected. No changes made.'); return; }
  assertFresh(options, selected);
  // Preflight every selection before the first write. Apply fresh plans in
  // sequence because each config edit changes the next plan's before snapshot.
  for (const s of selected) plan(options, 'disable', s.id);
  const completed: Change[] = [];
  const disabledByUs = new Set<string>();
  let satisfied = 0, attempted: ChangePlan | undefined;
  let failure: unknown;
  try {
    for (const s of selected) {
      const fresh = assertFresh(options, [s], disabledByUs);
      if (fresh.skills.find(item => item.id === s.id)?.status === 'disabled') { satisfied++; continue; }
      attempted = plan(options, 'disable', s.id);
      completed.push(apply(options, attempted));
      attempted = undefined;
      disabledByUs.add(s.canonical_path);
      satisfied++;
    }
  } catch (error) { failure = error; }
  console.log(`Disabled ${satisfied} of ${selected.length} selected skills.`);
  for (const change of completed) console.log(`  ${clean(change.name)} — ${change.id}`);
  const interrupted = failure instanceof GoblinError && failure.code === 'RECOVERY_REQUIRED'
    && attempted && failure.message.includes(`${attempted.id}:`) ? attempted : undefined;
  if (interrupted) console.error(`Interrupted change: ${interrupted.id}. Recover this first; its config write may have completed.`);
  const undo = [...(interrupted ? [interrupted] : []), ...completed.slice().reverse()];
  if (undo.length) {
    console.log('Restart Codex to load the new state.\nUndo in this order:');
    for (const c of undo) {
      const args = ['goblin', 'restore', c.id];
      const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
      if (options.home) args.push('--home', quote(options.home));
      if (options.dataDir) args.push('--data-dir', quote(options.dataDir));
      if (options.project) args.push('--project', quote(options.project));
      for (const r of options.roots ?? []) args.push('--root', quote(r.path));
      console.log(args.join(' '));
    }
  }
  if (failure) { console.error('Stopped. Remaining selected skills were not changed.'); throw failure; }
}
