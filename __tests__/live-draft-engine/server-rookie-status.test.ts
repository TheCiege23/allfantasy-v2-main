/**
 * Rookies-only / veterans-only drafts are enforced by the SERVER's reading of the draft pool,
 * not by the client's pick metadata. Before this, a veteran pick in a rookies-only draft was
 * refused only when the client sent `isRookie: false` — which the draft room never sends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  snapshot: { warm: false, payload: null } as { warm: boolean; payload: unknown },
}))

vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  getWarmDraftPoolSnapshotFast: vi.fn(async () => h.snapshot),
}))

import { resolveServerRookieStatus, rookieStatusFromPoolEntries } from '@/lib/live-draft-engine/serverRookieStatus'
import { validateSpecialtyDraftPools } from '@/lib/live-draft-engine/SpecialtyDraftPoolValidation'

const POOL = [
  { playerId: 'r1', name: 'Rookie One', isRookie: true },
  { playerId: 'v1', name: 'Vet One', isRookie: false },
  { playerId: 'v2', name: 'Vet Two' },
  { playerId: 'd1', name: 'Same Name', isRookie: true },
  { playerId: 'd2', name: 'Same Name', isRookie: false },
]

beforeEach(() => {
  h.snapshot = { warm: false, payload: null }
})

describe('rookieStatusFromPoolEntries', () => {
  it('answers from the pool by player id', () => {
    expect(rookieStatusFromPoolEntries(POOL, { playerId: 'r1', playerName: 'x' })).toBe(true)
    expect(rookieStatusFromPoolEntries(POOL, { playerId: 'v1', playerName: 'x' })).toBe(false)
    // A pool row with no flag, in a pool that does carry rookie data, is a veteran.
    expect(rookieStatusFromPoolEntries(POOL, { playerId: 'v2', playerName: 'x' })).toBe(false)
  })

  it('falls back to a unique name match', () => {
    expect(rookieStatusFromPoolEntries(POOL, { playerId: 'not-in-pool', playerName: 'rookie one' })).toBe(true)
    expect(rookieStatusFromPoolEntries(POOL, { playerName: 'Vet One' })).toBe(false)
  })

  it('is unknown for an ambiguous name, a player missing from a mixed pool, or a pool with no rookie data', () => {
    expect(rookieStatusFromPoolEntries(POOL, { playerName: 'Same Name' })).toBeNull()
    expect(rookieStatusFromPoolEntries(POOL, { playerId: 'zz', playerName: 'Nobody' })).toBeNull()
    expect(
      rookieStatusFromPoolEntries([{ playerId: 'v1', name: 'Vet One', isRookie: false }], { playerId: 'v1' }),
    ).toBeNull()
  })
})

describe('a rookies-only board (the snapshot is built after the pool filter)', () => {
  const ROOKIE_BOARD = [
    { playerId: 'r1', name: 'Rookie One', isRookie: true },
    { playerId: 'r2', name: 'Rookie Two', isRookie: true },
    { playerId: 'r3', name: 'Twin Name', isRookie: true },
    { playerId: 'r4', name: 'Twin Name', isRookie: true },
  ]

  it('a player absent from a board of nothing but rookies is not a rookie', () => {
    expect(rookieStatusFromPoolEntries(ROOKIE_BOARD, { playerId: 'vet-9', playerName: 'Veteran Star' })).toBe(false)
  })

  it('a rookie on it is found, and a shared name is still unknown', () => {
    expect(rookieStatusFromPoolEntries(ROOKIE_BOARD, { playerName: 'Rookie Two' })).toBe(true)
    expect(rookieStatusFromPoolEntries(ROOKIE_BOARD, { playerName: 'Twin Name' })).toBeNull()
  })
})

describe('resolveServerRookieStatus', () => {
  it('is unknown without a warm snapshot', async () => {
    expect(await resolveServerRookieStatus({ leagueId: 'L', playerId: 'v1', playerName: 'Vet One' })).toBeNull()
  })

  it('reads the warm snapshot entries', async () => {
    h.snapshot = { warm: true, payload: { entries: POOL } }
    expect(await resolveServerRookieStatus({ leagueId: 'L', playerId: 'v1', playerName: 'Vet One' })).toBe(false)
    expect(await resolveServerRookieStatus({ leagueId: 'L', playerId: 'r1', playerName: 'Rookie One' })).toBe(true)
  })
})

describe('validateSpecialtyDraftPools with a server verdict', () => {
  const base = {
    draftModeLabel: null,
    dispersalPoolConfig: null,
    effectiveRosterId: 'a',
    onClockRosterId: 'a',
    playerId: 'v1',
    playerName: 'Vet One',
    position: 'WR',
    assetType: 'player',
  }

  it('refuses a veteran in a rookies-only draft even when the client sends no rookie hint', () => {
    const r = validateSpecialtyDraftPools({ ...base, playerPool: 'rookies_only', pickMetadata: {}, serverRookieStatus: false })
    expect(r.valid).toBe(false)
  })

  it('the server verdict outranks a client claiming the player is a rookie', () => {
    const r = validateSpecialtyDraftPools({
      ...base,
      playerPool: 'rookies_only',
      pickMetadata: { isRookie: true },
      serverRookieStatus: false,
    })
    expect(r.valid).toBe(false)
  })

  it('accepts a rookie the server confirms, and refuses one in a veterans-only draft', () => {
    expect(validateSpecialtyDraftPools({ ...base, playerPool: 'rookies_only', serverRookieStatus: true }).valid).toBe(true)
    expect(validateSpecialtyDraftPools({ ...base, playerPool: 'veterans_only', serverRookieStatus: true }).valid).toBe(false)
  })

  it('with no server verdict, keeps the previous metadata behaviour', () => {
    expect(validateSpecialtyDraftPools({ ...base, playerPool: 'rookies_only', serverRookieStatus: null }).valid).toBe(true)
    expect(
      validateSpecialtyDraftPools({ ...base, playerPool: 'rookies_only', pickMetadata: { isRookie: false }, serverRookieStatus: null }).valid,
    ).toBe(false)
  })

  it('a commissioner override skips the check', () => {
    expect(
      validateSpecialtyDraftPools({ ...base, playerPool: 'rookies_only', serverRookieStatus: false, commissionerOverride: true }).valid,
    ).toBe(true)
  })
})
