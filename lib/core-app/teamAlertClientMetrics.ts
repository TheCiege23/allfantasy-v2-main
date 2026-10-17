type Event='opened'|'reviewed'|'stale'|'not_useful'|'repeat'
export function measureAlert(league:string,measurement:string|null|undefined,event:Event){
 if(!measurement)return Promise.resolve(false)
 // Feedback is nonblocking and never retries a lineup operation.
 return fetch('/api/core/team-alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({league,measurement,event}),keepalive:true}).then(r=>r.ok).catch(()=>false)
}
export function measuredAlertHref(href:string,measurement:string|null|undefined){
 if(!measurement)return href
 const url=new URL(href,'https://allfantasy.invalid');url.searchParams.set('alertMeasure',measurement)
 return url.pathname+url.search+url.hash
}
