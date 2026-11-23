import { describe, expect, it } from 'vitest'
import { buildDraftPipelineReport } from '@/lib/league/collegePro/draftPipeline'
import { buildDraftChecklist, readChecklistTicks, withChecklistTick } from '@/lib/league/collegePro/draftChecklist'

const pick = (id: string, name: string, overall: number, nflTeam = 'NYJ', college: string | null = 'Utah') => ({
  collegeAthleteId: id, name, position: 'WR', nflTeam, round: Math.ceil(overall / 32), pick: ((overall - 1) % 32) + 1, overall, college,
})

// Shaped like Peach Bowl (Sleeper) + Cream Bowl (Fantrax).
const base = {
  year: 2027,
  picks: [pick('a1', 'First Rounder', 5), pick('a2', 'Second Guy', 40), pick('a3', 'Nobody Held', 12), pick('a4', 'Late Pick', 200)],
  collegeRoster: [
    { fantraxId: 'f1', teamName: 'Ciege82' },
    { fantraxId: 'f2', teamName: 'Grindingffb' },
    { fantraxId: 'f4', teamName: 'ciege82' }, // names compare case-insensitively
    { fantraxId: 'f9', teamName: 'Grindingffb' }, // never drafted
    { fantraxId: 'fx', teamName: 'Ciege82' }, // resolved to two athletes: left out
  ],
  athleteIdOf: new Map<string, string | null>([['f1', 'a1'], ['f2', 'a2'], ['f4', 'a4'], ['f9', 'zz'], ['fx', null]]),
  collegeTeams: [{ key: 'ciege', name: 'Ciege82' }, { key: 'grind', name: 'Grindingffb' }],
  proTeams: [{ key: '8', name: '(F) SF TEP' }, { key: '11', name: 'GrindingFFB' }],
  map: { '8': 'ciege' } as Record<string, string>,
}

describe('the league-wide draft pipeline', () => {
  it('groups drafted college players by franchise, best pick first, with the pro team they move to', () => {
    const r = buildDraftPipelineReport(base)
    expect(r.movingUp.map((f) => [f.collegeName, f.proName, f.players.map((p) => p.name)])).toEqual([
      ['Ciege82', '(F) SF TEP', ['First Rounder', 'Late Pick']],
      ['Grindingffb', null, ['Second Guy']], // no pro team matched yet: kept, not dropped
    ])
    expect(r.movingUp[0]!.players[0]).toMatchObject({ fantraxId: 'f1', proTeam: 'NYJ', round: 1, pick: 5 })
  })

  it('the rookie pool is every drafted player no college team held, in draft order', () => {
    const r = buildDraftPipelineReport(base)
    expect(r.rookiePool.map((p) => [p.name, p.overall, p.college])).toEqual([['Nobody Held', 12, 'Utah']])
  })
})

describe('the commissioner checklist', () => {
  const report = buildDraftPipelineReport(base)
  const args = { report, ticks: {}, proLabel: 'NFL', proLeagueName: 'Peach Bowl', proPlatform: 'sleeper', collegeLeagueName: 'Cream Bowl', proDrafts: null }

  it('waits for the draft when no results are on file', () => {
    expect(buildDraftChecklist({ ...args, report: null })).toEqual([expect.objectContaining({ id: 'results', state: 'waiting' })])
  })

  it('reads what it can from data and leaves the hand-done steps to tick', () => {
    const steps = buildDraftChecklist(args)
    expect(steps.map((s) => [s.id, s.state, s.manual])).toEqual([
      ['results', 'done', false],
      ['moveUp', 'todo', true],
      ['rookiePool', 'todo', true],
      ['collegeCleared', 'todo', true],
      ['rookieDraft', 'unknown', false],
    ])
    expect(steps[1]!.title).toBe('Move 3 drafted players to Peach Bowl')
    expect(steps[1]!.detail).toContain('1 college team has no matching NFL team yet')
  })

  it('a ticked step reads done, and nothing to move means nothing to tick', () => {
    const ticked = buildDraftChecklist({ ...args, ticks: { moveUp: { at: 'x', by: 'u' } } })
    expect(ticked.find((s) => s.id === 'moveUp')?.state).toBe('done')
    const none = buildDraftChecklist({ ...args, report: { ...report, movingUp: [] } })
    expect(none.filter((s) => s.id === 'moveUp' || s.id === 'collegeCleared').map((s) => [s.state, s.manual])).toEqual([['done', false], ['done', false]])
  })

  it('the rookie draft step reads the pro half’s draft', () => {
    const d = (phase: 'done' | 'live' | 'upcoming', startsAt: string | null = null, season = 2027) =>
      ({ role: 'pro' as const, platform: 'sleeper' as const, season, phase, status: '', detail: null, startsAt })
    const step = (drafts: ReturnType<typeof d>[]) => buildDraftChecklist({ ...args, proDrafts: drafts }).at(-1)!
    expect(step([d('upcoming')])).toMatchObject({ state: 'todo', detail: 'It has no start date yet. Set one on Sleeper.' })
    expect(step([d('upcoming', '2027-05-10T00:00:00.000Z')])).toMatchObject({ state: 'done', detail: 'Starts May 10.' })
    expect(step([d('done')])).toMatchObject({ state: 'done' })
    expect(step([d('done', null, 2026)])).toMatchObject({ state: 'todo' }) // last year's draft does not count
  })

  it('ticks are stored per year and step, merged into the league settings', () => {
    const now = new Date('2027-05-02T12:00:00Z')
    let settings: Record<string, unknown> = { collegeProPair: { role: 'pro' }, other: 1 }
    settings = withChecklistTick(settings, 2027, 'moveUp', true, 'commish', now)
    settings = withChecklistTick(settings, 2027, 'rookiePool', true, 'commish', now)
    settings = withChecklistTick(settings, 2027, 'rookiePool', false, 'commish', now)
    expect(settings.other).toBe(1)
    expect(readChecklistTicks(settings, 2027)).toEqual({ moveUp: { at: now.toISOString(), by: 'commish' } })
    expect(readChecklistTicks(settings, 2026)).toEqual({})
  })
})
