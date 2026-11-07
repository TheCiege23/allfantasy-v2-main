'use client'

import Link from 'next/link'
import { LayoutDashboard, MessageSquare, Sparkles, Vote, Wand2, Trophy, Users } from 'lucide-react'
import './big-brother-light.css'

/**
 * Premium commissioner surface for Big Brother — links into league shell, Chimmy cards, and voting center.
 */
export function BigBrotherCommandDashboard({ leagueId }: { leagueId: string }) {
  const shell = `/league/${encodeURIComponent(leagueId)}?openChat=league`
  const shellChat = `/league/${encodeURIComponent(leagueId)}?tab=Chat&openChat=league`

  return (
    <div className="af-bb-shell space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-[#120a18] via-[#0a1228] to-[#040915] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200/75">Big Brother command</p>
        <h2 className="mt-2 text-xl font-bold text-white sm:text-2xl">House control room</h2>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/55">
          Run phases, fairness checks, and @Chimmy automation from one cinematic hub. Player votes and private ballots stay
          in the Vote Center and league chat policies.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=bb_voting`}
          className="group flex flex-col rounded-2xl border border-cyan-500/20 bg-[#0a1228]/90 p-4 transition-colors hover:border-cyan-400/35 hover:bg-[#0c162e]"
          data-testid="bb-command-voting"
        >
          <Vote className="h-5 w-5 text-cyan-300/90" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-white">Eviction voting</span>
          <span className="mt-1 text-[12px] text-white/50">Open the ballot strip inside the league shell.</span>
        </Link>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=bb_twists`}
          className="group flex flex-col rounded-2xl border border-violet-500/20 bg-[#0a1228]/90 p-4 transition-colors hover:border-violet-400/35 hover:bg-[#0c162e]"
          data-testid="bb-command-twists"
        >
          <Wand2 className="h-5 w-5 text-violet-300/90" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-white">Twists</span>
          <span className="mt-1 text-[12px] text-white/50">Inventory and scheduled twist weeks.</span>
        </Link>
        <Link
          href={`/big-brother/${encodeURIComponent(leagueId)}`}
          className="group flex flex-col rounded-2xl border border-amber-500/20 bg-[#0a1228]/90 p-4 transition-colors hover:border-amber-400/35 hover:bg-[#0c162e]"
          data-testid="bb-command-chimmy"
        >
          <Sparkles className="h-5 w-5 text-amber-300/90" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-white">@Chimmy cards</span>
          <span className="mt-1 text-[12px] text-white/50">Dedicated Chimmy surface for house commands.</span>
        </Link>
        <Link
          href={shellChat}
          className="group flex flex-col rounded-2xl border border-white/10 bg-[#0a1228]/90 p-4 transition-colors hover:border-white/20 hover:bg-[#0c162e]"
          data-testid="bb-command-chat"
        >
          <MessageSquare className="h-5 w-5 text-white/70" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-white">House chat</span>
          <span className="mt-1 text-[12px] text-white/50">Default league channel — left rail in the shell.</span>
        </Link>
        <Link
          href={`/big-brother/${encodeURIComponent(leagueId)}?panel=challenge_scores`}
          className="group flex flex-col rounded-2xl border border-emerald-500/20 bg-[#0a1228]/90 p-4 transition-colors hover:border-emerald-400/35 hover:bg-[#0c162e]"
          data-testid="bb-command-challenge-scores"
        >
          <Trophy className="h-5 w-5 text-emerald-300/90" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-white">Challenge scores</span>
          <span className="mt-1 text-[12px] text-white/50">Enter HOH and Veto challenge scores to resolve outcomes.</span>
        </Link>
        <Link
          href={`/big-brother/${encodeURIComponent(leagueId)}?panel=have_nots`}
          className="group flex flex-col rounded-2xl border border-rose-500/20 bg-[#0a1228]/90 p-4 transition-colors hover:border-rose-400/35 hover:bg-[#0c162e]"
          data-testid="bb-command-have-nots"
        >
          <Users className="h-5 w-5 text-rose-300/90" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-white">Have-Nots</span>
          <span className="mt-1 text-[12px] text-white/50">Override the weekly Have-Not roster and apply penalties.</span>
        </Link>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-[#070b18]/95 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <LayoutDashboard className="h-5 w-5 text-cyan-400/80" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-white">League shell</p>
            <p className="text-[12px] text-white/50">Full draft, roster, waivers, and settings tabs stay in one place.</p>
          </div>
        </div>
        <Link
          href={shell}
          className="mt-4 inline-flex rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-[13px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
          data-testid="bb-command-shell"
        >
          Enter league hub →
        </Link>
      </div>
    </div>
  )
}
