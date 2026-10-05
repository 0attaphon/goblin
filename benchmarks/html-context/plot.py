#!/usr/bin/env python3
"""Render measured A/B results. Requires matplotlib; not a Goblin dependency."""
import json
from pathlib import Path
from statistics import median

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
from matplotlib.patches import Patch

base = Path(__file__).resolve().parent
data = json.loads((base / 'results.json').read_text())
groups = [[r for r in data['runs'] if r['condition'] == condition]
          for condition in ['all', 'focused']]
assert all(len(runs) == 3 and all(r['exit_code'] == 0 for r in runs) for runs in groups)
inputs = [median(r['usage']['input_tokens'] for r in runs) for runs in groups]
cached = [median(r['usage']['cached_input_tokens'] for r in runs) for runs in groups]
outputs = [median(r['usage']['output_tokens'] for r in runs) for runs in groups]
seconds = [median(r['seconds'] for r in runs) for runs in groups]
reduction = inputs[0] - inputs[1]
percent = 100 * reduction / inputs[0]
assert reduction == data['summary']['median_input_reduction']

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'svg.fonttype': 'none', 'axes.titleweight': 'bold'})
fig, axes = plt.subplots(1, 3, figsize=(15, 6.2))
fig.patch.set_facecolor('#f7f9fc')
colors = ['#53657e', '#098865']
labels = ['66 candidates\nenabled', '66 candidates\ndisabled']
for ax in axes:
    ax.set_facecolor('#f7f9fc')
    ax.spines[['top', 'right', 'left']].set_visible(False)
    ax.spines['bottom'].set_color('#c9d2df')
    ax.set_xticks([0, 1], labels)
    ax.tick_params(axis='both', length=0, pad=8)
    ax.yaxis.grid(True, color='#dfe5ed', linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_xlim(-0.65, 1.65)

ax = axes[0]
ax.set_title('Input / context tokens', pad=32)
ax.bar([0, 1], cached, width=0.55, color='#c4d2e4')
ax.bar([0, 1], [i-c for i, c in zip(inputs, cached)], bottom=cached,
       width=0.55, color=colors)
for x, total, cache in zip([0, 1], inputs, cached):
    ax.text(x, total+450, f'{total:,}', ha='center', fontweight='bold', fontsize=14)
    ax.text(x, cache/2, f'{cache:,}\ncached', ha='center', color='#283f5a', fontsize=10)
ax.set_ylim(0, 24500)
ax.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f'{value:,.0f}'))
ax.text(0.5, 1.025, f'{reduction:,} fewer tokens ({percent:.2f}%)',
        transform=ax.transAxes, ha='center', color=colors[1], fontsize=11)
ax.legend(handles=[Patch(facecolor='#c4d2e4', label='Cached input'),
                   Patch(facecolor='#52657d', label='Uncached input')],
          frameon=False, loc='upper right', fontsize=9)

for ax, values, title, getter, limit, fmt in [
    (axes[1], outputs, 'Output tokens', lambda r: r['usage']['output_tokens'], 4300, ',.0f'),
    (axes[2], seconds, 'Elapsed seconds', lambda r: r['seconds'], 145, '.2f'),
]:
    ax.set_title(title, pad=32)
    ax.bar([0, 1], values, width=0.55, color=colors, alpha=0.88)
    for x, value, runs in zip([0, 1], values, groups):
        ax.text(x, max(getter(r) for r in runs)+limit*0.045, format(value, fmt),
                ha='center', fontweight='bold', fontsize=14)
        ax.scatter([x-0.09, x, x+0.09], [getter(r) for r in runs],
                   color='#172c43', edgecolors='white', linewidths=0.8, s=35, zorder=3)
    ax.set_ylim(0, limit)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f'{value:,.0f}'))
    ax.text(0.5, 1.025, 'Bars: medians · Dots: individual runs',
            transform=ax.transAxes, ha='center', color='#53657e', fontsize=10)

fig.suptitle('Goblin: measured HTML-generation A/B', x=0.07, ha='left',
             y=0.97, fontsize=23, fontweight='bold', color='#172c43')
fig.text(0.07, 0.89, 'Same prompt · gpt-6.1-sol / medium · 3 paired runs · 2026-10-05',
         color='#53657e', fontsize=12)
fig.text(0.07, 0.065,
         'Cached input is part of input. Skills unchanged. User plugins and MCP excluded in both conditions.\n'
         'Observed results for one task; not a universal token, cost, speed or quality guarantee.',
         color='#53657e', fontsize=10, linespacing=1.7)
fig.subplots_adjust(left=0.07, right=0.98, top=0.73, bottom=0.22, wspace=0.35)
for suffix in ['png', 'svg']:
    target = base / f'comparison.{suffix}'
    fig.savefig(target, dpi=160, facecolor=fig.get_facecolor())
    print(target)
