import { resolveNflRosterTemplate } from '@/lib/nfl-roster/NflRosterTemplates'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveMlbRosterTemplate } from '@/lib/mlb-roster/MlbRosterTemplates'
import { resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveNcaafRosterTemplate } from '@/lib/ncaaf-roster/NcaafRosterTemplates'
import { resolveNcaabRosterTemplate } from '@/lib/ncaab-roster/NcaabRosterTemplates'
import { resolveSoccerRosterTemplate } from '@/lib/soccer-roster/SoccerRosterTemplates'
import type { LeagueSport } from '@prisma/client'
import { stripProspectStashSlots } from '@/lib/league-creation/prospectStashPolicy'

/**
 * Slots that hold players but never start. Bench / IR / TAXI were the only three excluded before, so an
 * MLB dynasty league wrote `NA: 5` and `PROSPECT: 10` — and an NHL one `PROSPECT: 8` — into
 * `starter_slots`, inflating `rosterSlots` by up to 15 fake starters. The keys are every `reserve` /
 * `bench` category slot across the sport slot catalogs (`lib/*-roster/*RosterTemplates.ts`).
 */
const NON_STARTER_SLOT_KEYS = new Set([
  'BN', 'BENCH', 'IR', 'IR_PLUS', 'IL', 'IL_PLUS', 'NA', 'TAXI', 'PROSPECT', 'RIGHTS', 'MINORS',
  'DEVY', 'DEVELOPMENT', 'RESERVE', 'YOUTH', 'ACADEMY', 'CAMPUS',
])

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
  // NHL / MLB have no prospect pool, so a new league gets no TAXI / PROSPECT / RIGHTS / MINORS slots.
  // The templates keep them, because existing leagues with no stored roster config still read them.
  const stripped = stripProspectStashSlots(sport, slots)
  for (const key of Object.keys(slots)) if (!(key in stripped)) delete slots[key]
  const starters = Object.fromEntries(Object.entries(slots).filter(([key]) => !NON_STARTER_SLOT_KEYS.has(key)))
  return { slots, starters, benchSlots: slots[benchKey] ?? 0, irSlots: slots[irKey] ?? 0, taxiSlots: slots.TAXI ?? 0,
    totalRosterSlots: Object.values(slots).reduce((sum, count) => sum + count, 0) }
}
