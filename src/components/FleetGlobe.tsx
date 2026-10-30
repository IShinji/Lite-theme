// 移植自本机「节点星图」fleet-globe（Canvas 2D 手写正交投影）；绘制与交互逻辑保持原样，仅数据来源改为页面已有的 websocket 节点数据。
import "./fleet-globe.css"
import {useEffect,useMemo,useRef,useState} from "react"
import {Minus,Move,Pause,Play,Plus,RotateCcw,Globe2} from "lucide-react"
import {buildCities,matchMetrics,type City,type GlobeLink,type NodeInfo} from "@/lib/fleet-globe-data"
import {resolveCatalog} from "@/lib/fleet-globe-discover"
import {KIND_LABELS,countryFromTimeZone,fetchHelper,fetchTopologyDoc,kindsPresent,pickTopology,visitorArcs,type TopoLink} from "@/lib/fleet-globe-topology"
import {RING_COUNT,cityStates,dotAlpha,dotRadius,globePalette,kindColors,ringState,rgba,staticLayerKey,type Palette} from "@/lib/fleet-globe-style"
import {densifyLand,dotHash,initialView,layoutLabels,rateCompact,type LabelItem} from "@/lib/fleet-globe-layout"
import {arcEnds,createRenderLoop,makeArc,resolveMotion} from "@/lib/fleet-globe-loop"
import {readGlobeHelperUrl,readGlobeLinks,readGlobeMotion,readGlobeTopologyUrl} from "@/lib/theme-config"
import {formatLiteInfo} from "@/lib/utils"
import type {LiteServer} from "@/types/lite-api"
type Props={cities:City[];links:GlobeLink[];selected:string;onSelect:(city:string)=>void;filter:string;dark:boolean};
const D=Math.PI/180;
const vector=(lat:number,lon:number)=>[Math.cos(lat*D)*Math.sin(lon*D),Math.sin(lat*D),Math.cos(lat*D)*Math.cos(lon*D)];
function Globe(props:Props){
 const canvas=useRef<HTMLCanvasElement>(null),wrap=useRef<HTMLDivElement>(null),latest=useRef(props);
 const camera=useRef({lon:168,lat:21,zoom:1,lastInteraction:0}),drag=useRef({active:false,x:0,y:0,moved:false});
 const [rotating,setRotating]=useState(()=>resolveMotion(readGlobeMotion(),window.matchMedia("(prefers-reduced-motion: reduce)").matches)),rotateRef=useRef(rotating),invalidateRef=useRef<()=>void>(()=>{}),[land,setLand]=useState<number[][]>([]);
 const hit=useRef<{x:number;y:number;name:string}[]>([]),hoverRef=useRef(""),viewSet=useRef(false);
 const homeView=()=>{const v=initialView(latest.current.cities);return {lon:v.lon,lat:v.lat,zoom:1,lastInteraction:performance.now()};};
 useEffect(()=>{latest.current=props;invalidateRef.current();},[props]);
 useEffect(()=>{if(viewSet.current||!props.cities.length)return;viewSet.current=true;if(camera.current.lastInteraction)return;const v=initialView(props.cities);camera.current.lon=v.lon;camera.current.lat=v.lat;},[props.cities]);
 useEffect(()=>{rotateRef.current=rotating;invalidateRef.current();},[rotating]);
 useEffect(()=>{let alive=true;import("@/data/land-dots.json").then(m=>{const d=m.default as unknown;if(alive&&Array.isArray(d))setLand(densifyLand(d as number[][]));}).catch(()=>{});return()=>{alive=false;};},[]);
 useEffect(()=>{
  const el=canvas.current,container=wrap.current;if(!el||!container)return;
  const context=el.getContext("2d");if(!context)return;const ctx=context;
  let width=800,height=620,dpr=1,previous=0,visible=true,cacheKey="";
  const layer=document.createElement("canvas"),lctx=layer.getContext("2d");
  const resize=()=>{width=container.clientWidth;height=container.clientHeight;dpr=Math.min(window.devicePixelRatio||1,2);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);layer.width=el.width;layer.height=el.height;cacheKey="";invalidateRef.current();};
  resize();const observer=new ResizeObserver(resize);observer.observe(container);
    const geometry=(cam:{lon:number;lat:number;zoom:number})=>{
   const radius=Math.min(width*.39,height*.405)*cam.zoom,cx=width*.5,cy=height*.49,yaw=cam.lon*D,pitch=cam.lat*D;
   const project=(v:number[],alt=1)=>{const x=v[0]*Math.cos(yaw)-v[2]*Math.sin(yaw),z0=v[0]*Math.sin(yaw)+v[2]*Math.cos(yaw),y=v[1]*Math.cos(pitch)-z0*Math.sin(pitch),z=v[1]*Math.sin(pitch)+z0*Math.cos(pitch);return{x:cx+x*radius*alt,y:cy-y*radius*alt,z};};
   return {radius,cx,cy,project,point:(lat:number,lon:number)=>project(vector(lat,lon))};
  };
  // 静态层：大气光晕、底座椭圆、玻璃球体、经纬网、点阵陆地、高光与边缘光。只在镜头变化超过 0.1 度、尺寸或主题变化时重绘。
  const paintStatic=(c:CanvasRenderingContext2D,cam:{lon:number;lat:number;zoom:number},pal:Palette)=>{
   const {radius,cx,cy,point}=geometry(cam);
   c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);
   const halo=c.createRadialGradient(cx,cy,radius*.7,cx,cy,radius*1.42);halo.addColorStop(0,pal.halo[0]);halo.addColorStop(1,pal.halo[1]);c.fillStyle=halo;c.fillRect(0,0,width,height);
   c.save();c.translate(cx,cy+radius*1.16);c.scale(1,.15);
   const plate=c.createRadialGradient(0,0,radius*.2,0,0,radius*1.3);plate.addColorStop(0,pal.platform);plate.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=plate;c.beginPath();c.arc(0,0,radius*1.3,0,Math.PI*2);c.fill();
   c.strokeStyle=pal.platformLine;c.lineWidth=1;for(const k of [.62,.83,1.02,1.2]){c.beginPath();c.arc(0,0,radius*k,0,Math.PI*2);c.stroke();}c.restore();
   // 略倾斜的外层轨道环：后半在球体之后，前半在球体之前。
   const ringPath=(c2:CanvasRenderingContext2D,from:number,to:number)=>{c2.beginPath();c2.ellipse(cx,cy+radius*.04,radius*1.42,radius*.27,-.32,from,to);};
   const ringStroke=(c2:CanvasRenderingContext2D,from:number,to:number)=>{
    const g=c2.createLinearGradient(cx-radius*1.45,cy,cx+radius*1.45,cy);g.addColorStop(0,`rgba(${pal.ring},0)`);g.addColorStop(.25,`rgba(${pal.ring},.5)`);g.addColorStop(.75,`rgba(${pal.ring},.5)`);g.addColorStop(1,`rgba(${pal.ring},0)`);
    ringPath(c2,from,to);c2.strokeStyle=`rgba(${pal.ring},.1)`;c2.lineWidth=7;c2.stroke();ringPath(c2,from,to);c2.strokeStyle=g;c2.lineWidth=1.2;c2.stroke();
   };
   ringStroke(c,Math.PI,Math.PI*2);
   const fill=c.createRadialGradient(cx-radius*.37,cy-radius*.42,radius*.05,cx+radius*.22,cy+radius*.25,radius*1.22);fill.addColorStop(0,pal.sphere[0]);fill.addColorStop(.43,pal.sphere[1]);fill.addColorStop(.8,pal.sphere[2]);fill.addColorStop(1,pal.sphere[3]);
   c.beginPath();c.arc(cx,cy,radius,0,Math.PI*2);c.fillStyle=fill;c.shadowColor=pal.glow;c.shadowBlur=32;c.fill();c.shadowBlur=0;
   c.save();c.beginPath();c.arc(cx,cy,radius,0,Math.PI*2);c.clip();
   const trace=(coords:number[][],color:string)=>{c.beginPath();let open=false;for(const k of coords){const p=point(k[1],k[0]);if(p.z<0){open=false;continue;}if(open)c.lineTo(p.x,p.y);else{c.moveTo(p.x,p.y);open=true;}}c.strokeStyle=color;c.lineWidth=.6;c.stroke();};
   for(let lat=-60;lat<=60;lat+=30){const k=[];for(let lon=-180;lon<=180;lon+=3)k.push([lon,lat]);trace(k,`rgba(${pal.grid},${pal.gridAlpha})`);}
   for(let lon=-180;lon<180;lon+=30){const k=[];for(let lat=-90;lat<=90;lat+=3)k.push([lon,lat]);trace(k,`rgba(${pal.grid},${pal.gridAlpha*.85})`);}
   // 陆地点按（深度 × 随机亮度）分 12 档批量绘制，点更小更密，亮度有层次。
   const buckets:number[][][]=Array.from({length:12},()=>[]);
   for(const [lon,lat] of land){const p=point(lat,lon);if(p.z<=0)continue;buckets[Math.min(5,Math.floor(p.z*6))*2+(dotHash(lon,lat)>.5?1:0)].push([p.x,p.y,p.z]);}
   buckets.forEach((list,i)=>{if(!list.length)return;const z=(Math.floor(i/2)+.5)/6,tint=i%2?1:.72;c.fillStyle=`rgba(${pal.land},${(dotAlpha(z)*tint).toFixed(3)})`;c.beginPath();for(const q of list){const r=dotRadius(q[2]);c.moveTo(q[0]+r,q[1]);c.arc(q[0],q[1],r,0,Math.PI*2);}c.fill();});
   // 左上高光、右下暗角与边缘光。
   const spec=c.createRadialGradient(cx-radius*.4,cy-radius*.46,0,cx-radius*.4,cy-radius*.46,radius*.8);spec.addColorStop(0,`rgba(${pal.highlight},${pal.highlightAlpha})`);spec.addColorStop(1,`rgba(${pal.highlight},0)`);c.fillStyle=spec;c.fillRect(cx-radius,cy-radius,radius*2,radius*2);
   const shade=c.createRadialGradient(cx+radius*.3,cy+radius*.35,radius*.35,cx+radius*.1,cy+radius*.1,radius*1.05);shade.addColorStop(0,`rgba(${pal.shade},0)`);shade.addColorStop(1,`rgba(${pal.shade},${pal.shadeAlpha})`);c.fillStyle=shade;c.fillRect(cx-radius,cy-radius,radius*2,radius*2);
   const rim=c.createRadialGradient(cx,cy,radius*.8,cx,cy,radius);rim.addColorStop(0,`rgba(${pal.rim},0)`);rim.addColorStop(.82,`rgba(${pal.rim},${pal.rimAlpha*.2})`);rim.addColorStop(1,`rgba(${pal.rim},${pal.rimAlpha})`);c.fillStyle=rim;c.fillRect(cx-radius,cy-radius,radius*2,radius*2);
   c.restore();
   c.strokeStyle=pal.edge;c.lineWidth=1;c.beginPath();c.arc(cx,cy,radius,0,Math.PI*2);c.stroke();
   ringStroke(c,0,Math.PI);
  };
  const render=(now:number)=>{
   const playing=rotateRef.current;
   const dt=previous?Math.min(now-previous,40):16;previous=now;
   const cam=camera.current;if(playing&&!drag.current.active&&now-cam.lastInteraction>5500)cam.lon+=dt*.0016;
   const current=latest.current,pal=globePalette(current.dark),colors=kindColors(current.dark);
   const {cx,cy,project,point}=geometry(cam);
   const key=staticLayerKey(cam,width,height,current.dark,land.length);
   if(key!==cacheKey&&lctx){paintStatic(lctx,cam,pal);cacheKey=key;}
   ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,el.width,el.height);ctx.drawImage(layer,0,0);ctx.setTransform(dpr,0,0,dpr,0,0);
   const byName=new Map(current.cities.map(c=>[c.name,c]));
   const seen=new Set<string>();
   for(const link of current.links){
    if(current.filter!=="all"&&link.kind!==current.filter)continue;
    const a=byName.get(link.from),b=byName.get(link.to);if(!a||!b||a.name===b.name)continue;
    const key2=`${a.name}|${b.name}|${link.kind}`;if(seen.has(key2))continue;seen.add(key2);
    const arc=makeArc(a,b,project),at=arc.at;
    const color=colors[link.kind]||colors.exit,down=link.state==="down",active=link.state==="active";
    const pts=arc.segments();
    const trace=()=>{ctx.beginPath();for(const sg of pts){ctx.moveTo(sg[0].x,sg[0].y);for(let i=1;i<sg.length;i++)ctx.lineTo(sg[i].x,sg[i].y);}};
    if(down){trace();ctx.strokeStyle="rgba(205,217,210,.3)";ctx.globalAlpha=.58;ctx.lineWidth=.85;ctx.setLineDash([3,5]);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;continue;}
    // 光晕层：更宽更淡，lighter 叠加。
    ctx.save();if(pal.additive)ctx.globalCompositeOperation="lighter";trace();ctx.strokeStyle=rgba(color,active?(pal.additive?.16:.14):(pal.additive?.07:.06));ctx.lineWidth=active?6:4;ctx.lineCap="round";ctx.stroke();ctx.restore();
    // 主线：两端淡、中段亮的渐变描边。
    const ends=arcEnds(pts);if(!ends)continue;
    const first=ends.first,last=ends.last,grad=ctx.createLinearGradient(first.x,first.y,last.x,last.y);
    const peak=active?.95:.62;grad.addColorStop(0,rgba(color,peak*.35));grad.addColorStop(.5,rgba(color,peak));grad.addColorStop(1,rgba(color,peak*.35));
    trace();ctx.strokeStyle=grad;ctx.lineWidth=active?1.5:.85;ctx.stroke();
    if(playing){for(const offset of [0,.49]){const head=(now*.00011+offset)%1;
     for(let k=5;k>=1;k--){const t=head-k*.012;if(t<0)continue;const p=at(t);if(p.z<0)continue;ctx.fillStyle=rgba(color,.5*(1-k/6));ctx.beginPath();ctx.arc(p.x,p.y,2.2*(1-k/7),0,Math.PI*2);ctx.fill();}
     const p=at(head);if(p.z<0)continue;ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=9;ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}}
   }
   const states=cityStates(current.links),hover=hoverRef.current,ringRGB=pal.dark?pal.nodeRing:pal.ring;
   hit.current=[];
   const cities=current.cities.map(c=>({city:c,p:point(c.lat,c.lon)})).filter(x=>x.p.z>0).sort((a,b)=>b.p.z-a.p.z);
   const items:LabelItem[]=[],texts=new Map<string,{text:string;speed:string}>();
   for(const {city:c,p} of cities){
    const selected=c.name===current.selected,st=states.get(c.name),downOnly=st==="down",color=c.visitor?"#ffe9a8":(c.online&&!downOnly)?pal.nodeCore:pal.nodeOffline;
    const fade=Math.min(1,p.z*3+.15);
    // 发光圆点；仅 active 的节点带向外扩散并渐隐的光圈，standby 静态，down 灰。
    const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,selected?18:13);glow.addColorStop(0,`rgba(${pal.nodeGlow},${downOnly?.1:.42*fade})`);glow.addColorStop(1,`rgba(${pal.nodeGlow},0)`);ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,selected?18:13,0,Math.PI*2);ctx.fill();
    if(st==="active"&&playing){for(let i=0;i<RING_COUNT;i++){const r=ringState(now,i);ctx.strokeStyle=`rgba(${ringRGB},${(r.alpha*fade).toFixed(3)})`;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(p.x,p.y,r.radius,0,Math.PI*2);ctx.stroke();}}
    ctx.strokeStyle=selected?(pal.dark?"#fff":"#0a6e50"):`rgba(${ringRGB},.6)`;ctx.lineWidth=selected?1.4:1;ctx.beginPath();ctx.arc(p.x,p.y,selected?8:5.5,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,selected?3.8:2.8,0,Math.PI*2);ctx.fill();ctx.strokeStyle=pal.nodeStroke;ctx.lineWidth=1.4;ctx.stroke();
    hit.current.push({x:p.x,y:p.y,name:c.name});
    const text=c.name+(c.nodes.length>1?` · ${c.nodes.length}`:""),speed=c.visitor?"你的位置":c.hasData?`↓${rateCompact(c.down)} ↑${rateCompact(c.up)}`:"";
    ctx.font="600 11px -apple-system, sans-serif";const w1=ctx.measureText(text).width;ctx.font="9px ui-monospace, monospace";const w2=speed?ctx.measureText(speed).width:0;
    const pinned=selected||c.name===hover,h=speed?25:16;
    texts.set(c.name,{text,speed});
    items.push({key:c.name,x:p.x+9,y:p.y-h-3,w:Math.max(w1,w2)+12,h,smallW:w1+10,smallH:16,priority:(c.down+c.up)+(c.hasData?1:0)+p.z*.01+(pinned?1e12:0),pinned});
   }
   const placed=layoutLabels(items,{x:cx,y:cy},{w:width,h:height});
   for(const l of placed.slice().reverse()){
    if(l.mode==="hidden")continue;
    const t=texts.get(l.key);if(!t)continue;const strong=l.key===current.selected||l.key===hover;
    ctx.fillStyle=strong?pal.labelBgSelected:pal.labelBg;ctx.beginPath();ctx.roundRect(l.x,l.y,l.w,l.h,4);ctx.fill();ctx.strokeStyle=pal.labelBorder;ctx.lineWidth=.8;ctx.stroke();
    ctx.fillStyle=pal.labelName;ctx.font="600 11px -apple-system, sans-serif";ctx.fillText(t.text,l.x+6,l.y+11.5);
    if(l.mode==="full"&&t.speed){ctx.fillStyle=pal.labelSpeed;ctx.font="9px ui-monospace, monospace";ctx.fillText(t.speed,l.x+6,l.y+21.5);}
   }
  };
  const loop=createRenderLoop({raf:cb=>requestAnimationFrame(cb),caf:id=>cancelAnimationFrame(id),render,playing:()=>rotateRef.current,canRun:()=>visible&&!document.hidden,onError:e=>console.error("[FleetGlobe] draw failed",e)});
  invalidateRef.current=loop.invalidate;
  // 页面不可见或滚出视口时停止动画循环，回来后恢复。
  const start=()=>{previous=0;loop.start();};
  const io=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible)start();});io.observe(container);
  document.addEventListener("visibilitychange",start);
  start();
  return()=>{loop.stop();invalidateRef.current=()=>{};observer.disconnect();io.disconnect();document.removeEventListener("visibilitychange",start);};
 },[land]);
 const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{invalidateRef.current();e.currentTarget.setPointerCapture(e.pointerId);drag.current={active:true,x:e.clientX,y:e.clientY,moved:false};camera.current.lastInteraction=performance.now();};
 const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{invalidateRef.current();const d=drag.current;if(!d.active){const rc=e.currentTarget.getBoundingClientRect(),hx=e.clientX-rc.left,hy=e.clientY-rc.top;const n=hit.current.map(q=>({...q,d:Math.hypot(hx-q.x,hy-q.y)})).sort((a,b)=>a.d-b.d)[0];hoverRef.current=n&&n.d<23?n.name:"";return;}const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>2)d.moved=true;camera.current.lon-=dx*.25;camera.current.lat=Math.max(-65,Math.min(65,camera.current.lat+dy*.2));d.x=e.clientX;d.y=e.clientY;camera.current.lastInteraction=performance.now();};
 const up=(e:React.PointerEvent<HTMLCanvasElement>)=>{invalidateRef.current();const d=drag.current;d.active=false;camera.current.lastInteraction=performance.now();if(d.moved)return;const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const nearest=hit.current.map(p=>({...p,d:Math.hypot(x-p.x,y-p.y)})).sort((a,b)=>a.d-b.d)[0];if(nearest?.d<23)latest.current.onSelect(nearest.name);};
 return <div className="globe-stage" ref={wrap}>
  <div className="map-caption"><span className="tiny-tag">GLOBAL NETWORK</span><h2>每个节点，都在这里。</h2><p>拖动地球，探索你的连接。</p></div>
  <canvas ref={canvas} aria-label="可拖动的节点地球仪，方向键旋转，Home 复位" tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={()=>{hoverRef.current="";invalidateRef.current();}} onPointerCancel={()=>{drag.current.active=false;}} onKeyDown={e=>{if(e.key==="ArrowLeft")camera.current.lon-=8;else if(e.key==="ArrowRight")camera.current.lon+=8;else if(e.key==="ArrowUp")camera.current.lat=Math.min(65,camera.current.lat+8);else if(e.key==="ArrowDown")camera.current.lat=Math.max(-65,camera.current.lat-8);else if(e.key==="Home")camera.current=homeView();else return;e.preventDefault();invalidateRef.current();camera.current.lastInteraction=performance.now();}}/>
  <div className="map-coordinates">CITY-LEVEL POSITIONS <span>城市级示意坐标</span></div>
  <div className="globe-controls"><button onClick={()=>{invalidateRef.current();camera.current.zoom=Math.min(1.4,camera.current.zoom+.1);}} aria-label="放大"><Plus size={17}/></button><button onClick={()=>{invalidateRef.current();camera.current.zoom=Math.max(.7,camera.current.zoom-.1);}} aria-label="缩小"><Minus size={17}/></button><i/><button onClick={()=>{invalidateRef.current();camera.current=homeView();}} aria-label="复位"><RotateCcw size={16}/></button><button onClick={()=>setRotating(!rotating)} aria-label={rotating?"暂停旋转":"自动旋转"} title={rotating?"动画开启：点击暂停":"动画关闭：点击播放"}>{rotating?<Pause size={15}/>:<Play size={15}/>}</button></div>
  <div className="map-note"><Move size={13}/> 拖动旋转 <span>·</span> 点击城市高亮</div>
 </div>;
}

const REFRESH_MS=60000;
export default function FleetGlobe({servers,now}:{servers:LiteServer[];now:number}){
 const [helper,setHelper]=useState<{links:TopoLink[];nodes:NodeInfo[];at:number;updated?:string}|null>(null),[helperBusy,setHelperBusy]=useState(false),[helperFail,setHelperFail]=useState(""),helperUrl=useMemo(()=>readGlobeHelperUrl(),[]);
 const [dark,setDark]=useState(()=>document.documentElement.classList.contains("dark"));
 useEffect(()=>{const el=document.documentElement,sync=()=>setDark(el.classList.contains("dark"));sync();const mo=new MutationObserver(sync);mo.observe(el,{attributes:true,attributeFilter:["class"]});return()=>mo.disconnect();},[]);
 const [selected,setSelected]=useState(""),[filter,setFilter]=useState("all"),[remote,setRemote]=useState<TopoLink[]|null>(null),[remoteNodes,setRemoteNodes]=useState<NodeInfo[]>([]);
 const custom=useMemo(()=>readGlobeLinks(),[]),url=useMemo(()=>readGlobeTopologyUrl(),[]);
 useEffect(()=>{
  if(!url)return;let alive=true,timer=0;
  const load=async()=>{if(document.hidden)return;const r=await fetchTopologyDoc(url);if(alive){setRemote(r?r.links:null);setRemoteNodes(r?r.nodes:[]);}};
  const tick=()=>{void load();};
  void load();timer=window.setInterval(tick,REFRESH_MS);document.addEventListener("visibilitychange",tick);
  return()=>{alive=false;window.clearInterval(timer);document.removeEventListener("visibilitychange",tick);};
 },[url]);
 const names=useMemo(()=>servers.map(s=>({name:s.name,country_code:s.country_code})),[servers]);
 // 节点坐标不写死：发布的拓扑 JSON 里的 nodes（接入时记下的）为准，Lite 实时节点里没发布的按统一名自动定位（城市表 > 国家中心）
 const published=helper&&helper.nodes.length?helper.nodes:remoteNodes;
 const catalog=useMemo(()=>resolveCatalog(published,names),[published,names]);
 const refreshFromHelper=async()=>{
  if(helperBusy||document.hidden)return;setHelperBusy(true);
  const r=await fetchHelper(helperUrl);
  if(r.ok){setHelper({links:r.links,nodes:r.nodes,at:Date.now(),updated:r.updated});setHelperFail("");}else setHelperFail({network:"网络",timeout:"超时",format:"格式"}[r.reason]);
  setHelperBusy(false);
 };
 const topo=useMemo(()=>(helper?pickTopology(helper.links,null,catalog,names):null)||pickTopology(remote,custom,catalog,names),[helper,remote,custom,names,catalog]);
 const visitor=useMemo(()=>topo?null:visitorArcs(countryFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone),catalog),[topo,catalog]);
 const allNodes=useMemo(()=>[...catalog,...(topo?.extraNodes||[]),...(visitor?[visitor.visitor]:[])],[catalog,topo,visitor]);
 const metrics=useMemo(()=>matchMetrics(allNodes,servers.map(s=>{const i=formatLiteInfo(now,s);return {name:s.name,online:i.online,net_in:s.state?.net_in_speed||0,net_out:s.state?.net_out_speed||0};})),[allNodes,servers,now]);
 const cities=useMemo(()=>buildCities(allNodes,metrics),[allNodes,metrics]);
 const links=topo?.links||visitor?.links||[];
 const kinds=kindsPresent(links);
 useEffect(()=>{if(filter!=="all"&&!kinds.includes(filter as never))setFilter("all");},[filter,kinds]);
 return <div className={dark?"fleet-globe-root is-dark":"fleet-globe-root"}>
  <div className="map-card"><div className="map-toolbar"><div className="map-title"><Globe2 size={17}/><strong>全球节点分布</strong><span>{cities.length} 座城市</span></div><div className="globe-refresh"><button className="refresh-button" disabled={helperBusy} onClick={()=>void refreshFromHelper()}>{helperBusy?"获取中…":"获取最新"}</button>{helper&&!helperFail?<span>已更新 {new Date(helper.at).toLocaleTimeString("zh-CN",{hour12:false})}（本机助手）{helper.updated?` · 数据生成于 ${helper.updated}`:""}</span>:null}{helperFail?<span>本机助手没响应：在终端运行 sh scripts/topology-helper.sh（{helperFail}）</span>:null}</div><div className="segmented" aria-label="连线类型">{[["all","全部"],...kinds.map(k=>[k,KIND_LABELS[k]])].map(([v,t])=><button key={v} className={filter===v?"chosen":""} onClick={()=>setFilter(v)}>{t}</button>)}</div></div>
   <Globe cities={cities} links={links} selected={selected} onSelect={setSelected} filter={filter} dark={dark}/>
   <div className="map-footer"><div><span><i className="legend-dot"/> 节点</span>{kinds.map(k=><span key={k}><i className="legend-line" style={{background:kindColors(dark)[k]}}/> {KIND_LABELS[k]}</span>)}</div><p>{links.length===0?"设置 GlobeLinks 或 GlobeTopologyUrl 以显示节点关系":topo?"连线表示关系；同城速度汇总":"访客到各节点的示意弧线；设置 GlobeLinks 或 GlobeTopologyUrl 显示真实关系"}</p></div></div>
 </div>;
}
