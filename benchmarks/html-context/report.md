# Goblin: real HTML-generation A/B test

Model: `gpt-6.1-sol`, reasoning: `medium`, CLI: `codex-cli 0.159.2`.

66 local Codex skill candidates; same prompt, 3 paired runs, alternating order. User config, plugins and MCP are excluded in both conditions. No tool calls were requested.

| Pair | Condition | Input | Cached input | Uncached input | Output | Seconds | HTML bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | all | 19246 | 12288 | 6958 | 3511 | 114.16 | 13179 |
| 1 | focused | 13939 | 12288 | 1651 | 3137 | 101.01 | 11826 |
| 2 | focused | 13939 | 12288 | 1651 | 3010 | 108.67 | 11430 |
| 2 | all | 19246 | 12288 | 6958 | 3304 | 111.87 | 12593 |
| 3 | all | 19246 | 12288 | 6958 | 2830 | 95.53 | 10337 |
| 3 | focused | 13939 | 12288 | 1651 | 2941 | 99.43 | 11140 |

Median input: **19,246 → 13,939 tokens**.
Observed median input reduction: **5,307 tokens (27.57%)**.

Skill files unchanged: **True**. All six runs produced HTML; usage numbers come from turn.completed events.

## Interpretation

- Input tokens are the observed prompt/context token count for this single-response task, not the model context-window capacity.
- Cached input is a subset of input; it must not be added to input. Uncached input is input minus cached input.
- Prompt caching, HTML length and internal reasoning vary. Output tokens and elapsed time are reported separately; they are not guaranteed to decrease when skills are disabled.
- No universal percentage or monetary saving is claimed. This test excludes Goblin MCP overhead and plugin-rich desktop context.
- HTML document presence is verified; output quality is not assumed identical from token count.

## Evidence

- [Exact prompt](prompt.txt)
- [Raw measurements](results.json)
- [All-skills HTML, pair 1](runs/pair-1-all/index.html)
- [Focused HTML, pair 1](runs/pair-1-focused/index.html)

Run the same protocol again with run.py to check repeatability. No installed skills were removed.
