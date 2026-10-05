import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
export class GoblinError extends Error {
    code;
    constructor(code, message = code) {
        super(`${code}: ${message}`);
        this.code = code;
    }
}
export const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
export function inside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
export function exists(file) {
    try {
        fs.lstatSync(file);
        return true;
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return false;
        throw e;
    }
}
export function physical(file) {
    if (exists(file))
        return fs.realpathSync(file);
    const parent = path.dirname(file);
    return parent === file ? file : path.join(physical(parent), path.basename(file));
}
export function settings(options = {}) {
    const home = path.resolve(options.home ?? os.homedir());
    const defaultData = process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Goblin')
        : path.join(home, '.local', 'share', 'goblin');
    const dataDir = physical(path.resolve(options.dataDir ?? process.env.GOBLIN_DATA_DIR ?? defaultData));
    const roots = options.roots ?? [
        { path: path.join(home, '.agents', 'skills'), provider: 'codex', source: 'user' },
        { path: path.join(home, '.claude', 'skills'), provider: 'claude-code', source: 'user' },
        { path: path.join(home, '.codex', 'skills'), provider: 'codex', source: 'legacy' },
        { path: path.join(home, '.codex', 'plugins', 'cache'), provider: 'codex', source: 'plugin', managed: true },
        { path: path.join(home, '.claude', 'plugins', 'cache'), provider: 'claude-code', source: 'plugin', managed: true },
    ];
    const resolved = roots.map(r => ({ ...r, path: path.resolve(r.path) }));
    if (options.project) {
        const project = path.resolve(options.project);
        resolved.push({ path: path.join(project, '.agents', 'skills'), provider: 'codex', source: 'project' });
        resolved.push({ path: path.join(project, '.claude', 'skills'), provider: 'claude-code', source: 'project' });
    }
    for (const root of resolved) {
        const rp = physical(root.path), dp = physical(dataDir);
        if (inside(rp, dp) || inside(dp, rp))
            throw new GoblinError('UNSAFE_DATA_DIR', 'State and skill roots must be separate.');
    }
    return { home, dataDir, roots: resolved.map(r => ({ ...r, physical_path: physical(r.path) })), configPath: path.join(home, '.codex', 'config.toml') };
}
export function fingerprint(file) {
    const hash = crypto.createHash('sha256');
    let count = 0, bytes = 0;
    function walk(current, relative, depth) {
        if (++count > 10000 || depth > 32)
            throw new GoblinError('FINGERPRINT_LIMIT', file);
        const stat = fs.lstatSync(current);
        hash.update(JSON.stringify([relative, stat.mode & 0o777, stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : 'file']));
        if (stat.isSymbolicLink()) {
            hash.update(fs.readlinkSync(current));
            return;
        }
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(current).sort())
                walk(path.join(current, name), path.join(relative, name), depth + 1);
        }
        else if (stat.isFile()) {
            bytes += stat.size;
            if (bytes > 64 * 1024 * 1024)
                throw new GoblinError('FINGERPRINT_LIMIT', file);
            hash.update(String(stat.size));
            const fd = fs.openSync(current, 'r');
            try {
                const buffer = Buffer.alloc(64 * 1024);
                let n;
                while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
                    hash.update(buffer.subarray(0, n));
            }
            finally {
                fs.closeSync(fd);
            }
        }
        else
            throw new GoblinError('UNSUPPORTED_FILE', current);
    }
    walk(file, '', 0);
    return hash.digest('hex');
}
export function readOptional(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return null;
        throw e;
    }
}
export function atomicWrite(file, content, mode = 0o600) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        const fd = fs.openSync(tmp, 'wx', mode);
        try {
            fs.writeFileSync(fd, content);
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
    }
    finally {
        if (exists(tmp))
            fs.unlinkSync(tmp);
    }
}
//# sourceMappingURL=files.js.map