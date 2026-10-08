chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id || !['context','scores'].includes(message?.action))return
 const path='/api/leagues/import/fantrax-browser'
 const request=message.action==='context'?fetch(`${path}?leagueId=${encodeURIComponent(message.leagueId)}`,{credentials:'same-origin',cache:'no-store'}):fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(message.batch)})
 request.then(async response=>{const data=await response.json();reply({ok:response.ok,data})}).catch(()=>reply({ok:false,data:{error:'AllFantasy is unavailable'}}))
 return true
})
