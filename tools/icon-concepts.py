import math, os, sys
OUT=sys.argv[1]

def rounded_poly(pts, r):
    """Closed path through pts with rounded corners of radius r (quadratic joins)."""
    n=len(pts); d=''
    for i in range(n):
        p0=pts[i-1]; p1=pts[i]; p2=pts[(i+1)%n]
        def toward(a,b,dist):
            vx,vy=b[0]-a[0],b[1]-a[1]; L=math.hypot(vx,vy); return (a[0]+vx/L*dist, a[1]+vy/L*dist)
        a=toward(p1,p0,r); b=toward(p1,p2,r)
        d+=(f'M{a[0]:.1f},{a[1]:.1f}' if i==0 else f'L{a[0]:.1f},{a[1]:.1f}')+f' Q{p1[0]},{p1[1]} {b[0]:.1f},{b[1]:.1f} '
    return d+'Z'

SQ='M256,0 C409,0 512,103 512,256 C512,409 409,512 256,512 C103,512 0,409 0,256 C0,103 103,0 256,0 Z'
# squircle-ish background (superellipse look) via rounded rect is more standard for VS Code; use rx=116
BG_RECT='<rect width="512" height="512" rx="116"/>'

def wrap(defs, body, bg_fill):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
  <clipPath id="sq">{BG_RECT}</clipPath>
  <radialGradient id="sheen" cx="0.28" cy="0.18" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#020617" flood-opacity=".45"/></filter>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#020617" flood-opacity=".35"/></filter>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
  {defs}
</defs>
<g clip-path="url(#sq)">
  <rect width="512" height="512" fill="{bg_fill}"/>
  {body}
  <rect width="512" height="512" fill="url(#sheen)"/>
</g>
<rect x="1.5" y="1.5" width="509" height="509" rx="114.5" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="3"/>
</svg>'''

play_big=rounded_poly([(150,112),(150,400),(400,256)],34)

# 1. LAYERS: three stacked app cards, front one carries the play button
card=lambda x,y,fill,extra='': f'<rect x="{x}" y="{y}" width="236" height="168" rx="36" fill="{fill}" {extra}/>'
play_card=rounded_poly([(274,282),(274,342),(326,312)],10)
layers=wrap(
 '''<linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E1B4B"/><stop offset="1" stop-color="#0B1023"/></linearGradient>
  <linearGradient id="c1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38BDF8"/><stop offset="1" stop-color="#2563EB"/></linearGradient>
  <linearGradient id="c2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818CF8"/><stop offset="1" stop-color="#4F46E5"/></linearGradient>
  <linearGradient id="c3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C4B5FD"/><stop offset=".45" stop-color="#A78BFA"/><stop offset="1" stop-color="#7C3AED"/></linearGradient>''',
 card(100,112,'url(#c1)','opacity=".55" filter="url(#soft)"')+card(138,170,'url(#c2)','opacity=".8" filter="url(#soft)"')
 +card(176,228,'url(#c3)','filter="url(#shadow)"')
 +'<rect x="176" y="228" width="236" height="168" rx="36" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>'
 +f'<circle cx="294" cy="312" r="54" fill="#fff" fill-opacity=".2"/><path d="{play_card}" fill="#fff"/>',
 'url(#bg1)')

# 2. ORBIT: play in the centre, three app nodes on an orbit
def node(a):
    x=256+150*math.cos(math.radians(a)); y=256+150*math.sin(math.radians(a))
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="30" fill="#fff" filter="url(#soft)"/><circle cx="{x:.1f}" cy="{y:.1f}" r="13" fill="url(#bg2)"/>'
play_orbit=rounded_poly([(228,196),(228,316),(330,256)],16)
orbit=wrap(
 '''<linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06B6D4"/><stop offset="1" stop-color="#4F46E5"/></linearGradient>''',
 '<circle cx="256" cy="256" r="150" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="8" stroke-dasharray="2 22" stroke-linecap="round"/>'
 +''.join(node(a) for a in (-90,30,150))
 +f'<circle cx="256" cy="256" r="98" fill="#fff" filter="url(#shadow)"/><path d="{play_orbit}" fill="url(#bg2)"/>',
 'url(#bg2)')

# 3. SPLIT PLAY: one play button made of three app bands
split=wrap(
 f'''<linearGradient id="bg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#030712"/></linearGradient>
  <radialGradient id="halo" cx=".52" cy=".5" r=".5"><stop offset="0" stop-color="#6366F1" stop-opacity=".55"/><stop offset="1" stop-color="#6366F1" stop-opacity="0"/></radialGradient>
  <clipPath id="tri"><path d="{play_big}"/></clipPath>
  <linearGradient id="b1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#38BDF8"/></linearGradient>
  <linearGradient id="b2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#818CF8"/></linearGradient>
  <linearGradient id="b3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A78BFA"/><stop offset="1" stop-color="#E879F9"/></linearGradient>''',
 '<circle cx="256" cy="256" r="240" fill="url(#halo)"/>'
 +'<g filter="url(#shadow)"><g clip-path="url(#tri)">'
 +'<rect x="120" y="90" width="92" height="340" fill="url(#b1)"/>'+'<rect x="226" y="90" width="80" height="340" fill="url(#b2)"/>'+'<rect x="320" y="90" width="110" height="340" fill="url(#b3)"/>'
 +'</g></g>',
 'url(#bg3)')

for name,svg in [('1-layers',layers),('2-orbit',orbit),('3-split-play',split)]:
    open(os.path.join(OUT,name+'.svg'),'w').write(svg)

# preview page: each icon at 192px, plus 64/32 px, on light and dark rows
names=['1-layers','2-orbit','3-split-play']
labels={'1-layers':'1 · Layers','2-orbit':'2 · Orbit','3-split-play':'3 · Split play'}
cells=''.join(f'''<div class="cell"><img src="{n}.svg" width="192" height="192"><div class="small"><img src="{n}.svg" width="64"><img src="{n}.svg" width="32"></div><div class="lbl">{labels[n]}</div></div>''' for n in names)
html=f'''<!doctype html><meta charset="utf-8"><style>
body{{margin:0;font-family:-apple-system,Segoe UI,sans-serif}}
.row{{display:flex;gap:56px;padding:40px 56px;justify-content:center}}
.light{{background:#F3F4F6}} .dark{{background:#1F1F1F}}
.cell{{display:flex;flex-direction:column;align-items:center;gap:14px}}
.small{{display:flex;gap:18px;align-items:center}}
.lbl{{font-size:18px;font-weight:600;color:#374151}} .dark .lbl{{color:#D1D5DB}}
</style><div class="row light">{cells}</div><div class="row dark">{cells}</div>'''
open(os.path.join(OUT,'preview.html'),'w').write(html)
print('ok')
