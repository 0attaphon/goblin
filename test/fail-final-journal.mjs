// Inject one OS write failure after the second real config edit. All other
// filesystem operations use Node's real implementation.
import fs from 'node:fs';
const rename = fs.renameSync;
let applied = 0;
fs.renameSync = function (from, to) {
  if (String(to).includes('/changes/') && String(to).endsWith('.json')) {
    const data = JSON.parse(fs.readFileSync(from, 'utf8'));
    if (data.state === 'applied' && ++applied === 2)
      throw Object.assign(new Error('Simulated journal write failure'), { code: 'EIO' });
  }
  return rename.call(fs, from, to);
};
