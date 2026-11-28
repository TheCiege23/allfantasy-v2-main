'use client'

import Link from 'next/link'
import { LayoutDashboard, MessageSquare, Sparkles, Vote, Wand2, Trophy, Users } from 'lucide-react'

/**
 * Premium commissioner surface for Big Brother — links into league shell, Chimmy cards, and voting center.
 */
export function BigBrotherCommandDashboard({ leagueId }: { leagueId: string }) {
  const shell = `/league/${encodeURIComponent(leagueId)}?openChat=league`
  const shellChat = `/league/${encodeURIComponent(leagueId)}?tab=Chat&openChat=league`

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--line2)] bg-[var(--surface2)] p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--warn-soft)] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-40 w-40 rounded-full bg-[var(--accent-soft)] blur-3xl" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--warn)]">Big Brother command</p>
        <h2 className="mt-2 text-xl font-bold text-[var(--text)] sm:text-2xl">House control room</h2>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[var(--muted)]">
          Run each week’s steps, check fairness, and set up @Chimmy from here. Votes stay private.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=bb_voting`}
          className="group flex flex-col rounded-2xl border border-[var(--accent-line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--surface)]"
          data-testid="bb-command-voting"
        >
          <Vote className="h-5 w-5 text-[var(--accent)]" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-[var(--text)]">Eviction voting</span>
          <span className="mt-1 text-[12px] text-[var(--muted)]">See the ballot and who has voted.</span>
        </Link>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=bb_twists`}
          className="group flex flex-col rounded-2xl border border-[var(--accent-line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--surface)]"
          data-testid="bb-command-twists"
        >
          <Wand2 className="h-5 w-5 text-[var(--accent)]" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-[var(--text)]">Twists</span>
          <span className="mt-1 text-[12px] text-[var(--muted)]">Inventory and scheduled twist weeks.</span>
        </Link>
        <Link
          href={`/big-brother/${encodeURIComponent(leagueId)}`}
          className="group flex flex-col rounded-2xl border border-[var(--line2)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--line2)] hover:bg-[var(--surface)]"
          data-testid="bb-command-chimmy"
        >
          <Sparkles className="h-5 w-5 text-[var(--warn)]" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-[var(--text)]">@Chimmy cards</span>
          <span className="mt-1 text-[12px] text-[var(--muted)]">Chimmy’s house commands.</span>
        </Link>
        <Link
          href={shellChat}
          className="group flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--line2)] hover:bg-[var(--surface)]"
          data-testid="bb-command-chat"
        >
          <MessageSquare className="h-5 w-5 text-[var(--text2)]" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-[var(--text)]">House chat</span>
          <span className="mt-1 text-[12px] text-[var(--muted)]">The league’s main chat.</span>
        </Link>
        <Link
          href={`/big-brother/${encodeURIComponent(leagueId)}?panel=challenge_scores`}
          className="group flex flex-col rounded-2xl border border-[var(--good)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--good)] hover:bg-[var(--surface)]"
          data-testid="bb-command-challenge-scores"
        >
          <Trophy className="h-5 w-5 text-[var(--good)]" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-[var(--text)]">Challenge scores</span>
          <span className="mt-1 text-[12px] text-[var(--muted)]">Enter HOH and Veto challenge scores to resolve outcomes.</span>
        </Link>
        <Link
          href={`/big-brother/${encodeURIComponent(leagueId)}?panel=have_nots`}
          className="group flex flex-col rounded-2xl border border-[var(--bad)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--bad)] hover:bg-[var(--surface)]"
          data-testid="bb-command-have-nots"
        >
          <Users className="h-5 w-5 text-[var(--bad)]" aria-hidden />
          <span className="mt-3 text-sm font-semibold text-[var(--text)]">Have-Nots</span>
          <span className="mt-1 text-[12px] text-[var(--muted)]">Override the weekly Have-Not roster and apply penalties.</span>
        </Link>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <LayoutDashboard className="h-5 w-5 text-[var(--accent)]" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">The rest of the league</p>
            <p className="text-[12px] text-[var(--muted)]">Draft, rosters, waivers and settings.</p>
          </div>
        </div>
        <Link
          href={shell}
          className="mt-4 inline-flex rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] px-4 py-2.5 text-[13px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          data-testid="bb-command-shell"
        >
          Back to the house →
        </Link>
      </div>
    </div>
  )
}
