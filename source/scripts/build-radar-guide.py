"""Controller examples on real ESSA geography, with illustrative aircraft and vectors."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import math,json
root=Path(__file__).resolve().parents[2];out=root/'docs/images'
nav=json.loads((root/'source/ui/src/data/essa-star-distances.json').read_text(encoding='utf-8'))
W,H=1800,1100
BG='#eef3f6';INK='#142e40';RADAR='#424a4e';GREEN='#a6e3a1';RED='#ff737b';YELLOW='#f0e129';WHITE='#e6eeee';PATH='#b9e1e4'
BOUNDS=(16.2,59.46,18.35,60.15)
def f(n,bold=False,mono=False):return ImageFont.truetype('C:/Windows/Fonts/'+('consolab.ttf' if mono else 'arialbd.ttf' if bold else 'arial.ttf'),n)
def txt(d,xy,s,n=30,c=INK,b=False,mono=False):d.text(xy,s,font=f(n,b,mono),fill=c)
def base(title,sub):
 im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im);d.rectangle((0,0,W,144),fill=INK)
 txt(d,(44,27),title,48,'white',True);txt(d,(46,91),sub,27,'#cae1ef')
 txt(d,(44,1054),'ESSA GEOGRAPHY · ILLUSTRATED FLIGHTS / VECTORS · TIMES UTC · ENTRY SPEEDS IAS',21,'#536878')
 return im,d
def arrow(d,a,b,c=PATH,width=4):
 d.line((a,b),fill=c,width=width);angle=math.atan2(b[1]-a[1],b[0]-a[0]);p=[(b[0]-15*math.cos(angle+v),b[1]-15*math.sin(angle+v)) for v in [-.5,.5]];d.polygon([b,*p],fill=c)
def smooth(points):
 # Catmull-Rom interpolation for a single continuous vector path.
 result=[];p=[points[0],*points,points[-1]]
 for i in range(1,len(p)-2):
  a,b,c,e=p[i-1:i+3]
  for k in range(30):
   t=k/30;result.append(tuple(.5*(2*b[j]+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-e[j])*t*t+(-a[j]+3*b[j]-3*c[j]+e[j])*t*t*t) for j in (0,1)))
 return [*result,points[-1]]
def path(d,points):
 p=smooth(points);d.line(p,fill=PATH,width=4)
 if len(p)>45:arrow(d,p[len(p)//2-5],p[len(p)//2+5])
 arrow(d,p[-12],p[-1]);return p
def radar(im,box,holding=False):
 x,y,w,h=box
 # Equal geographic scale on both axes, north up; crop/letterbox is never stretched.
 scale=min(w/((BOUNDS[2]-BOUNDS[0])*math.cos(math.radians(59.8))),h/(BOUNDS[3]-BOUNDS[1]))
 def xy(lat,lon):return ((lon-(BOUNDS[0]+BOUNDS[2])/2)*math.cos(math.radians(59.8))*scale+x+w/2,((BOUNDS[1]+BOUNDS[3])/2-lat)*scale+y+h/2)
 bg=Image.open(out/'essa-guide-geography.png').resize((w,h),Image.Resampling.LANCZOS)
 if holding:
  overlay=Image.open(out/'eltok-guide-hold.png').resize((w,h),Image.Resampling.LANCZOS);bg.paste(overlay,(0,0),overlay)
 im.paste(bg,(x,y));d=ImageDraw.Draw(im)
 # Background was rendered at 1600 x 1000; use that same aspect ratio in every panel.
 assert abs(w/h-1.6)<.01
 for a,b in [('01L','19R'),('01R','19L'),('08','26')]:
  aa,bb=nav['runways'][a],nav['runways'][b];d.line((xy(aa['latitude'],aa['longitude']),xy(bb['latitude'],bb['longitude'])),fill='#d1d9db',width=4)
 for name in ['ELTOK','BALVI','ERXEC','TEB']:
  p=nav['navigation'][name];fx,fy=xy(p['latitude'],p['longitude'])
  d.polygon([(fx,fy-6),(fx-6,fy+5),(fx+6,fy+5)],outline='#a9b5b6',width=1)
  labelx=fx+9 if fx+90<x+w else fx-80
  txt(d,(labelx,fy-11),name,20,'#b3c0c1')
 a=nav['runways']['19L'];ax,ay=xy(a['latitude'],a['longitude']);txt(d,(ax+16,ay+7),'ESSA',22,'#c3cecf',True)
 txt(d,(x+w-40,y+16),'N',23,WHITE,True);arrow(d,(x+w-31,y+68),(x+w-31,y+44),WHITE,2)
 return xy
def plane(d,xy,lat,lon,call,instruction='',details='140  250  A320',offset=(26,-120)):
 x,y=xy(lat,lon);d.rectangle((x-6,y-6,x+6,y+6),outline=WHITE,width=2)
 tx,ty=x+offset[0],y+offset[1]
 if instruction:txt(d,(tx,ty),instruction,34,GREEN,True,True)
 txt(d,(tx,ty+40),call,30,GREEN,True,True);txt(d,(tx,ty+76),details,23,'#c2cecc',mono=True)
 return tx,ty
def card(d,x,y,num,title,lines,w=520):
 d.rounded_rectangle((x,y,x+w,y+148),radius=12,fill='white',outline='#bdced9',width=2)
 d.ellipse((x+17,y+20,x+65,y+68),fill='#247c9c');txt(d,(x+31,y+25),str(num),28,'white',True)
 txt(d,(x+82,y+20),title,30,INK,True)
 for i,line in enumerate(lines):txt(d,(x+23,y+80+i*33),line,26)
def feeder(xy):
 p=nav['navigation']['ELTOK'];return xy(p['latitude'],p['longitude'])
def example_vector(d,xy):
 # Illustrative upstream vector: turn south, then return towards the real feeder.
 path(d,[xy(59.99,16.40),xy(59.95,16.50),xy(59.82,16.50),xy(59.74,16.54),xy(59.73,16.64),xy(59.78,16.80),feeder(xy)])

im,d=base('ACC · Read line 0','Line 0 shows L/G. The yellow/red speed colours are in AMAN, not in the radar label.')
xy=radar(im,(42,190,1088,680));d=ImageDraw.Draw(im);example_vector(d,xy)
tx,ty=plane(d,xy,59.92,16.50,'SAS123','L03')
d.rounded_rectangle((tx-8,ty-5,tx+84,ty+37),radius=6,outline='#80d7ed',width=3)
txt(d,(72,794),'Example vector before ELTOK',29,WHITE,True)
card(d,1170,190,1,'Line 0: L03',['Lose three minutes before','reaching the feeder.'])
card(d,1170,365,2,'L = lose · G = gain',['Normal radar text colour.'])
card(d,1170,540,3,'AMAN · Information',['STA-FF = assigned time','over the feeder.'])
d.rounded_rectangle((42,900,1758,1024),radius=12,fill=INK)
txt(d,(72,918),'IN AMAN',23,WHITE,True);txt(d,(72,956),'Yellow number → 250 kt entry',33,YELLOW,True);txt(d,(928,956),'Red number → 230 kt entry',33,RED,True)
im.save(out/'acc-read-label.png')

im,d=base('ACC · L03 → L00 → turn in','One flight path: extend before ELTOK, then turn back towards the feeder.')
for x,instruction in [(42,'L03'),(920,'L00')]:
 xy=radar(im,(x,232,832,520));d=ImageDraw.Draw(im)
 txt(d,(x,180),'1 · ABSORB TIME' if instruction=='L03' else '2 · TURN TOWARDS ELTOK',30,INK,True)
 example_vector(d,xy)
 if instruction=='L03':plane(d,xy,59.92,16.50,'SAS123','L03',offset=(26,-122))
 else:plane(d,xy,59.755,16.73,'SAS123','L00',offset=(-40,-190))
 txt(d,(x+24,703),'Illustrative vector · north up',24,WHITE)
card(d,42,804,1,'L03',['Turn before the feeder to absorb time.'],w=838)
card(d,920,804,2,'L00',['Turn in; the turn absorbs the last seconds.'],w=838)
im.save(out/'acc-l03-example.png')

im,d=base('ACC · If you decide to hold','Choose vectors, speed or holding to suit the traffic. Here is the holding workflow.')
xy=radar(im,(42,190,1088,680),holding=True);d=ImageDraw.Draw(im)
plane(d,xy,59.886,16.805,'SAS456','L05',offset=(-70,-150))
# The green racetrack is the ELTOK holding geometry from the installed ESAA sector file.
txt(d,(73,794),'ELTOK hold · actual published geometry',28,WHITE,True)
card(d,1170,185,1,'Set TopSky HOLD',['Select the feeder fix.'])
card(d,1170,365,2,'Watch the lose time',['HOLD keeps line 0 visible','through feeder crossings.'])
card(d,1170,545,3,'When ready to leave',['Turn inbound. Clear HOLD','in TopSky when leaving.'])
d.rounded_rectangle((42,900,1758,1020),radius=12,fill=INK)
txt(d,(72,922),'THE CONTROLLER DECIDES WHETHER TO HOLD',26,WHITE,True)
txt(d,(72,962),'Keep the assigned feeder slot. Check STA-FF in AMAN; leave towards TMA at L00.',29,'#c4dce9')
im.save(out/'acc-holding-example.png')

im,d=base('APP · Build the landing order','Runway view shows the sequence. Aircraft inside TMA have no ACC-style L/G instruction.')
d.rounded_rectangle((42,190,650,870),radius=12,fill=RADAR);txt(d,(75,218),'AMAN · RUNWAY 19L',32,'white',True)
d.line((150,302,150,804),fill='#aabfc8',width=3)
for y,minute,call in [(370,'20','RYR789'),(550,'18','SAS123')]:
 txt(d,(83,y-17),minute,27,'#d2e2e8',mono=True);d.ellipse((143,y-7,157,y+7),fill=GREEN);txt(d,(184,y-19),call+'  '+minute,34,GREEN,True,True)
d.line((70,720,620,720),fill=RED,width=3);txt(d,(425,738),'12:16 NOW',24,RED,True)
xy=radar(im,(702,210,1056,660));d=ImageDraw.Draw(im)
a=nav['runways']['19L'];b=nav['runways']['01R']
# Extend the actual 19L centreline north of the threshold for a straight-in example.
lat,lon=a['latitude'],a['longitude'];dy=lat-b['latitude'];dx=lon-b['longitude']
points=[xy(lat+dy*k,lon+dx*k) for k in [11,7,3,0]];path(d,points)
plane(d,xy,lat+dy*3,lon+dx*3,'SAS123',details='050  180  A320',offset=(-270,-10))
plane(d,xy,lat+dy*7,lon+dx*7,'RYR789',details='070  210  B738',offset=(-300,-110))
txt(d,(731,794),'Example straight-in to the real 19L centreline',25,WHITE,True)
card(d,42,900,1,'Read the landing times',['SAS123 12:18, then RYR789 12:20.'],w=838)
card(d,920,900,2,'Need another order?',['Click one callsign, then the other to swap.'],w=838)
im.save(out/'app-sequence-example.png')
print('Built four ESSA controller illustrations with real geography.')
