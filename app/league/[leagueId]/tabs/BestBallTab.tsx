'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupportedSport } from '@/lib/sport-scope'
import './best-ball/best-ball.css'

type SubTab = 'lineup' | 'roster' | 'contest' | 'history'

type BestBallApiResponse = {
  league: {
    id: string
    name: string
    sport: string
    season: number
    summary: string
    settings: {
      mode: 'standard' | 'underdog'
      draftMode: string
      contestStructure: string
      matchupFormat: string
      waiversEnabled: boolean
      tradesEnabled: boolean
      substitutionsEnabled: boolean
      playoffTeams: number
      /** The period the league is actually scored with (lib/bestball/scoringPeriod.ts). */
      scoringPeriod?: string
    }
    profile: {
      label: string
      scoringPeriod: string
      recommendedRosterSize: number
      lineupSlots: Array<{ code: string; count: number }>
      notes: string[]
    }
  }
  selectedWeek: number
  weeksAvailable: number[]
  /** `native` when read from AllFantasy's own scoring; absent for the legacy tables. */
  source?: 'native' | 'imported'
  /** `imported`: who picks the lineups, and that only team scores are shown here. */
  importedNote?: string
  /** A hosted league whose draft is not finished: why nothing is scored yet. */
  draftNotice?: string | null
  /** A daily league whose season has no regular-season opener yet: daily scoring is waiting for it. */
  dailyScheduleNotice?: string | null
  lineups: Array<{
    rosterId: string
    teamName: string
    totalPoints: number
    /** `daily`: each day's best lineup was summed, and `slot` says how many days a player counted. */
    scoringPeriod?: 'daily'
    winLoss: string | null
    /** Native leagues: `provisional` until every game and stat for the week is final. */
    status?: 'final' | 'provisional'
    /** `position`: the one he was scored at; `positionNow`: native sealed weeks, when today's differs. */
    starters: Array<{ playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number; slot: string | null }>
    bench: Array<{ playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number | null; reason?: string }>
    unfilledSlots?: string[]
    awaitingStats?: number
    /** Native: the week was sealed on seats that differ from the league's current ones — which ones. */
    sealedSeatsNote?: string
  }>
  /** `players`: native leagues only — who was on the roster in the selected week; `reserve` = IR / taxi. */
  rosterComposition: Array<{ rosterId: string; teamName: string; playerCount: number; players?: Array<{ playerId: string; name: string; position: string; team: string | null; reserve: boolean }> }>
  standings: Array<{ rosterId: string; rank: number | null; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>
  history: Array<{ rosterId: string; week: number; totalPoints: number; status?: 'final' | 'provisional' }>
  /** The viewer's own rosters: every view leads with them. Absent from an older server: then nothing is marked. */
  viewerRosterIds?: string[]
}

type Lineup = BestBallApiResponse['lineups'][number]

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${tail}`
}

/** Mine first, then everyone else in the order given. */
function mineFirst<T extends { rosterId: string }>(rows: T[], mine: Set<string>): T[] {
  return [...rows.filter((r) => mine.has(r.rosterId)), ...rows.filter((r) => !mine.has(r.rosterId))]
}

/** A stored setting value as words: `season_long` reads "Season long", never with its underscore. */
export function settingWords(value: string | null | undefined): string {
  const words = String(value ?? '').replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—'
}

const RESULT_LABEL: Record<string, string> = { W: 'Won', L: 'Lost', T: 'Tied' }

type BestBallTabProps = {
  leagueId: string
  sport: SupportedSport | string
}

export function BestBallTab({ leagueId }: BestBallTabProps) {
  const [sub, setSub] = useState<SubTab>('lineup')
  // null until the first answer: the tab opens on the latest scored week, which only the server knows.
  // It asked for week 1 first, so any league with a scored week 1 opened ten weeks in the past.
  const [week, setWeek] = useState<number | null>(null)
  const [data, setData] = useState<BestBallApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** The week the server chose for the first, week-less request: already on screen, not fetched again. */
  const serverChose = useRef<number | null>(null)

  useEffect(() => {
    if (week != null && serverChose.current === week) {
      serverChose.current = null
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/bestball${week == null ? '' : `?week=${week}`}`, {
          cache: 'no-store',
        })
        const json = (await res.json()) as BestBallApiResponse | { error?: string }
        if (!res.ok) {
          const message =
            typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string'
              ? json.error
              : 'Failed to load Best Ball data'
          throw new Error(message)
        }
        if (!cancelled) {
          setData(json as BestBallApiResponse)
          const chosen = (json as BestBallApiResponse).selectedWeek
          if (week == null) serverChose.current = chosen
          setWeek((current) => (current === week ? chosen : current))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Best Ball data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [leagueId, week])

  const mine = useMemo(() => new Set(data?.viewerRosterIds ?? []), [data])
  const daily = data?.league.settings.scoringPeriod === 'daily'
  const pointsLeague = data?.league.settings.matchupFormat === 'cumulative'

  // Season total and weekly scores per roster, for the one History grid.
  const historyGrid = useMemo(() => {
    const weeks = [...new Set((data?.history ?? []).map((h) => h.week))].sort((a, b) => a - b)
    const byRoster = new Map<string, { total: number; byWeek: Map<number, { points: number; provisional: boolean }> }>()
    for (const h of data?.history ?? []) {
      const row = byRoster.get(h.rosterId) ?? { total: 0, byWeek: new Map() }
      row.total += h.totalPoints
      row.byWeek.set(h.week, { points: h.totalPoints, provisional: h.status === 'provisional' })
      byRoster.set(h.rosterId, row)
    }
    const names = new Map<string, string>()
    for (const r of [...(data?.standings ?? []), ...(data?.rosterComposition ?? []), ...(data?.lineups ?? [])]) names.set(r.rosterId, r.teamName)
    const rows = [...byRoster.entries()]
      .map(([rosterId, v]) => ({ rosterId, teamName: names.get(rosterId) ?? 'Team', ...v }))
      .sort((a, b) => b.total - a.total)
    return { weeks, rows: mineFirst(rows, mine) }
  }, [data, mine])

  /** This week's order (highest first) and your place in it. */
  const ranked = useMemo(() => (data?.lineups ?? []).map((l, i) => ({ ...l, place: i + 1 })), [data])
  const myLineups = ranked.filter((l) => mine.has(l.rosterId))
  // Nobody marked (an older server, or a commissioner without a team): the week's top team leads instead.
  const leadLineups = myLineups.length ? myLineups : ranked.slice(0, 1)
  const otherLineups = ranked.filter((l) => !leadLineups.includes(l))

  const tabLabel: Record<SubTab, string> = { lineup: 'Lineups', roster: 'Rosters', contest: 'Standings', history: 'History' }
  // The week only changes Lineups and Rosters; Standings and History are the whole season.
  const weekMatters = sub === 'lineup' || sub === 'roster'

  return (
    <div className="bb-tab flex min-h-0 flex-1 flex-col gap-4 p-4 text-[var(--text)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Best Ball views">
          {(['lineup', 'roster', 'contest', 'history'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sub === id}
              data-testid={`bestball-sub-${id}`}
              onClick={() => setSub(id)}
              className={`min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ${
                sub === id ? 'bb-chip-on' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {tabLabel[id]}
            </button>
          ))}
        </div>
        {weekMatters ? (
          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            Week
            <select
              value={week ?? data?.selectedWeek ?? 1}
              onChange={(e) => setWeek(Number(e.target.value))}
              className="min-h-[32px] rounded-md border border-[var(--line2)] bg-[var(--surface)] px-2 text-[var(--text)]"
            >
              {(data?.weeksAvailable?.length ? data.weeksAvailable : [week ?? 1]).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {loading ? <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">Loading Best Ball…</div> : null}
      {error ? <div className="rounded-xl border border-[var(--bad)] bg-[var(--bad-soft)] p-4 text-sm text-[var(--bad)]">{error}</div> : null}

      {!loading && !error && data && sub === 'lineup' ? (
        <div className="flex flex-col gap-4">
          <p data-testid="bestball-lineup-explainer" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[13px] leading-relaxed text-[var(--text2)]">
            {daily ? (
              <>
                Nobody sets a lineup in Best Ball. This league uses <span className="bb-accent font-semibold">daily best ball</span>: each day the
                highest-scoring legal lineup from the players on your roster that day counts automatically, and the week score is the sum of the days.
              </>
            ) : (
              <>Nobody sets a lineup in Best Ball. Each week the highest-scoring legal lineup from your whole roster counts automatically.</>
            )}{' '}
            Scores stay <span className="font-semibold text-[var(--warn)]">provisional</span> until every game and stat for the week is final.
          </p>
          {daily && data.dailyScheduleNotice ? (
            <div data-testid="bestball-daily-schedule-pending" className="rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--text)]">
              {data.dailyScheduleNotice}
            </div>
          ) : null}
          {/* The current season's draft is open: shown whether the tab is empty or still holding last
              season's lineups (a renewed league mid-draft), so neither reads as this season's scoring. */}
          {data.draftNotice ? (
            <div data-testid="bestball-draft-pending" className="rounded-xl border border-[var(--line)] bg-[var(--warn-soft)] p-4 text-sm text-[var(--warn)]">
              {data.draftNotice}
            </div>
          ) : data.lineups.length === 0 ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
              No scored weeks yet. Lineups appear here once the first games are played.
            </div>
          ) : null}
          {data.source === 'imported' && data.importedNote && data.lineups.length > 0 ? (
            <div data-testid="bestball-imported-note" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--text2)]">
              {data.importedNote}
            </div>
          ) : null}
          {/* Your team, open. Then everyone else as a ranked row you can open — 12 open cards ran ~8,000px on a phone. */}
          {leadLineups.map((lineup) => (
            <LineupCard key={lineup.rosterId} lineup={lineup} data={data} place={lineup.place} of={ranked.length} mine={mine.has(lineup.rosterId)} />
          ))}
          {otherLineups.length ? (
            <section aria-label="Every team this week" className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
              <h2 className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Week {data.selectedWeek} · every team</h2>
              <ul>
                {otherLineups.map((lineup) => (
                  <OtherLineupRow key={lineup.rosterId} lineup={lineup} data={data} place={lineup.place} of={ranked.length} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && data && sub === 'roster' ? (
        <div className="flex flex-col gap-4">
          {/* Your roster open; every other team a row you open (12 open rosters ran ~7,400px on a phone). */}
          {data.rosterComposition.filter((r) => mine.has(r.rosterId) || (!mine.size && r === data.rosterComposition[0])).map((roster) => (
            <RosterCard key={roster.rosterId} roster={roster} data={data} mine={mine.has(roster.rosterId)} />
          ))}
          {data.rosterComposition.some((r) => !mine.has(r.rosterId) && (mine.size || r !== data.rosterComposition[0])) ? (
            <section aria-label="Every team's roster" className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
              <h2 className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Every team</h2>
              <ul>
                {data.rosterComposition.filter((r) => !mine.has(r.rosterId) && (mine.size || r !== data.rosterComposition[0])).map((roster) => (
                  <OtherRosterRow key={roster.rosterId} roster={roster} data={data} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && data && sub === 'contest' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <h2 className="text-[15px] font-semibold text-[var(--text)]">Standings</h2>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">{pointsLeague ? 'Ranked by total points this season.' : 'Ranked by record, then points.'}</p>
            <ol className="mt-3 space-y-1.5">
              {data.standings.map((row) => (
                <li key={row.rosterId} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px] ${mine.has(row.rosterId) ? 'bb-mine' : 'border-[var(--line)]'}`}>
                  <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-[var(--muted)]">{row.rank ?? '–'}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">{row.teamName}{mine.has(row.rosterId) ? <span className="bb-accent ml-1.5 text-[12px] font-semibold">You</span> : null}</span>
                  {/* A points league has no wins or losses, so no "0-0-0" for every team. */}
                  {pointsLeague ? null : <span className="shrink-0 tabular-nums text-[var(--muted)]">{row.wins}-{row.losses}{row.ties ? `-${row.ties}` : ''}</span>}
                  <span className="bb-accent shrink-0 font-semibold tabular-nums">{row.pointsFor.toFixed(2)}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <h2 className="text-[15px] font-semibold text-[var(--text)]">How this league works</h2>
            <ul className="mt-3 space-y-2 text-[13px] text-[var(--text2)]">
              <li>{daily ? 'Lineups set themselves every day; the week is the sum of the days.' : 'Lineups set themselves every week.'}</li>
              <li>{pointsLeague ? 'Total points all season decide the standings.' : 'Each week is a head-to-head matchup.'}</li>
              <li>{settingWords(data.league.settings.draftMode)} draft{data.league.settings.mode === 'underdog' ? ', Underdog style' : ''}.</li>
              <li>Waivers {data.league.settings.waiversEnabled ? 'on' : 'off'} · trades {data.league.settings.tradesEnabled ? 'on' : 'off'} · manual subs {data.league.settings.substitutionsEnabled ? 'on' : 'off'}.</li>
            </ul>
          </section>
        </div>
      ) : null}

      {!loading && !error && data && sub === 'history' ? (
        <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2 sm:p-4">
          <h2 className="px-2 text-[15px] font-semibold text-[var(--text)] sm:px-0">Every week, every team</h2>
          {/* One grid instead of a 10-row card per team (~6,700px on a phone); wide seasons scroll sideways here only. */}
          <div className="mt-2 overflow-x-auto">
            <table data-testid="bestball-history-grid" className="w-full min-w-max border-collapse text-[13px] tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th scope="col" className="sticky left-0 bg-[var(--surface)] px-2 py-1.5 text-left font-semibold">Team</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-semibold">Total</th>
                  {historyGrid.weeks.map((w) => <th key={w} scope="col" className="px-2 py-1.5 text-right font-semibold">Wk {w}</th>)}
                </tr>
              </thead>
              <tbody>
                {historyGrid.rows.map((row) => (
                  <tr key={row.rosterId} className={`border-t border-[var(--line)] ${mine.has(row.rosterId) ? 'bb-mine' : ''}`}>
                    <th scope="row" className="sticky left-0 max-w-[9rem] truncate bg-inherit px-2 py-1.5 text-left font-medium text-[var(--text)]">{row.teamName}</th>
                    <td className="bb-accent px-2 py-1.5 text-right font-semibold">{row.total.toFixed(2)}</td>
                    {historyGrid.weeks.map((w) => {
                      const cell = row.byWeek.get(w)
                      return (
                        <td key={w} className={`px-2 py-1.5 text-right ${cell?.provisional ? 'text-[var(--warn)]' : 'text-[var(--text2)]'}`} title={cell?.provisional ? 'Provisional' : undefined}>
                          {cell ? cell.points.toFixed(1) : '–'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {historyGrid.rows.some((r) => [...r.byWeek.values()].some((c) => c.provisional)) ? (
            <p className="mt-2 px-2 text-[12px] text-[var(--muted)] sm:px-0"><span className="text-[var(--warn)]">Amber</span> weeks are provisional until every game is final.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function StatusChip({ status }: { status?: 'final' | 'provisional' }) {
  if (!status) return null
  return (
    <span
      data-testid="bestball-lineup-status"
      className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${status === 'final' ? 'bg-[var(--good-soft)] text-[var(--good)]' : 'bg-[var(--warn-soft)] text-[var(--warn)]'}`}
    >
      {status === 'final' ? 'Final' : 'Provisional'}
    </span>
  )
}

/** One team's week: who counted, any empty slot, and (folded) who did not count and why. */
function LineupCard({ lineup, data, place, of, mine }: { lineup: Lineup; data: BestBallApiResponse; place: number; of: number; mine: boolean }) {
  const imported = data.source === 'imported'
  return (
    <article data-testid="bestball-lineup-card" className={`min-w-0 rounded-xl border p-4 ${mine ? 'bb-mine' : 'border-[var(--line)] bg-[var(--surface)]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-[var(--text)]">{lineup.teamName}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
            {mine ? <span className="bb-accent font-semibold">Your team</span> : null}
            <span>Week {data.selectedWeek} · {ordinal(place)} of {of}</span>
            {lineup.scoringPeriod === 'daily' ? (
              <span data-testid="bestball-lineup-daily" className="rounded-full bg-[var(--accent-soft)] px-1.5 py-px text-[11px] font-semibold text-[var(--accent)]">
                Daily best ball
              </span>
            ) : null}
            <StatusChip status={lineup.status} />
            {lineup.winLoss ? <span>{RESULT_LABEL[lineup.winLoss] ?? lineup.winLoss}</span> : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="bb-accent text-lg font-bold tabular-nums">{lineup.totalPoints.toFixed(2)}</div>
          {imported ? null : <div className="text-[12px] text-[var(--muted)]">{lineup.starters.length} counted</div>}
        </div>
      </div>
      {lineup.sealedSeatsNote ? (
        <p data-testid="bestball-lineup-sealed-seats" className="mt-2 text-[12px] text-[var(--text2)]">
          {lineup.sealedSeatsNote}
        </p>
      ) : null}
      {lineup.awaitingStats ? (
        <p className="mt-2 text-[12px] text-[var(--warn)]">
          Waiting on stats for {lineup.awaitingStats} player{lineup.awaitingStats === 1 ? '' : 's'}; this total can still change.
        </p>
      ) : null}
      <div className={imported ? 'hidden' : 'mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]'}>
        Counted
        {lineup.scoringPeriod === 'daily' ? (
          <span className="normal-case tracking-normal"> · points summed over the days each player made that day&apos;s best lineup</span>
        ) : null}
      </div>
      <div className="mt-1.5 space-y-1.5">
        {lineup.starters.map((starter) => (
          <div key={`${starter.slot}-${starter.playerId}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-[13px]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="bb-slot w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold">
                {starter.slot ?? starter.position}
              </span>
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text)]">{starter.name}</div>
                <div className="truncate text-[12px] text-[var(--muted)]">
                  {starter.position}
                  {starter.positionNow ? <span data-testid="bestball-position-now"> (now {starter.positionNow})</span> : null}
                  {starter.team ? ` · ${starter.team}` : ''}
                </div>
              </div>
            </div>
            <div className="shrink-0 font-semibold tabular-nums text-[var(--text)]">{starter.points.toFixed(2)}</div>
          </div>
        ))}
        {(lineup.unfilledSlots ?? []).map((slot, i) => (
          <div key={`unfilled-${slot}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--bad)] px-3 py-2 text-[13px] text-[var(--bad)]">
            <span>
              <span className="mr-2 inline-block w-12 rounded bg-[var(--bad-soft)] px-1.5 py-0.5 text-center text-[11px] font-semibold">{slot}</span>
              No eligible player on the roster
            </span>
            <span className="font-semibold">0.00</span>
          </div>
        ))}
      </div>
      {lineup.bench.length > 0 ? (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-[12px] font-semibold text-[var(--muted)] hover:text-[var(--text)]">
            Didn&apos;t count ({lineup.bench.length}) <span className="font-normal group-open:hidden">· show why</span>
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {lineup.bench.map((player) => (
              <div key={player.playerId} data-testid="bestball-bench-row" className="rounded-lg border border-[var(--line)] px-3 py-2 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-[var(--text)]">
                    {player.name}{' '}
                    <span className="text-[var(--muted)]">
                      {player.position}
                      {player.positionNow ? <span data-testid="bestball-position-now"> (now {player.positionNow})</span> : null}
                      {player.team ? ` · ${player.team}` : ''}
                    </span>
                  </div>
                  <div className="shrink-0 tabular-nums text-[var(--muted)]">{player.points == null ? '—' : player.points.toFixed(2)}</div>
                </div>
                {player.reason ? <div className="mt-0.5 text-[12px] text-[var(--muted)]">{player.reason}</div> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  )
}

type Roster = BestBallApiResponse['rosterComposition'][number]

/** A roster's players by position, or why the list is not here. */
function RosterPlayers({ roster }: { roster: Roster }) {
  if (!roster.players?.length) return <p className="mt-2 text-[12px] text-[var(--muted)]">The player list is not available for this league here.</p>
  return (
    <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
      {[...roster.players].sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name)).map((p) => (
        <li key={p.playerId} className="flex items-center gap-2 text-[13px]">
          <span className="bb-slot w-10 shrink-0 rounded px-1 py-0.5 text-center text-[11px] font-semibold">{p.position}</span>
          <span className="min-w-0 truncate text-[var(--text)]">{p.name}</span>
          <span className="shrink-0 text-[12px] text-[var(--muted)]">{p.team ?? ''}{p.reserve ? ' · IR' : ''}</span>
        </li>
      ))}
    </ul>
  )
}

function RosterCard({ roster, data, mine }: { roster: Roster; data: BestBallApiResponse; mine: boolean }) {
  return (
    <article data-testid="bestball-roster-card" className={`rounded-xl border p-4 ${mine ? 'bb-mine' : 'border-[var(--line)] bg-[var(--surface)]'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="truncate text-[15px] font-semibold text-[var(--text)]">{roster.teamName}</h2>
        {mine ? <span className="bb-accent shrink-0 text-[12px] font-semibold">Your team</span> : null}
      </div>
      <p className="mt-0.5 text-[12px] text-[var(--muted)]">{roster.playerCount} players{data.source === 'native' ? ` in week ${data.selectedWeek}` : ''}</p>
      <RosterPlayers roster={roster} />
    </article>
  )
}

function OtherRosterRow({ roster, data }: { roster: Roster; data: BestBallApiResponse }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-t border-[var(--line)] first:border-t-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-[var(--surface2)]">
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">{roster.teamName}</span>
        <span className="shrink-0 text-[12px] text-[var(--muted)]">{roster.playerCount} players</span>
        <span aria-hidden className="shrink-0 text-[var(--muted)]">{open ? '▴' : '▾'}</span>
      </button>
      {open ? <div className="px-4 pb-3" data-week={data.selectedWeek}><RosterPlayers roster={roster} /></div> : null}
    </li>
  )
}

/** Another team's week as one ranked row; opening it shows the same card. */
function OtherLineupRow({ lineup, data, place, of }: { lineup: Lineup; data: BestBallApiResponse; place: number; of: number }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-t border-[var(--line)] first:border-t-0">
      <button
        type="button"
        data-testid="bestball-lineup-row"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-[var(--surface2)]"
      >
        <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-[var(--muted)]">{place}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">{lineup.teamName}</span>
        {lineup.status === 'provisional' ? <span className="shrink-0 text-[11px] font-semibold text-[var(--warn)]">Provisional</span> : null}
        <span className="bb-accent shrink-0 font-semibold tabular-nums">{lineup.totalPoints.toFixed(2)}</span>
        <span aria-hidden className="shrink-0 text-[var(--muted)]">{open ? '▴' : '▾'}</span>
      </button>
      {open ? <div className="px-3 pb-3"><LineupCard lineup={lineup} data={data} place={place} of={of} mine={false} /></div> : null}
    </li>
  )
}
