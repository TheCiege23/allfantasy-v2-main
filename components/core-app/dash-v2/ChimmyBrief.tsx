import { ChimmyAsk } from '@/components/core-app/dash-v2/ChimmyAsk'
import { Dash34Countdown, Dash34When } from '@/components/core-app/screens/Dashboard34Live'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Chimmy's brief — the hero card at the top of Dashboard v2.
 *
 * ⚠ NOTHING HERE COSTS A TOKEN. The card is rendered from `data.chimmyBrief`,
 * which `lib/core-app/dash34.ts` assembles out of reads it was already doing —
 * the ranked league list, the injury book, the fixture table. No model is called
 * during the dashboard render. That is the standing constraint on this screen:
 * PR #433 removed three per-league Anthropic call sites from the signed-in home
 * because they billed on every page view, and a brief written on load would put
 * the identical charge back on the identical screen with a friendlier name.
 * `ChimmyAsk` opens the panel; the user's first message is what spends.
 *
 * ⚠ THE DESIGN'S NUMBERS ARE MISSING BECAUSE THEY DO NOT EXIST, NOT BECAUSE THIS
 * IS UNFINISHED. Counted on production 2026-08-18: 0 of 893 `league_teams` rows
 * carry any result, 0 of 98 leagues have ever synced, and every `WeeklyMatchup`
 * row is season 2025 on league ids that do not join `leagues.id`. So "worth ~11
 * points", "you're 19 behind" and "78% to win" have no operand — not a missing
 * formula, a missing number. The one urgency claim that survived is when a
 * flagged player's club next kicks off, because 4,268 future fixtures are stored
 * and all 32 NFL clubs appear in one.
 *
 * ⚠ THE CARD RENDERS EVEN WHEN THE BRIEF HAS NO LINES. The headline then reads
 * "Nothing is waiting on you" and the caveat states what was and was not checked.
 * Hiding it in the quiet case would leave the reader unable to tell "looked, all
 * clear" from "not looking" — which is the same distinction the coverage list
 * exists to protect.
 */
export function ChimmyBrief({ data }: { data: Dash34Data | null }) {
  const brief = data?.chimmyBrief ?? null
  if (!brief) return null

  return (
    <section className="af-d2-brief" aria-label="Chimmy's brief">
      <div className="af-d2-brief-top">
        <span className="af-d2-brief-mark" aria-hidden>
          CH
        </span>
        <span className="af-d2-brief-label af-num">{brief.label}</span>

        {/*
          The countdown is the only live value on the card. It paints the server's
          string first and `Dash34Countdown` ticks from the ISO after hydration —
          rendering `Date.now()` during the first client pass is a mismatch, and
          this page has been taken down by one before. Omitted entirely when no
          fixture is scheduled, rather than showing a frozen zero.
        */}
        {brief.countdown ? (
          <span className="af-d2-brief-clock">
            <span className="af-d2-brief-clock-label af-num">
              {brief.countdown.label}
            </span>
            <span className="af-d2-brief-clock-value af-num">
              <Dash34Countdown
                to={brief.countdown.to}
                initial={brief.countdown.initial}
              />
            </span>
          </span>
        ) : null}
      </div>

      <h2 className="af-d2-brief-headline">{brief.headline}</h2>

      {brief.lines.length > 0 ? (
        <ul className="af-d2-brief-lines">
          {brief.lines.map((line) => (
            <li
              key={line.key}
              className={`af-d2-brief-line af-d2-brief-line--${line.tone ?? 'plain'}`}
            >
              <span className="af-d2-brief-dot" aria-hidden />
              <span className="af-d2-brief-text">
                {line.text}
                {/*
                  An instant the line ends with, localised after hydration. It is
                  a separate field rather than part of `text` because the server
                  has no way to know the reader's zone, and a kickoff shown in the
                  wrong one is the one value on this card someone acts on.
                */}
                {line.atIso ? (
                  <>
                    {' '}
                    <span className="af-d2-brief-at af-num">
                      <Dash34When iso={line.atIso} />
                    </span>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        What the brief did not read. Kept inside the card, not in a footnote
        elsewhere, because it qualifies the sentences directly above it.
      */}
      <p className="af-d2-brief-caveat">{brief.caveat}</p>

      <div className="af-d2-brief-actions">
        <ChimmyAsk label={brief.askLabel} />
        <a className="af-d2-brief-more af-num" href={brief.moreHref}>
          {brief.moreLabel} <span aria-hidden>→</span>
        </a>
      </div>
    </section>
  )
}

export default ChimmyBrief
