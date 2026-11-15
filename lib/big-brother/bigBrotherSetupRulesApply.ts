import { prisma } from '@/lib/prisma'
import { BIG_BROTHER_CONFIG_DEFAULTS, upsertBigBrotherConfig, type BigBrotherConfigUpsertInput } from './BigBrotherLeagueConfig'
import { SETUP_RULES_APPLIED_KEY, setupRulesForExistingLeague } from './bigBrotherSetupRules'

/**
 * Apply a league's Big Brother setup choices to its game config, once (./bigBrotherSetupRules.ts says why).
 *
 * Called by league creation right after the config is made, and by the automation tick for leagues created before
 * this existed. Only fields still at the built-in default are changed, so nothing anyone has set is overwritten; the
 * pass is stamped in `League.settings`, so it never runs twice for a league. Best-effort: a failure leaves the league
 * on its current rules and the next tick tries again.
 */
export async function applyBigBrotherSetupRules(leagueId: string, now = new Date()): Promise<BigBrotherConfigUpsertInput> {
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const settings = league?.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : null
    if (!settings || settings[SETUP_RULES_APPLIED_KEY]) return {}
    const config = await prisma.bigBrotherLeagueConfig.findUnique({ where: { leagueId } })
    if (!config) return {}

    const evictionsSoFar = await prisma.bigBrotherCycle.count({ where: { leagueId, evictedRosterId: { not: null } } })
    const changes = setupRulesForExistingLeague(settings, config as unknown as Record<string, unknown>, BIG_BROTHER_CONFIG_DEFAULTS, { evictionsSoFar })
    if (Object.keys(changes).length) {
      await upsertBigBrotherConfig(leagueId, changes)
      // The league log's "Changed the format settings" (lib/league-log/leagueLog.ts, section conceptRules).
      await prisma.leagueAuditLog.create({
        data: {
          leagueId,
          userId: null,
          actionType: 'settings_patch',
          entityType: 'league',
          entityId: leagueId,
          metadata: { section: 'conceptRules', format: 'big_brother', source: 'setup_rules', fields: Object.keys(changes) },
          afterState: changes,
        },
      })
    }
    await prisma.$executeRaw`
      UPDATE leagues SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
        ARRAY[${SETUP_RULES_APPLIED_KEY}]::text[], to_jsonb(${now.toISOString()}::text))
      WHERE id = ${leagueId}`
    return changes
  } catch (error) {
    console.warn('[big-brother] setup rules not applied; the next tick tries again', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}
