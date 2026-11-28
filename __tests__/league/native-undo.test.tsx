/**
 * Step 6 of docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md: undo's window and its confirm card. The full
 * round trip (every row back, field for field) runs against real Postgres in convert-in-place-db.test.ts; this covers
 * the refusals that need no database, and what the commissioner is shown before they confirm.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { previewNativeUndo } from '@/lib/league/undoNativeConversion'
import { NativeUndoView } from '@/components/league-home/NativeUndoCard'

afterEach(cleanup)

const SNAPSHOT = {
  version: 1,
  league: { platform: 'sleeper', platformLeagueId: 'sl-1', syncStatus: 'synced', settings: {} },
  seasonAtSwitch: { id: 's26', season: 2026 },
  teams: [{ id: 't1', externalId: '1', platformUserId: 'u', isOrphan: false, role: 'member' }],
  rosters: [{ id: 'r1', platformUserId: 'u', managerUserId: null, redraftRosterId: null, playerData: {}, settings: null }],
  redraftRosters: [], redraftPlayers: [], futurePicks: [], draftSessions: [],
  history: { matchupFacts: [], seasonStandingFacts: [], rosterSnapshots: [], seasonResults: [], leagueSeasons: [] },
  created: { memberIds: [], chatRoomIds: [], entrySlotIds: [] },
  entrySlotsBefore: [],
}

function fakeDb(over: { conversion?: Record<string, unknown> | null; newerSeason?: number | null; rosterIds?: string[] } = {}) {
  const update = vi.fn(async () => ({}))
  const count = vi.fn(async () => 0)
  const db = {
    leagueNativeConversion: {
      findUnique: vi.fn(async () => over.conversion === undefined
        ? { id: 'c1', status: 'applied', fromSeason: 2026, convertedAt: new Date('2026-12-01T00:00:00Z'), undoClosedAt: null, fromPlatform: 'sleeper', snapshot: SNAPSHOT, snapshotVersion: 1 }
        : over.conversion),
      update,
    },
    redraftSeason: { findFirst: vi.fn(async () => (over.newerSeason ? { season: over.newerSeason } : null)) },
    roster: { findMany: vi.fn(async () => (over.rosterIds ?? ['r1']).map((id) => ({ id }))) },
    leagueTeam: { findMany: vi.fn(async () => [{ id: 't1' }]) },
    league: { findFirst: vi.fn(async () => null) },
    afLeagueTrade: { count }, waiverClaim: { count }, waiverTransaction: { count }, redraftRosterPlayer: { count },
    keeperDeclaration: { count }, draftSession: { count }, redraftLeagueMember: { count }, futureDraftPick: { count },
  }
  return { db: db as never, update }
}

describe('previewNativeUndo', () => {
  it('has nothing to undo without an applied switch', async () => {
    expect(await previewNativeUndo(fakeDb({ conversion: null }).db, 'L')).toEqual({ status: 'none' })
    expect(await previewNativeUndo(fakeDb({ conversion: { status: 'undone' } }).db, 'L')).toEqual({ status: 'none' })
  })

  it('is open, with an empty list and a token, right after a switch', async () => {
    const preview = await previewNativeUndo(fakeDb().db, 'L')
    expect(preview).toMatchObject({ status: 'open', conversionId: 'c1', fromPlatform: 'sleeper', discards: [] })
    expect((preview as { token: string }).token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('closes for good once the league has a newer season, and records when', async () => {
    const { db, update } = fakeDb({ newerSeason: 2027 })
    expect(await previewNativeUndo(db, 'L')).toMatchObject({ status: 'closed', reason: expect.stringContaining('2027 season') })
    expect(update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { undoClosedAt: expect.any(Date) } })
  })

  it('refuses when teams were added or removed since the switch: it could not put them back', async () => {
    expect(await previewNativeUndo(fakeDb({ rosterIds: ['r1', 'r2'] }).db, 'L')).toMatchObject({ status: 'closed', reason: expect.stringContaining('added or removed') })
  })

  it('refuses a snapshot it cannot read rather than guessing', async () => {
    const conversion = { id: 'c1', status: 'applied', fromSeason: 2026, convertedAt: new Date(), undoClosedAt: null, fromPlatform: 'sleeper', snapshot: { version: 2 }, snapshotVersion: 2 }
    expect(await previewNativeUndo(fakeDb({ conversion }).db, 'L')).toMatchObject({ status: 'closed', reason: expect.stringContaining('cannot read') })
  })
})

describe('NativeUndoView', () => {
  const open = { status: 'open' as const, conversionId: 'c1', convertedAt: '2026-12-01T12:00:00Z', fromPlatform: 'sleeper', token: 't', discards: [] as Array<{ code: string; label: string; count: number }> }

  it('asks first, then lists exactly what undo throws away before the confirm button', () => {
    const onStart = vi.fn()
    const { rerender } = render(<NativeUndoView preview={open} confirming={false} onStart={onStart} />)
    expect(screen.getByRole('heading').textContent).toBe('You can still go back to Sleeper')
    expect(screen.queryByTestId('native-undo-confirm-button')).toBeNull()
    fireEvent.click(screen.getByTestId('native-undo-start'))
    expect(onStart).toHaveBeenCalledOnce()

    const discards = [{ code: 'trades', label: '2 trades proposed or made on AllFantasy', count: 2 }, { code: 'joined', label: '1 manager who joined through an invite link loses their team', count: 1 }]
    const onConfirm = vi.fn()
    rerender(<NativeUndoView preview={{ ...open, discards }} confirming onConfirm={onConfirm} />)
    expect(screen.getByTestId('native-undo-discard-trades').textContent).toBe('2 trades proposed or made on AllFantasy')
    expect(screen.getByTestId('native-undo-discard-joined')).toBeTruthy()
    fireEvent.click(screen.getByTestId('native-undo-confirm-button'))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.getByTestId('native-undo-confirm-button').textContent).toBe('Undo and go back to Sleeper')
  })

  it('says so when nothing would be thrown away', () => {
    render(<NativeUndoView preview={open} confirming />)
    expect(screen.getByTestId('native-undo-nothing').textContent).toContain('Nothing has happened')
  })
})
