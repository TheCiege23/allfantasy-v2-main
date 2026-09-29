'use client'

import { Bot, User, TrendingUp, AlertTriangle } from 'lucide-react'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import type { RedraftStarterHint } from '@/lib/draft-room/redraftPlanningHints'
import { DraftRosterStrip } from './DraftRosterStrip'
import { computeTeamNeeds, detectByeWeekClusters } from '@/lib/draft-room/teamNeeds'

export type DraftTeamPanelProps = {
  leagueName: string
  sport: string
  slotOrder: SlotOrderEntry[]
  currentUserRosterId: string | null
  /** Picks for the focused team (usually current user) */
  draftedPicks: Array<{
    playerName: string
    position: string
    overall: number
    rosterId: string
    /** Commit S — bye week of the drafted player when available, used for
     *  bye-week clustering warnings. Optional / null when upstream pool
     *  row didn't carry one. */
    byeWeek?: number | null
    isDevy?: boolean
    isTaxi?: boolean
  }>
  teamCount: number
  rounds: number
  /** Total picks recorded in the draft session (all teams) */
  leaguePicksMade: number
  commissionerAiTeams?: Array<{ teamId: string; teamName: string; aiStyle: string; tradeAggression: string; active: boolean }>
  /** When user selects another team to inspect — defaults to current user */
  focusRosterId?: string | null
  /** When true, renders the dynasty-aware DraftRosterStrip (starters/bench/taxi/devy). */
  showRosterStrip?: boolean
  isDynasty?: boolean
  starterSlots?: Record<string, number> | null
  benchSlots?: number | null
  taxiSlots?: number | null
  devySlots?: number | null
  /** Live redraft snake — soft starter balance cues (guidance only). */
  redraftStarterHints?: RedraftStarterHint[]
}

function posCounts(picks: Array<{ position: string }>): Record<string, number> {
  const m: Record<string, number> = {}
  for (const p of picks) {
    const k = String(p.position || '—').toUpperCase()
    m[k] = (m[k] ?? 0) + 1
  }
  return m
}

export function DraftTeamPanel({
  leagueName,
  sport,
  slotOrder,
  currentUserRosterId,
  draftedPicks,
  teamCount,
  rounds,
  leaguePicksMade,
  commissionerAiTeams = [],
  focusRosterId,
  showRosterStrip = false,
  isDynasty = false,
  starterSlots = null,
  benchSlots = null,
  taxiSlots = null,
  devySlots = null,
  redraftStarterHints,
}: DraftTeamPanelProps) {
  const focus = focusRosterId ?? currentUserRosterId
  const slot = slotOrder.find((s) => s.rosterId === focus)
  const myPicks = focus ? draftedPicks.filter((p) => p.rosterId === focus) : []
  const aiAssignment = commissionerAiTeams.find((t) => t.teamId === focus && t.active)
  const counts = posCounts(myPicks)
  const topNeed = Object.entries(counts).sort((a, b) => a[1] - b[1])[0]?.[0] ?? '—'
  const totalPicks = rounds * teamCount
  const picksRemaining = Math.max(0, totalPicks - leaguePicksMade)

  // Commit S — explicit team-needs computation driven by the league's
  // configured `starterSlots` (works for IDP / DEF / K / specialty
  // leagues without a hardcoded position list). The legacy
  // `redraftStarterHints` chip strip still renders above for the soft
  // QB/RB/WR/TE balance heuristic; this row surfaces the rule-correct
  // "have / target / remaining" against the actual roster template.
  const teamNeeds = computeTeamNeeds({ picks: myPicks, starterSlots })
  // Commit S — bye-week clustering: 3+ drafted starters sharing a bye
  // is a real lineup risk. Empty / unknown byes are dropped silently
  // so this section disappears for pools that don't carry bye data.
  const byeClusters = detectByeWeekClusters(myPicks)

  return (
    <aside
      className="flex h-full min-h-0 flex-col border border-white/8 bg-gradient-to-b from-[#070f21] to-[#040915] md:border-0"
      data-testid="draft-team-panel"
    >
      <div className="border-b border-white/8 px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-cyan-200/80">Your war room</p>
        <h2 className="truncate text-sm font-semibold text-white">{slot?.displayName ?? 'Team'}</h2>
        <p className="truncate text-[11px] text-white/45">{leagueName}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-white/60">{sport}</span>
          {slot && (
            <span className="rounded border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-[11px] text-cyan-100">
              Slot {slot.slot}
            </span>
          )}
          {aiAssignment ? (
            <span className="inline-flex items-center gap-0.5 rounded border border-sky-400/35 bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-100">
              <Bot className="h-3 w-3" aria-hidden />
              AI · {aiAssignment.aiStyle.replace(/_/g, ' ')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 rounded border border-white/15 px-1.5 py-0.5 text-[11px] text-white/70">
              <User className="h-3 w-3" aria-hidden />
              Human
            </span>
          )}
        </div>
      </div>

      {redraftStarterHints && redraftStarterHints.length > 0 ? (
        <div className="border-b border-cyan-500/15 bg-black/20 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-cyan-200/75">Starter balance (guide)</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {redraftStarterHints.map((h) => (
              <span
                key={h.position}
                title={
                  h.tone === 'thin'
                    ? 'Thin at this spot — consider filling soon.'
                    : h.tone === 'heavy'
                      ? 'Heavy here — OK if value dictates; watch other spots.'
                      : 'On track'
                }
                className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                  h.tone === 'thin'
                    ? 'border-amber-400/40 bg-amber-500/12 text-amber-100'
                    : h.tone === 'heavy'
                      ? 'border-violet-400/35 bg-violet-500/12 text-violet-100'
                      : 'border-white/12 bg-black/25 text-white/75'
                }`}
              >
                {h.position} {h.have}/{h.target}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-white/38">Typical redraft targets — not your league&apos;s exact rules.</p>
        </div>
      ) : null}

      <div
        className="space-y-2 border-b border-white/8 px-3 py-2"
        data-testid="draft-team-panel-positional-mix"
      >
        <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Positional mix</p>
        <div className="flex flex-wrap gap-1">
          {Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([pos, n]) => (
              <span
                key={pos}
                className="rounded border border-white/10 bg-black/25 px-1.5 py-0.5 text-[11px] text-white/75"
              >
                {pos} ×{n}
              </span>
            ))}
          {myPicks.length === 0 && <span className="text-[11px] text-white/35">No picks yet</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/55">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-300/90" aria-hidden />
          <span>
            Light need: <span className="text-white/80">{topNeed}</span>
          </span>
        </div>
      </div>

      {teamNeeds.length > 0 ? (
        <div
          className="space-y-1.5 border-b border-white/8 px-3 py-2"
          data-testid="draft-team-panel-needs"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">
            Starter needs
          </p>
          <div className="flex flex-wrap gap-1">
            {teamNeeds.map((n) => (
              <span
                key={n.position}
                data-testid={`draft-team-panel-need-${n.position.toLowerCase()}`}
                data-tone={n.tone}
                title={
                  n.tone === 'thin'
                    ? `${n.remaining} more ${n.position} needed for starting lineup`
                    : n.tone === 'heavy'
                      ? `Depth-overcommit at ${n.position}`
                      : `${n.position} starters set`
                }
                className={`rounded border px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                  n.tone === 'thin'
                    ? 'border-amber-400/40 bg-amber-500/12 text-amber-100'
                    : n.tone === 'heavy'
                      ? 'border-violet-400/35 bg-violet-500/12 text-violet-100'
                      : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                {n.position} {n.have}/{n.target}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {byeClusters.length > 0 ? (
        <div
          className="border-b border-amber-400/25 bg-amber-500/[0.07] px-3 py-2"
          data-testid="draft-team-panel-bye-clusters"
        >
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-amber-200/80">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Bye-week stack
          </p>
          <ul className="mt-1 space-y-0.5">
            {byeClusters.map((c) => (
              <li
                key={c.byeWeek}
                data-testid={`draft-team-panel-bye-cluster-${c.byeWeek}`}
                className="text-[11px] text-amber-100/85"
              >
                <span className="font-semibold text-amber-50 tabular-nums">Week {c.byeWeek}</span>
                <span className="text-amber-200/60"> · {c.count} starters</span>
                <span className="text-amber-200/45"> ({c.positions.join(', ')})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showRosterStrip ? (
        <DraftRosterStrip
          picks={myPicks.map((p) => ({
            playerName: p.playerName,
            position: p.position,
            overall: p.overall,
            isDevy: p.isDevy,
            isTaxi: p.isTaxi,
          }))}
          starterSlots={starterSlots}
          benchSlots={benchSlots}
          taxiSlots={taxiSlots}
          devySlots={devySlots}
          isDynasty={isDynasty}
          teamLabel={slot?.displayName ?? null}
          sport={sport}
        />
      ) : null}

      <div
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2"
        data-testid="draft-team-panel-drafted-list"
      >
        <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Drafted ({myPicks.length})</p>
        <ul className="space-y-1">
          {myPicks.length === 0 ? (
            <li className="text-[11px] text-white/35">Waiting for first pick…</li>
          ) : (
            myPicks
              .slice()
              .sort((a, b) => a.overall - b.overall)
              .map((p) => (
                <li
                  key={`${p.overall}-${p.playerName}`}
                  className="flex items-center justify-between gap-2 rounded border border-white/8 bg-black/20 px-2 py-1 text-[11px]"
                >
                  <span className="truncate font-medium text-white/90">{p.playerName}</span>
                  <span className="shrink-0 text-white/45">
                    {p.position} · #{p.overall}
                  </span>
                </li>
              ))
          )}
        </ul>
        <div className="mt-auto rounded border border-white/8 bg-black/25 px-2 py-1.5 text-[11px] text-white/50">
          <div className="flex justify-between">
            <span>League picks left</span>
            <span className="tabular-nums text-cyan-200/90">{picksRemaining}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
