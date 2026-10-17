'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { leagueViewActions } from '@/lib/core-app/leagueViewActions'
import { ActionLink } from '@/components/core-app/player-finder/ActionLink'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { reasonText } from '@/lib/core-app/playerFinderCopy'
import { leagueFormatText, tradeValueCopy, tradeValueReasonText } from '@/lib/core-app/finderTradeValueCopy'
import { viewActionsText } from '@/lib/core-app/finderSearchCopy'

/**
 * The league-scoped answer: in THIS league, is he yours, someone's, or free.
 *
 * Rendered above the cross-league table when a league is in context. It is a
 * promotion, not a filter — the table below still shows every league — but it
 * is the only place on the screen that names the manager who has him, which
 * is what a trade needs.
 *
 * ⚠ FOUR STATES, EACH SAID PLAINLY. "Free agent" is a claim about a league
 * whose rosters we read; a league with none imported gets the `unknown` reason
 * rather than a green "unrostered" that would send someone to claim a player
 * who is on a roster we never saw.
 *
 * Spanish (2026-10-05): finderTradeValueCopy.ts. The action buttons are `leagueViewActions`' — the
 * phone's sticky bar reads the same ones — so their labels go through the sticky bar's own
 * translator, finderSearchCopy.ts `viewActionsText`: one rule, one translation.
 */

function OwnerMark({ src, letter }: { src: string | null; letter: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className="af-pf-lv-avatar af-pf-lv-avatar--letter" aria-hidden>
        {letter}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="af-pf-lv-avatar" src={src} alt="" width={40} height={40} onError={() => setFailed(true)} />
  )
}

function slotTone(slot: string): 'good' | 'warn' | 'bad' | 'none' {
  if (slot === 'STARTER') return 'good'
  if (slot === 'IR SLOT') return 'warn'
  if (slot === 'BENCH' || slot === 'TAXI') return 'bad'
  return 'none'
}

export function LeagueOwnershipCard({
  view,
  playerName,
}: {
  view: PlayerLeagueView
  playerName: string
}) {
  const { language } = useOptionalLanguage()
  const t = tradeValueCopy(language)
  const actions = viewActionsText(view, leagueViewActions(view, playerName), playerName, language)
  const o = view.ownership

  return (
    <section className="af-card af-pf-lv" data-kind={o.kind} aria-labelledby="af-pf-lv-h">
      <header className="af-pf-lv-head">
        <span className="af-label">{t.inThisLeague}</span>
        <h3 className="af-pf-h3" id="af-pf-lv-h">
          <span className="af-platform af-platform-chip af-pfind-platform" data-platform={view.platform}>
            {view.platform}
          </span>
          <Link href={`/core?league=${encodeURIComponent(view.leagueId)}`} className="af-pf-lv-league">
            {view.leagueName}
          </Link>
          {view.format ? <span className="af-pf-lv-format">{leagueFormatText(view.format, language)}</span> : null}
        </h3>
      </header>

      <div className="af-pf-lv-body">
        {o.kind === 'yours' ? (
          <>
            <div className="af-pf-lv-who">
              <OwnerMark src={null} letter={t.youLetter} />
              <span className="af-pf-lv-who-text">
                <span className="af-pf-lv-who-name">{t.onYourRoster(o.teamName)}</span>
                <span className="af-pf-lv-who-meta">{t.thatsYou}</span>
              </span>
            </div>
            <span className="af-chip af-num af-pf-slot" data-tone={slotTone(o.slot)}>
              {t.slotChip(o.exactSlot ?? o.slot)}
            </span>
          </>
        ) : o.kind === 'other' ? (
          <>
            <div className="af-pf-lv-who">
              <OwnerMark
                src={o.owner?.avatarUrl ?? null}
                letter={(o.owner?.teamName ?? o.owner?.ownerName ?? '?').charAt(0).toUpperCase()}
              />
              <span className="af-pf-lv-who-text">
                <span className="af-pf-lv-who-name">
                  {o.owner ? o.owner.teamName : t.anotherManager}
                </span>
                <span className="af-pf-lv-who-meta">
                  {o.owner
                    ? [
                        o.owner.ownerName ? `@${o.owner.ownerName}` : null,
                        o.owner.record,
                        o.owner.isCommissioner ? t.commissioner : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : t.noTeamRow}
                </span>
              </span>
            </div>
            <span className="af-chip af-num af-pf-slot" data-tone="none" title={t.theirSlotTitle}>
              {o.slot === 'STARTER' ? t.theyStartHim : t.theirSlot(o.slot)}
            </span>
          </>
        ) : o.kind === 'free-agent' ? (
          <div className="af-pf-lv-who">
            <OwnerMark src={null} letter="+" />
            <span className="af-pf-lv-who-text">
              <span className="af-pf-lv-who-name">{t.unrosteredHere}</span>
              <span className="af-pf-lv-who-meta">{t.notOnAnyRosterHere(view.rosterCount)}</span>
            </span>
          </div>
        ) : (
          <p className="af-pf-unavailable">{tradeValueReasonText(o.reason, language)}</p>
        )}
      </div>

      <div className="af-pf-lv-foot">
        <span className="af-pf-lv-proj">
          {view.afPoints.available ? (
            <>
              <span className="af-pf-lv-proj-value af-num">{view.afPoints.data.points.toFixed(1)}</span>
              <span className="af-label">{t.projWeekScoring(view.afPoints.data.week)}</span>
            </>
          ) : (
            <span className="af-pf-tile-why">{reasonText(view.afPoints.reason, language)}</span>
          )}
        </span>

        {/* The same actions the phone's sticky bar shows (leagueViewActions.ts) — it hides while these are on screen. */}
        <span className="af-pf-lv-actions" id="af-pf-lv-actions">
          {actions.primary ? <ActionLink action={actions.primary} className="af-btn af-pf-lv-btn" /> : null}
          {actions.secondary ? <ActionLink action={actions.secondary} className="af-btn af-btn--ghost af-pf-lv-btn" /> : null}
        </span>
      </div>

      <p className="af-pf-readonly-note">{t.readOnly(platformLabel(view.platform))}</p>
    </section>
  )
}

export default LeagueOwnershipCard
