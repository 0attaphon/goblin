#!/usr/bin/env python3
"""Paired real Codex CLI measurements. No installed skill/config changes."""
import argparse
import datetime
import hashlib
import json
import pathlib
import statistics
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex', required=True)
    parser.add_argument('--model', default='gpt-6.1-sol')
    parser.add_argument('--pairs', type=int, default=3)
    args = parser.parse_args()
    project = pathlib.Path(__file__).resolve().parents[2]
    base = pathlib.Path(__file__).resolve().parent
    prompt = (base / 'prompt.txt').read_text()
    catalog = json.loads((project / 'docs/local-scan-0.0.1.json').read_text())
    # Plugins are not loaded under --ignore-user-config. Compare actual local
    # Codex discovery roots; Claude-only roots do not influence these calls.
    candidates = sorted({s['skill_file'] for s in catalog['skills']
                         if s['provider'] == 'codex' and s['source'] != 'plugin'})
    if not candidates:
        raise SystemExit('No local Codex skill candidates found.')
    before = {p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in candidates}
    results = []
    manifest = {
        'version': '0.0.1', 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'model': args.model, 'effort': 'medium', 'pairs': args.pairs,
        'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(), 'candidate_count': len(candidates),
        'candidate_paths': candidates, 'cli_version': subprocess.check_output([args.codex, '--version'], text=True).strip(),
        'conditions': {
            'all': 'Local Codex candidates enabled by per-invocation config; user config/plugins/MCP excluded in both arms.',
            'focused': 'Same candidates disabled per invocation. This standalone HTML task requires no optional skill.',
        },
        'scope': 'Single-response HTML generation, tools explicitly excluded. Counts from turn.completed usage; not byte estimates.',
        'runs': results,
    }
    report = base / 'results.json'
    for pair in range(1, args.pairs + 1):
        order = ['all', 'focused'] if pair % 2 else ['focused', 'all']
        for condition in order:
            run_dir = base / 'runs' / f'pair-{pair}-{condition}'
            run_dir.mkdir(parents=True, exist_ok=True)
            entries = ', '.join('{path = ' + json.dumps(p) + ', enabled = ' + ('true' if condition == 'all' else 'false') + '}' for p in candidates)
            command = [args.codex, 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
                       '--sandbox', 'read-only', '--json', '--color', 'never', '--model', args.model,
                       '-c', 'model_reasoning_effort="medium"', '-c', 'skills.config=[' + entries + ']',
                       '--cd', str(run_dir), '--output-last-message', str(run_dir / 'index.html'), '-']
            print(f'Pair {pair}/{args.pairs}: {condition} ({len(candidates)} candidates)', flush=True)
            started = time.monotonic()
            with (run_dir / 'events.jsonl').open('w') as out, (run_dir / 'stderr.log').open('w') as err:
                process = subprocess.run(command, input=prompt, text=True, stdout=out, stderr=err, timeout=300)
            events = []
            for line in (run_dir / 'events.jsonl').read_text().splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
            completed = [e for e in events if e.get('type') == 'turn.completed']
            usage = completed[-1].get('usage') if completed else None
            html_file = run_dir / 'index.html'
            html = html_file.read_text() if html_file.exists() else ''
            item = {'pair': pair, 'condition': condition, 'exit_code': process.returncode,
                    'seconds': round(time.monotonic() - started, 2), 'usage': usage,
                    'html_bytes': len(html.encode()), 'html_document': '<html' in html.lower() and '</html>' in html.lower(),
                    'tool_items': sum(e.get('type') == 'item.completed' and e.get('item', {}).get('type') not in ('agent_message', 'reasoning') for e in events),
                    'run_dir': str(run_dir.relative_to(base))}
            results.append(item)
            manifest['skill_files_unchanged'] = all(pathlib.Path(p).exists() and hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() == h for p, h in before.items())
            report.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
            print(json.dumps(item, ensure_ascii=False), flush=True)
            if process.returncode or usage is None or not item['html_document']:
                raise SystemExit(f'Unverified run: see {run_dir}. No fabricated metrics.')
    summary = {}
    for condition in ('all', 'focused'):
        group = [r for r in results if r['condition'] == condition]
        metrics = {}
        for key in ('input_tokens', 'cached_input_tokens', 'output_tokens'):
            values = [r['usage'][key] for r in group]
            metrics[key] = {'median': statistics.median(values), 'min': min(values), 'max': max(values)}
        metrics['seconds'] = statistics.median(r['seconds'] for r in group)
        summary[condition] = metrics
    baseline = summary['all']['input_tokens']['median']
    focused = summary['focused']['input_tokens']['median']
    summary['median_input_reduction'] = baseline - focused
    summary['median_input_reduction_percent'] = round((baseline - focused) / baseline * 100, 2) if baseline else None
    manifest['summary'] = summary
    report.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
