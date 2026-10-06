'use client'

import Link from 'next/link'

import type { StripChip } from '@/lib/core-app/leagueStrip'
import { TopicTip } from '@/components/core-app/TopicTip'
import { stripChipText, stripCopy } from '@/lib/core-app/finderSearchCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * One chip per league you play, under the player's name — START / BENCH / IR / TAXI where he is
 * yours, the other team's name where he is not, FA where nobody has him, "?" where we cannot read
 * the league (lib/core-app/leagueStrip.ts). The table below says the same in rows; this is the
 * glance.
 *
 * Each chip opens the card scoped to that league (`?league=`), where the ownership card, the
 * trade visual and the league's own call are.
 *
 * Spanish (2026-10-05): badges, sentences and the tally are built at render from the chip's parts
 * (finderSearchCopy.ts `stripChipText`), in the language `useOptionalLanguage` gives.
 */
export function LeagueStrip({ chips, leagueHref }: { chips: StripChip[]; leagueHref: (leagueId: string) => string }) {
  const { language } = useOptionalLanguage()
  if (chips.length === 0) return null
  const t = stripCopy(language)
  const count = (state: StripChip['state']) => chips.filter((c) => c.state === state).length
  const yours = chips.filter((c) => c.state === 'start' || c.state === 'bench' || c.state === 'ir' || c.state === 'taxi').length
  const free = count('free')
  return (
    <div className="af-pf-strip" aria-label={t.label}>
      <ul className="af-pf-strip-list">
        {chips.map((c) => {
          const words = stripChipText(c, language)
          return (
            <li key={c.leagueId}>
              <Link
                href={leagueHref(c.leagueId)}
                className="af-pf-strip-chip"
                data-state={c.state}
                data-tone={c.tone}
                aria-label={words.sentence}
              >
                <span className="af-pf-strip-league">{c.leagueName}</span>
                <span className="af-pf-strip-badge af-num">{words.badge}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="af-pf-strip-sum af-num">
        {t.summary(yours, free, count('other'))}
        {count('unknown') > 0 ? t.unreadable(count('unknown')) : ''}{' '}
        {/* One key for every chip — the per-chip `title` it replaces never showed on a phone. */}
        <TopicTip topic="leagueStripLegend" />
      </p>
    </div>
  )
}
