// @vitest-environment node
/**
 * Guards editing a tournament's rules after it exists.
 *
 * 🛑 THE CUT IS ENTERED BEFORE ANYBODY HAS PLAYED. The first time those numbers
 * meet reality is when the board draws the line, so getting them wrong at setup
 * is the normal case — and without an edit path, fixing one meant rebuilding the
 * tournament and re-linking 240 managers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const shellFindFirst = vi.fn()
const shellUpdate = vi.fn()
const conferenceFindMany = vi.fn()
const conferenceUpdate = vi.fn()
const advancementCount = vi.fn()
const auditCreate = vi.fn()
const transaction = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentShell: {
      findFirst: (...a: unknown[]) => shellFindFirst(...a),
      update: (...a: unknown[]) => shellUpdate(...a),
    },
    tournamentConference: {
      findMany: (...a: unknown[]) => conferenceFindMany(...a),
      update: (...a: unknown[]) => conferenceUpdate(...a),
    },
    tournamentAdvancementGroup: { count: (...a: unknown[]) => advancementCount(...a) },
    tournamentAuditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

import { updateTournamentSettings } from '@/lib/tournament/updateTournamentSettings'

const ARGS = { tournamentId: 't1', commissionerUserId: 'commish' }

beforeEach(() => {
  vi.clearAllMocks()
  shellFindFirst.mockResolvedValue({ id: 't1', currentParticipantCount: 240 })
  conferenceFindMany.mockResolvedValue([])
  advancementCount.mockResolvedValue(0)
  transaction.mockResolvedValue([])
})

/** ⚠ Same answer for "not found" and "not yours". */
it('refuses a tournament this user does not commission', async () => {
  shellFindFirst.mockResolvedValue(null)
  const out = await updateTournamentSettings({ ...ARGS, patch: { wildcardCount: 64 } })
  expect(out).toMatchObject({ ok: false, status: 404 })
})

it('saves the cut settings', async () => {
  const out = await updateTournamentSettings({
    ...ARGS,
    patch: { wildcardCount: 64, advancersPerLeague: 0, bubbleEnabled: true, bubbleSize: 6 },
  })
  expect(out).toMatchObject({ ok: true })
  expect(shellUpdate.mock.calls[0][0].data).toEqual({
    advancersPerLeague: 0,
    wildcardCount: 64,
    bubbleSize: 6,
    bubbleEnabled: true,
  })
})

describe('what it refuses to store', () => {
  it('rejects a negative or fractional count rather than storing it', async () => {
    for (const bad of [-1, 2.5]) {
      const out = await updateTournamentSettings({ ...ARGS, patch: { wildcardCount: bad } })
      expect(out).toMatchObject({ ok: false, status: 400 })
    }
    expect(transaction).not.toHaveBeenCalled()
  })

  /**
   * 🛑 AN UNKNOWN TIEBREAKER DOES NOT THROW IN `compareStandings` — it falls
   * through to "tied", silently. A typo would quietly flatten the order that
   * decides who advances, so it is refused here.
   */
  it('rejects a tiebreaker the comparator does not implement', async () => {
    const out = await updateTournamentSettings({
      ...ARGS,
      patch: { tiebreakerMode: 'coin_flip' },
    })
    expect(out).toMatchObject({ ok: false, status: 400 })
  })

  it('accepts the two the comparator does implement', async () => {
    for (const mode of ['points_for', 'points_against_inverse']) {
      const out = await updateTournamentSettings({ ...ARGS, patch: { tiebreakerMode: mode } })
      expect(out).toMatchObject({ ok: true })
    }
  })

  it('rejects an empty name rather than blanking the tournament', async () => {
    const out = await updateTournamentSettings({ ...ARGS, patch: { name: '   ' } })
    expect(out).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a no-op patch instead of writing an empty audit entry', async () => {
    const out = await updateTournamentSettings({ ...ARGS, patch: {} })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('renaming conferences', () => {
  /**
   * ⚠ SCOPED TO THIS TOURNAMENT. Conference ids arrive in a request body, so an
   * unscoped update lets a commissioner rename a conference in someone else's.
   */
  it('scopes the conference lookup to this tournament', async () => {
    conferenceFindMany.mockResolvedValue([{ id: 'c1' }])
    await updateTournamentSettings({
      ...ARGS,
      patch: { conferenceNames: [{ id: 'c1', name: 'BLACK' }] },
    })
    expect(conferenceFindMany.mock.calls[0][0].where).toMatchObject({ tournamentId: 't1' })
  })

  it('refuses when a conference is not in this tournament', async () => {
    conferenceFindMany.mockResolvedValue([])
    const out = await updateTournamentSettings({
      ...ARGS,
      patch: { conferenceNames: [{ id: 'elsewhere', name: 'X' }] },
    })
    expect(out).toMatchObject({ ok: false, status: 404 })
    expect(transaction).not.toHaveBeenCalled()
  })
})

/**
 * 🛑 CHANGING THE CUT MOVES THE LINE, NOT THE PEOPLE. Editing `wildcardCount`
 * after an advancement has run does not un-advance anybody, and a commissioner
 * who assumes otherwise will not go and fix it by hand.
 */
it('reports when an advancement has already run, so the change is not read as retroactive', async () => {
  advancementCount.mockResolvedValue(2)
  const out = await updateTournamentSettings({ ...ARGS, patch: { wildcardCount: 32 } })
  expect(out).toMatchObject({ ok: true, alreadyAdvanced: true })
})

it('reports no prior advancement when none has run', async () => {
  const out = await updateTournamentSettings({ ...ARGS, patch: { wildcardCount: 32 } })
  expect(out).toMatchObject({ ok: true, alreadyAdvanced: false })
})
