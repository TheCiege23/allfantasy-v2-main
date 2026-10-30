import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ZombieSetupPanel } from '@/app/zombie/components/commissioner/ZombieSetupPanel'
import { ZombieUniversePanel } from '@/app/zombie/components/commissioner/ZombieUniversePanel'
import { ArrowLeft, LayoutDashboard } from 'lucide-react'
import { ZombieStatusBoardCard } from '@/app/zombie/components/commissioner/ZombieStatusBoardCard'

export const metadata = {
  title: 'Zombie Commissioner Dashboard — AllFantasy',
}

/** Owner-only standalone and linked-universe commissioner controls. */
export default async function ZombieCommissionerDashboardPage(props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const { leagueId } = params
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  if(!session?.user?.id) redirect('/login?callbackUrl='+encodeURIComponent('/league/'+leagueId+'/zombie-commissioner'))
  const league=await prisma.league.findUnique({where:{id:leagueId},select:{userId:true,zombieLeague:{select:{universeId:true,universe:{select:{commissionedByUserId:true,createdByUserId:true}}}}}})
  const universe=league?.zombieLeague?.universe
  const leagueOwner=league?.userId===session.user.id
  const universeOwner=Boolean(universe&&(universe.commissionedByUserId??universe.createdByUserId)===session.user.id)
  if(!league?.zombieLeague||(!leagueOwner&&!universeOwner)) notFound()
  return (
    <div className="min-h-screen bg-[#040915] px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          href={`/league/${encodeURIComponent(leagueId)}`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:bg-white/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to league
        </Link>
        <header className="flex flex-wrap items-start gap-4 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-[#1a1408]/95 to-[#0a1228] p-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-200">
            <LayoutDashboard className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">Zombie Commissioner Dashboard</h1>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-white/55">
              Review league readiness, prepare the next season, and manage your Zombie league.
              Completed-season history stays in its original league.
            </p>
          </div>
        </header>
        <div className="rounded-xl border border-white/10 bg-[#0a1228]/60 p-4 text-[12px] text-white/45">
          Use <span className="text-white/70">Settings → Zombie</span> for Whisperers, combat, items,
          payments and weekly automation. Whisperers can never trade.
        </div>
        <ZombieSetupPanel leagueId={leagueId} canEdit={leagueOwner} />
        {league.zombieLeague.universeId && <ZombieUniversePanel leagueId={leagueId} canEdit={universeOwner} />}
        <section className="space-y-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/55">Weekly status board</h2>
          <ZombieStatusBoardCard leagueId={leagueId} />
        </section>
      </div>
    </div>
  )
}
