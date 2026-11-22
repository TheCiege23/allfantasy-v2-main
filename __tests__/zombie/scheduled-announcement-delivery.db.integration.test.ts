// @vitest-environment node
/** Opt in only against a disposable local database with explicit DATABASE_URL and DIRECT_URL. */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { processZombieAnnouncementQueue } from '@/lib/zombie/scheduledAnnouncementDelivery'

const enabled = process.env.RUN_ZOMBIE_ANNOUNCEMENT_DB === '1'
const marker = `zombie-delivery-${randomUUID()}`
let ownerId = ''
let leagueId = ''
let zombieLeagueId = ''
const due = new Date('2020-01-01T00:00:00Z')

describe.skipIf(!enabled)('scheduled announcement delivery in disposable PostgreSQL', () => {
  beforeAll(async () => {
    for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
      const url = new URL(process.env[name] ?? '')
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('A disposable local database is required.')
    }
    if (await prisma.zombieAnnouncement.count({ where: { isPosted: false, scheduledFor: { not: null, lte: new Date() }, type: { not: 'weekly_update' } } })) {
      throw new Error('Use a disposable database without another due announcement queue.')
    }
    const owner = await prisma.appUser.create({ data: { email: `${marker}@example.invalid`, username: marker } })
    ownerId = owner.id
    const league = await prisma.league.create({ data: { userId: ownerId, name: marker, platform: 'manual', platformLeagueId: marker, sport: 'NFL' } })
    leagueId = league.id
    const zombie = await prisma.zombieLeague.create({ data: { leagueId, commissionerId: ownerId, weeklyUpdateApproval: true, sport: 'NFL', season: 2026 } })
    zombieLeagueId = zombie.id
  })

  afterAll(async () => {
    if (leagueId && ownerId) await prisma.league.deleteMany({ where: { id: leagueId, userId: ownerId } })
    if (ownerId) await prisma.appUser.deleteMany({ where: { id: ownerId, username: marker } })
    await prisma.$disconnect()
  })

  it('concurrent workers create one public message and one private notification', async () => {
    const publicRow = await prisma.zombieAnnouncement.create({ data: { zombieLeagueId, type: 'commissioner_note', title: 'Public report', content: marker, scheduledFor: due } })
    const privateRow = await prisma.zombieAnnouncement.create({ data: { zombieLeagueId, type: 'whisperer_reveal', title: 'Private role', content: marker, isPublic: false, targetUserId: ownerId, scheduledFor: due } })
    const results = await Promise.all([processZombieAnnouncementQueue(), processZombieAnnouncementQueue()])
    expect(results.flatMap(result => result.errors)).toEqual([])
    expect(results.reduce((sum, result) => sum + result.posted, 0)).toBe(2)
    expect(await prisma.leagueChatMessage.count({ where: { leagueId } })).toBe(1)
    expect(await prisma.leagueChatMessage.findUnique({ where: { id: `zombie-announcement:${privateRow.id}` } })).toBeNull()
    expect(await prisma.platformNotification.count({ where: { userId: ownerId, sourceKey: `zombie-announcement:${privateRow.id}` } })).toBe(1)
    expect(await prisma.zombieAnnouncement.count({ where: { id: { in: [publicRow.id, privateRow.id] }, isPosted: true, postedAt: { not: null } } })).toBe(2)
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 0, errors: [] })
  })

  it('an actual delivery FK failure rolls back the posted receipt, continues, and recovers on retry', async () => {
    const failed = await prisma.zombieAnnouncement.create({ data: { zombieLeagueId, type: 'whisperer_reveal', title: 'Private retry', content: marker, isPublic: false, targetUserId: randomUUID(), scheduledFor: due } })
    const healthy = await prisma.zombieAnnouncement.create({ data: { zombieLeagueId, type: 'commissioner_note', title: 'Healthy delivery', content: marker, scheduledFor: due } })
    const result = await processZombieAnnouncementQueue()
    expect(result).toEqual({ posted: 1, errors: [`announcement ${failed.id}: delivery failed; pending retry`] })
    expect(await prisma.zombieAnnouncement.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ isPosted: false, postedAt: null })
    expect(await prisma.zombieAnnouncement.findUniqueOrThrow({ where: { id: healthy.id } })).toMatchObject({ isPosted: true })
    expect(await prisma.platformNotification.findUnique({ where: { sourceKey: `zombie-announcement:${failed.id}` } })).toBeNull()
    await prisma.zombieAnnouncement.update({ where: { id: failed.id }, data: { targetUserId: ownerId } })
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 1, errors: [] })
    expect(await prisma.platformNotification.count({ where: { sourceKey: `zombie-announcement:${failed.id}` } })).toBe(1)
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 0, errors: [] })
  })

  it('does not publish drafts, future announcements or weekly reports requiring approval', async () => {
    const rows = await Promise.all([
      prisma.zombieAnnouncement.create({ data: { zombieLeagueId, type: 'commissioner_note', title: 'Draft', content: marker } }),
      prisma.zombieAnnouncement.create({ data: { zombieLeagueId, type: 'commissioner_note', title: 'Future', content: marker, scheduledFor: new Date(Date.now() + 86_400_000) } }),
      prisma.zombieAnnouncement.create({ data: { zombieLeagueId, type: 'weekly_update', title: 'Needs approval', content: marker, scheduledFor: due } }),
    ])
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 0, errors: [] })
    expect(await prisma.zombieAnnouncement.count({ where: { id: { in: rows.map(row => row.id) }, isPosted: false, postedAt: null } })).toBe(3)
  })
})
