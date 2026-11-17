'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { useTournamentParticipantState } from '@/lib/tournament/useTournamentParticipantState'
import { StandingsRow } from '@/app/tournament/components/StandingsRow'
import type { StandingsLeagueRow } from '@/lib/tournament/tournamentStandingsFetch'

type Tab = 'league' | 'conference' | 'global' | 'weekly'

function weekPoints(row: StandingsLeagueRow): number {
  return row.weekPoints ?? 0
}

export default function TournamentStandingsHubPage() {
  const ctx = useTournamentUi()
  const [standingsRoundNumber, setStandingsRoundNumber] = useState<number>(() => {
    const c = ctx.shell.currentRoundNumber || 1
    if (ctx.rounds.some((r) => r.roundNumber === c)) return c
    return ctx.rounds[0]?.roundNumber ?? 1
  })
  const [tab, setTab] = useState<Tab>(() => (ctx.isCommissioner ? 'global' : 'league'))
  const [weeklyWeek, setWeeklyWeek] = useState<number | null>(null)
  const [q, setQ] = useState('')

  const roundsSorted = useMemo(
    () => [...ctx.rounds].sort((a, b) => a.roundNumber - b.roundNumber),
    [ctx.rounds],
  )

  const selectedRoundMeta = useMemo(
    () => roundsSorted.find((r) => r.roundNumber === standingsRoundNumber) ?? roundsSorted[0] ?? null,
    [roundsSorted, standingsRoundNumber],
  )

  const state = useTournamentParticipantState(ctx, {
    roundNumber: standingsRoundNumber,
    weeklyWeek: tab === 'weekly' ? weeklyWeek : undefined,
  })

  useEffect(() => {
    if (tab !== 'weekly') return
    if (weeklyWeek != null) return
    const r = state.standingsRound ?? selectedRoundMeta
    if (r) setWeeklyWeek(r.weekEnd)
  }, [tab, weeklyWeek, state.standingsRound, selectedRoundMeta])

  const conference = useMemo(
    () => ctx.conferences.find((c) => c.id === ctx.participant?.currentConferenceId) ?? ctx.conferences[0],
    [ctx.conferences, ctx.participant?.currentConferenceId],
  )

  const myLeague = useMemo(() => {
    if (!state.myStandingsRow) return null
    return state.standingsLeagues.find((l) => l.id === state.myStandingsRow?.tournamentLeagueId) ?? null
  }, [state.myStandingsRow, state.standingsLeagues])

  const conferenceRowsSeason = useMemo(() => {
    if (!conference) return []
    return state.standingsLeagues
      .filter((L) => L.conferenceId === conference.id)
      .flatMap((L) => L.participants.map((p) => ({ ...p, _league: L.name })))
      .sort((a, b) => (a.conferenceRank ?? 999) - (b.conferenceRank ?? 999))
  }, [conference, state.standingsLeagues])

  const globalRowsSeason = useMemo(() => {
    const rows = state.standingsLeagues.flatMap((L) =>
      L.participants.map((p) => ({ ...p, _league: L.name, _conf: L.conferenceId })),
    )
    rows.sort((a, b) => b.pointsFor - a.pointsFor)
    return rows
  }, [state.standingsLeagues])

  const weekOptions = useMemo(() => {
    const r = state.standingsRound ?? selectedRoundMeta
    if (!r) return []
    const o: number[] = []
    for (let w = r.weekStart; w <= r.weekEnd; w++) o.push(w)
    return o
  }, [state.standingsRound, selectedRoundMeta])

  const filterQ = (name: string) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase())

  useEffect(() => {
    if (roundsSorted.length === 0) return
    const ok = roundsSorted.some((r) => r.roundNumber === standingsRoundNumber)
    if (!ok) {
      setStandingsRoundNumber(ctx.shell.currentRoundNumber || roundsSorted[0]!.roundNumber)
      setWeeklyWeek(null)
    }
  }, [roundsSorted, standingsRoundNumber, ctx.shell.currentRoundNumber])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'league', label: 'My League' },
    { id: 'conference', label: 'Conference' },
    { id: 'global', label: 'Overall' },
    { id: 'weekly', label: 'Weekly' },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-white">Standings</h1>
          <p className="mt-1 text-[11px] text-[var(--tournament-text-dim)]">
            Overall board aggregates all feeder leagues and refreshes as weekly scores post.
          </p>
        </div>
        {roundsSorted.length > 0 ? (
          <label className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--tournament-text-mid)]">
            <span className="font-semibold text-white/80">Tournament round</span>
            <select
              value={standingsRoundNumber}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n)) {
                  setStandingsRoundNumber(n)
                  setWeeklyWeek(null)
                }
              }}
              className="max-w-[min(100vw-2rem,280px)] rounded-lg border border-[var(--tournament-border)] bg-black/30 px-2 py-1.5 text-[13px] text-white"
              data-testid="standings-round-select"
            >
              {roundsSorted.map((r) => (
                <option key={r.id} value={r.roundNumber}>
                  {r.roundLabel?.trim() ? r.roundLabel : `Round ${r.roundNumber}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-[var(--tournament-border)] pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id)
              if (t.id === 'weekly' && weeklyWeek === null) {
                const r = state.standingsRound ?? selectedRoundMeta
                if (r) setWeeklyWeek(r.weekEnd)
              }
            }}
            className={`shrink-0 rounded-lg px-4 py-2 text-[12px] font-bold ${
              tab === t.id ? 'bg-cyan-500/20 text-cyan-100' : 'text-[var(--tournament-text-mid)] hover:bg-white/5'
            }`}
            data-testid={`standings-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search team…"
        className="w-full rounded-xl border border-[var(--tournament-border)] bg-black/25 px-3 py-2 text-[13px] text-white placeholder:text-white/35 md:max-w-sm"
      />

      {tab === 'weekly' && weekOptions.length > 0 ? (
        <label className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--tournament-text-mid)]">
          <span className="font-semibold text-white/80">Redraft week</span>
          <select
            value={weeklyWeek ?? weekOptions[weekOptions.length - 1]!}
            onChange={(e) => setWeeklyWeek(parseInt(e.target.value, 10))}
            className="rounded-lg border border-[var(--tournament-border)] bg-black/30 px-2 py-1.5 text-[13px] text-white"
            data-testid="standings-week-select"
          >
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-[var(--tournament-text-dim)]">
            Points from linked redraft matchups for this tournament round.
          </span>
        </label>
      ) : null}

      {tab === 'league' && myLeague ? (
        <div className="tournament-panel overflow-x-auto p-2">
          <table className="w-full sm:min-w-[560px]">
            <tbody>
              {myLeague.participants
                .filter((r) => filterQ(r.participant.displayName))
                .sort((a, b) => (a.leagueRank ?? 99) - (b.leagueRank ?? 99))
                .map((row, idx) => (
                  <StandingsRow
                    key={row.id}
                    row={row}
                    rank={row.leagueRank ?? idx + 1}
                    highlight={row.userId === ctx.viewerUserId}
                    hidePf={false}
                  />
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'league' && !myLeague && state.standingsReady && state.standingsLeagues.length > 0 ? (
        <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">
          You have no league assignment in this round. Try Conference or Global, or pick another tournament round.
        </div>
      ) : null}

      {tab === 'league' && !myLeague && state.standingsReady && state.standingsLeagues.length === 0 && !state.standingsError ? (
        <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">
          No leagues in this round yet.
        </div>
      ) : null}

      {tab === 'league' && !myLeague && !state.standingsReady && !state.standingsError ? (
        <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">Loading standings…</div>
      ) : null}

      {tab === 'conference' ? (
        conferenceRowsSeason.length > 0 ? (
          <div className="tournament-panel overflow-x-auto p-2">
            <table className="w-full sm:min-w-[560px]">
              <tbody>
                {conferenceRowsSeason
                  .filter((r) => filterQ(r.participant.displayName))
                  .map((row, idx) => (
                    <StandingsRow
                      key={row.id}
                      row={row}
                      rank={row.conferenceRank ?? idx + 1}
                      highlight={row.userId === ctx.viewerUserId}
                      hidePf={false}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">
            No conference standings for this round{conference ? ` (${conference.name})` : ''}.
          </div>
        )
      ) : null}

      {tab === 'global' ? (
        globalRowsSeason.length > 0 ? (
          <div className="tournament-panel overflow-x-auto p-2">
            <table className="w-full sm:min-w-[560px]">
              <tbody>
                {globalRowsSeason
                  .filter((r) => filterQ(r.participant.displayName))
                  .map((row, idx) => (
                    <StandingsRow
                      key={`${row.id}-g`}
                      row={row}
                      rank={idx + 1}
                      highlight={row.userId === ctx.viewerUserId}
                      hidePf={false}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">
            No participants in this round yet.
          </div>
        )
      ) : null}

      {tab === 'weekly' && weeklyWeek === null ? (
        <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">Loading weekly scores…</div>
      ) : null}

      {tab === 'weekly' && weeklyWeek !== null ? (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-[13px] font-bold text-white">
              Global — round {state.standingsRound?.roundNumber ?? standingsRoundNumber}, week {weeklyWeek}
              <span className="ml-2 font-normal text-[var(--tournament-text-dim)]">(high to low)</span>
            </h2>
            <div className="tournament-panel overflow-x-auto p-2">
              <table className="w-full sm:min-w-[560px]">
                <tbody>
                  {[...globalRowsSeason]
                    .sort((a, b) => weekPoints(b) - weekPoints(a))
                    .filter((r) => filterQ(r.participant.displayName))
                    .map((row, idx) => (
                      <StandingsRow
                        key={`${row.id}-wg`}
                        row={row}
                        rank={idx + 1}
                        highlight={row.userId === ctx.viewerUserId}
                        hidePf={false}
                        variant="weekly"
                      />
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          {conference ? (
            <section>
              <h2 className="mb-2 text-[13px] font-bold text-white">
                {conference.name} — round {state.standingsRound?.roundNumber ?? standingsRoundNumber}, week {weeklyWeek}
              </h2>
              <div className="tournament-panel overflow-x-auto p-2">
                <table className="w-full sm:min-w-[560px]">
                  <tbody>
                    {[...conferenceRowsSeason]
                      .sort((a, b) => weekPoints(b) - weekPoints(a))
                      .filter((r) => filterQ(r.participant.displayName))
                      .map((row, idx) => (
                        <StandingsRow
                          key={`${row.id}-wc`}
                          row={row}
                          rank={idx + 1}
                          highlight={row.userId === ctx.viewerUserId}
                          hidePf={false}
                          variant="weekly"
                        />
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 text-[13px] font-bold text-white">
              My league — round {state.standingsRound?.roundNumber ?? standingsRoundNumber}, week {weeklyWeek}
            </h2>
            {myLeague ? (
              <div className="tournament-panel overflow-x-auto p-2">
                <table className="w-full sm:min-w-[560px]">
                  <tbody>
                    {myLeague.participants
                      .filter((r) => filterQ(r.participant.displayName))
                      .sort((a, b) => weekPoints(b) - weekPoints(a))
                      .map((row, idx) => (
                        <StandingsRow
                          key={`${row.id}-wl`}
                          row={row}
                          rank={idx + 1}
                          highlight={row.userId === ctx.viewerUserId}
                          hidePf={false}
                          variant="weekly"
                        />
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">
                Join a tournament league to see your pod&apos;s weekly scores here. Global and conference views above
                include everyone in this round.
              </div>
            )}
          </section>
        </div>
      ) : null}

      {state.standingsError ? (
        <p className="text-[12px] text-red-300">{state.standingsError}</p>
      ) : null}
    </div>
  )
}
