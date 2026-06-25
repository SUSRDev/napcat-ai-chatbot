#!/usr/bin/env python3
"""从 icon.svg 生成 NapCat 插件 icon.png（256×256）。需 Node.js + npx。"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / 'icon.svg'
PNG = ROOT / 'icon.png'

cmd = [
    'npx', '--yes', '@resvg/resvg-js-cli',
    str(SVG), str(PNG),
    '--fit-width', '256',
    '--fit-height', '256',
]
print('Running:', ' '.join(cmd))
subprocess.run(cmd, cwd=str(ROOT), check=True)
print(f'Wrote {PNG}')
