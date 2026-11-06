// 首页「全球节点分布」卡片：数据（节点、连线、速度）、工具栏（获取最新、地球仪/平面切换、连线筛选、全屏）和页脚；
// 画布本身在 FleetGlobeView（地球仪）与 FleetFlatMap（平面地图），两者共用标签放置、区域取景与缩放逻辑。
import "./fleet-globe.css"
import {useEffect,useMemo,useRef,useState} from "react"
import {Globe2,Map as MapIcon,Maximize2,Minimize2} from "lucide-react"
import {buildCities,matchMetrics,type NodeInfo} from "@/lib/fleet-globe-data"
import {resolveCatalog} from "@/lib/fleet-globe-discover"
import {KIND_LABELS,countryFromTimeZone,fetchHelper,fetchTopologyDoc,dropOfflineLinks,kindsPresent,pickTopology,visitorArcs,type TopoLink} from "@/lib/fleet-globe-topology"
import {kindColors} from "@/lib/fleet-globe-style"
import {readGlobeHelperUrl,readGlobeLinks,readGlobeTopologyUrl} from "@/lib/theme-config"
import FleetFlatMap from "@/components/FleetFlatMap"
import FleetGlobeView from "@/components/FleetGlobeView"
import {readStoredView,writeStoredView,type FlatView} from "@/lib/fleet-flatmap"
import {formatLiteInfo} from "@/lib/utils"
import type {LiteServer} from "@/types/lite-api"

const REFRESH_MS=60000;
export default function FleetGlobe({servers,now}:{servers:LiteServer[];now:number}){
 const [helper,setHelper]=useState<{links:TopoLink[];nodes:NodeInfo[];at:number;updated?:string}|null>(null),[helperBusy,setHelperBusy]=useState(false),[helperFail,setHelperFail]=useState(""),helperUrl=useMemo(()=>readGlobeHelperUrl(),[]);
 const [dark,setDark]=useState(()=>document.documentElement.classList.contains("dark"));
 useEffect(()=>{const el=document.documentElement,sync=()=>setDark(el.classList.contains("dark"));sync();const mo=new MutationObserver(sync);mo.observe(el,{attributes:true,attributeFilter:["class"]});return()=>mo.disconnect();},[]);
 const [view,setViewState]=useState<FlatView>(()=>readStoredView()),setView=(v:FlatView)=>{setViewState(v);writeStoredView(v);};
 const cardRef=useRef<HTMLDivElement>(null),[fullscreen,setFullscreen]=useState(false),canFullscreen=typeof document!=="undefined"&&document.fullscreenEnabled;
 useEffect(()=>{const sync=()=>setFullscreen(document.fullscreenElement!==null&&document.fullscreenElement===cardRef.current);document.addEventListener("fullscreenchange",sync);return()=>document.removeEventListener("fullscreenchange",sync);},[]);
 const toggleFullscreen=()=>{if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});else cardRef.current?.requestFullscreen().catch(()=>{});};
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
 // 离线节点不画线：Lite 里明确离线的机器，它的所有连线（含弧线上的光点）都不显示
 const offline=useMemo(()=>new Set(servers.filter(s=>!formatLiteInfo(now,s).online).map(s=>s.name)),[servers,now]);
 const topo=useMemo(()=>(helper?pickTopology(dropOfflineLinks(helper.links,offline),null,catalog,names):null)||pickTopology(dropOfflineLinks(remote,offline),custom,catalog,names),[helper,remote,custom,names,catalog,offline]);
 const visitor=useMemo(()=>topo?null:visitorArcs(countryFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone),catalog),[topo,catalog]);
 const allNodes=useMemo(()=>[...catalog,...(topo?.extraNodes||[]),...(visitor?[visitor.visitor]:[])],[catalog,topo,visitor]);
 const metrics=useMemo(()=>matchMetrics(allNodes,servers.map(s=>{const i=formatLiteInfo(now,s);return {name:s.name,online:i.online,net_in:s.state?.net_in_speed||0,net_out:s.state?.net_out_speed||0};})),[allNodes,servers,now]);
 const cities=useMemo(()=>buildCities(allNodes,metrics),[allNodes,metrics]);
 const links=topo?.links||visitor?.links||[];
 const kinds=kindsPresent(links);
 useEffect(()=>{if(filter!=="all"&&!kinds.includes(filter as never))setFilter("all");},[filter,kinds]);
 return <div className={dark?"fleet-globe-root is-dark":"fleet-globe-root"}>
  <div className={fullscreen?"map-card is-fs":"map-card"} ref={cardRef}><div className="map-toolbar"><div className="map-title"><Globe2 size={17}/><strong>全球节点分布</strong><span>{cities.length} 座城市</span></div><div className="globe-refresh"><button className="refresh-button" disabled={helperBusy} onClick={()=>void refreshFromHelper()}>{helperBusy?"获取中…":"获取最新"}</button>{helper&&!helperFail?<span>已更新 {new Date(helper.at).toLocaleTimeString("zh-CN",{hour12:false})}（本机助手）{helper.updated?` · 数据生成于 ${helper.updated}`:""}</span>:null}{helperFail?<span>本机助手没响应：在终端运行 sh scripts/topology-helper.sh（{helperFail}）</span>:null}</div><div className="segmented view-switch" role="group" aria-label="地图视图">{([["globe","地球仪",<Globe2 key="g" size={12}/>],["flat","平面",<MapIcon key="m" size={12}/>]] as const).map(([v,t,i])=><button key={v} className={view===v?"chosen":""} aria-pressed={view===v} onClick={()=>setView(v)}>{i}{t}</button>)}</div><div className="segmented" aria-label="连线类型">{[["all","全部"],...kinds.map(k=>[k,KIND_LABELS[k]])].map(([v,t])=><button key={v} className={filter===v?"chosen":""} onClick={()=>setFilter(v)}>{t}</button>)}</div>{canFullscreen?<button className="icon-button" onClick={toggleFullscreen} aria-label={fullscreen?"退出全屏":"全屏查看"} title={fullscreen?"退出全屏（Esc）":"全屏查看，地图更大"}>{fullscreen?<Minimize2 size={14}/>:<Maximize2 size={14}/>}</button>:null}</div>
   {view==="flat"?<FleetFlatMap cities={cities} links={links} selected={selected} onSelect={setSelected} filter={filter} dark={dark}/>:<FleetGlobeView cities={cities} links={links} selected={selected} onSelect={setSelected} filter={filter} dark={dark}/>}
   <div className="map-footer"><div><span><i className="legend-dot"/> 节点</span>{kinds.map(k=><span key={k}><i className="legend-line" style={{background:kindColors(dark)[k]}}/> {KIND_LABELS[k]}</span>)}</div><p>{links.length===0?"设置 GlobeLinks 或 GlobeTopologyUrl 以显示节点关系":topo?"连线表示关系；同城速度汇总":"访客到各节点的示意弧线；设置 GlobeLinks 或 GlobeTopologyUrl 显示真实关系"}</p></div></div>
 </div>;
}
