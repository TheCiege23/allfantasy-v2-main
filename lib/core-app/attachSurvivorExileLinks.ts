import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Marks each Exile Island league with the Survivor league it belongs to (`exileOf`), so the rail can
 * draw the two as one pair instead of two unrelated leagues. Exile Island is a League row of its own
 * (SurvivorExileEngine.getOrCreateExileLeague), named "Exile Island: <survivor name>", and on a rail
 * with two NBA Survivor leagues nothing said which island went with which.
 *
 * Read-only and best-effort: a failed read leaves the rail exactly as it was.
 */
export async function attachSurvivorExileLinks(leagues: Array<{ id: string; exileOf?: string }>): Promise<void> {
  if (leagues.length === 0) return
  let links: Array<{ mainLeagueId: string; exileLeagueId: string }>
  try {
    links = await prisma.survivorExileLeague.findMany({
      where: { exileLeagueId: { in: leagues.map((l) => l.id) } },
      select: { mainLeagueId: true, exileLeagueId: true },
    })
  } catch {
    return
  }
  const mainByExile = new Map(links.map((link) => [link.exileLeagueId, link.mainLeagueId]))
  for (const league of leagues) {
    const main = mainByExile.get(league.id)
    if (main) league.exileOf = main
  }
}
