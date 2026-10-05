import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goblin-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'skills');
  fs.mkdirSync(root);
  const options = { home, dataDir: path.join(home, 'goblin-data'), roots: [{ path: root, provider: 'codex', source: 'manual', managed: false }] };
  return { home, root, options };
}

export function skill(root, folder, name = folder, body = 'Do the task.') {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\n${body}\n`);
  return dir;
}
