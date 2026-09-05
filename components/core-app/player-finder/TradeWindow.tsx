'use client'

import { useState } from 'react'
import Link from 'next/link'
import { HelpDot } from '@/components/core-app/player-finder/HelpDot'
import type { ManagerPresence } from '@/lib/core-app/managerPresence'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { movedToday, pitchLine, pitchText, type PitchPackage } from '@/lib/core-app/tradePitch'

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
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const now = new Date(nowIso)

  if (!state.available) {
    return (
      <section className="af-card af-pf-tw af-pf-tw--empty" aria-labelledby="af-pf-tw-h">
        <header className="af-pf-tw-head">
          <span className="af-pf-tw-dot" aria-hidden />
          <h3 className="af-label af-pf-tw-title" id="af-pf-tw-h">
            Trade window · when they move
          </h3>
        </header>
        <p className="af-pf-unavailable">{state.reason}.</p>
      </section>
    )
  }

  const p = state.data
  const lines = p.managers.map((m) => ({ m, line: pitchLine({ presence: p, manager: m, playerName, now, pkg }) }))
  const first = p.managers[0] ?? null
  const live = movedToday(p, now)

  async function copy() {
    if (!first) return
    const text = pitchText({ manager: first, playerName, pkg })
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
        <span className="af-pf-tw-dot" aria-hidden title={live ? 'A listed manager moved in the last day' : undefined} />
        <h3 className="af-label af-pf-tw-title" id="af-pf-tw-h">
          Trade window · when they move
        </h3>
        <HelpDot
          title="Trade window"
          body={`When each manager usually makes their moves, read from ${p.leagueName}’s own transaction history — so you pitch while they are around instead of letting it sit. AllFantasy cannot see who is online; the window is when they have acted before, in the league’s zone (${p.zone}).`}
        />
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
        <p className="af-pf-unavailable">
          {p.holder === 'yours'
            ? `He is yours here, and no other roster could be read for a need at ${p.player.position ?? 'his position'}.`
            : 'Nobody to pitch.'}
        </p>
      )}

      {!p.activityIngested ? (
        <p className="af-pf-tw-note">
          No moves are ingested for this league yet, so there is no window — the need and record are real, the timing is not known.
        </p>
      ) : p.unattributed > 0 ? (
        <p className="af-pf-tw-note">
          {p.unattributed} move{p.unattributed === 1 ? '' : 's'} in this league could not be put to a name.
        </p>
      ) : null}

      <div className="af-pf-tw-actions">
        <button type="button" className="af-btn af-pf-tw-btn" onClick={copy} disabled={!first}>
          {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy the pitch'}
        </button>
        {gradeHref ? (
          <a className="af-btn af-btn--ghost af-pf-tw-btn" href={gradeHref}>
            Grade it
          </a>
        ) : (
          <Link className="af-btn af-btn--ghost af-pf-tw-btn" href={tradeCenterHref}>
            Grade it
          </Link>
        )}
      </div>
    </section>
  )
}

export default TradeWindow
