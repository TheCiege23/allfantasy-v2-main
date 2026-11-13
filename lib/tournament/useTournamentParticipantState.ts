'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TournamentUiContextValue } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import {
  fetchTournamentStandingsJson,
  type StandingsLeague,
  type StandingsLeagueRow,
} from '@/lib/tournament/tournamentStandingsFetch'

type AdvancementRoundEntry = {
  round?: number
  toRound?: number
  advanced?: boolean
  [key: string]: unknown
}

export type TournamentParticipantUiStatus =
  | 'active'
  | 'bubble'
  | 'advanced'
  | 'eliminated'
  | 'champion'
  | 'waitlisted'
  | 'registering'

function rowForUser(leagues: StandingsLeague[], userId: string | null): StandingsLeagueRow | null {
  if (!userId) return null
  for (const L of leagues) {
    for (const p of L.participants) {
      if (p.userId === userId) return p
    }
  }
  return null
}

export function useTournamentParticipantState(
  ctx: TournamentUiContextValue,
  opts?: { roundNumber?: number; weeklyWeek?: number | null },
) {
  const { shell, participant, viewerUserId, tournamentLeagues } = ctx
  const [standingsError, setStandingsError] = useState<string | null>(null)
  const [standingsReady, setStandingsReady] = useState(false)
  const [round, setRound] = useState(ctx.rounds.find((r) => r.roundNumber === shell.currentRoundNumber) ?? ctx.rounds[0] ?? null)
  const [leagues, setLeagues] = useState<StandingsLeague[]>([])

  const reload = useCallback(async () => {
    setStandingsError(null)
    setStandingsReady(false)
    try {
      const rn = opts?.roundNumber ?? (shell.currentRoundNumber || 1)
      const wk = opts?.weeklyWeek != null && Number.isFinite(opts.weeklyWeek) ? opts.weeklyWeek : undefined
      const data = await fetchTournamentStandingsJson(shell.id, rn, wk)
      setRound(data.round)
      setLeagues(data.leagues)
    } catch (e) {
      setStandingsError(e instanceof Error ? e.message : 'Standings unavailable')
    } finally {
      setStandingsReady(true)
    }
  }, [shell.id, shell.currentRoundNumber, opts?.roundNumber, opts?.weeklyWeek])

  useEffect(() => {
    void reload()
  }, [reload])

  const myRow = useMemo(() => rowForUser(leagues, viewerUserId), [leagues, viewerUserId])

  const currentTournamentLeague = useMemo(() => {
    if (!participant?.currentLeagueId) return null
    return tournamentLeagues.find((l) => l.id === participant.currentLeagueId) ?? null
  }, [participant?.currentLeagueId, tournamentLeagues])

  const advancementHistory = useMemo((): AdvancementRoundEntry[] => {
    const h = participant?.advancementHistory
    if (Array.isArray(h)) return h as AdvancementRoundEntry[]
    return []
  }, [participant?.advancementHistory])

  const [hasSeenAdvancement, setHasSeenAdvancement] = useState(false)
  useEffect(() => {
    try {
      setHasSeenAdvancement(
        typeof window !== 'undefined' &&
          window.localStorage.getItem(`tournament-advance-seen-${shell.id}`) === '1',
      )
    } catch {
      setHasSeenAdvancement(false)
    }
  }, [shell.id])

  const markAdvancementSeen = useCallback(() => {
    try {
      window.localStorage.setItem(`tournament-advance-seen-${shell.id}`, '1')
      setHasSeenAdvancement(true)
    } catch {
      /* ignore */
    }
  }, [shell.id])

  const nextDraftAt: Date | null = useMemo(() => {
    if (!currentTournamentLeague?.draftScheduledAt) return null
    return new Date(currentTournamentLeague.draftScheduledAt)
  }, [currentTournamentLeague?.draftScheduledAt])

  const isDraftLive = Boolean(
    currentTournamentLeague?.status === 'drafting' || currentTournamentLeague?.status === 'active',
  )

  const uiStatus: TournamentParticipantUiStatus = useMemo(() => {
    if (!participant) return 'registering'
    if (participant.status === 'eliminated') return 'eliminated'
    if (participant.status === 'champion') return 'champion'
    if (participant.status === 'waitlisted') return 'waitlisted'
    if (myRow?.advancementStatus === 'bubble') return 'bubble'
    if (myRow?.advancementStatus === 'qualified' || myRow?.advancementStatus === 'wildcard_eligible') {
      return 'advanced'
    }
    return 'active'
  }, [participant, myRow?.advancementStatus])

  return {
    status: uiStatus,
    currentRound: round?.roundNumber ?? shell.currentRoundNumber,
    currentLeagueId: participant?.currentLeagueId ?? null,
    currentConferenceId: participant?.currentConferenceId ?? null,
    leagueRank: myRow?.leagueRank ?? null,
    conferenceRank: myRow?.conferenceRank ?? null,
    globalRank: myRow?.conferenceRank ?? null,
    advancementHistory,
    isCommissioner: ctx.isCommissioner,
    hasSeenAdvancement,
    nextDraftAt,
    isDraftLive,
    standingsRound: round,
    standingsLeagues: leagues,
    standingsReady,
    standingsError,
    reloadStandings: reload,
    myStandingsRow: myRow,
    participantRecord: participant,
    markAdvancementSeen,
  }
}
