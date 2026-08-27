'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Loader2, Sparkles } from 'lucide-react'

import { useAfSubGate } from '@/hooks/useAfSubGate'
import type { IdpMatchupPayload, IdpMatchupSide } from '@/lib/idp-projections/idpMatchup'
import type { IDPMatchupReport } from '@/lib/idp/ai/idpChimmy'

/**
 * The IDP matchup, from the league rather than from a hash.
 *
 * ⚠ EVERY NUMBER HERE USED TO BE INVENTED, INCLUDING THE SCOREBOARD. This component summed
 * `mockIdpPoints(id, week)` — a hash of the player id string — across both rosters to produce a
 * team score, multiplied the offensive side by 0.85 for no stated reason, priced every player
 * with `mockContractSalaryM` and then graded them "Good value" / "Underperforming" on the
 * resulting ratio. Its parent handed it the literal ids `['4040','4041','4042']` against
 * `['4043','4044','4045']`, with the team names "Your team" and "Opponent". It shipped on the
 * Scores tab of live IDP leagues and read as analysis.
 *
 * What is gone and not replaced: the salary column, the points-per-million ratio and the value
 * grades built on them. The IDP cap tables are empty in production, so none of that has a source
 * for any league. The arbitrary head-to-head pairing is gone too — pairing your first defender
 * against their first defender compared two players who have nothing to do with each other.
 */

type Tab = 'OFFENSE' | 'DEFENSE' | 'ALL'

export type LeagueIdpMatchupViewProps = {
  leagueId: string
  sport?: string
  /** Optional override; by default the loader picks the newest week it can actually score. */
  week?: number
  live?: boolean
}

const fmt = (n: number) => n.toFixed(1)

export function IDPMatchupView({ leagueId, week, live = false }: LeagueIdpMatchupViewProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''
  const [tab, setTab] = useState<Tab>('ALL')
  const [data, setData] = useState<IdpMatchupPayload | null>(null)
  const [error, setError] = useState(false)
  const [chimmyLoading, setChimmyLoading] = useState(false)
  const [chimmyReport, setChimmyReport] = useState<IDPMatchupReport | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_idp_analysis')

  useEffect(() => {
    let alive = true
    setData(null)
    setError(false)
    const qs = new URLSearchParams({ leagueId, view: 'idp-matchup' })
    if (week) qs.set('week', String(week))
    fetch(`/api/idp/players?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('failed')
        return (await r.json()) as IdpMatchupPayload
      })
      .then((p) => alive && setData(p))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
    /*
     * `live` is in the dependency list rather than driving a setInterval. The old version ticked
     * a boolean every 4 seconds to re-render mock numbers, which looked like live scoring and
     * refreshed nothing. Real refresh belongs on a real feed.
     */
  }, [leagueId, week, live])

  const runChimmyMatchup = async () => {
    if (!leagueId || !userId) return
    setChimmyLoading(true)
    try {
      const res = await fetch('/api/idp/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, week: data?.week ?? week, action: 'matchup_analysis', managerId: userId }),
      })
      if (!(await handleApiResponse(res))) {
        setChimmyReport(null)
        return
      }
      const body = (await res.json().catch(() => null)) as IDPMatchupReport | null
      if (body && typeof body.analysis === 'string') setChimmyReport(body)
    } finally {
      setChimmyLoading(false)
    }
  }

  if (error) {
    return (
      <p className="rounded-lg border border-white/[0.08] bg-black/20 p-4 text-[12px] text-white/50">
        We couldn’t load this matchup. Nothing is shown rather than something wrong.
      </p>
    )
  }
  if (!data) {
    return (
      <p className="rounded-lg border border-white/[0.08] bg-black/20 p-4 text-[12px] text-white/40">
        Loading matchup…
      </p>
    )
  }
  if (data.state !== 'ok' || !data.you || !data.opponent) {
    const copy: Record<string, string> = {
      not_idp_league: 'This league doesn’t start defensive slots, so there’s no IDP matchup to show.',
      no_team_claimed: 'Claim your team in this league and your matchup appears here.',
      no_matchup: 'No matchup on file for this league yet.',
      no_scoring_settings: 'We don’t hold this league’s scoring settings, so nothing here can be scored.',
    }
    return (
      <p className="rounded-lg border border-white/[0.08] bg-black/20 p-4 text-[12px] text-white/50">
        {copy[data.state] ?? 'Nothing to show for this matchup.'}
      </p>
    )
  }

  const { you, opponent } = data
  const youLead = (you.officialScore ?? 0) >= (opponent.officialScore ?? 0)

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
        <div className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-wide text-white/35">
          <span>Week {data.week}</span>
          <span>{data.season} season</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <ScoreSide side={you} align="left" leading={youLead} />
          <span className="text-[10px] font-bold text-white/30">vs</span>
          <ScoreSide side={opponent} align="right" leading={!youLead} />
        </div>
      </div>

      {/* The caveat rides with the numbers rather than sitting in a tooltip nobody opens. */}
      {data.notes.map((n) => (
        <p key={n} className="text-[10px] leading-relaxed text-white/35">
          {n}
        </p>
      ))}

      <button
        type="button"
        onClick={runChimmyMatchup}
        disabled={chimmyLoading || !userId}
        className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
      >
        {chimmyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Chimmy matchup analysis
      </button>

      {chimmyReport ? (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-3">
          <p className="text-xs text-cyan-50/90">{chimmyReport.analysis}</p>
          {chimmyReport.defensiveHighlights ? (
            <p className="mt-2 text-xs text-emerald-200/85">{chimmyReport.defensiveHighlights}</p>
          ) : null}
          {chimmyReport.opponentAdvantage ? (
            <p className="mt-1 text-xs text-amber-200/80">Opponent angle: {chimmyReport.opponentAdvantage}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-1 rounded-lg border border-white/[0.08] bg-black/20 p-1">
        {(['OFFENSE', 'DEFENSE', 'ALL'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-2 text-[11px] font-bold ${
              tab === t ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/75'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PlayerColumn side={you} tab={tab} />
        <PlayerColumn side={opponent} tab={tab} />
      </div>
    </div>
  )
}

function ScoreSide({
  side,
  align,
  leading,
}: {
  side: IdpMatchupSide
  align: 'left' | 'right'
  leading: boolean
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className="truncate text-[12px] font-semibold text-white/85">{side.teamName}</p>
      {/*
        The platform's own score. A dash when the matchup carries none — an unplayed fixture has
        no score, and rendering 0.0 would say both teams were shut out.
      */}
      <p className={`text-2xl font-bold ${leading ? 'text-white' : 'text-white/55'}`}>
        {side.officialScore != null ? fmt(side.officialScore) : <span className="text-white/25">—</span>}
      </p>
      <p className="text-[9px] text-white/30">
        priced {side.scoredPlayers}/{side.totalPlayers} rostered
      </p>
    </div>
  )
}

function PlayerColumn({ side, tab }: { side: IdpMatchupSide; tab: Tab }) {
  const rows = side.players.filter((p) =>
    tab === 'ALL' ? true : tab === 'DEFENSE' ? p.side === 'defense' : p.side === 'offense',
  )
  return (
    <div className="space-y-1">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-white/[0.06] p-2 text-[10px] text-white/30">
          No players on this side of the ball.
        </p>
      ) : null}
      {rows.map((p) => (
        <div
          key={p.sleeperId}
          className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] px-2 py-1.5"
        >
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-white/85">{p.name}</p>
            <p className="text-[9px] text-white/35">
              {p.position ?? '—'} {p.team ? `· ${p.team}` : ''}
            </p>
          </div>
          {/*
            A dash, never 0.0. `no_game` is a bye or a week we have not ingested; `unscored`
            means the line we hold carries nothing this league prices. Either shown as zero tells
            a manager his starter blanked.
          */}
          <span
            className="shrink-0 font-mono text-[12px] font-bold text-white/90"
            title={
              p.points.scored
                ? undefined
                : p.points.reason === 'no_game'
                  ? 'no game on file for him that week'
                  : 'we hold a line for him but none of the stats this league scores'
            }
          >
            {p.points.scored ? fmt(p.points.points) : <span className="text-white/25">—</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
