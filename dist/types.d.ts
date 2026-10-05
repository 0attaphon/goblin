export type Provider = 'codex' | 'claude-code' | 'custom';
export interface Root {
    path: string;
    provider: Provider;
    source: string;
    managed?: boolean;
    physical_path?: string;
}
export interface Options {
    home?: string;
    dataDir?: string;
    roots?: Root[];
    project?: string;
}
export interface Settings {
    home: string;
    dataDir: string;
    roots: Root[];
    configPath: string;
}
export interface Skill {
    id: string;
    name: string;
    path: string;
    canonical_path: string;
    skill_file: string;
    provider: Provider;
    source: string;
    status: 'enabled' | 'disabled' | 'unknown';
    managed: boolean;
    is_link: boolean;
    link_target: string | null;
    metadata_valid: boolean;
    fingerprint: string | null;
    last_used_at: null;
    usage_count: null;
    usage_source: null;
    observation_start: null;
    observation_end: null;
    coverage: 'unknown';
}
export interface Issue {
    code: string;
    path: string;
}
export interface Catalog {
    scanned_at: string;
    skills: Skill[];
    issues: Issue[];
    incomplete: boolean;
}
export interface Finding {
    kind: string;
    ids: string[];
    path?: string;
}
export type Action = 'remove' | 'disable' | 'enable';
export interface Move {
    from: string;
    to: string;
    fingerprint: string;
    is_link: boolean;
}
export interface ChangePlan {
    id: string;
    action: Action;
    created_at: string;
    skill_id: string;
    name: string;
    affected: {
        id: string;
        path: string;
        provider: Provider;
    }[];
    moves: Move[];
    config?: {
        path: string;
        before: string | null;
        after: string;
    };
    roots: Root[];
    data_dir: string;
    snapshot: string;
}
export interface Change extends ChangePlan {
    state: 'applying' | 'applied' | 'restoring' | 'restored';
    updated_at: string;
}
