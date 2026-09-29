'use client'

import { useEffect, useState } from 'react'
import { HistoricalDraftBoard } from './HistoricalDraftBoard'

type WeeklyMatchup = {
  matchupId: string
  weekOrPeriod: number
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
}

type TransactionRow = {
  transactionId: string
  type: string
  playerId: string | null
  managerId: string | null
  rosterId: string | null
  payload: unknown
  weekOrPeriod: number | null
  createdAt: string
}

type WeeklySummaryRow = {
  week: number
  matchupCount: number
  highestCombinedScore: number
  highestCombinedLabel: string | null
}

type RosterPlayerPreview = {
  id: string | null
  name: string | null
  position: string | null
  team: string | null
  bucket: string | null
}

type LineupSnapshot = {
  teamId: string
  managerName: string | null
  weekOrPeriod: number
  rosterCount: number
  lineupCount: number
  benchCount: number
  lineupPlayers: RosterPlayerPreview[]
  benchPlayers: RosterPlayerPreview[]
}

type PlayoffBracketEntry = {
  id: string
  round: number | null
  matchup: number | null
  teamOneId: string | null
  teamTwoId: string | null
  winnerId: string | null
  loserId: string | null
  teamOneLabel: string | null
  teamTwoLabel: string | null
  winnerLabel: string | null
  loserLabel: string | null
}

type PlayoffParticipant = {
  rosterId: string
  managerName: string
  seed: number | null
  label: string | null
  isChampion: boolean
  isRunnerUp: boolean
  playoffWins: number
  playoffLosses: number
}

type StandingRow = {
  managerName?: string
  rosterId?: number | string
  wins?: number
  losses?: number
  ties?: number
  pointsFor?: number
  pointsAgainst?: number
}

type ApiResponse = {
  season: number
  standings: StandingRow[]
  weeklyMatchups: WeeklyMatchup[]
  weeklySummary: {
    weeks: WeeklySummaryRow[]
    highestScoringWeek: { week: number; combined: number; label: string } | null
  }
  draft: unknown[]
  draftSummary: {
    totalPicks: number
    roundCount: number
    managerCount: number
    firstOverall: {
      round: number
      pickNumber: number
      playerId: string
      managerId: string | null
    } | null
  }
  transactions: TransactionRow[]
  transactionSummary: Array<{ type: string; count: number }>
  lineupSnapshots: LineupSnapshot[]
  summary: {
    matchupCount: number
    weekCount: number
    draftPickCount: number
    transactionCount: number
    rosterSnapshotCount: number
    playoffMatchupCount: number
  }
  playoffBracket: {
    playoffWeekStart: number | null
    regularSeasonLength: number | null
    playoffTeams: number | null
    participants: PlayoffParticipant[]
    winnersBracket: PlayoffBracketEntry[]
    losersBracket: PlayoffBracketEntry[]
  } | null
  importedHistory: {
    provider: string | null
    platformLeagueId: string | null
    matchupHistory: Record<string, unknown> | null
  }
  scoringSettings: { scoringFormat: string | null; isDynasty: boolean; teamCount: number | null }
  meta: {
    championName: string | null
    championAvatar: string | null
    runnerUpName: string | null
    regularSeasonWinnerName: string | null
    status: string | null
  } | null
}

function formatTransactionSide(transaction: TransactionRow): string {
  if (transaction.playerId && transaction.managerId) {
    return `${transaction.playerId} -> ${transaction.managerId}`
  }
  if (transaction.playerId && transaction.rosterId) {
    return `${transaction.playerId} -> ${transaction.rosterId}`
  }
  if (transaction.playerId) {
    return transaction.playerId
  }
  const payload = transaction.payload && typeof transaction.payload === 'object' ? (transaction.payload as Record<string, unknown>) : null
  if (!payload) return ''
  const teamRefs = [payload.teamKeys, payload.teamIds, payload.franchiseIds]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((value) => String(value).trim())
    .filter(Boolean)
  return teamRefs.join(' / ')
}

function formatPlayerPreview(player: RosterPlayerPreview) {
  const bits = [player.name, player.position, player.team].filter(Boolean)
  return bits.join(' · ')
}

function bracketRoundLabel(round: number | null) {
  if (round == null) return 'Round'
  if (round === 1) return 'Quarterfinals'
  if (round === 2) return 'Semifinals'
  if (round === 3) return 'Final'
  return `Round ${round}`
}

export type SeasonDetailViewProps = {
  leagueId: string
  season: number
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white/55 hover:text-white/80"
      >
        <span>{title}</span>
        <span className="text-white/40">{open ? '▲' : '▼'}</span>
      </button>
      {open ? <div className="border-t border-white/[0.06] p-3">{children}</div> : null}
    </div>
  )
}

export function SeasonDetailView({ leagueId, season }: SeasonDetailViewProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ApiResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/league/${encodeURIComponent(leagueId)}/season-history?season=${season}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Failed to load season')
        if (!cancelled) setData(body as ApiResponse)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, season])

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.06]" />
        ))}
      </div>
    )
  }

  if (error) return <div className="p-3 text-xs text-rose-300/90">{error}</div>
  if (!data) return null

  const standings = Array.isArray(data.standings) ? data.standings : []
  const sorted = [...standings].sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0))

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-[11px] text-amber-100">
          <div className="text-[11px] uppercase tracking-wider text-amber-200/60">Champion</div>
          <div className="mt-1 font-semibold">{data.meta?.championName ?? 'Not recorded'}</div>
        </div>
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 p-3 text-[11px] text-sky-100">
          <div className="text-[11px] uppercase tracking-wider text-sky-200/60">Runner-Up</div>
          <div className="mt-1 font-semibold">{data.meta?.runnerUpName ?? 'Not recorded'}</div>
        </div>
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-[11px] text-emerald-100">
          <div className="text-[11px] uppercase tracking-wider text-emerald-200/60">Format</div>
          <div className="mt-1 font-semibold">{data.scoringSettings.scoringFormat ?? 'Imported'}</div>
          <div className="mt-1 text-white/55">{data.scoringSettings.teamCount ?? '??'} teams</div>
        </div>
        <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-3 text-[11px] text-fuchsia-100">
          <div className="text-[11px] uppercase tracking-wider text-fuchsia-200/60">Season State</div>
          <div className="mt-1 font-semibold">{data.meta?.status ?? 'historical'}</div>
          <div className="mt-1 text-white/55">{data.scoringSettings.isDynasty ? 'Dynasty' : 'Redraft / Standard'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-white/72">
          <div className="text-[11px] uppercase text-white/35">Weeks</div>
          <div className="mt-1 text-base font-semibold text-white">{data.summary.weekCount}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-white/72">
          <div className="text-[11px] uppercase text-white/35">Matchups</div>
          <div className="mt-1 text-base font-semibold text-white">{data.summary.matchupCount}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-white/72">
          <div className="text-[11px] uppercase text-white/35">Draft Picks</div>
          <div className="mt-1 text-base font-semibold text-white">{data.summary.draftPickCount}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-white/72">
          <div className="text-[11px] uppercase text-white/35">Transactions</div>
          <div className="mt-1 text-base font-semibold text-white">{data.summary.transactionCount}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-white/72">
          <div className="text-[11px] uppercase text-white/35">Lineup Snapshots</div>
          <div className="mt-1 text-base font-semibold text-white">{data.summary.rosterSnapshotCount}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-white/72">
          <div className="text-[11px] uppercase text-white/35">Playoff Matchups</div>
          <div className="mt-1 text-base font-semibold text-white">{data.summary.playoffMatchupCount}</div>
        </div>
      </div>

      {data.importedHistory.provider ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[11px] text-white/70">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Imported via <span className="font-semibold capitalize text-white">{data.importedHistory.provider}</span>
            </span>
            {data.importedHistory.platformLeagueId ? <span>Source league: {data.importedHistory.platformLeagueId}</span> : null}
          </div>
        </div>
      ) : null}

      <Section title="Standings" defaultOpen>
        <ul className="space-y-1 text-[11px] text-white/75">
          {sorted.map((row, idx) => (
            <li key={idx} className="flex items-center justify-between gap-2">
              <span className="text-white/50">
                {idx + 1}. {row.managerName ?? `Team ${row.rosterId ?? idx + 1}`}
              </span>
              <span>
                {row.wins ?? 0}-{row.losses ?? 0}
                {row.ties ? `-${row.ties}` : ''} · {(row.pointsFor ?? 0).toFixed(1)} pts
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Weekly Matchups">
        {data.weeklySummary.highestScoringWeek ? (
          <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-white/72">
            <span className="text-white/40">Peak scoring week:</span>{' '}
            Week {data.weeklySummary.highestScoringWeek.week} · {data.weeklySummary.highestScoringWeek.combined.toFixed(1)} combined ·{' '}
            {data.weeklySummary.highestScoringWeek.label}
          </div>
        ) : null}
        {data.weeklySummary.weeks.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {data.weeklySummary.weeks.map((week) => (
              <div key={week.week} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/65">
                W{week.week} · {week.matchupCount} matchups · {week.highestCombinedScore.toFixed(1)} top total
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.weeklyMatchups.map((m) => (
            <div
              key={m.matchupId}
              className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2 py-1.5 text-[11px] text-white/70"
            >
              <div className="text-[11px] uppercase text-white/35">Week {m.weekOrPeriod}</div>
              <div className="flex justify-between">
                <span className={m.winnerTeamId === m.teamA ? 'font-bold text-emerald-300' : ''}>
                  {m.teamA}
                </span>
                <span>{m.scoreA.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className={m.winnerTeamId === m.teamB ? 'font-bold text-emerald-300' : ''}>
                  {m.teamB}
                </span>
                <span>{m.scoreB.toFixed(1)}</span>
              </div>
            </div>
          ))}
          {data.weeklyMatchups.length === 0 ? (
            <div className="text-[11px] text-white/35">No matchups recorded.</div>
          ) : null}
        </div>
      </Section>

      <Section title="Draft">
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
            <div className="text-[11px] uppercase text-white/35">Total Picks</div>
            <div className="mt-1 font-semibold text-white">{data.draftSummary.totalPicks}</div>
          </div>
          <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
            <div className="text-[11px] uppercase text-white/35">Rounds</div>
            <div className="mt-1 font-semibold text-white">{data.draftSummary.roundCount}</div>
          </div>
          <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
            <div className="text-[11px] uppercase text-white/35">Managers</div>
            <div className="mt-1 font-semibold text-white">{data.draftSummary.managerCount}</div>
          </div>
          <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
            <div className="text-[11px] uppercase text-white/35">1.01</div>
            <div className="mt-1 font-semibold text-white">{data.draftSummary.firstOverall?.playerId ?? 'Not recorded'}</div>
          </div>
        </div>
        <HistoricalDraftBoard leagueId={leagueId} season={season} />
      </Section>

      <Section title="Playoff Bracket & Finish">
        {data.playoffBracket ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
                <div className="text-[11px] uppercase text-white/35">Playoff Start</div>
                <div className="mt-1 font-semibold text-white">
                  {data.playoffBracket.playoffWeekStart != null ? `Week ${data.playoffBracket.playoffWeekStart}` : 'Unknown'}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
                <div className="text-[11px] uppercase text-white/35">Regular Season</div>
                <div className="mt-1 font-semibold text-white">
                  {data.playoffBracket.regularSeasonLength != null ? `${data.playoffBracket.regularSeasonLength} weeks` : 'Unknown'}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
                <div className="text-[11px] uppercase text-white/35">Playoff Teams</div>
                <div className="mt-1 font-semibold text-white">{data.playoffBracket.playoffTeams ?? data.playoffBracket.participants.length}</div>
              </div>
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] text-white/72">
                <div className="text-[11px] uppercase text-white/35">Bracket Rows</div>
                <div className="mt-1 font-semibold text-white">{data.summary.playoffMatchupCount}</div>
              </div>
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-white/35">Playoff finish board</div>
                <ul className="space-y-2 text-[11px] text-white/72">
                  {data.playoffBracket.participants
                    .slice()
                    .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
                    .map((participant) => (
                      <li key={participant.rosterId} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2">
                        <div>
                          <div className="font-semibold text-white">{participant.managerName}</div>
                          <div className="text-[11px] text-white/45">
                            Seed {participant.seed ?? '?'} · {participant.label ?? 'Playoff team'}
                          </div>
                        </div>
                        <div className="text-right text-[11px] text-white/55">
                          <div>{participant.playoffWins}-{participant.playoffLosses}</div>
                          <div>
                            {participant.isChampion ? 'Champion' : participant.isRunnerUp ? 'Runner-up' : participant.label ?? ''}
                          </div>
                        </div>
                      </li>
                    ))}
                  {data.playoffBracket.participants.length === 0 ? <li className="text-white/35">No playoff participants recorded.</li> : null}
                </ul>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-white/35">Winners bracket</div>
                  <div className="space-y-2">
                    {data.playoffBracket.winnersBracket.map((entry) => (
                      <div key={`w-${entry.id}`} className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2 text-[11px] text-white/72">
                        <div className="mb-1 text-[11px] uppercase text-white/35">
                          {bracketRoundLabel(entry.round)}{entry.matchup != null ? ` · Matchup ${entry.matchup}` : ''}
                        </div>
                        <div className={entry.winnerId === entry.teamOneId ? 'font-semibold text-emerald-300' : ''}>{entry.teamOneLabel ?? 'TBD'}</div>
                        <div className={entry.winnerId === entry.teamTwoId ? 'font-semibold text-emerald-300' : ''}>{entry.teamTwoLabel ?? 'TBD'}</div>
                      </div>
                    ))}
                    {data.playoffBracket.winnersBracket.length === 0 ? <div className="text-[11px] text-white/35">No winners bracket recorded.</div> : null}
                  </div>
                </div>

                <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-white/35">Losers bracket</div>
                  <div className="space-y-2">
                    {data.playoffBracket.losersBracket.map((entry) => (
                      <div key={`l-${entry.id}`} className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2 text-[11px] text-white/72">
                        <div className="mb-1 text-[11px] uppercase text-white/35">
                          {bracketRoundLabel(entry.round)}{entry.matchup != null ? ` · Matchup ${entry.matchup}` : ''}
                        </div>
                        <div className={entry.winnerId === entry.teamOneId ? 'font-semibold text-amber-300' : ''}>{entry.teamOneLabel ?? 'TBD'}</div>
                        <div className={entry.winnerId === entry.teamTwoId ? 'font-semibold text-amber-300' : ''}>{entry.teamTwoLabel ?? 'TBD'}</div>
                      </div>
                    ))}
                    {data.playoffBracket.losersBracket.length === 0 ? <div className="text-[11px] text-white/35">No losers bracket recorded.</div> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-white/35">No playoff bracket metadata was stored for this season import.</div>
        )}
      </Section>

      <Section title="Lineups & Rosters">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {data.lineupSnapshots.map((snapshot) => (
            <div key={snapshot.teamId} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3 text-[11px] text-white/72">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{snapshot.managerName ?? snapshot.teamId}</div>
                  <div className="text-[11px] uppercase text-white/35">Imported roster snapshot</div>
                </div>
                <div className="text-right text-[11px] text-white/40">
                  <div>{snapshot.lineupCount} starters</div>
                  <div>{snapshot.benchCount} bench</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div>
                  <div className="mb-1 text-[11px] uppercase text-white/35">Starting lineup</div>
                  <ul className="space-y-1 text-white/68">
                    {snapshot.lineupPlayers.slice(0, 8).map((player, idx) => (
                      <li key={`${snapshot.teamId}-lineup-${player.id ?? idx}`}>{formatPlayerPreview(player)}</li>
                    ))}
                    {snapshot.lineupPlayers.length === 0 ? <li className="text-white/35">No lineup imported.</li> : null}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-[11px] uppercase text-white/35">Bench</div>
                  <ul className="space-y-1 text-white/60">
                    {snapshot.benchPlayers.slice(0, 6).map((player, idx) => (
                      <li key={`${snapshot.teamId}-bench-${player.id ?? idx}`}>{formatPlayerPreview(player)}</li>
                    ))}
                    {snapshot.benchPlayers.length === 0 ? <li className="text-white/35">No bench imported.</li> : null}
                  </ul>
                </div>
              </div>
            </div>
          ))}
          {data.lineupSnapshots.length === 0 ? <div className="text-[11px] text-white/35">No roster snapshots recorded.</div> : null}
        </div>
      </Section>

      <Section title="Trades & Transactions">
        {data.transactionSummary.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {data.transactionSummary.map((item) => (
              <div key={item.type} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/65">
                {item.type} · {item.count}
              </div>
            ))}
          </div>
        ) : null}
        <ul className="space-y-1 text-[11px] text-white/70">
          {data.transactions.slice(0, 50).map((t) => (
            <li key={t.transactionId} className="flex items-center justify-between gap-2">
              <span className="text-white/50">
                {t.type}
                {t.weekOrPeriod != null ? ` · W${t.weekOrPeriod}` : ''}
              </span>
              <span className="truncate text-white/60">
                {formatTransactionSide(t)}
              </span>
            </li>
          ))}
          {data.transactions.length === 0 ? (
            <li className="text-white/35">No transactions recorded.</li>
          ) : null}
        </ul>
      </Section>
    </div>
  )
}

export default SeasonDetailView
