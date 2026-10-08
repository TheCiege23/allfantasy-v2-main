export function validateDownloadUrl(value){
 const url=new URL(value)
 if(url.origin!=='https://www.fantrax.com' || url.pathname!=='/fxpa/downloadTeamRosterStats' || url.username || url.password)throw Error('Invalid source endpoint')
 const q=url.searchParams
 if(q.get('seasonOrProjection')!=='SEASON_50t_BY_PERIOD' || q.get('timeframeTypeCode')!=='BY_PERIOD' || q.get('view')!=='STATS' || q.get('statsType')!=='1' || q.get('scoringCategoryType')!=='5' || q.get('adminMode')!=='false' || !/^[a-z0-9]{8,32}$/.test(q.get('leagueId')??'') || !/^[a-z0-9]{8,32}$/.test(q.get('teamId')??'') || !/^(?:[1-9]|[1-3][0-9]|40)$/.test(q.get('period')??''))throw Error('Actual-week parameters required')
 const allowed=new Set(['leagueId','period','seasonOrProjection','timeframeTypeCode','scoringCategoryType','statsType','view','teamId','adminMode','startDate','endDate','lineupChangeSystem','daily','origDaily'])
 for(const key of q.keys())if(!allowed.has(key) || q.getAll(key).length!==1)throw Error('Unexpected download parameter')
 return url.href
}
export async function downloadActualCsv(url,fetcher=fetch){
 const response=await fetcher(validateDownloadUrl(url),{credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'})
 if(!response.ok)throw Error(response.status===429?'Fantrax rate limit; retry later':'Fantrax download unavailable')
 const csv=await response.text()
 if(new TextEncoder().encode(csv).length>2_000_000)throw Error('Export exceeds limit')
 if(!csv.includes('"Fantasy Points"') || !csv.includes('"ID"') || csv.trimStart().startsWith('<'))throw Error('Fantrax did not return actual-score CSV. Open Fantrax and sign in, then retry.')
 return csv
}
