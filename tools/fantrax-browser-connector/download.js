export function validateDownloadUrl(value){
 const url=new URL(value)
 if(url.origin!=='https://www.fantrax.com' || url.pathname!=='/fxpa/downloadTeamRosterStats' || url.username || url.password)throw Error('Invalid source endpoint')
 const q=url.searchParams
 if(q.get('seasonOrProjection')!=='SEASON_50t_BY_PERIOD' || q.get('timeframeTypeCode')!=='BY_PERIOD' || q.get('view')!=='STATS' || q.get('statsType')!=='1' || q.get('scoringCategoryType')!=='5' || q.get('adminMode')!=='false' || !/^[a-z0-9]{8,32}$/.test(q.get('leagueId')??'') || !/^[a-z0-9]{8,32}$/.test(q.get('teamId')??'') || !/^(?:[1-9]|[1-3][0-9]|40)$/.test(q.get('period')??''))throw Error('Actual-week parameters required')
 const allowed=new Set(['leagueId','period','seasonOrProjection','timeframeTypeCode','scoringCategoryType','statsType','view','teamId','adminMode','startDate','endDate','lineupChangeSystem','daily','origDaily'])
 for(const key of q.keys())if(!allowed.has(key) || q.getAll(key).length!==1)throw Error('Unexpected download parameter')
 return url.href
}
const TRANSACTION_QUERY={pageNumber:'1',team:'ALL',positionOrGroup:'ALL',adminMode:'false',includeDeleted:'false',executedOnly:'true'}
const TRANSACTION_COLUMNS={TRADE:['"From"','"To"'],CLAIM_DROP:['"Type"','"Bid"']}
/** The captured "Download all as CSV" request on Transaction History: this path, these parameters, nothing else. */
export function validateTransactionUrl(value){
 const url=new URL(value)
 if(url.origin!=='https://www.fantrax.com' || url.pathname!=='/fxpa/downloadTransactionHistory' || url.username || url.password)throw Error('Invalid source endpoint')
 const q=url.searchParams
 if(!/^[a-z0-9]{8,32}$/.test(q.get('leagueId')??'') || !(q.get('view') in TRANSACTION_COLUMNS))throw Error('Transaction history contract mismatch')
 for(const [key,expected] of Object.entries(TRANSACTION_QUERY))if(q.get(key)!==expected)throw Error('Transaction history contract mismatch')
 const allowed=new Set(['leagueId','view',...Object.keys(TRANSACTION_QUERY)])
 for(const key of q.keys())if(!allowed.has(key) || q.getAll(key).length!==1)throw Error('Unexpected download parameter')
 return url.href
}
export async function downloadTransactionCsv(url,fetcher=fetch){
 const href=validateTransactionUrl(url),view=new URL(href).searchParams.get('view')
 const response=await fetcher(href,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'})
 if(!response.ok)throw Error(response.status===429?'Fantrax rate limit; retry later':'Fantrax download unavailable')
 const csv=await response.text()
 if(new TextEncoder().encode(csv).length>2_000_000)throw Error('Export exceeds limit')
 const header=csv.split(/\r?\n/,1)[0]
 if(csv.trimStart().startsWith('<') || csv.trimStart().startsWith('{') || !header.includes('"Player"') || !header.includes('"Date (EST)"') || !TRANSACTION_COLUMNS[view].every(column=>header.includes(column)))throw Error('Fantrax did not return the transaction history CSV. Open Fantrax and sign in, then retry.')
 return csv
}
/**
 * The league's team list, as Fantrax's own site asks for it: one POST to `/fxpa/req` carrying the single
 * message `getFantasyTeams` (contracts/fantrax/fixtures/2026-fantasy-teams-request.json). Returns only
 * each team's id, name and logo address; nothing else in the response leaves this function.
 */
export function validateTeamsRequest(requestUrl,refUrl){
 const url=new URL(requestUrl),ref=new URL(refUrl)
 if(url.origin!=='https://www.fantrax.com' || url.pathname!=='/fxpa/req' || url.username || url.password)throw Error('Invalid source endpoint')
 const leagueId=url.searchParams.get('leagueId')??''
 if(!/^[a-z0-9]{8,32}$/.test(leagueId) || [...url.searchParams.keys()].length!==1)throw Error('Team list contract mismatch')
 if(ref.origin!=='https://www.fantrax.com' || ref.pathname!==`/fantasy/league/${leagueId}/home` || ref.search || ref.hash)throw Error('Team list contract mismatch')
 return {href:url.href,ref:ref.href}
}
export async function fetchFantasyTeams(requestUrl,refUrl,fetcher=fetch){
 const {href,ref}=validateTeamsRequest(requestUrl,refUrl)
 const body=JSON.stringify({msgs:[{method:'getFantasyTeams',data:{}}],uiv:3,refUrl:ref,dt:0,at:0,tz:'America/New_York',v:'188.3.7'})
 const response=await fetcher(href,{method:'POST',credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store',headers:{Accept:'application/json','Content-Type':'text/plain'},body})
 if(!response.ok)throw Error(response.status===429?'Fantrax rate limit; retry later':'Fantrax team list unavailable')
 const text=await response.text()
 if(new TextEncoder().encode(text).length>2_000_000)throw Error('Team list exceeds limit')
 let data;try{data=JSON.parse(text)}catch{throw Error('Fantrax did not return the team list. Open Fantrax and sign in, then retry.')}
 const list=data?.responses?.[0]?.data?.fantasyTeams
 if(data?.pageError || !Array.isArray(list) || !list.length || list.length>100)throw Error('Fantrax did not return the team list. Open Fantrax and sign in, then retry.')
 return list.map(team=>({id:String(team?.id??''),name:String(team?.name??''),logoUrl:String(team?.logoUrl256??team?.logoUrl128??'')}))
}
export async function downloadActualCsv(url,fetcher=fetch){
 const response=await fetcher(validateDownloadUrl(url),{credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'})
 if(!response.ok)throw Error(response.status===429?'Fantrax rate limit; retry later':'Fantrax download unavailable')
 const csv=await response.text()
 if(new TextEncoder().encode(csv).length>2_000_000)throw Error('Export exceeds limit')
 if(!csv.includes('"Fantasy Points"') || !csv.includes('"ID"') || csv.trimStart().startsWith('<'))throw Error('Fantrax did not return actual-score CSV. Open Fantrax and sign in, then retry.')
 return csv
}
