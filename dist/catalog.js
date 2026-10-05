import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parse as parseToml } from 'smol-toml';
import { digest, exists, fingerprint, GoblinError, inside, readOptional, settings } from './files.js';
export function scan(options = {}) {
    const config = settings(options);
    const catalog = { scanned_at: new Date().toISOString(), skills: [], issues: [], incomplete: false };
    const allowed = config.roots.filter(r => exists(r.path)).map(r => fs.realpathSync(r.path));
    let disabled = new Set();
    try {
        const toml = readOptional(config.configPath);
        if (toml) {
            const data = parseToml(toml);
            disabled = new Set((data.skills?.config ?? []).filter((x) => x.enabled === false && typeof x.path === 'string').map((x) => path.resolve(x.path)));
        }
    }
    catch {
        catalog.issues.push({ code: 'INVALID_CODEX_CONFIG', path: config.configPath });
    }
    const seenEntries = new Set();
    let visited = 0;
    const issue = (code, p) => {
        if (['EACCES', 'EPERM', 'READ_FAILED', 'SCAN_LIMIT', 'ELOOP'].includes(code))
            catalog.incomplete = true;
        if (catalog.issues.length < 200)
            catalog.issues.push({ code, path: p });
        else
            catalog.incomplete = true;
    };
    function walk(entry, root, depth, ancestors, inheritedManaged) {
        if (++visited > 20000 || depth > 10) {
            catalog.incomplete = true;
            issue('SCAN_LIMIT', entry);
            return;
        }
        try {
            const lstat = fs.lstatSync(entry);
            if (!lstat.isDirectory() && !lstat.isSymbolicLink())
                return;
            let canonical;
            try {
                canonical = fs.realpathSync(entry);
            }
            catch (e) {
                if (e.code === 'ENOENT')
                    issue('BROKEN_LINK', entry);
                else {
                    catalog.incomplete = true;
                    issue(e.code ?? 'READ_FAILED', entry);
                }
                return;
            }
            if (!allowed.some(r => inside(r, canonical))) {
                issue('OUTSIDE_ROOT', entry);
                return;
            }
            if (!fs.statSync(entry).isDirectory())
                return;
            if (ancestors.has(canonical)) {
                issue('LINK_CYCLE', entry);
                return;
            }
            const managed = inheritedManaged || entry.split(path.sep).some(p => p === 'synced' || p === '.system')
                || /[\\/]plugins[\\/]cache(?:[\\/]|$)/.test(entry) || exists(path.join(entry, 'manifest.json'));
            const skillFile = path.join(entry, 'SKILL.md');
            if (exists(skillFile)) {
                if (seenEntries.has(entry))
                    return;
                seenEntries.add(entry);
                let name = path.basename(entry), metadataValid = false, unsafeMetadata = false;
                try {
                    if (!inside(canonical, fs.realpathSync(skillFile))) {
                        unsafeMetadata = true;
                        issue('OUTSIDE_SKILL_METADATA', skillFile);
                        throw new GoblinError('OUTSIDE_SKILL_METADATA');
                    }
                    // Read only a bounded prefix, not the full skill body into output.
                    const fd = fs.openSync(skillFile, 'r');
                    let prefix;
                    try {
                        const buf = Buffer.alloc(65536);
                        const n = fs.readSync(fd, buf, 0, buf.length, 0);
                        prefix = buf.subarray(0, n).toString('utf8');
                    }
                    finally {
                        fs.closeSync(fd);
                    }
                    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(prefix);
                    if (match) {
                        const data = parseYaml(match[1], { maxAliasCount: 0 });
                        if (typeof data?.name === 'string' && data.name.trim() && data.name.length <= 256
                            && typeof data.description === 'string' && data.description.trim()) {
                            name = data.name;
                            metadataValid = true;
                        }
                    }
                }
                catch { /* Report invalid metadata without exposing the body. */ }
                let fp = null;
                try {
                    fp = fingerprint(canonical);
                }
                catch (e) {
                    issue(e.code ?? 'FINGERPRINT_FAILED', entry);
                }
                catalog.skills.push({
                    id: `sk_${digest(entry).slice(0, 12)}`, name, path: entry, canonical_path: canonical, skill_file: skillFile,
                    provider: root.provider, source: managed ? (root.source === 'plugin' ? 'plugin' : 'managed') : root.source,
                    managed: managed || unsafeMetadata || fp === null, is_link: lstat.isSymbolicLink(), link_target: lstat.isSymbolicLink() ? fs.readlinkSync(entry) : null,
                    metadata_valid: metadataValid, fingerprint: fp,
                    status: root.source === 'plugin' ? 'unknown' : root.provider === 'codex' && (disabled.has(skillFile) || disabled.has(path.join(canonical, 'SKILL.md'))) ? 'disabled' : 'enabled',
                    last_used_at: null, usage_count: null, usage_source: null, observation_start: null, observation_end: null, coverage: 'unknown',
                });
                return;
            }
            const next = new Set(ancestors).add(canonical);
            for (const name of fs.readdirSync(entry).sort()) {
                if (['.git', 'node_modules'].includes(name))
                    continue;
                walk(path.join(entry, name), root, depth + 1, next, managed || lstat.isSymbolicLink());
            }
        }
        catch (e) {
            issue(e.code ?? 'READ_FAILED', entry);
        }
    }
    function pluginRoots(entry, root, depth) {
        try {
            // Cache layout is publisher/plugin/version/skills, not the package's
            // test fixtures or application source tree. Do not recurse below versions.
            const skills = path.join(entry, 'skills');
            if (exists(skills))
                walk(skills, root, 0, new Set(), true);
            if (depth >= 3)
                return;
            for (const name of fs.readdirSync(entry).sort()) {
                if (['skills', 'packages', 'tests', 'fixtures', 'node_modules', '.git'].includes(name))
                    continue;
                const child = path.join(entry, name);
                const st = fs.lstatSync(child);
                if (st.isDirectory() && !st.isSymbolicLink())
                    pluginRoots(child, root, depth + 1);
            }
        }
        catch (e) {
            issue(e.code ?? 'READ_FAILED', entry);
        }
    }
    for (const root of config.roots)
        if (exists(root.path)) {
            if (root.source === 'plugin')
                pluginRoots(root.path, root, 0);
            else
                walk(root.path, root, 0, new Set(), root.managed === true);
        }
    catalog.skills.sort((a, b) => a.path.localeCompare(b.path));
    return catalog;
}
export function inspect(catalog, selector) {
    const byId = catalog.skills.find(s => s.id === selector);
    if (byId)
        return byId;
    const matches = catalog.skills.filter(s => s.name === selector || s.path === selector);
    if (matches.length > 1)
        throw new GoblinError('AMBIGUOUS_SKILL', matches.map(s => s.id).join(', '));
    if (!matches.length)
        throw new GoblinError('SKILL_NOT_FOUND', selector);
    return matches[0];
}
export function audit(catalog) {
    const findings = catalog.issues.map(i => ({ kind: i.code.toLowerCase(), ids: [], path: i.path }));
    const group = (key) => {
        const groups = new Map();
        for (const s of catalog.skills) {
            const k = key(s);
            if (k)
                groups.set(k, [...(groups.get(k) ?? []), s]);
        }
        return [...groups.values()].filter(g => g.length > 1);
    };
    for (const g of group(s => s.canonical_path))
        findings.push({ kind: 'shared_reference', ids: g.map(s => s.id) });
    for (const g of group(s => s.fingerprint)) {
        if (new Set(g.map(s => s.canonical_path)).size > 1)
            findings.push({ kind: 'exact_duplicate', ids: g.map(s => s.id) });
    }
    for (const g of group(s => s.name)) {
        if (new Set(g.map(s => s.canonical_path)).size > 1)
            findings.push({ kind: 'name_conflict', ids: g.map(s => s.id) });
    }
    for (const s of catalog.skills)
        if (!s.metadata_valid)
            findings.push({ kind: 'metadata_invalid', ids: [s.id] });
    return findings;
}
//# sourceMappingURL=catalog.js.map