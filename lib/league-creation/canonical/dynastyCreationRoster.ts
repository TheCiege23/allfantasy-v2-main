import { resolveNflRosterTemplate } from '@/lib/nfl-roster/NflRosterTemplates'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveMlbRosterTemplate } from '@/lib/mlb-roster/MlbRosterTemplates'
import { resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveNcaafRosterTemplate } from '@/lib/ncaaf-roster/NcaafRosterTemplates'
import { resolveNcaabRosterTemplate } from '@/lib/ncaab-roster/NcaabRosterTemplates'
import { resolveSoccerRosterTemplate } from '@/lib/soccer-roster/SoccerRosterTemplates'
import type { LeagueSport } from '@prisma/client'

/** Use the same templates the sport roster bootstrap installs, so draft capacity agrees. */
export function resolveDynastyCreationRoster(sport: LeagueSport, setup: Record<string, unknown>) {
  const resolvers = { NFL: resolveNflRosterTemplate, NBA: resolveNbaRosterTemplate, MLB: resolveMlbRosterTemplate,
    NHL: resolveNhlRosterTemplate, NCAAF: resolveNcaafRosterTemplate, NCAAB: resolveNcaabRosterTemplate, SOCCER: resolveSoccerRosterTemplate }
  const slots = { ...resolvers[sport]('dynasty').slots }
  const benchKey = 'BN' in slots ? 'BN' : 'BENCH'
  const irKey = 'IL' in slots ? 'IL' : 'IR'
  for (const [choice, key] of [['benchCount', benchKey], ['irCount', irKey], ['taxiSlots', 'TAXI']] as const) {
    if (typeof setup[choice] === 'number') slots[key] = setup[choice] as number
  }
  const starters = Object.fromEntries(Object.entries(slots).filter(([key]) => ![benchKey, irKey, 'TAXI'].includes(key)))
  return { slots, starters, benchSlots: slots[benchKey] ?? 0, irSlots: slots[irKey] ?? 0, taxiSlots: slots.TAXI ?? 0,
    totalRosterSlots: Object.values(slots).reduce((sum, count) => sum + count, 0) }
}
