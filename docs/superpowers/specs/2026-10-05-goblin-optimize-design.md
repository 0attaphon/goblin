# Goblin optimize: automatic usage-ranked disabling

## Intent and approved behavior

Reduce the installed skills exposed to Codex by disabling the least-used end of a usage ranking. The user sets the aggression level. Unlike interactive scan, optimize applies changes immediately: no checkbox, confirmation prompt or second submit. The user explicitly requested this automatic behavior.

`goblin optimize` defaults to **Ultra**. Levels mean the fraction to disable, not the fraction to retain:

| Level | Disable | Example with 10 eligible skills, ranked most-used first |
| --- | ---: | --- |
| low | 30% | ranks 8–10 |
| medium | 50% | ranks 6–10 |
| high | 60% | ranks 5–10 |
| ultra (default) | 80% | ranks 3–10 |

## Commands

```sh
goblin optimize
goblin optimize --level low
goblin optimize --level medium
goblin optimize --level high
goblin optimize --level ultra
goblin optimize --level ultra --dry-run
goblin optimize --json
```

Existing home, root, project and data-directory options retain their meanings. Unknown level/argument values fail before changes. `--dry-run` reports the exact proposal without creating state or changing configuration. JSON provides evidence coverage, ranking, excluded entries, selected IDs, outcomes and recovery IDs without skill bodies or raw conversation content.

## Evidence and context constraints

Read existing local Codex/Claude Code session logs over the preceding 30 days. Do not install hooks, change SKILL.md or memory instructions, add skills, execute skill scripts, call an LLM or send logs externally. Usage collection and ranking run locally. Do not add per-skill MCP tools or enlarge other skills' context.

Count only recognizable successful skill invocations or successful reads of a specific SKILL.md attributable to a real tool event. Match the installed skill's exact path/canonical identity or an unambiguous explicit name. Dedupe event IDs and session records. Do not count catalog listings, mentions, benchmark configuration, Goblin scanning, arbitrary substrings of conversation text, or unexecuted commands. Unsupported wrappers and ambiguous calls stay unclassified; never execute logged code to infer usage.

Observed usage is evidence of invocation/loading, not proof that a skill contributed to the answer. Report usage source, observation period and coverage. Missing/unreadable/unsupported logs and ambiguous mappings cannot become verified zero usage. Skills without attributable evidence remain **unknown** and are excluded from automatic optimization; absence of a record is not proof of never being used. This can mean optimize makes no changes even when many skills are installed.

Positive evidence ranks skills by observed count, then last observed use (newer first), then stable canonical path. Shared paths for one physical skill form one ranked item, avoiding duplicate weighting. The catalog should surface observed usage when evidence exists and retain unknown/null otherwise.

## Eligibility and rounding

Optimize affects supported, currently enabled, manually managed Codex skills only. Managed/plugin/system/synced skills, other providers, malformed or unreadable skills, and unknown usage are excluded with reasons. No unverified list of supposedly essential manual skills is invented; the highest-ranked eligible skill is always retained.

Let N be eligible physical skills. Disable `min(floor(N × fraction), max(0, N − 1))` from the least-used end. N=0 or N=1 results in no changes. All fractions use the same pre-change snapshot; already disabled skills are outside the denominator. Report eligible, excluded, selected and retained counts. Ties follow the deterministic ordering above, and the output must identify the cutoff tie if applicable.

## Applying and recovery

Use the existing native Codex disable adapter; keep files in place. If a ranked physical skill has several active discovered Codex paths, account for those paths so an alias does not leave it active. Preserve readonly shared references and refuse unsupported groups rather than editing managed sources.

Preflight the complete selection before the first write. Reject incomplete discovery, unsupported/symlinked config, changed skill identities or an outstanding recovery journal. Generate fresh plans sequentially because config snapshots change after each edit. Stop on the first apply failure and report successful, interrupted and untouched entries separately. Do not claim atomic all-or-nothing behavior.

Print restore commands in reverse change order, with an interrupted current change first when its journal exists. Preserve roots/home/data-directory options in recovery commands. Restart Codex to load changed state. No permanent file deletion.

## Boundaries

Interactive `scan` retains its checkbox flow. MCP scan stays read-only; optimization does not add MCP tools in this slice. Homebrew distribution and the separately proposed `goblin upgrade` command are outside this design.

## Acceptance evidence

- Synthetic logs with known actual calls, mentions, failures, duplicates, timestamps, ambiguous names and unsupported wrappers produce the expected evidence without reading a user's account during tests.
- Ten distinct ranked skills disable the final 3/5/6/8 at low/medium/high/ultra; no level means ultra.
- Unknown and managed entries stay unchanged; zero eligible and single eligible item do nothing.
- Repeated optimization uses the remaining enabled denominator and retains at least one eligible item.
- Dry-run changes no files/state; automatic mode needs no TTY and opens no checkbox.
- Shared aliases, stale selections, interrupted writes and reverse restore order preserve recoverability.
- Existing CLI, scan checkbox and fixed MCP tests remain passing; built distribution is included for one-command GitHub installs.

## Review status

Written spec for user review. Implementation has not started.
