import { prisma } from '@/lib/prisma'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { executeCanonicalLeagueCreation } from '@/lib/league-creation/canonical/executeCanonicalLeagueCreation'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { rehearsalSourceIds, stagingRehearsalEnabled } from './stagingRehearsalGuard'
const PRESETS = { NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points' } as const

/** Staging-only fixture creation. Existing source leagues are READ, never modified.
 * No account/session bypass is exposed to the browser: the normal owner signs in.
 * Repeated requests reuse the fixture, including when its draft has already started.
 */
export async function preparePhoneRehearsal(sport: keyof typeof PRESETS) {
  if (!stagingRehearsalEnabled(process.env)) throw new Error('REHEARSAL_DISABLED')
  const sources = rehearsalSourceIds(process.env)
  if (sources.length !== 4) throw new Error('REHEARSAL_SOURCES_REQUIRED')
  const source = await prisma.league.findFirst({
    where: { id: { in: sources }, sport }, select: { id: true, userId: true },
  })
  if (!source) throw new Error('REHEARSAL_SOURCE_MISSING')
  const name = `Zombie QA iPhone — ${sport}`
  const prior = await prisma.league.findFirst({ where: {
    userId: source.userId, name,
  }, select: { id: true, settings: true } })
  if (prior) {
    const settings = prior.settings as { zombieRehearsal?: { sourceLeagueId?: string } } | null
    if (settings?.zombieRehearsal?.sourceLeagueId !== source.id) throw new Error('REHEARSAL_NAME_CONFLICT')
    return { leagueId: prior.id, sport, created: false }
  }
  const checked = validateCreatePayload({
    concept: 'zombie', sport, teamCount: 8, draftType: 'snake', scoringPreset: PRESETS[sport],
    leagueName: name, timezone: 'America/New_York', conceptSetup: {},
  })
  if (!checked.ok) throw new Error('REHEARSAL_PRESET_INVALID')
  const result = await executeCanonicalLeagueCreation({ appUserId: source.userId, body: checked.data })
  if (!result.ok) throw new Error('REHEARSAL_CREATE_FAILED')
  const leagueId = result.response.league.id
  await prisma.$transaction(async tx => {
    const fresh = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
    const settings = fresh.settings && typeof fresh.settings === 'object' && !Array.isArray(fresh.settings) ? fresh.settings : {}
    await tx.league.update({ where: { id: leagueId }, data: { settings: toPrismaJsonInput({
      ...settings, zombieRehearsal: { kind: 'phone', version: 1, sourceLeagueId: source.id },
    }) } })
  })
  return { leagueId, sport, created: true }
}
