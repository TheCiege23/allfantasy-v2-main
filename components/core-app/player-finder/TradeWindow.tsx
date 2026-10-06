'use client'

import { useState } from 'react'
import Link from 'next/link'
import { HelpDot } from '@/components/core-app/player-finder/HelpDot'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { ManagerPresence } from '@/lib/core-app/managerPresence'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { movedToday, type PitchPackage } from '@/lib/core-app/tradePitch'
import { pitchLineText, pitchMessageText, tradeValueCopy, tradeValueReasonText } from '@/lib/core-app/finderTradeValueCopy'

/**
 * "TRADE WINDOW" — who to pitch for this player, and when they usually move.
 *
 * Every row is one manager: bold, who and their usual window; then what they
 * hold or need, the pitch, and whether now is the time. See managerPresence.ts
 * for what backs each phrase and what was deliberately left out ("online now"
 * has nothing behind it; the dot pulses only for a manager who moved today).
 *
 * Copy the pitch puts a message to the first manager on the clipboard. Grade it
 * jumps to the trade visual when it is on the screen, else to the Trade Center.
 *
 * Spanish (2026-10-05): the card's words, the line and the pitch come from finderTradeValueCopy.ts;
 * whether now is their window is still decided once, by `pitchLine`.
 */

export function TradeWindow({
  state,
  playerName,
  pkg,
  gradeHref,
  tradeCenterHref,
  nowIso,
}: {
  state: SectionState<ManagerPresence>
  playerName: string
  /** The trade visual's recommended package, when the screen has one. */
  pkg: PitchPackage
  /** In-page anchor to the trade visual, when it is rendered. */
  gradeHref: string | null
  tradeCenterHref: string
  /**
   * The server's clock, as an ISO string. Passed in rather than read here so
   * the "pitch now / not now" sentence hydrates to the same text it rendered.
   */
  nowIso: string
}) {
  const { language } = useOptionalLanguage()
  const t = tradeValueCopy(language)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const now = new Date(nowIso)

  if (!state.available) {
    return (
      <section className="af-card af-pf-tw af-pf-tw--empty" aria-labelledby="af-pf-tw-h">
        <header className="af-pf-tw-head">
          <span className="af-pf-tw-dot" aria-hidden />
          <h3 className="af-label af-pf-tw-title" id="af-pf-tw-h">
            {t.windowTitle}
          </h3>
        </header>
        <p className="af-pf-unavailable">{tradeValueReasonText(state.reason, language)}.</p>
      </section>
    )
  }

  const p = state.data
  const lines = p.managers.map((m) => ({ m, line: pitchLineText({ presence: p, manager: m, playerName, now, pkg }, language) }))
  const first = p.managers[0] ?? null
  const live = movedToday(p, now)

  async function copy() {
    if (!first) return
    const text = pitchMessageText({ manager: first, playerName, pkg }, language)
    try {
      await navigator.clipboard.writeText(text)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <section className="af-card af-pf-tw" aria-labelledby="af-pf-tw-h" data-live={live ? 'true' : 'false'} data-holder={p.holder}>
      <header className="af-pf-tw-head">
        <span className="af-pf-tw-dot" aria-hidden title={live ? t.movedTodayTitle : undefined} />
        <h3 className="af-label af-pf-tw-title" id="af-pf-tw-h">
          {t.windowTitle}
        </h3>
        <HelpDot title={t.windowHelpTitle} body={t.windowHelpBody(p.leagueName, p.zone)} />
      </header>

      {lines.length > 0 ? (
        <ul className="af-pf-tw-rows">
          {lines.map(({ m, line }) => (
            <li key={m.externalId} className="af-pf-tw-row" data-role={m.role} data-timing={line.timing}>
              <b className="af-pf-tw-lead">{line.lead}</b>
              <span className="af-pf-tw-body">{line.body}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="af-pf-unavailable">{p.holder === 'yours' ? t.yoursNoBuyer(p.player.position) : t.nobodyToPitch}</p>
      )}

      {!p.activityIngested ? (
        <p className="af-pf-tw-note">{t.noMovesIngested}</p>
      ) : p.unattributed > 0 ? (
        <p className="af-pf-tw-note">{t.unattributed(p.unattributed)}</p>
      ) : null}

      <div className="af-pf-tw-actions">
        <button type="button" className="af-btn af-pf-tw-btn" onClick={copy} disabled={!first}>
          {copied === 'done' ? t.copied : copied === 'failed' ? t.couldNotCopy : t.copyPitch}
        </button>
        {gradeHref ? (
          <a className="af-btn af-btn--ghost af-pf-tw-btn" href={gradeHref}>
            {t.gradeIt}
          </a>
        ) : (
          <Link className="af-btn af-btn--ghost af-pf-tw-btn" href={tradeCenterHref}>
            {t.gradeIt}
          </Link>
        )}
      </div>
    </section>
  )
}

export default TradeWindow
