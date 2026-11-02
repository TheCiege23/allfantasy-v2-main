/** Isolated staging fixture for the real admin-result → notification → Chimmy flow. */
import { Prisma, PrismaClient } from '@prisma/client'

const STAGING_PROJECT = 'b3cd0239-9cb1-4c22-9d76-533d91d26f36'
if (process.env.CHIMMY_STAGING_PROJECT_ID !== STAGING_PROJECT) throw new Error('Explicit bracket staging target required')
const db = new PrismaClient()
const run = process.argv[3] ?? 'base'
if (!/^[a-z0-9-]{1,24}$/.test(run)) throw new Error('Invalid QA run label')
const suffix = run === 'base' ? '' : `-${run}`
const poolId = `chimmy-release-3164-pool${suffix}`
const entryId = `chimmy-release-3164-entry${suffix}`
const silentEntryId = `chimmy-release-3164-silent${suffix}`
const userId = 'bracket-qa-admin'
const marker = `Chimmy release 3164 QA${suffix}`
const entryName = `Chimmy replay QA${suffix}`
const command = process.argv[2] ?? 'inspect'

async function main() {
try {
  const owner = await db.appUser.findUnique({ where: { id: userId }, select: { email: true } })
  if (owner?.email !== 'bracket-admin@staging.invalid') throw new Error('Staging QA identity not found')
  const existing = await db.playoffBracketChallenge.findUnique({ where: { id: poolId } })
  if (existing && (existing.name !== marker || existing.ownerUserId !== userId)) throw new Error('Fixture ownership mismatch')
  if (command === 'setup' && !existing) {
    const source = await db.playoffBracketChallenge.findUnique({ where: { id: 'cmvr54qty000ymic7s5swgcuz' }, include: { series: { orderBy: { seriesNumber: 'asc' } } } })
    if (!source || source.ownerUserId !== userId || source.sport !== 'ncaaf') throw new Error('Expected CFP staging seed missing')
    const games = source.series.filter((row) => row.sourceSeriesHome == null && row.sourceSeriesAway == null).slice(0, 2)
    if (games.length !== 2) throw new Error('Two independent staging games required')
    const started = new Date(Date.now() - 7_200_000)
    await db.$transaction(async (tx) => {
      await tx.playoffBracketChallenge.create({ data: { id: poolId, ownerUserId: userId, name: marker,
        sport: source.sport, seasonYear: source.seasonYear, isTestMode: false,
        config: { qaRelease: '3164', lockRule: 'series_start', firstGameStartsAt: started.toISOString() } } })
      for (const id of [entryId, silentEntryId]) {
        await tx.playoffBracketEntry.create({ data: { id, challengeId: poolId, userId,
          name: id === entryId ? entryName : `Chimmy silent QA${suffix}`, finalizedAt: started, tiebreakerTotalScore: 48 } })
      }
      for (const [index, game] of games.entries()) {
        const id = `${poolId}-game-${index + 1}`
        await tx.playoffBracketSeries.create({ data: { id, challengeId: poolId, round: game.round,
          roundIndex: game.roundIndex, seriesNumber: index + 1, conference: game.conference,
          homeSeed: game.homeSeed, awaySeed: game.awaySeed, homeTeamName: game.homeTeamName,
          awayTeamName: game.awayTeamName, startsAt: started, bestOf: 1 } })
        for (const entry of [entryId, silentEntryId]) await tx.playoffBracketPick.create({ data: {
          challengeId: poolId, entryId: entry, seriesId: id, pickTeamName: game.homeTeamName } })
      }
    })
  } else if (!['setup', 'inspect'].includes(command)) throw new Error('Use setup or inspect')
  const profile = await db.userProfile.findUnique({ where: { userId }, select: { notificationPreferences: true } })
  const prefs = profile?.notificationPreferences as Record<string, Prisma.JsonValue> | null
  const history = prefs?.chimmyBracketChangeHistory as Record<string, Prisma.JsonValue> | undefined
  const notifications = await db.platformNotification.findMany({ where: { userId, type: 'chimmy_bracket_change',
    meta: { path: ['entryId'], equals: entryId } }, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, body: true, meta: true } })
  const silentNotifications = await db.platformNotification.count({ where: { userId, type: 'chimmy_bracket_change', meta: { path: ['entryId'], equals: silentEntryId } } })
  const games = await db.playoffBracketSeries.findMany({ where: { challengeId: poolId }, orderBy: { seriesNumber: 'asc' },
    select: { seriesNumber: true, homeTeamName: true, awayTeamName: true, winnerTeamName: true, status: true } })
  console.log(JSON.stringify({ poolId, poolName: marker, entryId, entryName, silentEntryId, games, history: history?.[`playoff:${entryId}`] ?? [], notifications, silentNotifications }, null, 2))
} finally { await db.$disconnect() }
}
void main().catch(() => { console.error('Staging fixture operation failed'); process.exitCode = 1 })
