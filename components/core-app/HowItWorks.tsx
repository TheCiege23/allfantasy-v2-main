'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import {
  HOW_IT_WORKS_GROUPS,
  LEAGUE_ONLY_GUIDES,
  screenGuide,
  screenGuideHref,
} from '@/lib/core-app/screenGuides'
import { OPEN_HOW_IT_WORKS_EVENT, screenGuideMessages } from '@/lib/core-app/messages/screenGuide'
import '@/components/core-app/screen-guide.css'

/**
 * "How AllFantasy works" (2026-11-20): every /core page in one list, in plain words, opened from
 * the top bar's "How it works" button or any screen's "How every page works".
 *
 * A native <dialog> so focus trapping, Escape and the backdrop come from the browser rather than
 * a fourth hand-rolled modal. It is a sheet, not a route: the catch-all under app/core already
 * carries every screen, and a guide does not need a URL of its own to be found — it needs to be
 * one tap away from wherever the reader got confused.
 *
 * League-only pages (My team, Matchup…) link with the selected league; with none selected they
 * say "Pick a league first" instead of linking to a screen that would only ask for one.
 */
export function HowItWorks({ leagueCount }: { leagueCount: number }) {
  const t = useMessages(screenGuideMessages)
  const { language } = useOptionalLanguage()
  const params = useSearchParams()
  const leagueId = params?.get('league') || null
  const ref = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const open = () => {
      const dialog = ref.current
      if (dialog && !dialog.open) dialog.showModal?.()
    }
    window.addEventListener(OPEN_HOW_IT_WORKS_EVENT, open)
    return () => window.removeEventListener(OPEN_HOW_IT_WORKS_EVENT, open)
  }, [])

  const close = () => ref.current?.close()
  const groupTitle = { week: t.groupWeek, league: t.groupLeague, all: t.groupAll }
  const groupSub = { week: t.groupWeekSub, league: t.groupLeagueSub, all: t.groupAllSub }

  return (
    <>
      <button
        type="button"
        className="af-hiw-trigger"
        data-testid="how-it-works-open"
        aria-label={t.howItWorksAria}
        onClick={() => ref.current?.showModal?.()}
      >
        <span aria-hidden>?</span>
        <span className="af-hiw-trigger-label">{t.howItWorks}</span>
      </button>
      <dialog
        ref={ref}
        className="af-hiw"
        aria-labelledby="af-hiw-title"
        data-testid="how-it-works"
        onClick={(event) => { if (event.target === ref.current) close() }}
      >
        <div className="af-hiw-body">
          <header className="af-hiw-head">
            <h2 id="af-hiw-title">{t.sheetTitle}</h2>
            <button type="button" className="af-hiw-close" aria-label={t.close} onClick={close}>×</button>
          </header>
          <p className="af-hiw-intro">{t.sheetIntro}</p>

          <section className="af-hiw-start" aria-labelledby="af-hiw-start-title">
            <h3 id="af-hiw-start-title">{t.startTitle}</h3>
            <ol>
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3}</li>
            </ol>
            {leagueCount === 0 ? (
              <Link className="af-hiw-cta" href="/import" onClick={close}>{t.importAction}</Link>
            ) : null}
          </section>

          {HOW_IT_WORKS_GROUPS.map((group) => (
            <section key={group.id} className="af-hiw-group" aria-labelledby={`af-hiw-${group.id}`}>
              <h3 id={`af-hiw-${group.id}`}>{groupTitle[group.id]}</h3>
              <p className="af-hiw-sub">{groupSub[group.id]}</p>
              <ul>
                {group.keys.map((key) => {
                  const guide = screenGuide(key, language)
                  const needsLeague = LEAGUE_ONLY_GUIDES.has(key) && !leagueId
                  return (
                    <li key={key} className="af-hiw-row">
                      <div>
                        <strong>{guide.name}</strong>
                        <span>{guide.what}</span>
                      </div>
                      {needsLeague ? (
                        <em className="af-hiw-needs">{t.pickLeagueFirst}</em>
                      ) : (
                        <Link href={screenGuideHref(key, leagueId)} onClick={close} prefetch={false}>
                          {t.open}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          <section className="af-hiw-chimmy">
            <h3>{t.chimmyTitle}</h3>
            <p>{t.chimmyBody}</p>
          </section>
          <p className="af-hiw-help">
            {t.helpLine} <Link href="/help" onClick={close}>{t.helpAction}</Link>
          </p>
        </div>
      </dialog>
    </>
  )
}
