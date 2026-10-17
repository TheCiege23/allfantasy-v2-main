import { describe, expect, it } from 'vitest'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import { buildTeamAlerts } from '@/lib/core-app/teamAlerts'
import { parseTeamAlertTarget } from '@/lib/core-app/teamAlertTarget'

const now = Date.parse('2026-10-06T12:00:00Z')
const deadline = new Date(now + 3600_000).toISOString()
const starter = { sleeperId: 'injured', name: 'Starter', position: 'RB', ruledOut: true, injuryStatus: 'OUT', kickoff: deadline }
function roster(bench: unknown, patch: object = {}): MyTeamData {
  return { league: { id: 'league', name: 'League', platform: 'native' }, starters: { available: true, data: [{ slotLabel: 'QB', player: null }, { slotLabel: 'RB', player: starter }] }, bench, ...patch } as unknown as MyTeamData
}

describe('injury alerts without a bench replacement', () => {
  it.each([
    { available: false, reason: 'no bench players recorded on this roster' },
    { available: true, data: [] },
    { available: false, reason: 'bench evidence unavailable' },
  ])('retains the injured starter and exact slot when bench state is %j', bench => {
    const data = roster(bench)
    const before = JSON.stringify(data)
    const alerts = buildTeamAlerts(data, {}, now)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'injury', playerId: 'injured', alternative: null, fresh: false, key: `injury:injured:${deadline}` })
    expect(parseTeamAlertTarget(new URL(alerts[0].href, 'https://www.allfantasy.ai'), 'league')).toEqual({ playerId: 'injured', deadline, slotIndex: 1 })
    expect(JSON.stringify(data)).toBe(before)
  })
  it('retains deadlines alongside an injury with no bench', () => {
    expect(buildTeamAlerts(roster({ available: false }), { tradeDeadlineAt: deadline }, now).map(a => a.kind)).toEqual(['injury', 'deadline'])
  })
  it('does not invent an injury when starters are unreadable', () => {
    expect(buildTeamAlerts(roster({ available: false }, { starters: { available: false, reason: 'unreadable' } }), {}, now)).toEqual([])
  })
  it.each(['preDraft', 'completed', 'eliminated'])('keeps %s leagues excluded', flag => {
    expect(buildTeamAlerts(roster({ available: false }, { [flag]: true }), {}, now)).toEqual([])
  })
  it.each([
    { ruledOut: false }, { kickoff: null }, { kickoff: new Date(now).toISOString() },
    { kickoff: new Date(now + 8 * 86400_000).toISOString() },
  ])('keeps inactive/future-game gates with starter patch %j', patch => {
    const data = roster({ available: false }, { starters: { available: true, data: [{ slotLabel: 'RB', player: { ...starter, ...patch } }] } })
    expect(buildTeamAlerts(data, {}, now)).toEqual([])
  })
  it('keeps the eligible alternative when bench evidence exists', () => {
    const bench = { ...starter, sleeperId: 'backup', name: 'Backup', ruledOut: false, onBye: false }
    expect(buildTeamAlerts(roster({ available: true, data: [bench] }), {}, now)[0].alternative).toBe('Backup')
  })
})

