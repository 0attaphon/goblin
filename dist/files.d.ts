import type { Options, Settings } from './types.js';
export declare class GoblinError extends Error {
    code: string;
    constructor(code: string, message?: string);
}
export declare const digest: (value: string | Buffer) => string;
export declare function inside(parent: string, child: string): boolean;
export declare function exists(file: string): boolean;
export declare function physical(file: string): string;
export declare function settings(options?: Options): Settings;
export declare function fingerprint(file: string): string;
export declare function readOptional(file: string): string | null;
export declare function atomicWrite(file: string, content: string, mode?: number): void;
