"""Cut Inkweaver's wings out of the reference art into game textures.

Usage: python3 tools/fx/cut_wings.py REFERENCE.png        (numpy + Pillow)
Writes public/fx/wing_l.png and public/fx/wing_r.png (RGBA, root on the left edge) and prints the
size / root metadata pasted into WING in src/fx/ink.js.

How: the hazy background is estimated by a normalized blur of the bright (non-wing) pixels; the
wing matte is how much darker each pixel is than that background, plus the gold, orange glow next
to the wing; colour is un-premultiplied against the background. Only the two largest dark masses
(the wings) are kept, sparkle holes inside them are filled, the character's column is cut out, and
each wing is cropped with the point where it meets her back recorded (her body = 332 px = 1.66 m).
"""
import sys, os, json
from collections import deque
OUTDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "fx")
from PIL import Image
import numpy as np, sys
im=Image.open(sys.argv[1]).convert('RGB'); W,H=im.size
a=np.asarray(im).astype(np.float32)/255
lum=a@np.array([0.299,0.587,0.114],np.float32)
def box(x, r, axis):
    if r<1: return x
    c=np.cumsum(np.pad(x,[(r+1,r) if i==axis else (0,0) for i in range(x.ndim)],mode='edge'),axis=axis)
    hi=np.take(c, np.arange(2*r+1, 2*r+1+x.shape[axis]), axis=axis); lo=np.take(c, np.arange(0, x.shape[axis]), axis=axis)
    return (hi-lo)/(2*r+1)
def gblur(x, s):
    r=max(1,int(s*0.95))
    for _ in range(3): x=box(box(x,r,0),r,1)
    return x
ss=lambda e0,e1,x: (lambda t: t*t*(3-2*t))(np.clip((x-e0)/(e1-e0),0,1))
mask=(lum>0.27).astype(np.float32)
bg=np.stack([gblur(a[...,c]*mask,30) for c in range(3)],-1)/np.maximum(gblur(mask,30),1e-3)[...,None]
bg=np.clip(bg,0,1)
bgl=bg@np.array([0.299,0.587,0.114],np.float32)
dark=(bgl-lum)/np.maximum(bgl,0.05)
ad=ss(0.10,0.5,dark)
body=gblur((ad>0.5).astype(np.float32),5)
near=gblur((body>0.3).astype(np.float32),8)>0.15
excess=lum-bgl; orange=a[...,0]-a[...,2]
ag=ss(0.06,0.3,excess)*ss(0.12,0.3,orange)*near
alpha=np.clip(gblur(np.maximum(ad,ag),1),0,1)
xs=np.arange(W)[None,:]
alpha=alpha*np.where((xs>548)&(xs<702),0.0,1.0)
A=np.maximum(alpha,1e-3)[...,None]
col=np.clip((a-(1-A)*bg)/A,0,1)
col=np.where(alpha[...,None]>0.04,col,0)
# ---- keep only the two wings: label the dense wing mass (downsampled) and keep the two largest blobs
dense=gblur(ad,4)
m=(dense>0.45)
f=4; hs,ws=H//f,W//f
small=m[:hs*f,:ws*f].reshape(hs,f,ws,f).mean((1,3))>0.5
lab=np.zeros((hs,ws),int); n=0; sizes={}
for y in range(hs):
    for x in range(ws):
        if small[y,x] and not lab[y,x]:
            n+=1; q=deque([(y,x)]); lab[y,x]=n; c=0
            while q:
                cy,cx=q.popleft(); c+=1
                for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny,nx=cy+dy,cx+dx
                    if 0<=ny<hs and 0<=nx<ws and small[ny,nx] and not lab[ny,nx]: lab[ny,nx]=n; q.append((ny,nx))
            sizes[n]=c
keep=sorted(sizes,key=lambda k:-sizes[k])[:2]
kmask=np.isin(lab,keep).astype(np.float32)
big=np.kron(kmask,np.ones((f,f),np.float32)); big=np.pad(big,((0,H-big.shape[0]),(0,W-big.shape[1])))
region=gblur(big,14)>0.04          # the wings plus their soft, smoky edges
alpha=alpha*region
# ---- fill the sparkle holes inside the wing: there the wing is solid and the sparkle is an ember on it
closed=((gblur(big,16)>0.42)&(gblur(big,34)>0.55)).astype(np.float32)   # fill sparkle holes, interior only (edges keep their real shape)
solid=ss(0.35,0.7,gblur(closed,3))
region=region|(closed>0.5)
alpha2=np.maximum(alpha,solid*0.97)
col2=np.where((solid>alpha)[...,None], a, col)
# the big lens flare in the right wing: paint the wing back over it with its surrounding colour
yy,xx=np.indices((H,W)); disc=ss(38,24,np.hypot(xx-1068,yy-226))
wcol=np.stack([gblur(col2[...,c]*alpha2,12) for c in range(3)],-1)/np.maximum(gblur(alpha2,12),1e-3)[...,None]
alpha2=np.maximum(alpha2,disc*0.97); col2=col2*(1-disc[...,None])+wcol*disc[...,None]
xs=np.arange(W)[None,:]
alpha2=alpha2*np.where((xs>548)&(xs<702),0.0,1.0)
# ---- carry each wing in behind her body to her spine: the wing's inner edge (where it vanishes
# behind her) is extended to the centre line, narrowing as it goes, so seen from any side the wing
# grows out of her back; seen from the front her body covers the extension exactly as in the art
CX, RY = 607, 360                     # her centre line, and the height where both wings meet her back
yy,xx=np.indices((H,W))
smooth_a=gblur(alpha2,3); smooth_c=np.stack([gblur(col2[...,c]*alpha2,3) for c in range(3)],-1)/np.maximum(smooth_a,1e-3)[...,None]
for x0, x1, edge in ((CX, 717, 717), (531, CX, 531)):          # from just outside her hair / cloak
    xs_=np.arange(x0,x1); u=np.abs(xs_-CX)/abs(edge-CX)           # 0 at the spine .. 1 at the edge column
    sc=0.5+0.5*u
    for i,x in enumerate(xs_):
        src=np.clip(np.round(RY+(np.arange(H)-RY)/sc[i]).astype(int),0,H-1)
        alpha2[:,x]=smooth_a[src,edge]; col2[:,x]=smooth_c[src,edge]*(0.8+0.2*u[i])
# soften the edges where the art's frame cut the wing tips off
edge=ss(0,14,xx.astype(np.float32))*ss(0,14,(W-1-xx).astype(np.float32))
alpha2=alpha2*edge
# ---- crops (each wing: its bounding box) with the root on the spine
body_px=332.0; body_m=1.66
def crop(x0,x1,flip,name):
    al=alpha2[:,x0:x1]; rows=np.where(al.max(1)>0.03)[0]; y0,y1=max(0,rows.min()-4),min(H,rows.max()+4)
    rgba=np.dstack([col2[y0:y1,x0:x1],al[y0:y1]])
    img=Image.fromarray((np.clip(rgba,0,1)*255+0.5).astype(np.uint8),'RGBA')
    rx,ry=CX-x0,RY-y0; w,h=img.size
    if flip: img=img.transpose(Image.FLIP_LEFT_RIGHT); rx=w-rx
    img.save(os.path.join(OUTDIR, name + '.png'), optimize=True)
    return {'w': round(w/body_px*body_m,3), 'h': round(h/body_px*body_m,3), 'ru': round(rx/w,4), 'rv': round(ry/h,4)}
os.makedirs(OUTDIR, exist_ok=True)
meta={'L': crop(CX,W,False,'wing_l'), 'R': crop(0,CX,True,'wing_r')}
# ---- the backdrop plate for the front-on shot: the art with the wings and her taken out (filled
# with the haze around them), and the light that was behind her painted back in: the halo ring,
# the shaft of light through her, and the warm glow at her chest
# wings: the haze estimate the wing colours were un-premultiplied against, so wing over plate gives back
# the art exactly; her: the light around her, filled in from her surroundings
holew=(gblur((alpha2>0.02).astype(np.float32),4)>0.05).astype(np.float32)
her=np.clip(1-np.maximum(np.abs(xx-CX)/80.0, np.where(yy<255,(255-yy)/6.0,np.where(yy>600,(yy-600)/6.0,0))),0,1)
holeh=(her>0).astype(np.float32)
keep=(1-np.maximum(holew,holeh))
def nfill(s):
    w=gblur(keep,s); return np.stack([gblur(a[...,c]*keep,s) for c in range(3)],-1)/np.maximum(w,1e-4)[...,None], w
f1,w1=nfill(10); f2,w2=nfill(30); f3,w3=nfill(80)
fill=np.where((w1>0.25)[...,None],f1,np.where((w2>0.2)[...,None],f2,f3))
fill=np.stack([gblur(fill[...,c],4) for c in range(3)],-1)
hw=gblur(holew,2)[...,None]; hs=gblur(holeh,8)[...,None]
plate=a*(1-hw)+bg*hw
plate=plate*(1-hs)+fill*hs
# painted light inside the hole only (outside it the art has its own)
gold=np.array([1.0,0.78,0.45],np.float32)
rr=np.hypot(xx-CX,yy-357)
ring=(np.exp(-((rr-180)/1.6)**2)*0.4+np.exp(-((rr-180)/7)**2)*0.1)*(0.55+0.45*np.exp(-((xx-CX)/60.0)**2))
ring=ring+np.exp(-((yy-537)/2.2)**2-((xx-CX)/55.0)**2)*0.9   # the flare where the ring meets the shaft below her
shaft=(np.exp(-((xx-CX)/1.4)**2)*0.85+np.exp(-((xx-CX)/7)**2)*0.22)*ss(560,500,yy)
glow=np.exp(-(np.hypot(xx-CX,(yy-318)*1.15)/70)**2)*0.55
light=(ring+shaft+glow)[...,None]*gold*hs
plate=1-(1-plate)*(1-np.clip(light,0,1))
Image.fromarray((np.clip(plate,0,1)*255+0.5).astype(np.uint8)).save(os.path.join(OUTDIR,'wing_plate.jpg'),quality=90)
meta['plate']={'w':W,'h':H,'root':[CX,RY],'body_px':body_px}
print(json.dumps(meta))
