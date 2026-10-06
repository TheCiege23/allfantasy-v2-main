'use client'

import { useState } from 'react'
import Link from 'next/link'
import { HelpDot } from '@/components/core-app/player-finder/HelpDot'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { ManagerPresence } from '@/lib/core-app/managerPresence'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { type PitchPackage } from '@/lib/core-app/tradePitch'
import { anyMovedToday, rankTradeWindows } from '@/lib/core-app/tradeWindows'
import { pitchLineText, pitchMessageText, tradeValueCopy } from '@/lib/core-app/finderTradeValueCopy'

/**
 * "TRADE WINDOWS · WHO'S REACHABLE" — the core view's card: every league
 * where someone else has him, one row per owner, the most reachable first.
 *
 * Same row grammar as the single-league card (bold who-and-when, then the
 * pitch and the timing), with the league named above each row and a Grade it
 * per row, since each one is a different Trade Center. The dot pulses only
 * when a listed owner moved in the last day — never "online" (see
 * managerPresence.ts for what backs each phrase).
 *
 * Every row shows on a phone: the single card keeps one line there because
 * it is one league; here the list IS the answer.
 *
 * Spanish (2026-10-05): the order is `rankTradeWindows`' in both languages; only the words change,
 * through finderTradeValueCopy.ts.
 */

export function TradeWindows({
  presences,
  playerName,
  pkg,
  nowIso,
  /** Leagues where he is someone else's but the presence could not be loaded. */
  unread = 0,
}: {
  presences: ManagerPresence[]
  playerName: string
  pkg: PitchPackage
  nowIso: string
  unread?: number
}) {
  const { language } = useOptionalLanguage()
  const t = tradeValueCopy(language)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const now = new Date(nowIso)
  const rows = rankTradeWindows({ presences, playerName, now, pkg }).map((r) => ({
    ...r,
    line: pitchLineText({ presence: r.presence, manager: r.manager, playerName, now, pkg }, language),
  }))
  const first = rows[0] ?? null
  const live = anyMovedToday(rows, now)
  const reachableNow = rows.filter((r) => r.line.timing === 'now').length

  async function copy() {
    if (!first) return
    try {
      await navigator.clipboard.writeText(pitchMessageText({ manager: first.manager, playerName, pkg }, language))
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }

  if (rows.length === 0) return null

  return (
    <section className="af-card af-pf-tw af-pf-tw--multi" aria-labelledby="af-pf-tws-h" data-live={live ? 'true' : 'false'}>
      <header className="af-pf-tw-head">
        <span className="af-pf-tw-dot" aria-hidden title={live ? t.movedTodayTitle : undefined} />
        <h3 className="af-label af-pf-tw-title" id="af-pf-tws-h">
          {t.windowsTitle}
        </h3>
        <HelpDot title={t.windowsHelpTitle} body={t.windowsHelpBody} />
      </header>

      <p className="af-pf-tw-sum">{reachableNow > 0 ? t.inWindowNow(reachableNow, rows.length) : t.soonestFirst(rows.length)}</p>

      <ul className="af-pf-tw-rows">
        {rows.map((r) => (
          <li key={r.leagueId} className="af-pf-tw-row" data-role="owner" data-timing={r.line.timing}>
            <span className="af-label af-pf-tw-league">
              {r.leagueName} · {platformLabel(r.platform)}
            </span>
            <b className="af-pf-tw-lead">{r.line.lead}</b>
            <span className="af-pf-tw-body">{r.line.body}</span>
            <Link className="af-pf-tw-go" href={`/core/trades?league=${encodeURIComponent(r.leagueId)}`}>
              {t.gradeItIn(r.leagueName)}
            </Link>
          </li>
        ))}
      </ul>

      {unread > 0 ? <p className="af-pf-tw-note">{t.unreadLeagues(unread)}</p> : null}

      <div className="af-pf-tw-actions">
        <button type="button" className="af-btn af-pf-tw-btn" onClick={copy} disabled={!first}>
          {copied === 'done' ? t.copied : copied === 'failed' ? t.couldNotCopy : first ? t.copyPitchTo(first.manager.ownerName) : t.copyPitch}
        </button>
      </div>
    </section>
  )
}

export default TradeWindows
