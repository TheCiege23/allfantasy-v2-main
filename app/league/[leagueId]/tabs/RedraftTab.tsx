'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRedraftStream } from '@/lib/hooks/useRedraftStream'
import { MatchupView } from './redraft/MatchupView'
import { RosterManager } from './redraft/RosterManager'
import { ScheduleView } from './redraft/ScheduleView'
import { StandingsView } from './redraft/StandingsView'
import { TradeCenter } from './redraft/TradeCenter'
import { WaiverCenter } from './redraft/WaiverCenter'
import { IDPWaiverSection } from '@/app/idp/components/IDPWaiverSection'
import {
  fetchRedraftMatchups,
  fetchRedraftRoster,
  fetchRedraftSchedule,
  fetchRedraftSeason,
  fetchRedraftStandings,
  type RedraftMatchupClient,
  type RedraftRosterClient,
  type RedraftRosterRow,
  type RedraftScheduleClient,
  type RedraftSeasonClient,
} from '@/lib/redraft/client'

export function RedraftTab({ leagueId, idpLeagueUi = false }: { leagueId: string; idpLeagueUi?: boolean }) {
  const [season, setSeason] = useState<RedraftSeasonClient | null>(null)
  const [standings, setStandings] = useState<RedraftRosterRow[]>([])
  const [matchups, setMatchups] = useState<RedraftMatchupClient[]>([])
  const [schedule, setSchedule] = useState<RedraftScheduleClient | null>(null)
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null)
  const [selectedRoster, setSelectedRoster] = useState<RedraftRosterClient | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const seasonId = season?.id ?? null
  const currentWeek = Math.max(1, season?.currentWeek || 1)
  const sport = season?.sport ?? 'NFL'

  useRedraftStream(seasonId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const nextSeason = await fetchRedraftSeason(leagueId)
        if (cancelled) return
        setSeason(nextSeason)
        setSelectedRosterId((prev) => prev ?? nextSeason?.rosters?.[0]?.id ?? null)
      } catch (err) {
        if (!cancelled) {
          setSeason(null)
          setSelectedRosterId(null)
          setError(err instanceof Error ? err.message : 'Unable to load redraft season.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    ;(async () => {
      try {
        const [rows, weeklyMatchups] = await Promise.all([
          fetchRedraftStandings(seasonId),
          fetchRedraftMatchups(seasonId, currentWeek),
        ])
        if (!cancelled) {
          setStandings(rows)
          setMatchups(weeklyMatchups)
        }
      } catch {
        if (!cancelled) {
          setStandings([])
          setMatchups([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [seasonId, currentWeek])

  useEffect(() => {
    if (!seasonId) {
      setSchedule(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const nextSchedule = await fetchRedraftSchedule(leagueId, seasonId)
        if (!cancelled) setSchedule(nextSchedule)
      } catch {
        if (!cancelled) setSchedule(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, seasonId])

  useEffect(() => {
    if (!selectedRosterId) {
      setSelectedRoster(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const roster = await fetchRedraftRoster(selectedRosterId, currentWeek)
        if (!cancelled) setSelectedRoster(roster)
      } catch {
        if (!cancelled) setSelectedRoster(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedRosterId, currentWeek])

  const visibleMatchup = useMemo(() => {
    if (!selectedRosterId) return matchups[0] ?? null
    return (
      matchups.find((m) => m.homeRosterId === selectedRosterId || m.awayRosterId === selectedRosterId) ??
      matchups[0] ??
      null
    )
  }, [matchups, selectedRosterId])

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Redraft</h2>
          <p className="text-[11px] text-white/45">
            NFL redraft scoring uses cached weekly stats, PlayerWeeklyScore, and league matchup records.
          </p>
        </div>
        {season?.rosters?.length ? (
          <label className="flex items-center gap-2 text-[11px] text-white/55">
            Roster
            <select
              value={selectedRosterId ?? ''}
              onChange={(event) => setSelectedRosterId(event.target.value || null)}
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
            >
              {season.rosters.map((roster) => (
                <option key={roster.id} value={roster.id}>
                  {roster.teamName ?? roster.ownerName ?? roster.id.slice(0, 6)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-[12px] text-white/50">
          Loading redraft season...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-4 text-[12px] text-rose-100">
          {error}
        </div>
      ) : !season ? (
        <div className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-4 text-[12px] text-amber-100">
          No active redraft season is connected to this league yet.
        </div>
      ) : null}

      <MatchupView matchup={visibleMatchup} selectedRosterId={selectedRosterId} sport={sport} />

      <ScheduleView schedule={schedule} />

      <div className="grid gap-4 lg:grid-cols-2">
        <RosterManager roster={selectedRoster} week={currentWeek} />
        <div className="space-y-3">
          <WaiverCenter
            seasonId={seasonId}
            leagueId={leagueId}
            rosterId={selectedRosterId}
            sport={sport}
          />
          {idpLeagueUi ? <IDPWaiverSection leagueId={leagueId} week={currentWeek} /> : null}
        </div>
      </div>

      <TradeCenter
        leagueId={leagueId}
        seasonId={seasonId}
        standings={standings}
        currentWeek={currentWeek}
        myRosterId={selectedRosterId}
      />

      <StandingsView rows={standings} seasonId={seasonId} />
    </div>
  )
}
