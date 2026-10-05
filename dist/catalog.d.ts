import type { Catalog, Finding, Options, Skill } from './types.js';
export declare function scan(options?: Options): Catalog;
export declare function inspect(catalog: Catalog, selector: string): Skill;
export declare function audit(catalog: Catalog): Finding[];
