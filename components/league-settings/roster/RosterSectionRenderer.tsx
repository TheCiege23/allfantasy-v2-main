import { ReadOnlyRosterRow } from './ReadOnlyRosterRow'
import { RosterRowControl } from './RosterRowControl'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { RosterGroup } from './buildRosterGroups'

/**
 * Renders sport-driven roster groups (see `buildRosterGroups`). Category headings are dictionary
 * keys (`lsEd.ro.cat.<category>`); a non-football "offense" group reads "Starting lineup", and the
 * injured list is headed "IR (doesn't count toward draft rounds)" with the sport's own code.
 */
export function RosterSectionRenderer({
  title,
  groups,
  pendingSlots,
  isCommissioner,
  football,
  onAdjust,
}: {
  title?: string
  groups: RosterGroup[]
  pendingSlots: Record<string, number>
  isCommissioner: boolean
  football: boolean
  onAdjust: (key: string, delta: number) => void
}) {
  const { t } = useLanguage()
  const heading = (g: RosterGroup): string | null => {
    if (g.kind === 'offense') return football ? t('lsEd.ro.cat.offense') : t('lsEd.ro2.starters')
    if (g.kind === 'injured') return t('lsEd.ro2.injured').replace('{{slot}}', g.injuredCode ?? 'IR')
    if (g.kind === 'other') return null
    return t(`lsEd.ro.cat.${g.kind}`)
  }

  return (
    <div className="space-y-3">
      {title ? <p className="af-ls-eyebrow">{title}</p> : null}
      {groups.map((g) => {
        const h = heading(g)
        return (
          <section key={g.kind} className="af-ls-card !p-1.5" data-testid={`roster-group-${g.kind}`}>
            {h ? <p className="af-ls-eyebrow px-2 pb-1 pt-1.5">{h}</p> : null}
            <div>
              {g.defs.map((def) => {
                const count = pendingSlots[def.key] ?? 0
                return isCommissioner
                  ? <RosterRowControl key={def.key} def={def} count={count} onAdjust={onAdjust} />
                  : <ReadOnlyRosterRow key={def.key} def={def} count={count} />
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
