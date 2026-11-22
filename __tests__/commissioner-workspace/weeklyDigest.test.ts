import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/integrity/tradeValueAudit', () => ({ readTradeValueAudits: vi.fn(), tradeValueAuditsReady: vi.fn() }))

import { buildDigestLines, digestWeekKey, isDigestDay, runWeeklyCommishDigests, settingsCounts, type DigestDeps } from '@/lib/commissioner-workspace/weeklyDigest'

const TUE = new Date('2026-11-10T08:40:00Z')
const WED = new Date('2026-11-11T08:40:00Z')
const MON = new Date('2026-11-09T08:40:00Z')

const busySettings = {
  dues_tracker: { enabled: true, amount: 50, entries: [{ teamId: 't1', paid: false, selfReportedAt: '2026-11-08T10:00:00Z' }, { teamId: 't2', paid: true, selfReportedAt: '2026-11-01T10:00:00Z' }] },
  constitution_amendments: [{ id: 'a1', status: 'pending_approval' }, { id: 'a2', status: 'voting' }],
  draft_schedule_poll: { status: 'open' },
}

let deps: { [K in keyof DigestDeps]: ReturnType<typeof vi.fn> }
const run = (now = TUE) => runWeeklyCommishDigests({ now, deadline: Date.now() + 60_000 }, deps as unknown as DigestDeps)

beforeEach(() => {
  deps = {
    candidates: vi.fn(async () => ['L1']),
    league: vi.fn(async (id: string) => ({ id, name: 'Dynasty Dads', userId: 'commish', settings: busySettings })),
    openCases: vi.fn(async () => 2),
    audits: vi.fn(async () => [{ gapPct: 12 }, { gapPct: -38.4 }]),
    claim: vi.fn(async () => true),
    language: vi.fn(async () => null),
    send: vi.fn(async () => undefined),
  }
})

describe('when the digest goes out', () => {
  it('Tuesday, with Wednesday as catch-up, and one key for both', () => {
    expect([MON, TUE, WED].map(isDigestDay)).toEqual([false, true, true])
    expect(digestWeekKey(TUE)).toBe('2026-11-10')
    expect(digestWeekKey(WED)).toBe('2026-11-10')
  })

  it('does nothing on the other days', async () => {
    expect(await run(MON)).toMatchObject({ day: false, sent: 0 })
    expect(deps.candidates).not.toHaveBeenCalled()
  })
})

describe('what it says', () => {
  it('rolls every waiting item into one notification for the commissioner', async () => {
    expect(await run()).toMatchObject({ sent: 1, quiet: 0 })
    const arg = deps.send.mock.calls[0][0]
    expect(arg).toMatchObject({ userId: 'commish', leagueId: 'L1', leagueName: 'Dynasty Dads', lang: 'en' })
    expect(arg.lines).toEqual([
      '2 integrity cases are open for review.',
      '1 rule change is waiting for your approval.',
      '1 manager says they paid dues. Confirm or follow up.',
      'A draft-time poll is open. Lock a time once the league has voted.',
      '2 trades were audited this week. The widest value gap was 38%.',
    ])
    expect(deps.audits).toHaveBeenCalledWith('L1', new Date('2026-11-03T08:40:00Z'))
  })

  it('a quiet league gets nothing, and is not marked', async () => {
    deps.league.mockResolvedValue({ id: 'L1', name: 'Quiet', userId: 'commish', settings: {} })
    deps.openCases.mockResolvedValue(0)
    deps.audits.mockResolvedValue([])
    expect(await run()).toMatchObject({ sent: 0, quiet: 1 })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('a confirmed payment is not a claim to chase; a voting rule change is not waiting on the commissioner', () => {
    expect(settingsCounts(busySettings)).toEqual({ duesClaims: 1, pendingRuleChanges: 1, draftPollOpen: true })
    expect(settingsCounts({ draft_schedule_poll: { status: 'locked' } }).draftPollOpen).toBe(false)
    expect(buildDigestLines({ openCases: 0, tradesAudited: 0, widestGapPct: null, duesClaims: 0, pendingRuleChanges: 0, draftPollOpen: false })).toBeNull()
  })
})

describe('once a week, never twice', () => {
  it('a league already sent this week is skipped before any work', async () => {
    deps.league.mockResolvedValue({ id: 'L1', name: 'X', userId: 'commish', settings: { ...busySettings, commish_digest: { weekKey: '2026-11-10' } } })
    expect(await run(WED)).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(deps.openCases).not.toHaveBeenCalled()
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('only the run that wins the claim sends', async () => {
    deps.claim.mockResolvedValue(false)
    expect(await run()).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(deps.send).not.toHaveBeenCalled()
    expect(deps.claim).toHaveBeenCalledWith('L1', '2026-11-10', TUE)
  })

  it('one league failing does not cost the others their digest', async () => {
    deps.candidates.mockResolvedValue(['bad', 'L1'])
    deps.league.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('boom')
      return { id, name: 'Dynasty Dads', userId: 'commish', settings: busySettings }
    })
    expect(await run()).toMatchObject({ sent: 1, failed: 1 })
  })
})

describe('in the commissioner\u2019s language', () => {
  it('a Spanish-speaking commissioner gets the digest in Spanish, any Spanish locale', async () => {
    deps.language.mockResolvedValue('es-MX')
    await run()
    const arg = deps.send.mock.calls[0][0]
    expect(arg.lang).toBe('es')
    expect(arg.lines).toEqual([
      'Hay 2 casos de integridad abiertos para revisar.',
      '1 cambio de reglas espera tu aprobación.',
      '1 mánager dice que pagó la cuota. Confírmalo o haz seguimiento.',
      'Hay una encuesta abierta para la hora del draft. Fija una hora cuando la liga haya votado.',
      'Se auditaron 2 intercambios esta semana. La mayor diferencia de valor fue de 38%.',
    ])
    expect(deps.language).toHaveBeenCalledWith('commish')
  })

  it('no stored language, or one the digest does not have, is English', async () => {
    for (const preferred of [null, 'fr']) {
      deps.send.mockClear()
      deps.language.mockResolvedValue(preferred)
      await run()
      expect(deps.send.mock.calls[0][0]).toMatchObject({ lang: 'en' })
      expect(deps.send.mock.calls[0][0].lines[0]).toBe('2 integrity cases are open for review.')
    }
  })
})
