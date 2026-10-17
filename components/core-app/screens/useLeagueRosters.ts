'use client'

import { useEffect, useState } from 'react'
import type { PartnerRanking } from '@/lib/trade-intel/partnerRanking'
import type { UnpricedReason } from '@/lib/trade-value/unpricedReason'
import type { TradePickPreviewBook } from '@/lib/trade-value-console/pickPreview'

/**
 * The league's rosters, read once and shared by everything on the Trade Center
 * that needs them.
 *
 * ⚠ ONE FETCH, BECAUSE THIS READ IS NOT CHEAP. `/trades/rosters` enriches every
 * roster in the league through `getNormalizedPlayerData`. The asset picker, the
 * counterparty selector and the propose panel all want the same answer, and
 * three components each fetching it would triple that work for one screen.
 *
 * ⚠ LEAGUE-SCOPED. The preview needs this quote book before analysis, so it
 * loads for a selected league. Global Trade Center has no league roster to load.
 */

/**
 * A player on someone's roster, as the picker renders them.
 *
 * ⚠ EVERY FIELD PAST `position` ALREADY EXISTED SERVER-SIDE and was being discarded before it
 * reached the wire. The picker was a search box because this shape gave it nothing to show.
 * `null` on any of them is a real state — no headshot, no known bye — and must render as absent
 * rather than as a placeholder value a manager could mistake for data.
 */
export type RosterPlayer = {
  id: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  byeWeek: number | null
  injuryStatus: string | null
  /** ⚠ NULL IS "NOT PRICED", NEVER 0 — an unpriced asset is why a verdict declines to judge. */
  value: number | null
  /**
   * 30-day direction. Null means unmeasured, which is not the same as unmoved.
   *
   * ⚠ OPTIONAL, LIKE ITS COUNTERPART ON THE ROUTE. This mirrors a response body, and a browser
   * holding this bundle can be talking to the previous deploy, which omits the key entirely.
   */
  stock?: 'up' | 'down' | 'flat' | null
  stockDelta?: number | null
  /** Why `value` is null, in the words the builder prints. Optional for the same rollout reason. */
  unpricedReason?: UnpricedReason | null
  /** AllFantasy's own weekly projection under this league's scoring. Display only; optional for rollout. */
  afProjection?: number | null
}

export type RosterPick = {
  pickId: string
  season: number | null
  round: number | null
  label: string
  itemType: 'rookie_pick' | 'future_pick'
  /** ⚠ NULL IS "NOT PRICED", never 0 — the same contract `RosterPlayer.value` carries. */
  value: number | null
  /** Why `value` is null; set only when the route could not place the pick on the curve. */
  unpricedReason?: UnpricedReason | null
  /**
   * False for an imported league's pick (read from `future_draft_picks`): listed and valued, but
   * `pickId` is not an id a proposal can reference. Absent means proposable.
   */
  proposable?: boolean
  /** The team the pick originally belonged to, when that is not this roster. */
  fromTeam?: string | null
}

/**
 * How complete an imported league's pick lists are. `traded_only`: the league's rookie-draft size is
 * unknown, so only picks that changed hands are listed — a short list is not "no picks".
 */
export type PickCoverage = 'complete' | 'traded_only' | 'none'

export type LeagueRoster = {
  rosterId: string
  platformUserId: string
  players: RosterPlayer[]
  picks: RosterPick[]
  /** `LeagueTeam.externalId` — what the analyzer means by opponent. */
  teamExternalId: string | null
  ownerName: string | null
  /**
   * Other names this manager goes by — the manager's own name where `ownerName` is the team name, and
   * the account name. Optional: absent from a server that predates it.
   */
  ownerHandles?: string[]
  /** Manager avatar from the league, for the header above their asset list. */
  avatarUrl: string | null
  /** ⚠ 0-0-0 is a REAL record pre-season, not "unknown". Render it. */
  wins: number
  losses: number
  ties: number
  /** FAAB left. Null means the league tracks none — not $0 available to offer. */
  faabRemaining: number | null
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
  /**
   * The other managers ranked as trade partners, with reasons and a starting package.
   *
   * ⚠ OPTIONAL AND NULLABLE. Absent: a server from before the ranking shipped. Null: no viewer
   * team, or the ranking could not be produced. Either way the chips fall back to roster order.
   */
  partnerRanking?: PartnerRanking | null
  /** Optional: absent from a server that predates imported picks. */
  pickCoverage?: PickCoverage
  pickPreviewBook?: TradePickPreviewBook | null
}

export type LeagueRostersState = 'idle' | 'loading' | 'failed'

export function useLeagueRosters(
  leagueId: string | null,
  enabled: boolean,
  viewerId?: string | null,
): { data: LeagueRostersData | null; state: LeagueRostersState } {
  const [data, setData] = useState<LeagueRostersData | null>(null)
  const [state, setState] = useState<LeagueRostersState>('idle')

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    setData(null)
    if (!leagueId || !enabled) {
      setState('idle')
      return () => { current = false; controller.abort() }
    }
    setState('loading')
    void (async () => {
      try {
        const response = await fetch('/api/leagues/' + encodeURIComponent(leagueId) + '/trades/rosters',
          { signal: controller.signal })
        const j = (await response.json().catch(() => ({}))) as Partial<LeagueRostersData>
        if (!current) return
        if (!response.ok) {
          setState('failed')
          return
        }
        setData({
          rosters: Array.isArray(j.rosters) ? j.rosters : [],
          viewerRosterId: j.viewerRosterId ?? null,
          viewerTeamRosterId: j.viewerTeamRosterId ?? null,
          partnerRanking: j.partnerRanking ?? null,
          pickCoverage: j.pickCoverage ?? 'none',
          pickPreviewBook: j.pickPreviewBook ?? null,
        })
        setState('idle')
      } catch {
        if (current) setState('failed')
      }
    })()
    return () => { current = false; controller.abort() }
  }, [leagueId, enabled, viewerId])

  return { data, state }
}
