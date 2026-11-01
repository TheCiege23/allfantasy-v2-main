/**
 * IR auto-move (lib/ir-activation): who counts as activated (the league's own IR rule, the live feed,
 * and the outage guard), the move itself, the hourly run (moves through the lineup save, tells the
 * manager when it cannot, once), the plan gate, the Commish OS task, Chimmy, and the Hub card.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  elevated: vi.fn(),
  lock: vi.fn(),
  persist: vi.fn(),
  dispatch: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    league: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    roster: { findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
    sportsInjury: { findMany: vi.fn(), count: vi.fn() },
    platformNotification: { findFirst: vi.fn() },
    userProfile: { findUnique: vi.fn() },
  },
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: m.owner }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: m.lock }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: m.persist }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const t = (k: string) => translations[lang.language][k] ?? translations.en[k] ?? k
  return {
    useOptionalLanguage: () => ({
      language: lang.language,
      t,
      tInterpolate: (k: string, vars: Record<string, string | number>) => t(k).replace(/\{\{(\w+)\}\}/g, (_: string, v: string) => String(vars[v] ?? '')),
    }),
  }
})

import { activatedIrPlayers, irNotice, irPlayerIds, moveOffIr, parseIrAutoMoveRule, readIrAutoMoveEnabled } from '@/lib/ir-activation/irAutoMove'
import { readIrAutoMoveTasks, readIrAutoMoveView, runIrAutoMove } from '@/lib/ir-activation/irAutoMoveService'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { buildLeagueOfficeSummary } from '@/lib/chimmy-context/leagueOfficeSummary'
import { IrAutoMove } from '@/components/core-app/commissioner/IrAutoMove'

const RULES = { irAllowOut: true, irAllowCovid: false, irAllowSuspended: false, irAllowNA: false, irAllowDNR: false, irAllowDoubtful: false }
const lineup = (ir: string[], bench: string[] = ['b1']) => ({
  starters: ['s1'],
  lineup_sections: { starters: [{ id: 's1', slotIndex: 0 }], bench: bench.map((id) => ({ id })), ir: ir.map((id) => ({ id, name: id })), taxi: [], devy: [] },
})

describe('the rule', () => {
  it('reads as on only in the shape the reader knows; parsing refuses anything else', () => {
    expect(readIrAutoMoveEnabled({ ir_auto_move: { enabled: true } })).toBe(true)
    expect(readIrAutoMoveEnabled({ ir_auto_move: { enabled: 'yes' } })).toBe(false)
    expect(readIrAutoMoveEnabled({})).toBe(false)
    expect(parseIrAutoMoveRule({ enabled: false })).toEqual({ ok: true, value: { enabled: false } })
    expect(parseIrAutoMoveRule({ enabled: 1 })).toMatchObject({ ok: false })
    expect(parseIrAutoMoveRule(null)).toMatchObject({ ok: false })
  })

  it('activated means the league’s IR rule no longer allows the designation; no live row counts', () => {
    const statusById = new Map<string, string | null>([['out', 'Out'], ['ir', 'IR'], ['q', 'Questionable'], ['none', null]])
    expect(activatedIrPlayers({ irIds: ['out', 'ir', 'q', 'none'], statusById, rules: RULES, feedLive: true })).toEqual(['q', 'none'])
    expect(activatedIrPlayers({ irIds: ['out'], statusById, rules: { ...RULES, irAllowOut: false }, feedLive: true })).toEqual(['out'])
  })

  it('a feed with nothing live moves nobody: an outage is not a league-wide recovery', () => {
    expect(activatedIrPlayers({ irIds: ['none'], statusById: new Map([['none', null]]), rules: RULES, feedLive: false })).toEqual([])
  })

  it('the move: off IR to the end of the bench, everyone else where they were', () => {
    const next = moveOffIr(lineup(['a', 'keep']), ['a'])
    const s = getNormalizedLineupSections(next)
    expect(s.ir.map((r) => r.id)).toEqual(['keep'])
    expect(s.bench.map((r) => r.id)).toEqual(['b1', 'a'])
    expect(s.starters.map((r) => r.id)).toEqual(['s1'])
    expect(next.reserve).toEqual(['keep'])
    expect(irPlayerIds(next)).toEqual(['keep'])
  })

  it('the manager’s notice, both languages, moved or not', () => {
    expect(irNotice({ names: ['Ace'], leagueName: 'Den', moved: true }).body.en).toBe('Ace was activated, so AllFantasy moved them from IR to your Den bench. Start them when you are ready.')
    expect(irNotice({ names: ['Ace', 'Bo'], leagueName: 'Den', moved: true }).title.es).toBe('Ace y Bo salieron de la lista de lesionados')
    const stuck = irNotice({ names: ['Ace'], leagueName: 'Den', moved: false, reason: 'Bench is full.' })
    expect(stuck.title.en).toBe('Ace is active but still on IR')
    expect(stuck.body.en).toContain('(Bench is full.)')
    expect(stuck.body.es).toContain('Haz espacio')
  })
})

const LEAGUE = {
  id: 'L', name: 'Den', userId: 'owner', platform: 'allfantasy', sport: 'NFL', season: 2026, settings: { ir_auto_move: { enabled: true } },
  leagueVariant: null, lifecycleState: 'in_season', lockAllMoves: false, ...RULES,
}

function seed() {
  m.prisma.$queryRaw.mockResolvedValue([{ id: 'L' }])
  m.prisma.league.findUnique.mockResolvedValue(LEAGUE)
  m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's26', season: 2026, currentWeek: 7 })
  m.prisma.roster.findMany.mockResolvedValue([
    { id: 'af1', platformUserId: 'u1', redraftRosterId: 'r1', playerData: lineup(['healed', 'hurt']) },
    { id: 'af2', platformUserId: 'u2', redraftRosterId: 'r2', playerData: lineup([]) },
  ])
  m.prisma.redraftRoster.findMany.mockResolvedValue([{ id: 'r1', teamName: 'Aces', ownerName: 'a' }])
  m.prisma.redraftRosterPlayer.findMany.mockResolvedValue([
    { rosterId: 'r1', playerId: 'healed', playerName: 'Healed Guy', sport: 'NFL' },
    { rosterId: 'r1', playerId: 'hurt', playerName: 'Hurt Guy', sport: 'NFL' },
  ])
  m.prisma.sportsInjury.findMany.mockResolvedValue([{ sport: 'NFL', playerId: 'hurt', playerName: 'Hurt Guy', status: 'IR', fetchedAt: new Date() }])
  m.prisma.sportsInjury.count.mockResolvedValue(400)
  m.prisma.platformNotification.findFirst.mockResolvedValue(null)
  m.prisma.userProfile.findUnique.mockResolvedValue({ preferredLanguage: 'es' })
  m.owner.mockResolvedValue(true)
  m.elevated.mockResolvedValue(true)
  m.lock.mockResolvedValue({ locked: false, lockedPlayerIds: [] })
  m.persist.mockResolvedValue({ ok: true })
  m.dispatch.mockResolvedValue({})
}

describe('the hourly run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
  })

  it('moves the activated player through the lineup save and tells the manager in their language', async () => {
    const r = await runIrAutoMove({ now: new Date('2026-10-20T12:00:00Z') })
    expect(r).toMatchObject({ leagues: 1, teams: 1, moved: 1, notified: 0, failures: [] })
    const saved = m.persist.mock.calls[0][0]
    expect(saved).toMatchObject({ leagueId: 'L', rosterId: 'af1', actorUserId: 'u1', expectedOwnerUserId: 'u1', season: 2026, week: 7, source: 'system', expectedStarters: ['s1'] })
    expect(irPlayerIds(saved.nextPlayerData)).toEqual(['hurt'])
    expect(saved.automationAudit.message).toBe("IR auto-move: Healed Guy was activated and moved from IR to Aces's bench.")
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['u1'], type: 'ir_auto_move', title: 'Healed Guy salió de la lista de lesionados', leagueId: 'L',
      dedupePrefix: 'ir-auto-move:moved:L:af1:2026:7:healed',
    }))
  })

  it('a refused save tells the manager why, once a week', async () => {
    m.persist.mockResolvedValue({ ok: false, error: 'Bench is full.' })
    m.prisma.userProfile.findUnique.mockResolvedValue(null)
    const r = await runIrAutoMove()
    expect(r).toMatchObject({ moved: 0, notified: 1 })
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ir_auto_move_blocked', title: 'Healed Guy is active but still on IR', dedupePrefix: 'ir-auto-move:stuck:L:af1:2026:7' }))
    m.prisma.platformNotification.findFirst.mockResolvedValue({ id: 'sent' })
    m.dispatch.mockClear()
    expect(await runIrAutoMove()).toMatchObject({ notified: 0, skipped: { already_told: 1 } })
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('a feed outage moves nobody', async () => {
    m.prisma.sportsInjury.count.mockResolvedValue(0)
    expect(await runIrAutoMove()).toMatchObject({ teams: 0, moved: 0 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('a player whose game has started waits; a locked lineup waits', async () => {
    m.lock.mockResolvedValue({ locked: false, lockedPlayerIds: ['healed'] })
    expect(await runIrAutoMove()).toMatchObject({ moved: 0, skipped: { started: 1 } })
    m.lock.mockResolvedValue({ locked: true, lockedPlayerIds: [] })
    expect(await runIrAutoMove()).toMatchObject({ moved: 0, skipped: { lineup_locked: 1 } })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('only while the owner holds AF Commissioner, only in leagues AllFantasy runs, never under the move lock', async () => {
    m.owner.mockResolvedValue(false)
    expect(await runIrAutoMove()).toMatchObject({ skipped: { not_entitled: 1 } })
    m.owner.mockResolvedValue(true)
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, platform: 'sleeper' })
    expect(await runIrAutoMove()).toMatchObject({ skipped: { not_native: 1 } })
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, lockAllMoves: true })
    expect(await runIrAutoMove()).toMatchObject({ skipped: { moves_locked: 1 } })
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, settings: {} })
    expect(await runIrAutoMove()).toMatchObject({ moved: 0 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('no season being played, nothing to do', async () => {
    m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
    expect(await runIrAutoMove()).toMatchObject({ skipped: { not_in_season: 1 } })
  })
})

describe('the commissioner’s view and the Commish OS task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
  })
  it('the view lists who the rule would move, whether or not it is on', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, settings: {} })
    m.owner.mockResolvedValue(false)
    expect(await readIrAutoMoveView('L', 'boss')).toEqual({
      ok: true, view: { supported: true, enabled: false, available: false, week: 7, teams: [{ teamName: 'Aces', players: ['Healed Guy'] }] },
    })
    m.elevated.mockResolvedValue(false)
    expect(await readIrAutoMoveView('L', 'member')).toEqual({ ok: false, status: 403 })
  })
  it('the task names the teams still stuck, only while the rule runs', async () => {
    const [task] = await readIrAutoMoveTasks('L')
    expect(task).toMatchObject({ sourceKey: 'ir-auto-move-stuck:2026:7:v1', title: 'An activated player is still on IR', automationCandidate: false })
    expect(task.description).toContain('Aces (Healed Guy)')
    m.owner.mockResolvedValue(false)
    expect(await readIrAutoMoveTasks('L')).toEqual([])
  })
  it('Chimmy is told when it runs', () => {
    const base = { viewerRole: 'member' as const, prizes: null, trades: [], correction: null, inactive: null, viewerTeamManaged: false, log: null }
    expect(buildLeagueOfficeSummary({ ...base, irAutoMove: true })).toContain('IR auto-move is on')
    expect(buildLeagueOfficeSummary({ ...base, irAutoMove: false })).toBeNull()
  })
})

describe('the Hub card', () => {
  const VIEW = { supported: true, enabled: false, available: true, week: 7, teams: [{ teamName: 'Aces', players: ['Healed Guy'] }] }
  const stub = (view: unknown, post: { ok: boolean; body: unknown } = { ok: true, body: {} }) => {
    const f = vi.fn(async (_u: string, init?: { method?: string }) =>
      init?.method === 'POST' ? { ok: post.ok, json: async () => post.body } : { ok: true, json: async () => view },
    )
    vi.stubGlobal('fetch', f)
    return f
  }
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    lang.language = 'en'
  })
  it('turns it on through the rule route', async () => {
    const f = stub(VIEW)
    render(<IrAutoMove leagueId="L" />)
    expect((await screen.findByTestId('ir-auto-move-team')).textContent).toBe('Aces · Healed Guy')
    fireEvent.click(screen.getByTestId('ir-auto-move-enabled'))
    fireEvent.click(screen.getByTestId('ir-auto-move-save'))
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/leagues/L/ir-auto-move', expect.objectContaining({ method: 'POST', body: JSON.stringify({ rule: { enabled: true } }) })))
    expect(await screen.findByText('Saved. The rule applies from the next hourly check.')).toBeTruthy()
  })
  it('without the plan it says so and cannot be switched on; a server refusal is shown as is', async () => {
    stub({ ...VIEW, available: false })
    render(<IrAutoMove leagueId="L" />)
    expect(await screen.findByTestId('ir-auto-move-plan')).toBeTruthy()
    expect((screen.getByTestId('ir-auto-move-enabled').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    cleanup()
    stub(VIEW, { ok: false, body: { error: 'IR auto-move is part of the AF Commissioner plan.' } })
    render(<IrAutoMove leagueId="L" />)
    fireEvent.click(await screen.findByTestId('ir-auto-move-save'))
    expect(await screen.findByText('IR auto-move is part of the AF Commissioner plan.')).toBeTruthy()
  })
  it('nothing outside leagues AllFantasy runs; in Spanish', async () => {
    stub({ supported: false })
    const { container } = render(<IrAutoMove leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
    cleanup()
    lang.language = 'es'
    stub({ ...VIEW, teams: [] })
    render(<IrAutoMove leagueId="L" />)
    expect(await screen.findByText('Ningún equipo tiene un jugador disponible en la lista de lesionados.')).toBeTruthy()
    expect(screen.getByText('Salida automática de la lista de lesionados')).toBeTruthy()
  })
})
