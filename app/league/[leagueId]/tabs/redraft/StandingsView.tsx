'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  advancePlayoffRound,
  fetchRedraftPlayoffRuntime,
  finalizeRedraftSeason,
  generatePlayoffs,
  type RedraftPlayoffRuntimeClient,
} from '@/lib/redraft/client'

export function StandingsView({
  rows,
  seasonId,
  isCommissioner = false,
}: {
  rows: {
    id: string
    teamName: string | null
    ownerName?: string | null
    wins: number
    losses: number
    ties?: number
    pointsFor: number
    pointsAgainst?: number
    playoffSeed?: number | null
    streak?: string | null
  }[]
  seasonId: string | null
  isCommissioner?: boolean
}) {
  const [playoffTeams, setPlayoffTeams] = useState<number>(Math.min(6, Math.max(2, rows.length || 6)))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finalizeBusy, setFinalizeBusy] = useState(false)
  const [finalizeResult, setFinalizeResult] = useState<string | null>(null)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [advanceBusy, setAdvanceBusy] = useState(false)
  const [advanceMsg, setAdvanceMsg] = useState<string | null>(null)
  const [advanceError, setAdvanceError] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<RedraftPlayoffRuntimeClient | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  const refreshRuntime = useCallback(async () => {
    if (!seasonId) {
      setRuntime(null)
      return
    }
    setRuntimeLoading(true)
    setRuntimeError(null)
    try {
      setRuntime(await fetchRedraftPlayoffRuntime({ seasonId }))
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : 'Failed to load playoff runtime')
    } finally {
      setRuntimeLoading(false)
    }
  }, [seasonId])

  useEffect(() => {
    void refreshRuntime()
  }, [refreshRuntime])

  const onFinalize = async () => {
    if (!seasonId) return
    setFinalizeBusy(true)
    setFinalizeError(null)
    setFinalizeResult(null)
    try {
      const res = await finalizeRedraftSeason({ seasonId })
      if (res.alreadyFinalized) {
        setFinalizeResult('Season already finalized.')
      } else if (res.status === 'ok') {
        setFinalizeResult(
          res.championTeamName ? `Champion: ${res.championTeamName}` : 'Season finalized.',
        )
      } else {
        setFinalizeError(`Cannot finalize: ${res.status.replace(/_/g, ' ')}`)
      }
      await refreshRuntime()
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : 'Failed to finalize season')
    } finally {
      setFinalizeBusy(false)
    }
  }

  const onGenerate = async () => {
    if (!seasonId) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await generatePlayoffs({ seasonId, playoffTeams, regenerate: true })
      const s = res.summary
      if (s) {
        setResult(`Generated ${s.playoffTeams}-team bracket (${s.rounds} rounds, ${s.byes} byes).`)
      } else {
        setResult('Playoff bracket generated.')
      }
      await refreshRuntime()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate playoffs')
    } finally {
      setBusy(false)
    }
  }

  // Derive playoff lifecycle state from the canonical runtime (never fabricated).
  const bracket = runtime?.bracket ?? null
  const generated = bracket?.generated ?? false
  const bracketComplete = bracket?.status === 'complete' || Boolean(bracket?.championRosterId)
  const rounds = bracket?.rounds ?? []
  const activeRoundIndex = rounds.findIndex((r) => r.status === 'active')
  const activeRound = activeRoundIndex >= 0 ? rounds[activeRoundIndex] : null
  const activeRoundResolved = Boolean(
    activeRound && activeRound.matchups.every((m) => m.bye || Boolean(m.winnerRosterId)),
  )
  const allRoundsComplete = generated && rounds.length > 0 && !activeRound
  const advanceWeek = runtime ? runtime.settings.playoffStartWeek + Math.max(0, activeRoundIndex) : 0

  const onAdvance = async () => {
    if (!seasonId || !activeRound) return
    setAdvanceBusy(true)
    setAdvanceError(null)
    setAdvanceMsg(null)
    try {
      const res = await advancePlayoffRound({ seasonId, week: advanceWeek })
      if (res.status === 'ready_for_champion_finalization' || res.status === 'championship_ready') {
        setAdvanceMsg('Championship ready — finalize to crown the champion.')
      } else if ((res.advanced ?? 0) > 0 || res.status === 'round_complete') {
        setAdvanceMsg(`Round advanced (${res.advanced} team${res.advanced === 1 ? '' : 's'}).`)
      } else if (res.blocked && res.blocked.length > 0) {
        setAdvanceError('Round is not ready to advance — resolve all matchups first.')
      } else {
        setAdvanceMsg(`Advance status: ${String(res.status).replace(/_/g, ' ')}`)
      }
      await refreshRuntime()
    } catch (e) {
      setAdvanceError(e instanceof Error ? e.message : 'Failed to advance round')
    } finally {
      setAdvanceBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {isCommissioner ? (
        <div
          data-testid="redraft-playoff-commissioner-controls"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Playoffs</p>

          {!generated ? (
            <>
              <input
                type="number"
                aria-label="Playoff team count"
                min={2}
                max={Math.max(2, rows.length)}
                value={playoffTeams}
                onChange={(e) => setPlayoffTeams(Math.max(2, Math.min(Number(e.target.value) || 2, Math.max(2, rows.length))))}
                className="w-20 rounded border border-white/15 bg-black/30 px-2 py-1 text-[11px] text-white"
              />
              <button
                type="button"
                data-testid="redraft-generate-bracket"
                onClick={() => void onGenerate()}
                disabled={!seasonId || busy || rows.length < 2}
                className="rounded bg-white/80 px-2 py-1 text-[11px] font-semibold text-black disabled:opacity-50"
              >
                {busy ? 'Generating...' : 'Generate Bracket'}
              </button>
              {result ? <span className="text-[11px] text-emerald-300">{result}</span> : null}
              {error ? <span className="text-[11px] text-rose-300">{error}</span> : null}
            </>
          ) : null}

          {generated && activeRound && !bracketComplete ? (
            <>
              <button
                type="button"
                data-testid="redraft-advance-round"
                onClick={() => void onAdvance()}
                disabled={!seasonId || advanceBusy || !activeRoundResolved}
                title={activeRoundResolved ? undefined : 'Resolve this round’s matchups before advancing.'}
                className="rounded bg-emerald-400/85 px-2 py-1 text-[11px] font-semibold text-black disabled:opacity-50"
              >
                {advanceBusy ? 'Advancing...' : `Advance ${activeRound.roundName}`}
              </button>
              {!activeRoundResolved ? (
                <span className="text-[11px] text-white/45">Resolve matchups to advance.</span>
              ) : null}
              {advanceMsg ? <span className="text-[11px] text-emerald-300">{advanceMsg}</span> : null}
              {advanceError ? <span className="text-[11px] text-rose-300">{advanceError}</span> : null}
            </>
          ) : null}

          {generated && allRoundsComplete && !bracketComplete ? (
            <>
              <button
                type="button"
                data-testid="redraft-finalize-season"
                onClick={() => void onFinalize()}
                disabled={!seasonId || finalizeBusy}
                className="rounded border border-amber-300/40 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-100 disabled:opacity-50"
              >
                {finalizeBusy ? 'Finalizing...' : 'Finalize Season'}
              </button>
              {finalizeResult ? <span className="text-[11px] text-amber-300">{finalizeResult}</span> : null}
              {finalizeError ? <span className="text-[11px] text-rose-300">{finalizeError}</span> : null}
            </>
          ) : null}

          {bracketComplete ? (
            <span data-testid="redraft-playoff-complete" className="text-[11px] font-semibold text-amber-200">
              {finalizeResult ?? 'Season finalized — champion crowned.'}
            </span>
          ) : null}
        </div>
      ) : null}

      <PlayoffRuntimePanel runtime={runtime} loading={runtimeLoading} error={runtimeError} />

      <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
        <table className="w-full text-left text-[12px] text-white/80">
        <thead className="border-b border-white/[0.08] bg-white/[0.04] text-[10px] uppercase text-white/45">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2">W-L-T</th>
            <th className="px-3 py-2">PF</th>
            <th className="px-3 py-2">PA</th>
            <th className="px-3 py-2">Streak</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-white/[0.05]">
              <td className="px-3 py-2 text-white/45">{r.playoffSeed ?? i + 1}</td>
              <td className="px-3 py-2">{r.teamName ?? r.ownerName ?? r.id.slice(0, 6)}</td>
              <td className="px-3 py-2">
                {r.wins}-{r.losses}-{r.ties ?? 0}
              </td>
              <td className="px-3 py-2">{r.pointsFor.toFixed(1)}</td>
              <td className="px-3 py-2">{(r.pointsAgainst ?? 0).toFixed(1)}</td>
              <td className="px-3 py-2">{r.streak ?? '-'}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  )
}

function PlayoffRuntimePanel({
  runtime,
  loading,
  error,
}: {
  runtime: RedraftPlayoffRuntimeClient | null
  loading: boolean
  error: string | null
}) {
  if (loading && !runtime) {
    return (
      <div
        data-testid="redraft-playoff-runtime"
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-[11px] text-white/55"
      >
        Loading playoff runtime...
      </div>
    )
  }

  if (error && !runtime) {
    return (
      <div
        data-testid="redraft-playoff-runtime"
        className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-[11px] text-rose-200"
      >
        {error}
      </div>
    )
  }

  if (!runtime) return null

  const champion = runtime.teams.find((team) => team.rosterId === runtime.bracket.championRosterId)
  const rounds = runtime.bracket.rounds
  const firstRoundByes = runtime.seeds.slice(0, runtime.settings.firstRoundByes)

  return (
    <section
      data-testid="redraft-playoff-runtime"
      className="grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 text-[12px] text-white/75 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/50">
            Playoff runtime
          </span>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200">
            {runtime.bracket.status.replace(/_/g, ' ')}
          </span>
          {runtime.bracket.locked ? (
            <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">
              Locked
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <RuntimeMetric label="Teams" value={runtime.settings.playoffTeamCount} />
          <RuntimeMetric label="Rounds" value={runtime.settings.roundCount} />
          <RuntimeMetric label="Start" value={`Week ${runtime.settings.playoffStartWeek}`} />
          <RuntimeMetric label="Byes" value={runtime.settings.firstRoundByes} />
        </div>

        {runtime.bracket.generated ? (
          <div data-testid="redraft-playoff-seeds" className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Qualified seeds</p>
            <div className="flex flex-wrap gap-1.5">
              {runtime.seeds.map((seed) => (
                <span key={seed.rosterId} className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/75">
                  {seed.seed}. {seed.displayName}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div data-testid="redraft-playoff-empty" className="rounded-lg border border-dashed border-white/12 bg-black/15 p-3 text-[11px] text-white/55">
            Playoff qualification is available from standings. Generate a bracket when regular-season results are ready.
          </div>
        )}

        {firstRoundByes.length ? (
          <p className="text-[11px] text-white/50">
            First-round byes: {firstRoundByes.map((seed) => seed.displayName).join(', ')}
          </p>
        ) : null}

        {champion ? (
          <p data-testid="redraft-playoff-champion" className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-[12px] font-semibold text-amber-100">
            Champion crowned: {champion.displayName}
          </p>
        ) : null}
      </div>

      <div data-testid="redraft-playoff-bracket" className="grid gap-2">
        {rounds.length ? (
          rounds.map((round) => (
            <div key={round.roundId} className="rounded-lg border border-white/[0.08] bg-black/15 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-white/80">{round.roundName}</p>
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/38">{round.status}</span>
              </div>
              <div className="grid gap-1.5">
                {round.matchups.map((matchup) => (
                  <div key={matchup.matchupId} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11px]">
                    <span className="truncate text-white/70">{teamName(runtime, matchup.homeRosterId, matchup.homeSeed)}</span>
                    <span className="text-white/35">vs</span>
                    <span className="truncate text-right text-white/70">{teamName(runtime, matchup.awayRosterId, matchup.awaySeed)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-white/12 bg-black/15 p-3 text-[11px] text-white/55">
            No bracket rows are stored yet.
          </div>
        )}
      </div>
    </section>
  )
}

function RuntimeMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/15 p-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white/85">{value}</p>
    </div>
  )
}

function teamName(runtime: RedraftPlayoffRuntimeClient, rosterId: string | null, seed: number | null) {
  if (!rosterId) return seed ? `Seed ${seed} bye` : 'TBD'
  const team = runtime.teams.find((row) => row.rosterId === rosterId)
  const prefix = seed ? `${seed}. ` : ''
  return `${prefix}${team?.displayName ?? rosterId.slice(0, 6)}`
}
