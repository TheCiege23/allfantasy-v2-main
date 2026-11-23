// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  existing: null as unknown,
  upsert: vi.fn(async () => ({})),
  draft: vi.fn(),
  roster: vi.fn(),
  notify: vi.fn(async () => ({ leagues: 0, managers: 0, commissioners: 0 })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findUnique: vi.fn(async () => (h.existing ? { data: h.existing } : null)), upsert: h.upsert } },
}))
vi.mock('@/lib/cbbd/cbbdFetch', () => ({ getCbbdDraftPicks: h.draft, getCbbdTeamRoster: h.roster }))
// The paired-league notices are their own suite (collegeProDraftNotices); here only the hand-off is checked.
vi.mock('@/lib/league/collegePro/draftNotices', () => ({ notifyNewDraftPicks: h.notify }))

import {
  inNbaDraftWindow,
  latestNbaDraftYear,
  linkCbbdPicks,
  refreshCbbdDraftPicks,
  schoolsToRead,
} from '@/lib/devy/cbbdDraftPicksStore'
import type { CbbdDraftPick, CbbdRosterTeam } from '@/lib/cbbd/cbbdFetch'

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'contracts/cbbd/fixtures', name), 'utf8')).response
const PICKS: CbbdDraftPick[] = fixture('draft-picks-2025.json')
const DUKE_2025: CbbdRosterTeam = fixture('roster-2025-duke.json')[0]

describe('linking the NBA draft to ESPN ids (contracts/cbbd B-01)', () => {
  it("links all five of Duke's 2025 picks to their ESPN ids through the draft-year roster, with no names", () => {
    const { picks } = linkCbbdPicks(PICKS, new Map([['Duke', DUKE_2025]]))
    const byName = Object.fromEntries(picks.map((p) => [p.name, p]))
    expect(byName['Cooper Flagg']).toMatchObject({ collegeAthleteId: '5041939', nflTeam: 'Dallas Mavericks', round: 1, pick: 1, collegeTeam: 'Duke' })
    expect(byName['Kon Knueppel']?.collegeAthleteId).toBe('5061575')
    expect(byName['Khaman Maluach']?.collegeAthleteId).toBe('5203685')
    // Duke had five 2025 picks (Sion James and Tyrese Proctor too), all on the 2024-25 roster.
    expect(picks).toHaveLength(5)
  })

  it('reports every college pick it could not link, and leaves international picks out entirely', () => {
    const { picks, unlinked } = linkCbbdPicks(PICKS, new Map([['Duke', DUKE_2025]]))
    const college = PICKS.filter((p) => p.sourceTeamCollegeId != null)
    expect(picks.length + unlinked.length).toBe(college.length)
    expect(unlinked.find((u) => u.name === 'Egor Demin')).toMatchObject({ school: 'BYU', reason: 'no athlete id' })
    // Only Duke's roster was supplied, so every other school's pick is reported, not dropped.
    expect(unlinked.filter((u) => u.reason === 'not on the draft-year roster').length).toBe(college.length - 5 - 1)
    expect(unlinked.some((u) => u.name === 'Noa Essengue')).toBe(false)
  })

  it('refuses a roster row whose source id is not an ESPN id', () => {
    const broken: CbbdRosterTeam = { ...DUKE_2025, players: DUKE_2025.players.map((p) => ({ ...p, sourceId: null })) }
    const { picks, unlinked } = linkCbbdPicks(PICKS.filter((p) => p.sourceTeamLocation === 'Duke'), new Map([['Duke', broken]]))
    expect(picks).toEqual([])
    expect(unlinked).toHaveLength(5)
    expect(new Set(unlinked.map((u) => u.reason))).toEqual(new Set(['roster has no ESPN id']))
  })

  it('asks for one roster per school that has a linkable pick', () => {
    const schools = schoolsToRead(PICKS)
    expect(schools).toContain('Duke')
    expect(schools).not.toContain('BYU') // its only pick has no athlete id
    expect(schools).not.toContain('France')
  })
})

describe('when the NBA draft is read', () => {
  it('reads this June\'s draft from June 20, last year\'s before', () => {
    expect(latestNbaDraftYear(new Date('2026-06-19T12:00:00Z'))).toBe(2025)
    expect(latestNbaDraftYear(new Date('2026-06-20T00:00:00Z'))).toBe(2026)
    expect(latestNbaDraftYear(new Date('2026-11-22T00:00:00Z'))).toBe(2026)
    expect(inNbaDraftWindow(new Date('2026-06-26T00:00:00Z'))).toBe(true)
    expect(inNbaDraftWindow(new Date('2026-07-11T00:00:00Z'))).toBe(false)
  })
})

describe('refreshCbbdDraftPicks', () => {
  beforeEach(() => {
    h.existing = null
    h.upsert.mockClear()
    h.draft.mockReset().mockResolvedValue({ ok: true, data: PICKS.filter((p) => p.sourceTeamLocation === 'Duke') })
    h.roster.mockReset().mockResolvedValue({ ok: true, data: [DUKE_2025] })
  })

  it('stores the linked picks under the year key, reading the draft-year roster', async () => {
    const r = await refreshCbbdDraftPicks({ now: new Date('2026-11-22T12:00:00Z') })
    expect(r).toMatchObject({ year: 2026, stored: 5, unlinked: 0, schools: 1 })
    expect(h.roster).toHaveBeenCalledWith(2026, 'Duke')
    const write = h.upsert.mock.calls[0][0] as { where: { cacheKey: string }; create: { data: { picks: unknown[] } } }
    expect(write.where.cacheKey).toBe('cbbd:draft-picks:v1:2026')
    expect(write.create.data.picks).toHaveLength(5)
    // Nothing was stored before, so all five are new to the notices.
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ sport: 'NCAAB', year: 2026, previousIds: new Set() }))
    expect((h.notify.mock.calls.at(-1)?.[0] as { currentIds: string[] }).currentIds).toHaveLength(5)
  })

  it('writes nothing when a roster cannot be read, so nobody is reported undrafted by mistake', async () => {
    h.roster.mockResolvedValue({ ok: false, failure: { kind: 'quota', status: 429, message: 'quota', path: '/teams/roster' } })
    const r = await refreshCbbdDraftPicks({ now: new Date('2026-11-22T12:00:00Z') })
    expect(r).toMatchObject({ year: 2026 })
    expect('error' in r).toBe(true)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('never calls CBBD again once a year is final', async () => {
    h.existing = { year: 2026, fetchedAt: '2026-07-20T00:00:00.000Z', picks: [], unlinked: [] }
    const r = await refreshCbbdDraftPicks({ now: new Date('2026-11-22T12:00:00Z') })
    expect(r).toEqual({ year: 2026, skipped: 'final for this draft' })
    expect(h.draft).not.toHaveBeenCalled()
  })
})
