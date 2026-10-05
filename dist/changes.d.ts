import type { Action, Change, ChangePlan, Options } from './types.js';
export declare function plan(options: Options, action: Action, selector: string): ChangePlan;
export declare function history(options?: Options): Change[];
export declare function apply(options: Options, p: ChangePlan): Change;
export declare function restore(options: Options, id: string, dryRun?: boolean): Change;
export declare function savePlan(options: Options, p: ChangePlan): void;
export declare function readPlan(options: Options, id: string): ChangePlan;
