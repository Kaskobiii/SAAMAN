"""Create original instructional diagrams; these are not live-session screenshots."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out=Path(__file__).resolve().parents[2]/'docs/images'
out.mkdir(exist_ok=True)
def font(size,bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/'+('arialbd.ttf' if bold else 'arial.ttf'),size)
def canvas(title,subtitle):
    im=Image.new('RGB',(1400,820),'#edf2f5');d=ImageDraw.Draw(im)
    d.rectangle((0,0,1400,130),fill='#102b3c')
    d.text((48,28),title,font=font(36,True),fill='white')
    d.text((50,82),subtitle,font=font(22),fill='#bdd9e9')
    d.text((48,780),'ILLUSTRATED EXAMPLE  ·  ALL TIMES UTC',font=font(18),fill='#4f6572')
    return im,d
def text(d,xy,value,size=23,color='#183747',bold=False): d.text(xy,value,font=font(size,bold),fill=color)
def arrow(d,a,b,color='#256587',width=5):
    import math
    d.line((a,b),fill=color,width=width)
    angle=math.atan2(b[1]-a[1],b[0]-a[0]);p=[]
    for delta in [-.48,.48]:p.append((b[0]-18*math.cos(angle+delta),b[1]-18*math.sin(angle+delta)))
    d.polygon([b,*p],fill=color)

im,d=canvas('ACC · Lose time before ELTOK','The assigned crossing stays 12:10 while ACC absorbs the early arrival.')
for x,title,now,instruction in [(48,'1   VECTOR UPSTREAM','12:07','L03'),(724,'2   TURN TOWARDS THE FEEDER','12:09','L00')]:
    d.rounded_rectangle((x,160,x+628,625),radius=16,fill='white',outline='#c2cfd7',width=2)
    text(d,(x+24,182),title,23,bold=True)
    d.rounded_rectangle((x+24,231,x+604,559),radius=8,fill='#4f595f')
    axis=x+95;d.line((axis,259,axis,535),fill='#bdcbd3',width=2)
    for y,label in [(263,'12:12'),(342,'12:10'),(421,'12:08'),(500,'12:06')]:
        d.line((axis-5,y,axis+7,y),fill='#bdcbd3',width=2);text(d,(x+34,y-11),label,16,'#c7d4dc')
    d.ellipse((axis-5,337,axis+5,347),fill='#a6dfab')
    text(d,(axis+22,325),'SAS123   10',27,'#b4e8b9',True)
    text(d,(axis+22,281),'Assigned ELTOK 12:10',20,'#d5e0e8')
    y=461 if instruction=='L03' else 381
    d.line((x+24,y,x+604,y),fill='#ff6468',width=3)
    text(d,(x+426,y+8),now+' NOW',20,'#ffb1b3',True)
    text(d,(x+30,580),'Line 0: '+instruction,25,'#b11b28' if instruction=='L03' else '#183747',True)
text(d,(72,661),'L03: turn before the fix; plan 230 kt entry.',25,bold=True)
text(d,(748,661),'L00: turn in; the turn absorbs the last seconds.',23,bold=True)
text(d,(72,708),'Yellow delay number → 250 kt IAS entry       Red delay number → 230 kt IAS entry',25)
im.save(out/'acc-l03-example.png')

im,d=canvas('ACC · Holding at the feeder','Example: SAS456 has L05 and an assigned ELTOK crossing at 12:15.')
d.rounded_rectangle((48,168,878,617),radius=16,fill='white',outline='#c2cfd7',width=2)
text(d,(78,193),'HOLD AT ELTOK',26,bold=True)
d.rounded_rectangle((129,292,684,476),radius=91,outline='#39738e',width=7)
arrow(d,(290,293),(480,293));arrow(d,(496,475),(301,475))
d.ellipse((672,372,698,398),fill='#ea9c29',outline='#183747',width=2)
text(d,(645,414),'ELTOK',25,bold=True)
arrow(d,(698,385),(834,385),'#4b8b60',6)
text(d,(721,337),'Into TMA',21,'#356b49',True)
text(d,(161,359),'Time the exit turn',28,bold=True)
text(d,(161,400),'for the inbound crossing.',26)
d.rounded_rectangle((910,168,1352,617),radius=16,fill='#4f595f')
text(d,(940,201),'ACC · ELTOK',26,'#d8e6ee',True)
text(d,(940,269),'SAS456     L05',31,'#ff7279',True)
text(d,(940,334),'Assigned feeder',23,'#d8e6ee')
text(d,(940,373),'12:15 UTC',40,'white',True)
text(d,(940,454),'Now 12:10',28,'#ffb1b3')
text(d,(940,516),'Plan release to meet 12:15.',23,'#d8e6ee')
text(d,(68,658),'The first crossing into the hold is not the release into TMA.',28,bold=True)
text(d,(68,706),'Use STA-FF and NOW to plan the next inbound crossing; AMAN does not clear the hold exit.',25)
im.save(out/'acc-holding-example.png')
print('Built two controller illustrations.')
