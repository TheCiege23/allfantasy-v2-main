import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { readCutover } from '@/lib/league-import/fantrax/cutoverPolicy'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { CutoverUpload } from './CutoverUpload'

export default async function ScoringHandoff({params}:{params:Promise<{leagueId:string}>}){
  const {leagueId}=await params
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}} | null
  if(!session?.user?.id)notFound()
  try{await assertCommissionerAccess(leagueId,session.user.id,'league')}catch{notFound()}
  const league=await prisma.league.findUnique({where:{id:leagueId},select:{name:true,sport:true,settings:true,season:true}})
  const cut=readCutover(league?.settings,league?.season??-1)
  if(!cut || !league)notFound()
  const categories=nativeCategoryScoringContext(league.settings,String(league.sport))?.categories
  const keys=[...new Set(categories?.flatMap(c=>c.computation.kind==='sum'?[c.computation.statKey]:[c.computation.numeratorStatKey,c.computation.denominatorStatKey,...(c.computation.additionalNumeratorStatKeys??[])])??[])]
  return <main className="mx-auto grid max-w-3xl gap-5 p-6">
    <Link href={'/core?league='+encodeURIComponent(leagueId)}>{league.name}</Link>
    <h1 className="text-2xl font-bold">Scoring handoff for period {cut.period}</h1>
    <p>{cut.reason ?? 'Finish roster setup to verify the scoring handoff.'}</p>
    {cut.policy==='reconcile_open_period' && cut.installedSeasonId && !cut.settled && <>
      <p>Use one row per franchise, athlete and elapsed Eastern calendar day, including today. {keys.length ? 'Enter the actual category components, including makes and attempts for percentages. You can leave points blank.' : 'Enter actual fantasy points, including zero for a player who earned none.'} Use Fantrax team and player IDs. Accepted lineup statuses are ACTIVE, RESERVE, IR and TAXI.</p>
      <a className="underline" href={'/api/leagues/'+encodeURIComponent(leagueId)+'/import-carryover/reconcile/template'}>Download the template with your franchise IDs, player IDs and dates</a>
      <p>CSV columns</p><code className="break-words">{['season','period','team_id','player_id','date','slot','points',...keys.map(k=>'stat.'+k)].join(',')}</code>
      <p>Enter season {cut.season}, period {cut.period}, and dates as YYYY-MM-DD. Verification compares native player stats and the official Fantrax scoreboard between games. Fantrax will finish this period if it closes first.</p>
      <CutoverUpload leagueId={leagueId}/>
    </>}
  </main>
}
