#!/usr/bin/env python3
"""Basic output checks; browser interaction checks are recorded separately."""
import json
import pathlib
from html.parser import HTMLParser


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.controls = []
        self.labels = []
        self.external_assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append(tag)
        if tag in ('input', 'select'):
            self.controls.append(attrs)
        if tag == 'label':
            self.labels.append(attrs.get('for'))
        if tag in ('script', 'img', 'link'):
            for key in ('src', 'href'):
                if attrs.get(key, '').startswith(('http:', 'https:', '//')):
                    self.external_assets.append(attrs[key])


base = pathlib.Path(__file__).resolve().parent
measurements = json.loads((base / 'results.json').read_text())
checks = []
for run in measurements['runs']:
    content = (base / run['run_dir'] / 'index.html').read_text()
    doc = Document()
    doc.feed(content)
    checks.append({
        'pair': run['pair'], 'condition': run['condition'],
        'has_html_document': 'html' in doc.tags and '</html>' in content.lower(),
        'has_inline_css_and_js': 'style' in doc.tags and 'script' in doc.tags,
        'table_rows_including_header': doc.tags.count('tr'),
        'has_search_and_status_controls': len(doc.controls) >= 2 and any(c.get('type') == 'search' for c in doc.controls) and 'select' in doc.tags,
        'all_controls_labeled': all(c.get('id') in doc.labels or bool(c.get('aria-label')) for c in doc.controls),
        'external_assets': doc.external_assets,
    })
evidence = {
    'basic_checks': checks,
    'browser_checks': [
        {'pair': 1, 'condition': 'all', 'search': 'มินตรา', 'search_visible_rows': 1, 'status': 'เสร็จแล้ว', 'status_visible_rows': 2},
        {'pair': 1, 'condition': 'focused', 'search': 'พิมพ์ชนก', 'search_visible_rows': 1, 'status': 'เสร็จแล้ว', 'status_visible_rows': 2},
    ],
    'browser_evidence': 'Observed using Codex in-app browser accessibility snapshots on localhost, 2026-10-05. Browser checks cover pair 1 only; no full visual-quality equivalence claimed.'
}
(base / 'quality-checks.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
print(json.dumps(evidence, ensure_ascii=False, indent=2))
