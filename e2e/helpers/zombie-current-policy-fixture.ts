/** Controlled ownership/pairing and synthetic-stat setup for the disposable Zombie rehearsals. */
import { getRosterTemplateForLeague } from '../../lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '../../lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '../../lib/league/lineupStarterSlots'
import { computeOptimalLineup } from '../../lib/lineup-optimizer/optimalLineup'
import { buildPlayerDataFromSections } from '../../lib/roster/LineupTemplateValidation'
import { persistRosterLineupWithEngine } from '../../lib/roster-lineup-engine/lineupService'
import { reconcileRosterRedraftLinks } from '../../lib/league-runtime/reconcileRosterRedraftLinks'
import { prisma } from '../../lib/prisma'
import { calculateScoreFromSportConfig, isScoringStarterSlot, recalculateMatchupsForSeasonWeek } from '../../lib/redraft/scoringEngine'
import { loadWeekLineups, weekSlotType } from '../../lib/redraft/weekLineupSlots'
function localOnly() {
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL ?? '').hostname)) throw new Error('LOCAL_DISPOSABLE_DATABASE_REQUIRED')
}
/** These scenarios exercise defined Survivor/Horde outcomes; the separate rules tests hold W-v-W for review. */
export async function separateFixtureWhisperers(leagueId: string, seasonId: string, week: number) {
  localOnly()
  const [teams, owners, rosters, matches] = await Promise.all([
    prisma.zombieLeagueTeam.findMany({ where: { leagueId, status: 'Whisperer' }, select: { rosterId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    prisma.redraftRoster.findMany({ where: { seasonId }, select: { id: true, ownerId: true } }),
    prisma.redraftMatchup.findMany({ where: { seasonId, week, awayRosterId: { not: null } } }),
  ])
  const users = new Set(owners.filter(r => teams.some(t => t.rosterId === r.id)).map(r => r.platformUserId))
  const whisperers = new Set(rosters.filter(r => users.has(r.ownerId)).map(r => r.id))
  const pair = matches.find(m => whisperers.has(m.homeRosterId) && whisperers.has(m.awayRosterId!))
  if (!pair) return
  const other = matches.find(m => !whisperers.has(m.homeRosterId) && !whisperers.has(m.awayRosterId!))
  if (!other) throw new Error('The fixture needs two non-Whisperer opponents.')
  await prisma.$transaction([
    prisma.redraftMatchup.update({ where: { id: pair.id }, data: { awayRosterId: other.awayRosterId } }),
    prisma.redraftMatchup.update({ where: { id: other.id }, data: { awayRosterId: pair.awayRosterId } }),
  ])
}
/** Draft enough eligible fixture players for the league's actual saved starter layout. */
export async function fixtureNflDraftPositions(leagueId: string): Promise<string[]> {
  localOnly()
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
  const template = await getRosterTemplateForLeague('NFL', getFormatTypeForVariant('NFL', league.leagueVariant ?? undefined), leagueId)
  return resolveLineupStarterSlots(league, template).map(slot => slot.allowedPositions[0] === '*' ? 'RB' : slot.allowedPositions[0])
}
/** Actual finalized synthetic player stats feed the native NFL scorer and item-score receipt. */
export async function seedFinalNflFixtureTotals(leagueId: string, seasonId: string, season: number, week: number, targets: Map<string, number>) {
  localOnly()
  const links = await reconcileRosterRedraftLinks(leagueId)
  if (links.unlinked) throw new Error(`Synthetic roster links remain missing: ${links.unlinked}`)
  const rosterIds = [...targets.keys()]
  const club = `ZOMBIE_FIXTURE_${leagueId}`
  const externalId = `zombie-fixture:${leagueId}:${season}:${week}`
  const kickoff = new Date(Date.now() - 3_600_000)
  await prisma.sportsGame.upsert({
    where: { sport_externalId_source: { sport: 'NFL', externalId, source: 'zombie_synthetic_fixture' } },
    create: { sport: 'NFL', externalId, source: 'zombie_synthetic_fixture', homeTeam: club, awayTeam: `${club}_AWAY`, season, seasonType: 'regular', week, status: 'final', startTime: kickoff, expiresAt: new Date(Date.now() + 86_400_000) },
    update: {},
  })
  await prisma.redraftRosterPlayer.updateMany({ where: { rosterId: { in: rosterIds }, droppedAt: null }, data: { team: club } })
  const players = await prisma.redraftRosterPlayer.findMany({ where: { rosterId: { in: rosterIds }, droppedAt: null } })
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
  const template = await getRosterTemplateForLeague('NFL', getFormatTypeForVariant('NFL', league.leagueVariant ?? undefined), leagueId)
  const slots = resolveLineupStarterSlots(league, template)
  for (const rosterId of rosterIds) {
    const roster = await prisma.roster.findFirstOrThrow({ where: { leagueId, redraftRosterId: rosterId } })
    const rosterPlayers = players.filter(p => p.rosterId === rosterId)
    const lineup = computeOptimalLineup({
      players: rosterPlayers.map(p => ({ playerId: p.playerId, positions: [p.position], points: 1 })),
      slots: slots.map(slot => ({ slot: String(slot.index), eligible: slot.allowedPositions, count: 1, slotOrder: slot.index })),
    })
    if (lineup.unfilledSlots.length) throw new Error('The synthetic draft must fill every starter slot.')
    const row = (id: string) => {
      const player = rosterPlayers.find(p => p.playerId === id)!
      return { id, position: player.position, name: player.playerName }
    }
    const nextPlayerData = buildPlayerDataFromSections(roster.playerData, {
      starters: lineup.assignments.map(a => ({ ...row(a.playerId), slotIndex: Number(a.slot) })),
      bench: lineup.unusedPlayerIds.map(row), ir: [], taxi: [], devy: [],
    })
    // Only this disposable synthetic week omits wall-clock kickoff locks; all roster/slot validation runs.
    const saved = await persistRosterLineupWithEngine({ leagueId, rosterId: roster.id, actorUserId: roster.platformUserId!, nextPlayerData, season, week, source: 'system', skipLockCheck: true })
    if (!saved.ok) throw new Error(`Synthetic lineup save failed: ${saved.error}`)
  }
  const lineups = await loadWeekLineups(prisma, { redraftRosterIds: rosterIds, season, week })
  for (const rosterId of rosterIds) {
    const rosterPlayers = players.filter(p => p.rosterId === rosterId)
    const starter = rosterPlayers.find(p => isScoringStarterSlot(weekSlotType(p, lineups)))
    if (!starter) throw new Error('The synthetic roster needs an actual starter.')
    const unit = await calculateScoreFromSportConfig(leagueId, starter.playerId, week, { pass_td: 1 }, starter.position)
    if (!(unit > 0)) throw new Error('The synthetic NFL stat must have a positive league scoring weight.')
    for (const player of rosterPlayers) {
      const target = player.id === starter.id ? targets.get(rosterId)! : 0
      // Use a linear category: yardage thresholds would add bonuses to these exact synthetic totals.
      const stats = { pass_td: target / unit }
      await prisma.playerWeeklyScore.create({ data: { playerId: player.playerId, sport: 'NFL', season, week, stats, fantasyPts: target, isFinalized: true } })
    }
  }
  await recalculateMatchupsForSeasonWeek(seasonId, week)
  const matches = await prisma.redraftMatchup.findMany({ where: { seasonId, week } })
  for (const match of matches) {
    if (match.status !== 'final' || Math.abs(match.homeScore - targets.get(match.homeRosterId)!) > .01 || Math.abs(match.awayScore - targets.get(match.awayRosterId!)!) > .01) throw new Error('The native synthetic scores did not match the finalized inputs.')
  }
}
