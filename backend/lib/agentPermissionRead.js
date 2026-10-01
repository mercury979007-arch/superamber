const {performance}=require('node:perf_hooks');
const {dedupeClassMap,extractMySquadClassMap,extractDashboardTutorId,extractDashboardClassMap}=require('./classMapParser');
const {applyCoHeadTeacherClasses}=require('./coHeadTeacherClasses');
const inFlight=new WeakMap();

// No permission TTL or stale-cache fallback: only simultaneous fresh checks
// for the exact scraper session share work. Every later check reads upstream.
function freshAgentPermissions(scraper,{timeoutMs=6500}={}){
  if(inFlight.has(scraper))return inFlight.get(scraper);
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{
    const error=Object.assign(Error('教务权限读取超时，请稍后重试。'),{code:'SOURCE_PERMISSION_TIMEOUT'});
    controller.abort(error);reject(error);
  },timeoutMs);});
  const work=Promise.race([Promise.resolve().then(()=>scraper.getClassMap(true,{authorization:true,signal:controller.signal})),timeout])
    .catch(error=>{controller.abort(error);throw error;})
    .finally(()=>{clearTimeout(timer);if(inFlight.get(scraper)===work)inFlight.delete(scraper);});
  inFlight.set(scraper,work);return work;
}

// Authorization must not trigger a hidden browser fallback (which can outlive
// the caller by 30+ seconds) or silently return an incomplete permission set.
async function readAgentPermissionMap(scraper,signal){
  const start=performance.now();let myMs=0,dashboardMs=0;
  const validate=({response,text})=>{
    if(response.status===401||scraper.isLoginPage(text,response.url))throw Object.assign(Error('教务登录已失效，请重新登录。'),{code:'SOURCE_LOGIN_EXPIRED'});
    if(!response.ok)throw Object.assign(Error('教务权限页面暂时不可用。'),{code:'SOURCE_PERMISSION_UNAVAILABLE'});
    return text;
  };
  const [myMap,dashboard]=await Promise.all([
    (async()=>{const html=validate(await scraper.requestText('/admin/my_squad',{headers:{accept:'text/html'},signal}));myMs=performance.now()-start;return extractMySquadClassMap(html);})(),
    (async()=>{const html=validate(await scraper.requestText('/admin',{headers:{accept:'text/html'},signal}));const id=extractDashboardTutorId(html);
      let map=null;if(id){const {response,data}=await scraper.requestJson('/admin/dashboard/getSquadData?id='+encodeURIComponent(id),{signal});if(!response.ok||!(Array.isArray(data?.myClasses)||Array.isArray(data?.data?.myClasses)))throw Object.assign(Error('教务班级权限数据暂时不可用。'),{code:'SOURCE_PERMISSION_UNAVAILABLE'});map=extractDashboardClassMap(data);}
      dashboardMs=performance.now()-start;return {html,map};})(),
  ]);
  signal?.throwIfAborted();
  let map=dashboard.map!==null?dedupeClassMap([...myMap,...dashboard.map]):myMap.length?myMap:scraper.extractClassMapFromHtml(dashboard.html);
  map=applyCoHeadTeacherClasses(map,scraper.username);
  scraper.classMapCache=map;scraper.classMapCacheAt=Date.now();
  scraper.lastClassMapTiming={cacheHit:false,authorization:true,mySquadMs:Math.round(myMs),dashboardMs:Math.round(dashboardMs),totalMs:Math.round(performance.now()-start),classCount:map.length};
  return map;
}
module.exports={freshAgentPermissions,readAgentPermissionMap};
