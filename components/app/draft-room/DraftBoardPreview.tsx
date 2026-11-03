'use client'

import { useMemo } from 'react'
import { DraftBoard } from './DraftBoard'
import type { DraftPickSnapshot, DraftType, SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'

export type DraftBoardPreviewTeam = {
  id: string
  slot: number
  name: string
  avatarUrl?: string | null
  isUser?: boolean
  isCpu?: boolean
  isOrphan?: boolean
}

export type DraftBoardPreviewPick = {
  overall: number
  round: number
  slot: number
  rosterId: string
  originalRosterId?: string | null
  playerName?: string | null
  playerId?: string | null
  position?: string | null
  team?: string | null
  headshotUrl?: string | null
  byeWeek?: number | null
  amount?: number | null
  source?: string
}

type Props = {
  teams: DraftBoardPreviewTeam[]
  picks: DraftBoardPreviewPick[]
  teamCount: number
  rounds: number
  sport: string
  draftType?: DraftType
  thirdRoundReversal?: boolean
  currentOverall?: number | null
  orderSourceLabel?: string | null
}

/** Display adapter for the mock engines. Pick ownership and turn timing remain with the caller. */
export function DraftBoardPreview({
  teams, picks, teamCount, rounds, sport, draftType = 'snake',
  thirdRoundReversal = false, currentOverall = null, orderSourceLabel,
}: Props) {
  const slotOrder = useMemo<SlotOrderEntry[]>(() => teams.map((team) => ({
    slot: team.slot, rosterId: team.id, displayName: team.name,
  })), [teams])
  const teamMetaByRoster = useMemo(() => Object.fromEntries(teams.map((team) => [team.id, {
    rosterId: team.id, teamName: team.name, avatarUrl: team.avatarUrl, isOrphan: team.isOrphan,
  }])), [teams])
  const boardPicks = useMemo<DraftPickSnapshot[]>(() => picks
    .filter((pick) => Boolean(pick.playerName?.trim()))
    .map((pick) => ({
      id: `preview-${pick.overall}`, overall: pick.overall, round: pick.round, slot: pick.slot,
      rosterId: pick.rosterId,
      displayName: teams.find((team) => team.id === pick.rosterId)?.name ?? null,
      playerName: pick.playerName!, position: pick.position ?? '', team: pick.team ?? null,
      byeWeek: pick.byeWeek ?? null, playerId: pick.playerId ?? null,
      playerImageUrl: pick.headshotUrl ?? null, amount: pick.amount ?? null,
      tradedPickMeta: pick.originalRosterId && pick.originalRosterId !== pick.rosterId
        ? { originalRosterId: pick.originalRosterId } : null,
      source: pick.source ?? 'mock', pickLabel: `${pick.round}.${String((pick.overall - 1) % teamCount + 1).padStart(2, '0')}`,
      createdAt: '',
    })), [picks, teams, teamCount])
  const tradedPicks = useMemo<TradedPickRecord[]>(() => picks
    .filter((pick) => pick.originalRosterId && pick.originalRosterId !== pick.rosterId)
    .map((pick) => ({
      round: pick.round, originalRosterId: pick.originalRosterId!, newRosterId: pick.rosterId,
      previousOwnerName: teams.find((team) => team.id === pick.originalRosterId)?.name ?? 'Original owner',
      newOwnerName: teams.find((team) => team.id === pick.rosterId)?.name ?? 'New owner',
    })), [picks, teams])

  return <DraftBoard
    picks={boardPicks} slotOrder={slotOrder} tradedPicks={tradedPicks}
    teamCount={teamCount} rounds={rounds} sport={sport} draftType={draftType}
    thirdRoundReversal={thirdRoundReversal} currentOverallPick={currentOverall}
    currentUserRosterId={teams.find((team) => team.isUser)?.id ?? null}
    aiManagedRosterIds={teams.filter((team) => team.isCpu).map((team) => team.id)}
    teamMetaByRoster={teamMetaByRoster} orderSourceLabel={orderSourceLabel}
  />
}
