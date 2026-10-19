import { describe, expect, it } from 'vitest'
import { detectInboxConditions, type InboxConditionInput } from '@/lib/commissioner-workspace/inboxTasks'
import { taskText } from '@/lib/commissioner-os/i18n/analyticsCopy'

const now = new Date('2026-10-19T12:00:00Z')
const empty: InboxConditionInput = { leagueId: 'L1', season: 2026, keeperSessions: [], alerts: [], integrity: [], settings: {}, teams: [], payouts: [] }
const keys = (input: Partial<InboxConditionInput>) => detectInboxConditions({ ...empty, ...input }, now).map((t) => t.sourceKey)

describe('Commish Inbox detectors', () => {
  it('nothing waiting → no tasks', () => {
    expect(detectInboxConditions(empty, now)).toEqual([])
  })

  it('keepers: missing submissions, critical inside 48h of the deadline, and clears once everyone submits', () => {
    const session = { id: 'K', deadline: new Date('2026-10-20T12:00:00Z'), totalTeams: 12, teamsSubmitted: 9, conflictsDetected: null, conflictsResolved: false }
    const [task] = detectInboxConditions({ ...empty, keeperSessions: [session] }, now)
    expect(task).toMatchObject({ sourceKey: 'operational:keepers:K:v1', priority: 'critical', dueAt: session.deadline })
    expect(task.description).toMatch(/^3 of 12 teams have not submitted keepers/)
    expect(keys({ keeperSessions: [{ ...session, deadline: new Date('2026-10-30T12:00:00Z') }] })).toEqual(['operational:keepers:K:v1'])
    expect(keys({ keeperSessions: [{ ...session, teamsSubmitted: 12 }] })).toEqual([])
  })

  it('keepers: unresolved conflicts', () => {
    const session = { id: 'K', deadline: new Date('2026-10-30T12:00:00Z'), totalTeams: 12, teamsSubmitted: 12, conflictsDetected: [{ rosterId: 'r1' }], conflictsResolved: false }
    expect(keys({ keeperSessions: [session] })).toEqual(['operational:keeper-conflicts:K:v1'])
    expect(keys({ keeperSessions: [{ ...session, conflictsResolved: true }] })).toEqual([])
  })

  it('AI alerts and integrity flags, with snoozed alerts held back', () => {
    const alert = { alertId: 'A', headline: 'Lopsided trade flagged', summary: 'Team X sent three starters for a bench player.', severity: 'high', snoozedUntil: null }
    const [a] = detectInboxConditions({ ...empty, alerts: [alert] }, now)
    expect(a).toMatchObject({ sourceKey: 'operational:alert:A:v1', title: 'Lopsided trade flagged', priority: 'critical' })
    expect(keys({ alerts: [{ ...alert, snoozedUntil: new Date('2026-10-21T00:00:00Z') }] })).toEqual([])
    expect(keys({ alerts: [{ ...alert, snoozedUntil: new Date('2026-10-18T00:00:00Z') }] })).toEqual(['operational:alert:A:v1'])
    expect(keys({ integrity: [{ id: 'F', flagType: 'duplicate_manager', severity: 'medium', summary: null }] })).toEqual(['operational:integrity:F:v1'])
  })

  it('join requests and pending orphan adoptions from league settings', () => {
    const settings = {
      classJoinRequests: [{ userId: 'u1', requestedAt: '2026-10-18T00:00:00Z', divisionAtRequest: 3 }],
      orphan_adoption_requests: [
        { id: 'O1', leagueId: 'L1', rosterId: 'r', userId: 'u2', requesterName: 'Sam', message: null, status: 'pending', createdAt: '2026-10-18T00:00:00Z', resolvedAt: null, resolvedBy: null },
        { id: 'O2', leagueId: 'L1', rosterId: 'r', userId: 'u3', requesterName: 'Lee', message: null, status: 'approved', createdAt: '2026-10-18T00:00:00Z', resolvedAt: null, resolvedBy: null },
      ],
    }
    const out = keys({ settings })
    expect(out).toContain('operational:join-requests:v1')
    expect(out).toContain('operational:adoption:O1:v1')
    expect(keys({ settings: {} })).toEqual([])
    expect(out).not.toContain('operational:adoption:O2:v1')
  })

  it('dues: only when the tracker is on, counting paid and paid-this-season teams', () => {
    const teams = [{ id: 't1', teamName: 'Ghosts' }, { id: 't2', teamName: 'Kings' }, { id: 't3', teamName: 'Rebels' }]
    const dues = (entries: unknown[], enabled = true) => ({ dues_tracker: { enabled, entries } })
    expect(keys({ teams, settings: dues([], false) })).toEqual([])
    const [task] = detectInboxConditions({ ...empty, teams, settings: dues([{ teamId: 't1', paid: true, paidSeasons: [] }, { teamId: 't2', paid: false, paidSeasons: [2026] }]) }, now)
    expect(task).toMatchObject({ sourceKey: 'operational:dues:2026:v1', priority: 'standard' })
    expect(task.description).toBe('1 of 3 teams have not paid 2026 dues: Rebels.')
    expect(keys({ teams, settings: dues([{ teamId: 't1', paid: true }, { teamId: 't2', paid: true }, { teamId: 't3', paid: true }]) })).toEqual([])
  })

  it('payout requests awaiting approval', () => {
    expect(keys({ payouts: [{ id: 'P' }] })).toEqual(['operational:payout:P:v1'])
  })

  it('every title and description it can produce has Spanish copy', () => {
    const tasks = detectInboxConditions(
      {
        ...empty,
        keeperSessions: [{ id: 'K', deadline: new Date('2026-10-30T12:00:00Z'), totalTeams: 12, teamsSubmitted: 9, conflictsDetected: [{}], conflictsResolved: false }],
        alerts: [{ alertId: 'A', headline: 'x', summary: null, severity: 'medium', snoozedUntil: null }],
        integrity: [{ id: 'F', flagType: 'duplicate_manager', severity: 'medium', summary: null }],
        settings: {
          dues_tracker: { enabled: true, entries: [] },
          classJoinRequests: [{ userId: 'u1', requestedAt: 'x', divisionAtRequest: 3 }],
          orphan_adoption_requests: [{ id: 'O', leagueId: 'L1', rosterId: 'r', userId: 'u', requesterName: 'Sam', message: null, status: 'pending', createdAt: 'x', resolvedAt: null, resolvedBy: null }],
        },
        teams: [{ id: 't1', teamName: 'Ghosts' }],
        payouts: [{ id: 'P' }],
      },
      now,
    )
    const texts = tasks.flatMap((t) => (t.sourceKey.startsWith('operational:alert:') ? [t.description] : [t.title, t.description]))
    expect(tasks.map((t) => t.sourceKey.split(':')[1]).sort()).toEqual(['adoption', 'alert', 'dues', 'integrity', 'join-requests', 'keeper-conflicts', 'keepers', 'payout'])
    expect(texts.length).toBeGreaterThan(10)
    for (const text of texts) expect(taskText(text, 'es'), text).not.toBe(text)
  })
})
