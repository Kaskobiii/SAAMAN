"""Draw original radar-style training examples, not live screenshots or charts."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import math

out=Path(__file__).resolve().parents[2]/'docs/images';out.mkdir(exist_ok=True)
W,H=1800,1100
BG='#eef3f6';INK='#142e40';RADAR='#424a4e';GREEN='#a6e3a1';RED='#ff737b';YELLOW='#f0e129'
def f(n,bold=False,mono=False):return ImageFont.truetype('C:/Windows/Fonts/'+('consolab.ttf' if mono else 'arialbd.ttf' if bold else 'arial.ttf'),n)
def txt(d,xy,s,n=30,c=INK,b=False,mono=False):d.text(xy,s,font=f(n,b,mono),fill=c)
def base(title,sub):
 im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im);d.rectangle((0,0,W,144),fill=INK)
 txt(d,(44,27),title,48,'white',True);txt(d,(46,91),sub,27,'#cae1ef')
 txt(d,(44,1054),'ILLUSTRATED RADAR EXAMPLE  ·  TIMES UTC  ·  ENTRY SPEEDS IAS',21,'#536878')
 return im,d
def arrow(d,a,b,c='#e9e9e9',width=5):
 d.line((a,b),fill=c,width=width);angle=math.atan2(b[1]-a[1],b[0]-a[0]);p=[(b[0]-18*math.cos(angle+v),b[1]-18*math.sin(angle+v)) for v in [-.5,.5]];d.polygon([b,*p],fill=c)
def radar(d,box):
 x,y,w,h=box;d.rounded_rectangle((x,y,x+w,y+h),radius=12,fill=RADAR)
 # Stylised coastline and sector boundary give the same visual context as a radar picture.
 coast=[(.65,.03),(.61,.15),(.69,.26),(.64,.35),(.77,.44),(.7,.55),(.8,.68),(.74,.79),(.86,.94)]
 pts=[(x+a*w,y+b*h) for a,b in coast];d.line(pts,fill='#727c80',width=2)
 for a in [.18,.48,.78]:
  for z in range(12):d.line((x+z*w/12,y+a*h,x+(z+.5)*w/12,y+a*h),fill='#606b71',width=1)
 for a,b in [(.19,.3),(.35,.62),(.56,.25)]:d.arc((x+a*w-22,y+b*h-22,x+a*w+22,y+b*h+22),0,360,fill='#727f86',width=1)
def fix(d,x,y,name):
 d.polygon([(x,y-11),(x-10,y+9),(x+10,y+9)],outline=GREEN,width=2);txt(d,(x+17,y-17),name,27,GREEN,True)
def plane(d,x,y,tag,line0,delay='L03',color=RED,details='140  250  A320'):
 for i in range(1,5):d.ellipse((x-18*i-2,y+6*i-2,x-18*i+2,y+6*i+2),fill='#a0aeb5')
 d.rectangle((x-6,y-6,x+6,y+6),outline='white',width=2)
 tx,ty=(x-300 if x>1450 else x+48),y-115;d.line((x+6,y-3,tx-8,ty+68),fill='#bac5ca',width=2)
 txt(d,(tx,ty),line0,38,GREEN,True,True)
 if delay:txt(d,(tx+135,ty),delay,38,color,True,True)
 txt(d,(tx,ty+45),tag,34,GREEN,True,True);txt(d,(tx,ty+85),details,25,'#c2cecc',mono=True)
 return tx,ty
def card(d,x,y,num,title,lines,w=520):
 d.rounded_rectangle((x,y,x+w,y+148),radius=12,fill='white',outline='#bdced9',width=2)
 d.ellipse((x+17,y+20,x+65,y+68),fill='#247c9c');txt(d,(x+31,y+25),str(num),28,'white',True)
 txt(d,(x+82,y+20),title,31,INK,True)
 for i,line in enumerate(lines):txt(d,(x+23,y+80+i*33),line,26)

im,d=base('ACC · Read line 0','Look at the time, then the L/G instruction. The colour tells you the entry speed.')
radar(d,(42,178,1090,690));fix(d,926,681,'ELTOK');fix(d,1015,790,'TEB')
d.line((370,582,926,681,1015,790),fill=GREEN,width=3)
tx,ty=plane(d,370,582,'SAS123','1210','L03')
d.rounded_rectangle((tx-9,ty-7,tx+269,ty+44),radius=7,outline=RED,width=3)
arrow(d,(tx+46,ty-14),(tx+46,296),'#7fd5ff',3);txt(d,(tx-40,251),'TIME AT FEEDER',28,'#a5e5ff',True)
arrow(d,(tx+192,ty+130),(tx+192,735),RED,3);txt(d,(tx+112,748),'LOSE 3 MIN',30,RED,True)
card(d,1170,190,1,'1210',['Cross ELTOK at 12:10.'])
card(d,1170,365,2,'L03',['Lose three minutes before','reaching the feeder.'])
card(d,1170,540,3,'Red number',['Give 230 kt entry speed.'])
d.rounded_rectangle((42,900,1758,1016),radius=12,fill=INK)
txt(d,(76,936),'Yellow → 250 kt entry',37,YELLOW,True);txt(d,(735,936),'Red → 230 kt entry',37,RED,True)
im.save(out/'acc-read-label.png')

im,d=base('ACC · L03 → L00 → turn in','Use vectors before the feeder. Turn towards it at L00; the turn absorbs the last seconds.')
for x,step,instruction in [(42,'1   L03: TURN BEFORE THE FIX','L03'),(920,'2   L00: TURN TOWARDS THE FIX','L00')]:
 radar(d,(x,190,838,665));txt(d,(x+24,213),step,30,'white',True)
 fix(d,x+605,650,'ELTOK')
 if instruction=='L03':
  d.line((x+210,590,x+300,500,x+300,370),fill=GREEN,width=3);arrow(d,(x+300,455),(x+300,370),GREEN)
  plane(d,x+300,500,'SAS123','1210',instruction)
  txt(d,(x+46,760),'Add track miles before ELTOK.',30,'white',True)
 else:
  arrow(d,(x+286,510),(x+595,645),GREEN)
  plane(d,x+286,510,'SAS123','1210',instruction,'#dfebeb')
  txt(d,(x+46,760),'Turn inbound and cross at 12:10.',30,'white',True)
card(d,42,884,1,'L03',['Turn away before the feeder.'],w=838)
card(d,920,884,2,'L00',['Turn in. AMAN’s zero number is blank.'],w=838)
im.save(out/'acc-l03-example.png')

im,d=base('ACC · L05 or more? Use a hold','Set HOLD at the feeder in TopSky. Keep the assigned feeder time while you absorb the delay.')
radar(d,(42,180,1090,755))
d.rounded_rectangle((200,440,880,730),radius=145,outline=GREEN,width=4)
arrow(d,(440,440),(610,440),GREEN);arrow(d,(610,730),(440,730),GREEN)
fix(d,880,585,'ELTOK');plane(d,505,440,'SAS456','1215','L05')
txt(d,(310,625),'HOLD AT ELTOK',36,'#d3e4e0',True)
arrow(d,(889,585),(1050,745),GREEN,3);txt(d,(876,785),'TOWARDS TMA',24,GREEN,True)
card(d,1170,185,1,'Set TopSky HOLD',['Select the feeder fix.'])
card(d,1170,365,2,'Watch L05 → L00',['HOLD keeps line 0 visible','through feeder crossings.'])
card(d,1170,545,3,'At L00: leave the hold',['Turn inbound. Clear HOLD','in TopSky when leaving.'])
d.rounded_rectangle((1170,745,1690,915),radius=12,fill=INK)
txt(d,(1194,766),'Assigned ELTOK',29,'#c4dce9');txt(d,(1194,810),'12:15 UTC',42,'white',True)
txt(d,(62,965),'Aim for the assigned feeder time. Leave the slot alone while flying the hold.',33,INK,True)
im.save(out/'acc-holding-example.png')

im,d=base('APP · Build this landing order','Runway view gives the landing sequence. Aircraft inside TMA show sequence times, without L/G.')
d.rounded_rectangle((42,190,650,864),radius=12,fill=RADAR);txt(d,(75,218),'AMAN · RUNWAY 19L',32,'white',True)
d.line((150,302,150,804),fill='#aabfc8',width=3)
for y,minute,call in [(370,'20','RYR789'),(550,'18','SAS123')]:
 txt(d,(83,y-17),minute,27,'#d2e2e8',mono=True);d.ellipse((143,y-7,157,y+7),fill=GREEN);txt(d,(184,y-19),call+'  '+minute,34,GREEN,True,True)
d.line((70,720,620,720),fill=RED,width=3);txt(d,(425,738),'12:16 NOW',24,RED,True)
radar(d,(700,190,1058,674));fix(d,980,420,'TEB');fix(d,1570,744,'ESSA')
d.line((980,420,1390,420,1540,590,1570,744),fill=GREEN,width=3)
plane(d,1515,610,'SAS123','',delay='',details='050  180  A320');plane(d,1120,420,'RYR789','',delay='',details='070  210  B738')
txt(d,(770,774),'SAS123 first → RYR789 second',32,'white',True)
card(d,42,892,1,'Read the landing times',['SAS123 12:18, then RYR789 12:20.'],w=838)
card(d,920,892,2,'Need another order?',['Click one callsign, then the other to swap.'],w=838)
im.save(out/'app-sequence-example.png')
print('Built four radar-style controller examples.')
