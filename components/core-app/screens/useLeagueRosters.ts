'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The league's rosters, read once and shared by everything on the Trade Center
 * that needs them.
 *
 * ⚠ ONE FETCH, BECAUSE THIS READ IS NOT CHEAP. `/trades/rosters` enriches every
 * roster in the league through `getNormalizedPlayerData`. The asset picker, the
 * counterparty selector and the propose panel all want the same answer, and
 * three components each fetching it would triple that work for one screen.
 *
 * ⚠ LAZY, AND `enabled` IS LOAD-BEARING. A manager who opens the Trades tab and
 * reads the verdict on someone else's deal never needs this at all. It only
 * runs once they start building something.
 */

export type RosterPlayer = { id: string; name: string; position: string | null }

export type RosterPick = {
  pickId: string
  season: number | null
  round: number | null
  label: string
  itemType: 'rookie_pick' | 'future_pick'
}

export type LeagueRoster = {
  rosterId: string
  platformUserId: string
  players: RosterPlayer[]
  picks: RosterPick[]
  /** `LeagueTeam.externalId` — what the analyzer means by opponent. */
  teamExternalId: string | null
  ownerName: string | null
  canReceiveProposal: boolean
}

export type LeagueRostersData = {
  rosters: LeagueRoster[]
  /**
   * The roster a proposal may be sent FROM — the engine's own predicate, and
   * null on every imported league.
   */
  viewerRosterId: string | null
  /**
   * The roster that is the viewer's TEAM on screen. Resolved the way the rest
   * of the league surfaces resolve identity, so it is present on imports too.
   *
   * ⚠ USE THIS ONE FOR "WHICH TEAM IS MINE" AND THE OTHER FOR "CAN I SEND
   * THIS". Filtering a counterparty list by `viewerRosterId` filters nothing on
   * an import and offers the manager their own team to trade with.
   */
  viewerTeamRosterId: string | null
}

export type LeagueRostersState = 'idle' | 'loading' | 'failed'

export function useLeagueRosters(
  leagueId: string | null,
  enabled: boolean,
): { data: LeagueRostersData | null; state: LeagueRostersState } {
  const [data, setData] = useState<LeagueRostersData | null>(null)
  const [state, setState] = useState<LeagueRostersState>('idle')

  const load = useCallback(async () => {
    if (!leagueId) return
    setState('loading')
    try {
      const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/rosters`)
      const j = (await r.json().catch(() => ({}))) as Partial<LeagueRostersData>
      if (!r.ok) {
        setState('failed')
        return
      }
      setData({
        rosters: Array.isArray(j.rosters) ? j.rosters : [],
        viewerRosterId: j.viewerRosterId ?? null,
        viewerTeamRosterId: j.viewerTeamRosterId ?? null,
      })
      setState('idle')
    } catch {
      setState('failed')
    }
  }, [leagueId])

  useEffect(() => {
    if (!leagueId || !enabled || data != null || state === 'loading') return
    void load()
  }, [leagueId, enabled, data, state, load])

  return { data, state }
}
