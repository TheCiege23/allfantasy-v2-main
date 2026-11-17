/**
 * One taxi squad size (2026-11-15).
 *
 * 🛑 TWO STORES HELD IT AND EACH SCREEN WROTE ONE. The settings window's Taxi squad section saved `League.taxiSlots`,
 * which roster legality reads (lib/roster-legality/loadLegalityEvaluationContext.ts); the dynasty settings saved
 * `DynastyLeagueConfig.taxiSlots`, which taxi moves are enforced from (lib/taxi/TaxiSettingsService.ts). A commissioner
 * who changed the size in one place saw it take effect in only half the league. Each save now writes both.
 *
 * Devy and C2C leagues size their taxi squad on their own config (`taxiSize`) and are not touched here.
 */
import { prisma } from '@/lib/prisma'

function count(n: unknown): number | null {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v >= 0 ? v : null
}

/** After `League.taxiSlots` was saved: the dynasty config, where the league has one. Never throws. */
export async function syncTaxiSlotsToDynastyConfig(leagueId: string, taxiSlots: unknown): Promise<void> {
  const n = count(taxiSlots)
  if (n == null) return
  try {
    await prisma.dynastyLeagueConfig.updateMany({ where: { leagueId }, data: { taxiSlots: n } })
  } catch (e) {
    console.warn('[taxi-slots] dynasty config sync failed', { leagueId, error: e instanceof Error ? e.message : String(e) })
  }
}

/** After `DynastyLeagueConfig.taxiSlots` was saved: the league column. Never throws. */
export async function syncTaxiSlotsToLeague(leagueId: string, taxiSlots: unknown): Promise<void> {
  const n = count(taxiSlots)
  if (n == null) return
  try {
    await prisma.league.update({ where: { id: leagueId }, data: { taxiSlots: n } })
  } catch (e) {
    console.warn('[taxi-slots] league column sync failed', { leagueId, error: e instanceof Error ? e.message : String(e) })
  }
}
