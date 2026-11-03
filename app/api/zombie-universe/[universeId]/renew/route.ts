import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { previewZombieUniverseRenewal, renewZombieUniverse, previewReviewedZombieUniverseRenewal,
  getZombieUniverseRenewalEditor, saveZombieUniverseRenewalDraft, ZombieRenewalError } from '@/lib/zombie/renewZombieUniverse'
export const dynamic='force-dynamic'
export const maxDuration=120
type Context={params:Promise<{universeId:string}>}
const headers={'Cache-Control':'private, no-store'}
async function run(req:Request,context:Context,mode:'read'|'preview'|'save'|'execute') {
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  if(!session?.user?.id) return NextResponse.json({error:'Unauthorized'},{status:401,headers})
  const {universeId}=await context.params
  let body:{season?:unknown;previewHash?:unknown;proposal?:unknown}|null=null
  if(mode!=='read') {
    const text=await req.text()
    if(text.length>160000) return NextResponse.json({error:'The review proposal is too large.'},{status:413,headers})
    try {const parsed=JSON.parse(text);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))body=parsed}catch{}
  }
  const params=new URL(req.url).searchParams
  const raw=mode==='read'?params.get('season'):body?.season
  const season=typeof raw==='number'||typeof raw==='string'&&/^\d{4}$/.test(raw)?Number(raw):NaN
  if(!Number.isInteger(season)||season<2000||season>=2200) return NextResponse.json({error:'Choose a valid completed season.'},{status:400,headers})
  if((mode==='save'||mode==='execute')&&(typeof body?.previewHash!=='string'||!/^[a-f0-9]{64}$/.test(body.previewHash)))
    return NextResponse.json({error:'Review a fresh season preview first.'},{status:400,headers})
  try {
    const actor=session.user.id
    const data=mode==='read'?(params.get('editor')==='1'?await getZombieUniverseRenewalEditor(universeId,season,actor):await previewZombieUniverseRenewal(universeId,season,actor)):
      mode==='preview'?await previewReviewedZombieUniverseRenewal(universeId,season,actor,body?.proposal):
      mode==='save'?await saveZombieUniverseRenewalDraft(universeId,season,actor,body!.previewHash as string,body?.proposal):
      body?.proposal===undefined?await renewZombieUniverse(universeId,season,actor,body!.previewHash as string):
        await renewZombieUniverse(universeId,season,actor,body!.previewHash as string,body.proposal)
    return NextResponse.json(data,{headers})
  } catch(error) {
    if(error instanceof ZombieRenewalError) {
      const code=error.message,messages:Record<string,string>={
        RENEWAL_OWNER_REQUIRED:'Only the universe commissioner can prepare or renew its season.',
        RENEWAL_NOT_FOUND:'Universe not found.',
        RENEWAL_SEASONS_INCOMPLETE:'Every league must finish its native and Zombie seasons before renewal.',
        RENEWAL_RECONCILIATION_REQUIRED:'Finish weekly settlements and resolve stat corrections first.',
        RENEWAL_MEMBERSHIP_AMBIGUOUS:'Every current seat needs a distinct registered manager across this universe.',
        RENEWAL_PREVIEW_CHANGED:'Results, rules, movement history or the proposal changed. Review a fresh preview.',
        RENEWAL_DRAFT_INCOMPLETE:'Every previous-season draft must be completed.',
        RENEWAL_NEWER_SEASON_EXISTS:'A newer season already exists. Open it before renewing again.',
        RENEWAL_ALREADY_RENEWED:'This season has already been renewed.',
        RENEWAL_MANUAL_REVIEW_REQUIRED:'Use Plan placements and capacity to review this manual universe.',
        RENEWAL_CAPACITY_UNBALANCED:'Automatic movement cannot fill the configured levels evenly. Use Plan placements and capacity.',
        RENEWAL_MOVEMENT_REVIEW_REQUIRED:'The proposal differs from recorded movement. Explicitly approve replacing that allocation; its original values will be retained in the audit trail.',
        RENEWAL_PROPOSAL_INVALID:'Provide a complete proposal, supported team counts and a reason of 10–1,000 characters.',
        RENEWAL_POOL_INVALID:'Each destination needs a unique key, an existing level and a rule template from this universe.',
        RENEWAL_LEVEL_CAPACITY_EXCEEDED:'A destination level exceeds its configured maximum number of leagues.',
        RENEWAL_PLACEMENT_INCOMPLETE:'Assign every returning manager exactly once to a destination league.',
        RENEWAL_POOL_OVERFILLED:'A destination has more managers than seats. Resize it or move managers before previewing.',
      }
      return NextResponse.json({error:messages[code]||'Review league configuration and completed standings before renewal.',code},
        {status:code==='RENEWAL_OWNER_REQUIRED'?403:code==='RENEWAL_NOT_FOUND'?404:code==='RENEWAL_PROPOSAL_INVALID'?400:409,headers})
    }
    console.error('[zombie-renewal] transaction failed',{code:'RENEWAL_TRANSACTION_FAILED'})
    return NextResponse.json({error:'The operation failed. No partial season was saved.'},{status:500,headers})
  }
}
export function GET(req:Request,context:Context){return run(req,context,'read')}
export function PATCH(req:Request,context:Context){return run(req,context,'preview')}
export function PUT(req:Request,context:Context){return run(req,context,'save')}
export function POST(req:Request,context:Context){return run(req,context,'execute')}
