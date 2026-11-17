import type { Metadata } from 'next'
import LeagueTypesFaq from '@/components/league/LeagueTypesFaq'
import { listLeagueFormats } from '@/lib/league/format-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { isSurvivorCreationSportAvailable } from '@/lib/survivor/survivorCreationAvailability'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { buildSeoMeta } from '@/lib/seo'

export const metadata: Metadata = buildSeoMeta({
  title: 'League Types & Rules FAQ | AllFantasy',
  description: 'Compare every AllFantasy league format, general rules, commissioner settings and add-ons before choosing your next league.',
  canonicalPath: '/league-types/faq',
})

export default function LeagueTypesPage() {
  const formats = listLeagueFormats().map((format) => ({
    id: format.id,
    label: format.label,
    description: format.description,
    sports: (() => {
      // Use the same registry/catalog intersection as the format landers without
      // importing their sample league builders into this public rules page.
      const offered = LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedSportsByConcept[format.id]
      return format.supportedSports.filter((sport) =>
        (!offered?.length || offered.includes(sport)) &&
        (format.id !== 'survivor' || isSurvivorCreationSportAvailable(sport))
      )
    })(),
    modifiers: format.supportedModifiers,
  }))

  return <LeagueTypesFaq formats={formats} sports={SUPPORTED_SPORTS} />
}
