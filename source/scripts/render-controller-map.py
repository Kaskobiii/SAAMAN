from pathlib import Path
import re,math,argparse
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description='Refresh controller illustrations from an installed ESAA sector file.')
parser.add_argument('sector',type=Path)
sector=parser.parse_args().sector
out=root/'docs/images'
# Render the installed sector geography into an illustration background; no scenario tracks or labels.
BOUNDS=(16.2,59.46,18.35,60.15);W,H=1600,1000
scale=min(W/((BOUNDS[2]-BOUNDS[0])*math.cos(math.radians(59.8))),H/(BOUNDS[3]-BOUNDS[1]))
def xy(lat,lon):return ((lon-(BOUNDS[0]+BOUNDS[2])/2)*math.cos(math.radians(59.8))*scale+W/2,((BOUNDS[1]+BOUNDS[3])/2-lat)*scale+H/2)
def coord(t):
 a=t[1:].split('.');return (int(a[0])+int(a[1])/60+float(a[2]+'.'+a[3])/3600)*(-1 if t[0] in 'SW' else 1)
im=Image.new('RGB',(W,H),'#424a4e');d=ImageDraw.Draw(im);group='';holds=[]
for line in sector.read_text(encoding='cp1252').splitlines():
 m=re.search(r'(N\d{3}\.\d{2}\.\d{2}\.\d+ E\d{3}\.\d{2}\.\d{2}\.\d+) (N\d{3}\.\d{2}\.\d{2}\.\d+ E\d{3}\.\d{2}\.\d{2}\.\d+)',line)
 if not m:continue
 prefix=line[:m.start()].strip()
 if prefix:group=prefix
 a=[coord(t) for t in (m[1]+' '+m[2]).split()];p,q=xy(*a[:2]),xy(*a[2:])
 if 'COLOR_Coastline' in line and all(-10<x<W+10 and -10<y<H+10 for x,y in (p,q)):d.line((p,q),fill='#586165',width=1)
 if group.startswith('HOLDING ELTOK'):holds.append((p,q))
im.save(out/'essa-guide-geography.png')
h=Image.new('RGBA',(W,H));hd=ImageDraw.Draw(h)
for p,q in holds:hd.line((p,q),fill='#a6e3a1',width=5)
h.save(out/'eltok-guide-hold.png')
print('Rendered local ESAA coastline and ELTOK holding pattern.')

