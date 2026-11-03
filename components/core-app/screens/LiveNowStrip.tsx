'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreLocale } from '@/lib/core-app/messages/coreLocale'
import { liveScoresMessages } from '@/lib/core-app/messages/liveScores'
import { liveScoresCopy as lsc } from '@/lib/core-app/liveScoresCopy'
import { messagesFor } from '@/lib/i18n/messages'
import { liveGameAnchor, type SlateChip, type SlateStrip } from '@/lib/live/liveSlateStrip'

/**
 * The top of Live Scores on the redraft design board (LiveScores.dc.html): a dark "now" strip — the
 * time, how many games are live / final / still to come, and how many of your starters are on the
 * field — and a scrollable strip of every game on the slate with how many of YOUR starters are in it.
 * Each chip jumps to that game's card below.
 *
 * ⚠ READ FROM THE SLATE THE SCREEN ALREADY HOLDS (`liveSlateStrip`), so it can never disagree with the
 * cards under it. The starters figure is shown only when the screen has roster data: with none, "0 of
 * your starters" would be a claim about players we never read.
 *
 * Shown under the redraft stamp only (af-core-redraft-live.css); every other league renders as before.
 */
export function LiveNowStrip({
  strip,
  now,
  sportLabel,
  hasRosterData,
  liveOnly,
  onLiveOnly,
}: {
  strip: SlateStrip
  /** Client clock; null until mount, so the server never renders a time the browser would contradict. */
  now: number | null
  sportLabel: string
  hasRosterData: boolean
  liveOnly: boolean
  onLiveOnly: (next: boolean) => void
}) {
  const { language } = useOptionalLanguage()
  const m = messagesFor(liveScoresMessages, language)
  const clock =
    now == null
      ? null
      : new Intl.DateTimeFormat(coreLocale(language).usLocale, { hour: 'numeric', minute: '2-digit' }).format(new Date(now))
  return (
    <div className="af-live-now-wrap">
      <section className="af-live-now" data-live={strip.live > 0} aria-label={lsc('Right now', language)}>
        <span className="af-live-now-main">
          {strip.live > 0 ? <span className="af-live-now-dot" aria-hidden /> : null}
          {clock ? <span className="af-live-now-clock af-num">{clock}</span> : null}
          <span className="af-live-now-counts af-num">{m.nowCounts(strip.live, strip.final, strip.upcoming)}</span>
        </span>
        {hasRosterData ? <span className="af-live-now-starters af-num">{m.nowStarters(strip.startersLive)}</span> : null}
      </section>

      {strip.chips.length > 0 ? (
        <section className="af-live-chips" aria-label={m.slateGamesHead(sportLabel)}>
          <div className="af-live-chips-head">
            <h2 className="af-live-chips-title">{m.slateGamesHead(sportLabel)}</h2>
            <button
              type="button"
              className="af-live-chips-filter"
              aria-pressed={liveOnly}
              disabled={strip.live === 0 && !liveOnly}
              onClick={() => onLiveOnly(!liveOnly)}
            >
              {lsc('Live now', language)}
              <span className="af-live-chips-filter-n af-num">{strip.live}</span>
            </button>
          </div>
          <ul className="af-live-chips-list">
            {strip.chips.map((chip) => (
              <li key={chip.gameId}>
                <GameChip chip={chip} hasRosterData={hasRosterData} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function GameChip({ chip, hasRosterData }: { chip: SlateChip; hasRosterData: boolean }) {
  const { language } = useOptionalLanguage()
  const m = messagesFor(liveScoresMessages, language)
  const status = chip.label ?? (chip.stage === 'final' ? lsc('Final', language) : chip.stage === 'live' ? lsc('LIVE', language) : '')
  const scored = chip.stage !== 'upcoming'
  return (
    <a className="af-live-chip" href={`#${liveGameAnchor(chip.gameId)}`} data-stage={chip.stage} data-yours={chip.yours.length > 0}>
      <span className="af-live-chip-status af-num">{status}</span>
      <span className="af-live-chip-team">
        <span>{chip.away.abbrev}</span>
        {scored ? <span className="af-num">{chip.away.score ?? '—'}</span> : null}
      </span>
      <span className="af-live-chip-team">
        <span>{chip.home.abbrev}</span>
        {scored ? <span className="af-num">{chip.home.score ?? '—'}</span> : null}
      </span>
      {hasRosterData && chip.yours.length > 0 ? (
        <span className="af-live-chip-yours" title={m.chipYoursNames(chip.yours.join(', '))}>
          {m.chipYours(chip.yours.length)}
        </span>
      ) : null}
    </a>
  )
}

export default LiveNowStrip
