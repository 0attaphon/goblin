#!/usr/bin/env python3
"""Generate a shareable report from real Codex usage events."""
import html
import json
import pathlib


def main():
    base = pathlib.Path(__file__).resolve().parent
    data = json.loads((base / 'results.json').read_text())
    if 'summary' not in data or len(data['runs']) != 6:
        raise SystemExit('Need six verified runs and a completed summary.')
    summary = data['summary']
    rows = []
    for r in data['runs']:
        u = r['usage']
        rows.append([r['pair'], r['condition'], u['input_tokens'], u['cached_input_tokens'],
                     u['input_tokens'] - u['cached_input_tokens'], u['output_tokens'], r['seconds'], r['html_bytes']])
    headers = ['Pair', 'Condition', 'Input', 'Cached input', 'Uncached input', 'Output', 'Seconds', 'HTML bytes']
    md = ['# Goblin: real HTML-generation A/B test', '',
          f"Model: `{data['model']}`, reasoning: `{data['effort']}`, CLI: `{data['cli_version']}`.", '',
          f"{data['candidate_count']} local Codex skill candidates; same prompt, 3 paired runs, alternating order. User config, plugins and MCP are excluded in both conditions. No tool calls were requested.", '',
          '| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join(['---'] * len(headers)) + ' |']
    md += ['| ' + ' | '.join(map(str, row)) + ' |' for row in rows]
    md += ['', f"Median input: **{summary['all']['input_tokens']['median']:,} → {summary['focused']['input_tokens']['median']:,} tokens**.",
           f"Observed median input reduction: **{summary['median_input_reduction']:,} tokens ({summary['median_input_reduction_percent']}%)**.", '',
           f"Skill files unchanged: **{data['skill_files_unchanged']}**. All six runs produced HTML; usage numbers come from turn.completed events.", '',
           '## Interpretation', '',
           '- Input tokens are the observed prompt/context token count for this single-response task, not the model context-window capacity.',
           '- Cached input is a subset of input; it must not be added to input. Uncached input is input minus cached input.',
           '- Prompt caching, HTML length and internal reasoning vary. Output tokens and elapsed time are reported separately; they are not guaranteed to decrease when skills are disabled.',
           '- No universal percentage or monetary saving is claimed. This test excludes Goblin MCP overhead and plugin-rich desktop context.',
           '- HTML document presence is verified; output quality is not assumed identical from token count.', '',
           '## Evidence', '',
           '- [Exact prompt](prompt.txt)', '- [Raw measurements](results.json)',
           '- [All-skills HTML, pair 1](runs/pair-1-all/index.html)',
           '- [Focused HTML, pair 1](runs/pair-1-focused/index.html)', '',
           'Run the same protocol again with run.py to check repeatability. No installed skills were removed.']
    (base / 'report.md').write_text('\n'.join(md) + '\n')
    def cell(value):
        return html.escape(str(value))
    table = '<table><thead><tr>' + ''.join('<th>' + cell(h) + '</th>' for h in headers) + '</tr></thead><tbody>'
    table += ''.join('<tr>' + ''.join('<td>' + cell(v) + '</td>' for v in row) + '</tr>' for row in rows)
    table += '</tbody></table>'
    reduction = summary['median_input_reduction_percent']
    body = f'''<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goblin A/B token test</title>
<style>body{{font:16px/1.6 system-ui,sans-serif;background:#f7f8fa;color:#17232e;margin:0}}main{{max-width:1100px;margin:auto;padding:32px 20px}}h1{{line-height:1.2}}table{{border-collapse:collapse;width:100%;background:white}}th,td{{padding:10px;border-bottom:1px solid #d7dde3;text-align:right;font-variant-numeric:tabular-nums}}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){{text-align:left}}.scroll{{overflow:auto}}.metric{{font-size:30px;font-weight:600}}a{{color:#235d86}}small{{color:#536170}}</style>
<main><h1>Goblin — HTML prompt A/B</h1><p>{cell(data['model'])} · 3 paired runs · {data['candidate_count']} local Codex skill candidates</p>
<p class="metric">Median input {summary['all']['input_tokens']['median']:,} → {summary['focused']['input_tokens']['median']:,} tokens</p><p>ลดลงในการทดลองนี้ {reduction}% ({summary['median_input_reduction']:,} tokens)</p><div class="scroll">{table}</div>
<p><a href="runs/pair-1-all/index.html">HTML เปิดสกิลทั้งหมด</a> · <a href="runs/pair-1-focused/index.html">HTML ปิดสกิลที่ไม่เกี่ยวข้อง</a> · <a href="results.json">ข้อมูลดิบ</a> · <a href="prompt.txt">Prompt เดียวกัน</a></p>
<p>Skill files unchanged: {data['skill_files_unchanged']}. ผลวัดจริงจาก Codex CLI ไม่ใช่การประมาณจากขนาดไฟล์</p>
<small>Input หมายถึง token ของ prompt/context ที่ส่งในงานนี้ ไม่ใช่ความจุ context window. Cached input เป็นส่วนหนึ่งของ input. การทดลองนี้ไม่รวม plugin, MCP อื่น หรือ overhead ของ Goblin MCP. เวลาและ output อาจแตกต่างจาก cache และการสร้าง HTML; ตัวเลขนี้ไม่ใช่คำรับประกันสำหรับทุกงาน.</small></main></html>'''
    (base / 'report.html').write_text(body)
    print(base / 'report.md')
    print(base / 'report.html')


if __name__ == '__main__':
    main()
