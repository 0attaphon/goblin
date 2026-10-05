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
    last_used_at: string | null;
    usage_count: number | null;
    usage_rank: number | null;
    usage_source: string | null;
    observation_start: string | null;
    observation_end: string | null;
    coverage: 'unknown' | 'partial';
}
export interface Issue {
    code: string;
    path: string;
}
export interface UsageReport {
    observation_start: string;
    observation_end: string;
    days: number;
    logs_scanned: number;
    bytes_scanned: number;
    observed_calls: number;
    read_issues: number;
    limit_reached: boolean;
    coverage: 'partial';
}
export interface Catalog {
    scanned_at: string;
    skills: Skill[];
    issues: Issue[];
    incomplete: boolean;
    usage?: UsageReport;
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
