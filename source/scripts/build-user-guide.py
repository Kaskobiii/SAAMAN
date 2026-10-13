"""Render the small Markdown subset used by the controller guide, without dependencies."""
from pathlib import Path
import html, re, sys

root = Path(__file__).resolve().parents[2]
source = (root / 'docs/user-guide.md').read_text(encoding='utf-8')
def inline(text):
    text = html.escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
lines = source.splitlines()
blocks = []
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1
        continue
    if line.startswith('# '):
        i += 1
        continue  # The page or standalone wrapper owns its title.
    if line.startswith('## '):
        blocks.append('<h2>' + inline(line[3:]) + '</h2>')
        i += 1
    elif line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            rows.append([cell.strip() for cell in lines[i].strip('|').split('|')])
            i += 1
        assert len(rows) > 2 and all(re.fullmatch(r':?-+:?', cell) for cell in rows[1])
        blocks.append('<table><thead><tr>' + ''.join('<th>' + inline(c) + '</th>' for c in rows[0]) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in row) + '</tr>' for row in rows[2:]) + '</tbody></table>')
    elif line.startswith('- ') or re.match(r'^\d+\. ', line):
        ordered = not line.startswith('- ')
        tag = 'ol' if ordered else 'ul'
        items = []
        while i < len(lines) and (bool(re.match(r'^\d+\. ', lines[i])) if ordered else lines[i].startswith('- ')):
            items.append('<li>' + inline(re.sub(r'^(?:\d+\. |\- )', '', lines[i])) + '</li>')
            i += 1
        blocks.append('<' + tag + '>' + ''.join(items) + '</' + tag + '>')
    else:
        text = []
        while i < len(lines) and lines[i].strip():
            text.append(lines[i])
            i += 1
        blocks.append('<p>' + inline(' '.join(text)) + '</p>')
fragment = '\n'.join(blocks) + '\n'
document = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SAAMAN user guide</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f6;color:#152c38;font:16px/1.6 Arial,Helvetica,sans-serif}header{background:#011328;color:white;border-bottom:5px solid #43c6e7;padding:28px max(24px,calc((100% - 920px)/2))}header p{margin:0;color:#bde5ef;font-size:13px;letter-spacing:1px}h1{margin:6px 0;font-size:34px;line-height:1.2}main{max-width:920px;margin:0 auto;padding:28px 32px 48px;background:white}h2{font-size:23px;margin:32px 0 14px;border-bottom:2px solid #43c6e7;padding-bottom:7px;line-height:1.3}p{margin:12px 0}li{padding:3px 0}table{width:100%;border-collapse:collapse;margin:18px 0;font-size:15px}th{background:#1a475f;color:white;text-align:left}td,th{padding:9px 12px;border:1px solid #ccd9df;vertical-align:top}tbody tr:nth-child(even){background:#f1f6f8}code{font:0.94em Consolas,monospace;background:#eef3f5;padding:2px 4px;overflow-wrap:anywhere}footer{max-width:920px;margin:auto;padding:16px 32px;color:#48606d;font-size:13px}@media(max-width:600px){main{padding:18px}h1{font-size:28px}table{font-size:14px}td,th{padding:8px}}@media print{body{background:white;font-size:11pt}header{background:white;color:#152c38;padding:0 0 12px}header p{color:#48606d}main{padding:0;max-width:none}h2{break-after:avoid;font-size:16pt}tr{break-inside:avoid}footer{padding:12px 0}}
</style></head><body><header><p>EUROSCOPE · ESSA</p><h1>SAAMAN user guide</h1></header><main>''' + fragment + '''</main><footer>Controller guide for SAAMAN 1.3.6. All times UTC.</footer></body></html>
'''
outputs = {'docs/user-guide-wiki.html': fragment, 'docs/user-guide.html': document}
for name, content in outputs.items():
    target = root / name
    if '--check' in sys.argv:
        assert target.read_text(encoding='utf-8') == content, f'Regenerate {name}'
    else:
        target.write_text(content, encoding='utf-8')
print(f'User guide: {len(source.split())} words; standalone HTML and wiki fragment agree with Markdown.')
