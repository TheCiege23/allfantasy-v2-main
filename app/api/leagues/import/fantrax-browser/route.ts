import {NextRequest,NextResponse} from 'next/server'
import {requireAgeConfirmedUser} from '@/lib/auth-guard'
import {getServedOrigin} from '@/lib/http/served-origin'
import {fantraxBrowserContext} from '@/lib/import-os/collector/fantraxBrowserContext'
import {importFantraxBrowserActuals} from '@/lib/import-os/collector/fantraxBrowserActuals'
import {fantraxTransactionContext,importFantraxTransactionExports} from '@/lib/import-os/collector/fantraxTransactionSync'
export const dynamic='force-dynamic'
export const maxDuration=120
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export async function GET(req:NextRequest){
 const auth=await requireAgeConfirmedUser();if(!auth.ok)return auth.response
 const leagueId=req.nextUrl.searchParams.get('leagueId')??''
 if(!uuid.test(leagueId))return NextResponse.json({error:'Valid league ID required'},{status:400})
 // `kind=transactions`: the two Transaction History download addresses (trades, claims and drops). Any sport; commissioner only.
 if(req.nextUrl.searchParams.get('kind')==='transactions'){
  try{return NextResponse.json(await fantraxTransactionContext(auth.userId,leagueId),{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'Fantrax league not found, or you are not its commissioner'},{status:400})}
 }
 try{return NextResponse.json(await fantraxBrowserContext(auth.userId,leagueId),{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'Owned Fantrax college league or verified download contract unavailable'},{status:400})}
}
export async function POST(req:NextRequest){
 const auth=await requireAgeConfirmedUser();if(!auth.ok)return auth.response
 // Railway's nextUrl origin can be the bind address; trust configured deployment origin.
 if(req.headers.get('origin')!==getServedOrigin(req))return NextResponse.json({error:'Same-origin request required'},{status:403})
 try{
  const text=await req.text();if(Buffer.byteLength(text)>8_000_000)return NextResponse.json({error:'Batch exceeds limit'},{status:413})
  const body=JSON.parse(text)
  if(body?.kind==='transactions'){
   const csv=(value:unknown)=>typeof value==='string'&&value.length>0?value:null
   const trades=csv(body.trades),claimDrops=csv(body.claimDrops)
   if(!uuid.test(body.leagueId??'') || (!trades&&!claimDrops) || (body.trades!=null&&!trades) || (body.claimDrops!=null&&!claimDrops))return NextResponse.json({error:'Invalid transaction batch'},{status:400})
   try{return NextResponse.json(await importFantraxTransactionExports(auth.userId,{leagueId:body.leagueId,trades,claimDrops}),{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'Fantrax league not found, or you are not its commissioner; nothing imported'},{status:400})}
  }
  if(!uuid.test(body.leagueId??'') || !Number.isInteger(body.season) || !Array.isArray(body.exports) || !body.exports.length || body.exports.length>24 || body.exports.some((e:any)=>typeof e.csv!=='string' || typeof e.sourceTeamId!=='string' || !Number.isInteger(e.period)))return NextResponse.json({error:'Invalid score batch'},{status:400})
  const result=await importFantraxBrowserActuals(auth.userId,{leagueId:body.leagueId,season:body.season,exports:body.exports.map((e:any)=>({period:e.period,sourceTeamId:e.sourceTeamId,csv:e.csv})),apply:body.apply===true})
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}})
 }catch{return NextResponse.json({error:'Source scores failed ownership, roster, period, total or correction validation; no batch applied'},{status:400})}
}
