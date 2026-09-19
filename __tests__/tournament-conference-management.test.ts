// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const shellFindFirst = vi.fn()
const shellUpdate = vi.fn()
const roundFindFirst = vi.fn()
const conferenceFindMany = vi.fn()
const conferenceCreate = vi.fn()
const conferenceUpdate = vi.fn()
const leagueFindMany = vi.fn()
const leagueUpdate = vi.fn()
const advancementCount = vi.fn()
const leagueParticipantFindMany = vi.fn()
const leagueParticipantUpdateMany = vi.fn()
const participantUpdateMany = vi.fn()
const auditCreate = vi.fn()

const tx = {
  tournamentConference: { create: conferenceCreate, update: conferenceUpdate },
  tournamentLeague: { update: leagueUpdate },
  tournamentLeagueParticipant: {
    findMany: leagueParticipantFindMany,
    updateMany: leagueParticipantUpdateMany,
  },
  tournamentParticipant: { updateMany: participantUpdateMany },
  tournamentShell: { update: shellUpdate },
  tournamentAuditLog: { create: auditCreate },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentShell: { findFirst: (...args: unknown[]) => shellFindFirst(...args) },
    tournamentRound: { findFirst: (...args: unknown[]) => roundFindFirst(...args) },
    tournamentConference: { findMany: (...args: unknown[]) => conferenceFindMany(...args) },
    tournamentLeague: {
      findMany: (...args: unknown[]) => leagueFindMany(...args),
    },
    tournamentAdvancementGroup: { count: (...args: unknown[]) => advancementCount(...args) },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  },
}))

import { applyConferencePlan } from '@/lib/tournament/manageConferences'

const args = { tournamentId: 't1', commissionerUserId: 'commish' }
const conferences = [
  { id: 'c1', clientId: 'c1', name: 'Black', active: true, leagueIds: ['l1'] },
  { id: 'c2', clientId: 'c2', name: 'Gold', active: true, leagueIds: ['l2'] },
]

beforeEach(() => {
  vi.clearAllMocks()
  shellFindFirst.mockResolvedValue({ id: 't1', currentRoundNumber: 1 })
  roundFindFirst.mockResolvedValue({ id: 'r1', roundNumber: 1 })
  conferenceFindMany.mockResolvedValue([
    { id: 'c1', name: 'Black', slug: 'black', conferenceNumber: 1, isActive: true },
    { id: 'c2', name: 'Gold', slug: 'gold', conferenceNumber: 2, isActive: true },
  ])
  leagueFindMany.mockResolvedValue([
    { id: 'l1', conferenceId: 'c1', leagueNumber: 1 },
    { id: 'l2', conferenceId: 'c2', leagueNumber: 2 },
  ])
  advancementCount.mockResolvedValue(0)
  leagueParticipantFindMany.mockResolvedValue([{ participantId: 'p1' }])
})

it('moves a league and its managers together, resets the cached rank, and audits the plan', async () => {
  const out = await applyConferencePlan({
    ...args,
    conferences: [
      { ...conferences[0]!, leagueIds: ['l1', 'l2'] },
      { ...conferences[1]!, leagueIds: [] },
    ],
  })

  expect(out).toMatchObject({ ok: true, movedLeagues: 1 })
  expect(leagueUpdate).toHaveBeenCalledWith({
    where: { id: 'l2' },
    data: { conferenceId: 'c1', leagueNumber: 2 },
  })
  expect(participantUpdateMany).toHaveBeenCalledWith({
    where: { id: { in: ['p1'] } },
    data: { currentConferenceId: 'c1', originalConferenceId: 'c1' },
  })
  expect(leagueParticipantUpdateMany).toHaveBeenCalledWith({
    where: { tournamentLeagueId: 'l2' },
    data: { conferenceRank: null },
  })
  expect(auditCreate.mock.calls[0][0].data.action).toBe('tournament.conferences_managed')
})

it('locks membership after this round has advanced while still allowing a rename', async () => {
  advancementCount.mockImplementation(async (query: { where: { fromRoundId?: string } }) =>
    query.where.fromRoundId ? 1 : 1,
  )
  const blocked = await applyConferencePlan({
    ...args,
    conferences: [
      { ...conferences[0]!, leagueIds: ['l1', 'l2'] },
      { ...conferences[1]!, leagueIds: [] },
    ],
  })
  expect(blocked).toMatchObject({ ok: false, status: 409 })
  expect(leagueUpdate).not.toHaveBeenCalled()

  const renamed = await applyConferencePlan({
    ...args,
    conferences: [{ ...conferences[0]!, name: 'AFC' }, conferences[1]!],
  })
  expect(renamed).toMatchObject({ ok: true, membershipLocked: true, movedLeagues: 0 })
})

it('refuses partial or duplicated assignments so a league cannot disappear or score twice', async () => {
  const missing = await applyConferencePlan({
    ...args,
    conferences: [{ ...conferences[0]!, leagueIds: ['l1'] }, { ...conferences[1]!, leagueIds: [] }],
  })
  expect(missing).toMatchObject({ ok: false, status: 409 })

  const duplicate = await applyConferencePlan({
    ...args,
    conferences: [conferences[0]!, { ...conferences[1]!, leagueIds: ['l1', 'l2'] }],
  })
  expect(duplicate).toMatchObject({ ok: false, status: 409 })
})

it('creates a named conference and archives an emptied one without deleting its history', async () => {
  const created = await applyConferencePlan({
    ...args,
    conferences: [
      conferences[0]!,
      conferences[1]!,
      { clientId: 'new-blue', name: 'Blue', active: true, leagueIds: [] },
    ],
  })
  expect(created).toMatchObject({ ok: true, createdConferences: 1 })
  expect(conferenceCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ tournamentId: 't1', name: 'Blue', slug: 'blue', isActive: true }),
  })

  const archived = await applyConferencePlan({
    ...args,
    conferences: [
      { ...conferences[0]!, leagueIds: ['l1', 'l2'] },
      { ...conferences[1]!, active: false, leagueIds: [] },
    ],
  })
  expect(archived).toMatchObject({ ok: true, movedLeagues: 1, archivedConferences: 1 })
  expect(conferenceUpdate).toHaveBeenCalledWith({
    where: { id: 'c2' },
    data: expect.objectContaining({ isActive: false }),
  })
})

it('scopes every editable id to the tournament and rejects a stale conference list', async () => {
  const out = await applyConferencePlan({
    ...args,
    conferences: [conferences[0]!],
  })
  expect(out).toMatchObject({ ok: false, status: 409 })
  expect(conferenceFindMany.mock.calls[0][0].where).toEqual({ tournamentId: 't1' })
})

it('rejects a plan based on stale names or assignments before it overwrites another edit', async () => {
  const out = await applyConferencePlan({
    ...args,
    conferences,
    expectedConferences: [{ ...conferences[0]!, name: 'Old Black' }, conferences[1]!],
  })
  expect(out).toMatchObject({ ok: false, status: 409 })
  expect(leagueUpdate).not.toHaveBeenCalled()
})
