// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The weekly commissioner checklist for zombie leagues: the four states in which the zombie engine waits for a
 * person, or one line confirming the week is settling. Before, a zombie league got no checklist at all.
 */

const m = vi.hoisted(() => ({
  league: null as Record<string, unknown> | null,
  zombie: null as Record<string, unknown> | null,
  heldRow: null as { week: number } | null,
  heldCode: null as string | null,
  workflow: null as { id: string } | null,
  workflowWhere: null as unknown,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    zombieLeague: { findUnique: vi.fn(async () => m.zombie) },
    zombieWeeklyResolution: { findFirst: vi.fn(async () => m.heldRow) },
    zombieAuditEntry: { findFirst: vi.fn(async () => (m.heldCode ? { newState: { code: m.heldCode }, createdAt: new Date() } : null)) },
    zombieRoleWorkflow: { findFirst: vi.fn(async (args: { where: unknown }) => { m.workflowWhere = args.where; return m.workflow }) },
    redraftSeason: { findFirst: vi.fn(async () => { throw new Error('a zombie league must not read the redraft season') }) },
  },
}))

import { buildZombieWeeklyChecklist } from '@/lib/commissioner/zombieWeeklyChecklist'
import { readWeeklyChecklist } from '@/lib/commissioner/weeklyChecklistService'

const quiet = { leagueId: 'L 1', week: 6, paused: false, hold: null, correctionFromWeek: null, whispererReviewNeeded: false }

describe('buildZombieWeeklyChecklist', () => {
  it('a quiet week confirms it is settling', () => {
    expect(buildZombieWeeklyChecklist(quiet)).toEqual([expect.objectContaining({ id: 'zombie_ok', status: 'done', title: { en: 'Week 6 is settling normally', es: expect.any(String) } })])
  })

  it('each waiting state is a to-do that links to where it is fixed', () => {
    const items = buildZombieWeeklyChecklist({ ...quiet, paused: true, hold: { week: 5, reasonText: "A team's status needs fixing." }, correctionFromWeek: 4, whispererReviewNeeded: true })
    expect(items.map((i) => [i.id, i.status])).toEqual([['zombie_paused', 'todo'], ['zombie_hold', 'todo'], ['zombie_correction', 'todo'], ['zombie_whisperer', 'todo']])
    expect(items[1]).toMatchObject({ href: '/zombie/L%201/settings', title: { en: 'Week 5 settlement is on hold' }, detail: { en: "A team's status needs fixing. Open Automation to retry it." } })
    expect(items[3].href).toBe('/zombie/L%201')
    // Bilingual like the rest of the checklist: every item has Spanish too.
    expect(items.every((i) => i.title.es && i.detail.es)).toBe(true)
  })
})

describe('readWeeklyChecklist for a zombie league', () => {
  beforeEach(() => {
    m.league = { platform: 'native', leagueType: 'redraft', leagueVariant: 'zombie', isDynasty: false, bestBallMode: false, guillotineMode: false, sport: 'NFL', settings: {}, tradeDeadlineWeek: null }
    m.zombie = { id: 'z1', status: 'active', currentWeek: 6, correctionHoldFromWeek: null }
    m.heldRow = null
    m.heldCode = null
    m.workflow = null
  })

  it('reads the zombie engine, never the redraft season', async () => {
    expect(await readWeeklyChecklist('L')).toMatchObject({ applies: true, week: 6, format: 'zombie', items: [{ id: 'zombie_ok' }] })
  })

  it('a held week carries its recorded reason; an exhausted Whisperer draw is listed', async () => {
    m.heldRow = { week: 5 }
    m.heldCode = 'ZOMBIE_WINNINGS_STATUS_REQUIRED'
    m.workflow = { id: 'w1' }
    const view = await readWeeklyChecklist('L')
    const items = (view as { items: Array<{ id: string; detail: { en: string } }> }).items
    expect(items.map((i) => i.id)).toEqual(['zombie_hold', 'zombie_whisperer'])
    expect(items[0].detail.en).toContain('Override status')
    expect(m.workflowWhere).toEqual({ zombieLeagueId: 'z1', kind: 'initial_offer', status: 'review_required' })
  })

  it('paused and a correction hold come from the league row', async () => {
    m.zombie = { id: 'z1', status: 'paused', currentWeek: 6, correctionHoldFromWeek: 4 }
    const items = (await readWeeklyChecklist('L') as { items: Array<{ id: string }> }).items
    expect(items.map((i) => i.id)).toEqual(['zombie_paused', 'zombie_correction'])
  })

  it('no zombie league row, or no week yet: no checklist', async () => {
    m.zombie = null
    expect(await readWeeklyChecklist('L')).toEqual({ applies: false, reason: 'no_season' })
    m.zombie = { id: 'z1', status: 'setup', currentWeek: 0, correctionHoldFromWeek: null }
    expect(await readWeeklyChecklist('L')).toEqual({ applies: false, reason: 'not_in_season' })
  })

  it('an imported league with a zombie variant is not ours to run', async () => {
    m.league = { ...m.league, platform: 'sleeper' }
    expect(await readWeeklyChecklist('L')).toEqual({ applies: false, reason: 'not_redraft' })
  })
})
