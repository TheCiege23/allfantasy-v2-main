'use client'

import { useState } from 'react'
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
 *
 * Guap, 2026-10-08: "I see every league listed when I only need the few leagues I have him on my
 * roster." A 65-league manager got 65 chips — 4 of them his. YOUR chips always show; once the rest
 * passes FOLD_AFTER they fold behind one toggle per group (available / taken / unreadable), so the
 * glance is the leagues that are yours and the rest is one tap away, not gone.
 */

/** Up to this many non-yours chips render inline; past it, each group folds behind its toggle. */
export const FOLD_AFTER = 6

const YOURS: ReadonlyArray<StripChip['state']> = ['start', 'bench', 'ir', 'taxi']
type Group = 'free' | 'other' | 'unknown'

export function LeagueStrip({ chips, leagueHref }: { chips: StripChip[]; leagueHref: (leagueId: string) => string }) {
  const { language } = useOptionalLanguage()
  const [open, setOpen] = useState<Group | null>(null)
  if (chips.length === 0) return null
  const t = stripCopy(language)
  const mine = chips.filter((c) => YOURS.includes(c.state))
  const byGroup = (g: Group) => chips.filter((c) => c.state === g)
  const fold = chips.length - mine.length > FOLD_AFTER

  const chip = (c: StripChip) => {
    const words = stripChipText(c, language)
    return (
      <li key={c.leagueId}>
        <Link href={leagueHref(c.leagueId)} className="af-pf-strip-chip" data-state={c.state} data-tone={c.tone} aria-label={words.sentence}>
          <span className="af-pf-strip-league">{c.leagueName}</span>
          <span className="af-pf-strip-badge af-num">{words.badge}</span>
        </Link>
      </li>
    )
  }

  const groups: Array<{ g: Group; label: string }> = [
    { g: 'free', label: t.foldFree(byGroup('free').length) },
    { g: 'other', label: t.foldOther(byGroup('other').length) },
    { g: 'unknown', label: t.foldUnknown(byGroup('unknown').length) },
  ]

  return (
    <div className="af-pf-strip" aria-label={t.label} data-folded={fold ? 'true' : undefined}>
      {fold ? (
        <>
          {mine.length > 0 ? <ul className="af-pf-strip-list">{mine.map(chip)}</ul> : <p className="af-pf-strip-none">{t.noneYours}</p>}
          <div className="af-pf-strip-folds" role="group" aria-label={t.foldLabel}>
            {groups
              .filter(({ g }) => byGroup(g).length > 0)
              .map(({ g, label }) => (
                <button
                  key={g}
                  type="button"
                  className="af-pf-strip-fold af-num"
                  data-group={g}
                  aria-expanded={open === g}
                  aria-controls={`af-pf-strip-${g}`}
                  onClick={() => setOpen(open === g ? null : g)}
                >
                  {label}
                  <span aria-hidden className="af-pf-strip-caret">
                    ▾
                  </span>
                </button>
              ))}
          </div>
          {open ? (
            <ul className="af-pf-strip-list af-pf-strip-list--more" id={`af-pf-strip-${open}`}>
              {byGroup(open).map(chip)}
            </ul>
          ) : null}
        </>
      ) : (
        <ul className="af-pf-strip-list">{chips.map(chip)}</ul>
      )}
      <p className="af-pf-strip-sum af-num">
        {t.summary(mine.length, byGroup('free').length, byGroup('other').length)}
        {byGroup('unknown').length > 0 ? t.unreadable(byGroup('unknown').length) : ''}{' '}
        {/* One key for every chip — the per-chip `title` it replaces never showed on a phone. */}
        <TopicTip topic="leagueStripLegend" />
      </p>
    </div>
  )
}
