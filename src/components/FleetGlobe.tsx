// 移植自本机「节点星图」fleet-globe（Canvas 2D 手写正交投影）；绘制与交互逻辑保持原样，仅数据来源改为页面已有的 websocket 节点数据。
import "./fleet-globe.css"
import {useEffect,useMemo,useRef,useState} from "react"
import {Minus,Move,Pause,Play,Plus,RotateCcw,Globe2} from "lucide-react"
import {buildCities,buildLinks,fleetLinks,fleetNodes,matchMetrics,rate,type City,type GlobeLink} from "@/lib/fleet-globe-data"
import {formatLiteInfo} from "@/lib/utils"
import type {LiteServer} from "@/types/lite-api"
type Props={cities:City[];links:GlobeLink[];selected:string;onSelect:(city:string)=>void;filter:string};
const D=Math.PI/180;
const vector=(lat:number,lon:number)=>[Math.cos(lat*D)*Math.sin(lon*D),Math.sin(lat*D),Math.cos(lat*D)*Math.cos(lon*D)];
function Globe(props:Props){
 const canvas=useRef<HTMLCanvasElement>(null),wrap=useRef<HTMLDivElement>(null),latest=useRef(props);
 const camera=useRef({lon:168,lat:21,zoom:1,lastInteraction:0}),drag=useRef({active:false,x:0,y:0,moved:false});
 const [rotating,setRotating]=useState(true),rotateRef=useRef(true),[land,setLand]=useState<number[][]>([]);
 const hit=useRef<{x:number;y:number;name:string}[]>([]);
 useEffect(()=>{latest.current=props;},[props]);
 useEffect(()=>{rotateRef.current=rotating;},[rotating]);
 useEffect(()=>{let alive=true;import("@/data/land-dots.json").then(m=>{const d=m.default as unknown;if(alive&&Array.isArray(d))setLand(d as number[][]);}).catch(()=>{});return()=>{alive=false;};},[]);
 useEffect(()=>{
  const el=canvas.current,container=wrap.current;if(!el||!container)return;
  const context=el.getContext("2d");if(!context)return;const ctx=context;
  let width=800,height=620,frame=0,previous=0;
  const resize=()=>{width=container.clientWidth;height=container.clientHeight;const dpr=Math.min(window.devicePixelRatio||1,2);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);};
  resize();const observer=new ResizeObserver(resize);observer.observe(container);
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const draw=(now:number)=>{
   const dt=previous?Math.min(now-previous,40):16;previous=now;
   const cam=camera.current;if(rotateRef.current&&!drag.current.active&&!reduced&&now-cam.lastInteraction>5500)cam.lon+=dt*.0016;
   const radius=Math.min(width*.39,height*.405)*cam.zoom,cx=width*.5,cy=height*.49;
   const yaw=cam.lon*D,pitch=cam.lat*D;
   const project=(v:number[],alt=1)=>{const x=v[0]*Math.cos(yaw)-v[2]*Math.sin(yaw),z0=v[0]*Math.sin(yaw)+v[2]*Math.cos(yaw),y=v[1]*Math.cos(pitch)-z0*Math.sin(pitch),z=v[1]*Math.sin(pitch)+z0*Math.cos(pitch);return{x:cx+x*radius*alt,y:cy-y*radius*alt,z};};
   const point=(lat:number,lon:number)=>project(vector(lat,lon));
   ctx.clearRect(0,0,width,height);
   // Soft emerald atmosphere, with a quiet illuminated base.
   const halo=ctx.createRadialGradient(cx,cy,radius*.6,cx,cy,radius*1.35);halo.addColorStop(0,"rgba(75,211,166,.08)");halo.addColorStop(.72,"rgba(45,192,145,.10)");halo.addColorStop(1,"rgba(45,192,145,0)");ctx.fillStyle=halo;ctx.fillRect(0,0,width,height);
   ctx.save();ctx.translate(cx,cy+radius*1.17);ctx.scale(1,.14);ctx.strokeStyle="rgba(12,153,109,.13)";ctx.lineWidth=1;for(const k of [.62,.83,1.02]){ctx.beginPath();ctx.arc(0,0,radius*k,0,Math.PI*2);ctx.stroke();}ctx.restore();
   const fill=ctx.createRadialGradient(cx-radius*.37,cy-radius*.42,radius*.05,cx+radius*.22,cy+radius*.25,radius*1.22);fill.addColorStop(0,"#168b70");fill.addColorStop(.43,"#08755d");fill.addColorStop(.8,"#035341");fill.addColorStop(1,"#013e33");
   ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.fillStyle=fill;ctx.shadowColor="rgba(22,170,125,.23)";ctx.shadowBlur=28;ctx.fill();ctx.shadowBlur=0;
   ctx.save();ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.clip();
   // Latitude and longitude lines, projected on a sphere rather than a flat map.
   const trace=(coords:number[][],color:string)=>{ctx.beginPath();let open=false;for(const c of coords){const p=point(c[1],c[0]);if(p.z<0){open=false;continue;}if(open)ctx.lineTo(p.x,p.y);else{ctx.moveTo(p.x,p.y);open=true;}}ctx.strokeStyle=color;ctx.lineWidth=.65;ctx.stroke();};
   for(let lat=-60;lat<=60;lat+=30){const c=[];for(let lon=-180;lon<=180;lon+=3)c.push([lon,lat]);trace(c,"rgba(165,255,216,.15)");}
   for(let lon=-180;lon<180;lon+=30){const c=[];for(let lat=-90;lat<=90;lat+=3)c.push([lon,lat]);trace(c,"rgba(165,255,216,.13)");}
   for(const [lon,lat] of land){const p=point(lat,lon);if(p.z<0)continue;const alpha=.26+p.z*.62;ctx.fillStyle=`rgba(211,255,232,${alpha})`;ctx.beginPath();ctx.arc(p.x,p.y,.65+p.z*.55,0,Math.PI*2);ctx.fill();}
   ctx.restore();
   ctx.strokeStyle="rgba(186,255,220,.45)";ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();
   const current=latest.current,byName=new Map(current.cities.map(c=>[c.name,c]));
   const seen=new Set<string>();
   for(const link of current.links){
    if(current.filter!=="all"&&link.kind!==current.filter)continue;
    const a=byName.get(link.from),b=byName.get(link.to);if(!a||!b||a.name===b.name)continue;
    const key=`${a.name}|${b.name}|${link.kind}`;if(seen.has(key))continue;seen.add(key);
    const av=vector(a.lat,a.lon),bv=vector(b.lat,b.lon),omega=Math.acos(Math.max(-1,Math.min(1,av.reduce((s,x,i)=>s+x*bv[i],0)))),sine=Math.sin(omega);
    const at=(t:number)=>{const f=sine?Math.sin((1-t)*omega)/sine:1-t,g=sine?Math.sin(t*omega)/sine:t;return project(av.map((x,i)=>x*f+bv[i]*g),1+Math.sin(t*Math.PI)*(.11+omega*.06));};
    const color=link.kind==="management"?"#f5cc79":"#9cefd0";
    ctx.beginPath();let open=false;for(let i=0;i<=64;i++){const p=at(i/64);if(p.z<-.02){open=false;continue;}if(open)ctx.lineTo(p.x,p.y);else{ctx.moveTo(p.x,p.y);open=true;}}
    ctx.strokeStyle=link.state==="unavailable"?"rgba(205,217,210,.3)":color;ctx.globalAlpha=link.kind==="management"?.84:.58;ctx.lineWidth=link.kind==="management"?1.15:.85;ctx.setLineDash(link.state==="unavailable"?[3,5]:[]);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
    if(link.state!=="unavailable"&&!reduced){for(const offset of [0,.49]){const p=at((now*.00011+offset)%1);if(p.z<0)continue;ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=9;ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}}
   }
   const occupied:{x:number;y:number;w:number;h:number}[]=[];hit.current=[];
   const cities=current.cities.map(c=>({city:c,p:point(c.lat,c.lon)})).filter(x=>x.p.z>0).sort((a,b)=>(b.city.name===current.selected?1:0)-(a.city.name===current.selected?1:0)||b.p.z-a.p.z);
   for(const {city:c,p} of cities){
    const selected=c.name===current.selected,color=c.online?"#d5ffef":"#b1c3bb";
    ctx.strokeStyle=selected?"#fff":"rgba(180,255,220,.55)";ctx.lineWidth=selected?1.4:1;ctx.beginPath();ctx.arc(p.x,p.y,selected?8:5.5,0,Math.PI*2);ctx.stroke();ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,selected?3.6:2.5,0,Math.PI*2);ctx.fill();
    hit.current.push({x:p.x,y:p.y,name:c.name});
    const text=c.name+(c.nodes.length>1?` · ${c.nodes.length}`:""),speed=c.hasData?`↓ ${rate(c.down)}  ↑ ${rate(c.up)}`:"无采样";
    ctx.font="600 12px -apple-system, sans-serif";const w=Math.max(ctx.measureText(text).width,ctx.measureText(speed).width)+15;
    let rect={x:p.x+12,y:p.y-28,w,h:35};
    for(const dy of [-28,8,-54,34]){const candidate={x:Math.min(width-w-12,Math.max(12,p.x+12)),y:Math.min(height-45,Math.max(12,p.y+dy)),w,h:35};if(!occupied.some(r=>candidate.x<r.x+r.w&&candidate.x+candidate.w>r.x&&candidate.y<r.y+r.h&&candidate.y+candidate.h>r.y)){rect=candidate;break;}}
    if(!selected&&occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y))continue;
    occupied.push(rect);ctx.fillStyle=selected?"rgba(0,55,42,.88)":"rgba(0,54,43,.63)";ctx.beginPath();ctx.roundRect(rect.x-5,rect.y-4,rect.w+4,rect.h+5,6);ctx.fill();
    ctx.fillStyle=selected?"#fff":"#e3fff1";ctx.font="600 12px -apple-system, sans-serif";ctx.fillText(text,rect.x,rect.y+10);ctx.fillStyle="#b4e8d2";ctx.font="10px ui-monospace, monospace";ctx.fillText(speed,rect.x,rect.y+26);
   }
   frame=requestAnimationFrame(draw);
  };
  frame=requestAnimationFrame(draw);return()=>{cancelAnimationFrame(frame);observer.disconnect();};
 },[land]);
 const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={active:true,x:e.clientX,y:e.clientY,moved:false};camera.current.lastInteraction=performance.now();};
 const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{const d=drag.current;if(!d.active)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>2)d.moved=true;camera.current.lon-=dx*.25;camera.current.lat=Math.max(-65,Math.min(65,camera.current.lat+dy*.2));d.x=e.clientX;d.y=e.clientY;camera.current.lastInteraction=performance.now();};
 const up=(e:React.PointerEvent<HTMLCanvasElement>)=>{const d=drag.current;d.active=false;camera.current.lastInteraction=performance.now();if(d.moved)return;const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const nearest=hit.current.map(p=>({...p,d:Math.hypot(x-p.x,y-p.y)})).sort((a,b)=>a.d-b.d)[0];if(nearest?.d<23)latest.current.onSelect(nearest.name);};
 return <div className="globe-stage" ref={wrap}>
  <div className="map-caption"><span className="tiny-tag">GLOBAL NETWORK</span><h2>每个节点，都在这里。</h2><p>拖动地球，探索你的连接。</p></div>
  <canvas ref={canvas} aria-label="可拖动的节点地球仪，方向键旋转，Home 复位" tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{drag.current.active=false;}} onKeyDown={e=>{if(e.key==="ArrowLeft")camera.current.lon-=8;else if(e.key==="ArrowRight")camera.current.lon+=8;else if(e.key==="ArrowUp")camera.current.lat=Math.min(65,camera.current.lat+8);else if(e.key==="ArrowDown")camera.current.lat=Math.max(-65,camera.current.lat-8);else if(e.key==="Home")camera.current={lon:168,lat:21,zoom:1,lastInteraction:performance.now()};else return;e.preventDefault();camera.current.lastInteraction=performance.now();}}/>
  <div className="map-coordinates">CITY-LEVEL POSITIONS <span>城市级示意坐标</span></div>
  <div className="globe-controls"><button onClick={()=>{camera.current.zoom=Math.min(1.4,camera.current.zoom+.1);}} aria-label="放大"><Plus size={17}/></button><button onClick={()=>{camera.current.zoom=Math.max(.7,camera.current.zoom-.1);}} aria-label="缩小"><Minus size={17}/></button><i/><button onClick={()=>{camera.current={lon:168,lat:21,zoom:1,lastInteraction:performance.now()};}} aria-label="复位"><RotateCcw size={16}/></button><button onClick={()=>setRotating(!rotating)} aria-label={rotating?"暂停旋转":"自动旋转"}>{rotating?<Pause size={15}/>:<Play size={15}/>}</button></div>
  <div className="map-note"><Move size={13}/> 拖动旋转 <span>·</span> 点击城市高亮</div>
 </div>;
}

export default function FleetGlobe({servers,now}:{servers:LiteServer[];now:number}){
 const [selected,setSelected]=useState(fleetNodes[0].city),[filter,setFilter]=useState("all");
 const metrics=useMemo(()=>matchMetrics(fleetNodes,servers.map(s=>{const i=formatLiteInfo(now,s);return {name:s.name,online:i.online,net_in:s.state?.net_in_speed||0,net_out:s.state?.net_out_speed||0};})),[servers,now]);
 const cities=useMemo(()=>buildCities(fleetNodes,metrics),[metrics]);
 const links=useMemo(()=>buildLinks(fleetNodes,fleetLinks),[]);
 return <div className="fleet-globe-root">
  <div className="map-card"><div className="map-toolbar"><div className="map-title"><Globe2 size={17}/><strong>全球节点分布</strong><span>{cities.length} 座城市</span></div><div className="segmented" aria-label="连线类型">{[["all","全部"],["proxy","代理"],["management","隧道"]].map(([v,t])=><button key={v} className={filter===v?"chosen":""} onClick={()=>setFilter(v)}>{t}</button>)}</div></div>
   <Globe cities={cities} links={links} selected={selected} onSelect={setSelected} filter={filter}/>
   <div className="map-footer"><div><span><i className="legend-dot"/> 节点</span><span><i className="legend-line"/> 代理连接</span><span><i className="legend-line amber"/> 管理隧道</span></div><p>连线表示关系；同城速度汇总</p></div></div>
 </div>;
}
