'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { survivorRulebookMessages } from '@/lib/core-app/messages/survivorRulebook'
import { localDeadline, rulebook, type RulebookConfig, type RulebookRule } from '@/lib/core-app/survivorRulebook'

/**
 * The season rulebook: the league's Survivor rules on one carved board, so a castaway never has to
 * open settings to know when the merge is or whether Exile is on. Read-only; the commissioner gets
 * a link to edit. Renders nothing until there is a rule to show.
 */
export function SurvivorRulebook({ config, editHref, collapsible = false }: { config: RulebookConfig | null | undefined; editHref?: string | null; collapsible?: boolean }) {
  const m = useMessages(survivorRulebookMessages)
  const language = useOptionalLanguage().language
  // The deadline is worded in the reader's own time zone, so it is only filled in on the client.
  const [locale, setLocale] = useState<string | null>(null)
  useEffect(() => { setLocale(language === 'es' ? 'es' : 'en-US') }, [language])

  const rules = rulebook(config)
  if (rules.length === 0) return null

  const row = (r: RulebookRule): [string, string] => {
    switch (r.id) {
      case 'tribes': return [m.tribes, m.tribesValue(r.count, r.size, r.formation === 'commissioner')]
      case 'merge': return [m.merge, r.byWeek != null ? m.mergeWeek(r.byWeek) : m.mergePlayers(r.byPlayers ?? 0)]
      case 'jury': return [m.jury, m.juryValue(r.afterMerge)]
      case 'exile': return [m.exile, r.on ? m.exileOn(r.tokens) : m.exileOff]
      case 'idols': return [m.idols, m.idolsValue(r.count)]
      case 'swap': return [m.swap, r.on ? m.on : m.off]
      case 'vote': {
        const when = locale ? localDeadline(r.day, r.timeUtc, locale) : null
        return [m.vote, [when ? m.voteDue(when) : null, r.selfVote ? m.voteSelf : m.voteNoSelf].filter(Boolean).join(' · ')]
      }
      case 'challenges': return [m.challenges, m.challengesValue(r.frequency)]
    }
  }

  const body = (
    <>
      <dl className="sv-rules">
        {rules.map((r) => {
          const [k, v] = row(r)
          return (
            <div key={r.id} className="sv-rule" data-rule={r.id}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          )
        })}
      </dl>
      {editHref ? <Link className="sv-link" href={editHref}>{m.edit} →</Link> : null}
    </>
  )

  if (collapsible) {
    return (
      <details className="sv-panel sv-rulebook" data-testid="survivor-rulebook">
        <summary className="sv-eyebrow">{config?.seasonThemeLabel ? `${m.title} · ${config.seasonThemeLabel}` : m.title}</summary>
        {body}
      </details>
    )
  }
  return (
    <section className="sv-panel sv-rulebook" aria-label={m.title} data-testid="survivor-rulebook">
      <div className="sv-panel-h"><span className="sv-eyebrow">{config?.seasonThemeLabel ? `${m.title} · ${config.seasonThemeLabel}` : m.title}</span></div>
      {body}
    </section>
  )
}
