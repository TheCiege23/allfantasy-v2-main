const $=id=>document.getElementById(id)
let context,tabId,batches=[]
const status=text=>{$('status').textContent=text}
async function app(action,payload){const result=await chrome.tabs.sendMessage(tabId,{action,...payload});if(!result?.ok)throw Error(result?.data?.error??'AllFantasy request failed');return result.data}
async function run(task){$('league').disabled=true;$('weeks').disabled=true;$('load').disabled=true;$('preview').disabled=true;$('apply').disabled=true;try{await task()}catch(error){batches=[];status(error.message)}finally{$('league').disabled=false;$('weeks').disabled=!context;$('load').disabled=false;$('preview').disabled=!context;$('apply').disabled=!batches.length}}
$('league').addEventListener('input',()=>{context=null;batches=[];$('preview').disabled=true;$('apply').disabled=true})
$('weeks').addEventListener('change',()=>{batches=[];$('apply').disabled=true})
$('load').onclick=()=>run(async()=>{
 context=null;batches=[]
 const leagueId=$('league').value.trim();if(!/^[a-f0-9-]{36}$/i.test(leagueId))throw Error('Enter the AllFantasy league UUID')
 const tabs=await chrome.tabs.query({url:'https://www.allfantasy.ai/*'});if(!tabs.length)throw Error('Open AllFantasy and sign in, then reload its page')
 tabId=tabs[0].id;context=await app('context',{leagueId});$('weeks').disabled=false;status(`${context.leagueName}: ${context.periods.length} completed weeks available. No scores imported.`)
})
$('preview').onclick=()=>run(async()=>{
 batches=[]
 const periods=[...context.periods].sort((a,b)=>a.period-b.period);const selected=$('weeks').value==='all'?periods:periods.slice(-2)
 let rows=0,writes=0
 for(const period of selected){
  const exports=[]
  for(const team of period.downloads){status(`Week ${period.period}: downloading ${team.name} (${exports.length+1}/${period.downloads.length})`);const result=await chrome.runtime.sendMessage({action:'download',url:team.url});if(!result?.ok)throw Error(result?.error??'Download failed');exports.push({period:period.period,sourceTeamId:team.sourceTeamId,csv:result.csv})}
  const batch={leagueId:context.leagueId,season:context.season,exports,apply:false};const result=await app('scores',{batch});rows+=result.verifiedRows;writes+=result.plannedWrites;batches.push(batch)
 }
 status(`${rows} player scores verified across ${batches.length} weeks. ${writes} changes planned. Review these counts, then click Import verified scores.`)
})
$('apply').onclick=()=>run(async()=>{
 let written=0,unchanged=0
 let committed=0
 for(const batch of batches){status(`Importing week ${batch.exports[0].period}…`);let result;try{result=await app('scores',{batch:{...batch,apply:true}})}catch(error){throw Error(`Stopped at week ${batch.exports[0].period}. ${committed} earlier weeks committed (${written} written, ${unchanged} unchanged). ${error.message} Repeat downloads safely to resume.`)}written+=result.written;unchanged+=result.unchanged;committed++}
 batches=[];status(`Import complete: ${written} scores written; ${unchanged} unchanged. Each week is committed independently. Published team results remain authoritative.`)
})
