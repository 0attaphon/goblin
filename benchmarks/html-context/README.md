# HTML prompt A/B experiment

![Measured token and time comparison](comparison.png)

Charts: [PNG](comparison.png) · [SVG](comparison.svg). Rebuild from `results.json` with `python3 plot.py` (requires matplotlib; optional reporting dependency).

The user requested real prompt runs comparing many installed skills with unused skills disabled. The user explicitly authorized the six external Codex calls using normally loaded skill contents.

## Protocol

- Same Thai prompt, model (`gpt-6.1-sol`) and reasoning effort (`medium`).
- Three paired runs; order alternates all/focused, focused/all, all/focused.
- Independent ephemeral sessions and working folders. No permanent skill/config changes.
- User config is ignored in both arms. This excludes user plugin activation and MCP servers, reducing confounding from unrelated integrations.
- Compare 66 discovered local Codex skill candidates. The all condition explicitly enables them for that invocation; the focused condition disables them. The self-contained single-response HTML task needs no optional skill.
- The prompt requests no tools and only HTML output. This tests single-response generation/context overhead, not a whole multi-turn agent workflow.
- Use actual `turn.completed.usage` fields for input, cached input and output. Byte counts are only HTML output sizes, never token estimates.
- Inspect raw events and outputs; verify installed skill file hashes before/after.

`results.json` records measurements only when the run produces a valid HTML document and a real usage record. Failure or missing usage is reported instead of filling estimated values.

## Re-run

Requires an authenticated Codex CLI. The script never changes HOME/CODEX_HOME or installed skill directories. Re-running sends normally loaded skill contents to the configured Codex service and consumes account usage.

```sh
node dist/cli.js scan --json > docs/local-scan-0.0.1.json
python3 benchmarks/html-context/run.py --codex /absolute/path/to/codex --pairs 3
```

Compare medians and ranges rather than declaring one run universal. Prompt caching can change uncached input independently of catalog reduction; output quality and length may differ even under the same prompt. Do not infer a monetary saving without the applicable model pricing. Plugin-rich desktop sessions can have a different baseline from this isolated CLI protocol.
