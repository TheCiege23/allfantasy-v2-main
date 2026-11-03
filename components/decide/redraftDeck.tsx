'use client'

import { useMemo } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { resolveRedraftIdentity, type RedraftIdentity } from '@/lib/league-media/redraftIdentity'
import './redraft-deck.css'

/**
 * Redraft broadcast deck (batch A3): Decision OS, Live Intel, Legacy and the Commissioner tab.
 *
 * Every deck screen asks `useRedraftDeck(league)`; `null` means "not a native redraft league" and the
 * screen renders exactly as before. The stylesheet (redraft-deck.css) is scoped to the workspace's
 * `data-format=redraft][data-sport]` as well, so the two gates agree: redraft-only markup appears only
 * where its styles apply, and /core (which mounts `.bdx` embeds without those attributes) is untouched.
 */
export type RedraftDeckLeague = Pick<
  UserLeague,
  'platform' | 'sport' | 'leagueType' | 'leagueVariant' | 'isDynasty' | 'bestBallMode' | 'guillotineMode' | 'keeperPhaseActive'
>

export function useRedraftDeck(league: RedraftDeckLeague | null | undefined): RedraftIdentity | null {
  const { platform, sport, leagueType, leagueVariant, isDynasty, bestBallMode, guillotineMode, keeperPhaseActive } = league ?? {}
  return useMemo(
    () =>
      league
        ? resolveRedraftIdentity({ platform, sport, leagueType, leagueVariant, isDynasty, bestBallMode, guillotineMode, keeperPhaseActive })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(league), platform, sport, leagueType, leagueVariant, isDynasty, bestBallMode, guillotineMode, keeperPhaseActive],
  )
}

/** The `data-rd-deck` stamp a deck root carries in a redraft league (the capture script reads it). */
export function rdDeckAttrs(rd: RedraftIdentity | null): Record<string, string> {
  return rd ? { 'data-rd-deck': rd.sport } : {}
}
