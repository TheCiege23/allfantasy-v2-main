/**
 * MLB / NBA / NHL pools carry a three-state rookie verdict (`rookieVerdict`) from stored season
 * stats. On a rookies-only board: proven non-rookies are removed AND refused at pick time, unknown
 * players stay on the board and are never refused, and the draft room says the data is partial.
 * NFL pools carry no verdicts and keep their two-state behaviour exactly.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const h = vi.hoisted(() => ({
  snapshot: { warm: false, payload: null } as { warm: boolean; payload: unknown },
}))

vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  getWarmDraftPoolSnapshotFast: vi.fn(async () => h.snapshot),
}))

import { applyDraftModePoolFiltersWithState } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { resolveRookieFilterState, parseRookieFilterState } from '@/lib/draft-room/rookieFilterState'
import {
  filterCandidatesForPlayerPool,
  resolveServerRookieStatus,
  rookieStatusFromPoolEntries,
} from '@/lib/live-draft-engine/serverRookieStatus'
import { validateSpecialtyDraftPools } from '@/lib/live-draft-engine/SpecialtyDraftPoolValidation'
import { extractRookieHint } from '@/lib/draft-room/sportsPlayerRecordDraftEnrichment'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { isRookieEligibleForFilter, isVetEligibleForFilter } from '@/lib/draft-room/rookieFilterPredicate'
import { RookieFilterFallbackBanner } from '@/components/app/draft-room/RookieFilterFallbackBanner'
import { translations } from '@/lib/i18n/translations'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'

type Verdict = 'rookie' | 'not_rookie' | 'unknown'
const nba = (name: string, playerId: string, rookieVerdict: Verdict, isRookie?: boolean) =>
  ({ name, playerId, position: 'PG', team: 'BOS', rookieVerdict, isRookie, display: { playerId } }) as unknown as NormalizedDraftEntry

const VERDICT_POOL = [
  nba('Proven Vet', '101', 'not_rookie'),
  nba('Unknown Guard', '102', 'unknown'),
  nba('Other Unknown', '103', 'unknown'),
]
const ROOKIES_ONLY = { playerPool: 'rookies_only' }
const names = (entries: Array<{ name: string }>) => entries.map((e) => e.name)

beforeEach(() => {
  h.snapshot = { warm: false, payload: null }
})

describe('the rookies-only board for a verdict pool', () => {
  it('partial data: removes proven non-rookies, keeps unknown players, and lists who was removed', () => {
    const out = applyDraftModePoolFiltersWithState(VERDICT_POOL, ROOKIES_ONLY, [])
    expect(out.rookieFilterState).toBe('partial_rookie_data')
    expect(names(out.entries)).toEqual(['Unknown Guard', 'Other Unknown'])
    expect(out.provenNonRookies).toEqual([{ playerId: '101', name: 'Proven Vet' }])
  })

  it('no known verdict at all: the full pool, as before', () => {
    const allUnknown = VERDICT_POOL.map((e) => ({ ...e, rookieVerdict: 'unknown' as const }))
    const out = applyDraftModePoolFiltersWithState(allUnknown, ROOKIES_ONLY, [])
    expect(out.rookieFilterState).toBe('fallback_no_rookie_data')
    expect(out.entries).toHaveLength(3)
    expect(out.provenNonRookies).toEqual([])
  })

  it('every player known: narrowed to the rookies (a devy rookie flag counts)', () => {
    const known = [nba('Proven Vet', '101', 'not_rookie'), nba('Proven Rookie', '104', 'rookie', true), { ...nba('Devy', '105', 'unknown'), rookieVerdict: undefined, isRookie: true }]
    const out = applyDraftModePoolFiltersWithState(known as NormalizedDraftEntry[], ROOKIES_ONLY, [])
    expect(out.rookieFilterState).toBe('applied')
    expect(names(out.entries)).toEqual(['Proven Rookie', 'Devy'])
    expect(out.provenNonRookies).toEqual([{ playerId: '101', name: 'Proven Vet' }])
  })

  it('an NFL-style pool with no verdicts keeps the two-state rule', () => {
    const nfl = [
      { name: 'Rookie', playerId: 'a', isRookie: true },
      { name: 'Vet', playerId: 'b' },
    ] as unknown as NormalizedDraftEntry[]
    const out = applyDraftModePoolFiltersWithState(nfl, ROOKIES_ONLY, [])
    expect(out.rookieFilterState).toBe('applied')
    expect(names(out.entries)).toEqual(['Rookie'])
    expect(out.provenNonRookies).toEqual([])
    expect(resolveRookieFilterState(nfl, { playerPool: 'veterans_only' })).toBe('not_requested')
  })

  it('the new state survives the API round trip', () => {
    expect(parseRookieFilterState('partial_rookie_data')).toBe('partial_rookie_data')
  })
})

describe('the server pick check against a verdict board', () => {
  const board = applyDraftModePoolFiltersWithState(VERDICT_POOL, ROOKIES_ONLY, [])

  it('refuses a proven non-rookie even though the board no longer lists him', () => {
    expect(rookieStatusFromPoolEntries(board.entries, { playerId: '101', playerName: 'Proven Vet' }, board.provenNonRookies)).toBe(false)
    expect(rookieStatusFromPoolEntries(board.entries, { playerName: 'Proven Vet' }, board.provenNonRookies)).toBe(false)
  })

  it('never refuses an unknown player, on the board or off it', () => {
    expect(rookieStatusFromPoolEntries(board.entries, { playerId: '102', playerName: 'Unknown Guard' }, board.provenNonRookies)).toBeNull()
    expect(rookieStatusFromPoolEntries(board.entries, { playerId: '999', playerName: 'Nobody' }, board.provenNonRookies)).toBeNull()
  })

  it('reads an unfiltered verdict board (snapshot built before the mode was set) by each verdict', () => {
    expect(rookieStatusFromPoolEntries(VERDICT_POOL, { playerId: '101' })).toBe(false)
    expect(rookieStatusFromPoolEntries(VERDICT_POOL, { playerId: '102' })).toBeNull()
    expect(rookieStatusFromPoolEntries([...VERDICT_POOL, nba('Proven Rookie', '104', 'rookie', true)], { playerId: '104' })).toBe(true)
  })

  it('reads the removed list off the warm snapshot, and pick validation refuses on it', async () => {
    h.snapshot = { warm: true, payload: { entries: board.entries, provenNonRookies: board.provenNonRookies } }
    const verdict = await resolveServerRookieStatus({ leagueId: 'L', playerId: '101', playerName: 'Proven Vet' })
    expect(verdict).toBe(false)
    const base = {
      dispersalPoolConfig: null,
      draftModeLabel: 'rookie',
      playerPool: 'rookies_only',
      effectiveRosterId: 'r',
      onClockRosterId: 'r',
      playerId: '101',
      playerName: 'Proven Vet',
      position: 'PG',
      assetType: 'player',
    }
    expect(validateSpecialtyDraftPools({ ...base, serverRookieStatus: verdict }).valid).toBe(false)
    const unknown = await resolveServerRookieStatus({ leagueId: 'L', playerId: '102', playerName: 'Unknown Guard' })
    expect(validateSpecialtyDraftPools({ ...base, playerId: '102', playerName: 'Unknown Guard', serverRookieStatus: unknown }).valid).toBe(true)
  })

  it('autopick drops proven non-rookies and keeps unknown candidates', async () => {
    h.snapshot = { warm: true, payload: { entries: board.entries, provenNonRookies: board.provenNonRookies } }
    const candidates = [{ id: '101', n: 'Proven Vet' }, { id: '102', n: 'Unknown Guard' }]
    const kept = await filterCandidatesForPlayerPool('L', 'rookies_only', candidates, (c) => ({ playerId: c.id, playerName: c.n }))
    expect(kept.map((c) => c.n)).toEqual(['Unknown Guard'])
  })
})

describe('the zero-games rookie hint', () => {
  it('no longer calls a zero-games MLB/NBA/NHL row a rookie (an injured veteran has one)', () => {
    for (const sport of ['MLB', 'NBA', 'NHL'] as const) {
      expect(extractRookieHint({ gamesPlayed: 0 }, null, sport as never)).toBeNull()
      expect(extractRookieHint({ games_played: 0 }, null, sport as never)).toBeNull()
      // An explicit upstream rookie flag still counts.
      expect(extractRookieHint({ isRookie: true }, null, sport as never)).toBe(true)
    }
  })

  it('is unchanged for the other non-NFL sports', () => {
    expect(extractRookieHint({ gamesPlayed: 0 }, null, 'NCAAB' as never)).toBe(true)
    expect(extractRookieHint({ gamesPlayed: 0 }, null, 'NFL' as never)).toBeNull()
  })
})

describe('the verdict reaches the draft room entry and its client filters', () => {
  it('normalization keeps the verdict (it used to rebuild the entry field by field)', () => {
    const entry = normalizeDraftPlayer({ name: 'Proven Vet', position: 'C', team: 'BOS', rookieVerdict: 'not_rookie' }, 'NHL')
    expect(entry.rookieVerdict).toBe('not_rookie')
    expect(entry.isRookie).toBeUndefined()
    expect(normalizeDraftPlayer({ name: 'X', position: 'C', team: 'BOS' }, 'NHL').rookieVerdict).toBeUndefined()
  })

  it('a not_rookie verdict beats the NHL age inference and counts as a veteran', () => {
    const young = { sport: 'NHL', age: 20, rookieVerdict: 'not_rookie' as const }
    expect(isRookieEligibleForFilter({ sport: 'NHL', age: 20 })).toBe(true)
    expect(isRookieEligibleForFilter(young)).toBe(false)
    expect(isVetEligibleForFilter(young)).toBe(true)
    expect(isVetEligibleForFilter({ rookieVerdict: 'unknown' })).toBe(false)
  })
})

describe('the board says plainly when a sport has no or partial rookie data', () => {
  const tFor = (lang: 'en' | 'es') => (key: string) => translations[lang]?.[key] ?? key

  it('partial data names the sport and says most picks are not checked', () => {
    const { getByTestId } = render(<RookieFilterFallbackBanner rookieFilterState="partial_rookie_data" t={tFor('en')} sport="NBA" />)
    const text = getByTestId('draft-rookie-filter-fallback-banner').textContent ?? ''
    expect(text).toContain("Rookie status isn't available for most NBA players yet, so most picks aren't checked")
    expect(text).toContain("can't be drafted")
    expect(text).not.toContain('{{sport}}')
  })

  it('no data names MLB/NBA/NHL; NFL and other sports keep the original copy', () => {
    const mlb = render(<RookieFilterFallbackBanner rookieFilterState="fallback_no_rookie_data" t={tFor('en')} sport="MLB" />)
    expect(mlb.getByTestId('draft-rookie-filter-fallback-banner').textContent).toContain(
      "Rookie status isn't available for MLB players yet",
    )
    mlb.unmount()
    const nfl = render(<RookieFilterFallbackBanner rookieFilterState="fallback_no_rookie_data" t={tFor('en')} sport="NFL" />)
    expect(nfl.getByTestId('draft-rookie-filter-fallback-banner').textContent).toContain('Rookie filter unavailable for this sport')
  })

  it('has Spanish copy for the new states', () => {
    const { getByTestId } = render(<RookieFilterFallbackBanner rookieFilterState="partial_rookie_data" t={tFor('es')} sport="NHL" />)
    const text = getByTestId('draft-rookie-filter-fallback-banner').textContent ?? ''
    expect(text).toContain('Estado de rookie incompleto en NHL')
    expect(text).not.toContain('draftRoom.')
  })
})
