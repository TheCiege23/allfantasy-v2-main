import { formatRecord, type BoardTeam, type StandingsBoard } from '@/lib/core-app/standingsModel'
import {
  LUCK_FLOOR,
  currentStreak,
  leagueAwards,
  streakLabel,
  yourHeadToHead,
  type Award,
} from '@/lib/core-app/standingsHighlights'

/**
 * The per-league Standings screen's headline layer (2026-10-01): your season in one banner, the league's
 * awards, and your record against everyone you have played. Everything here is read off `StandingsBoard`
 * by `lib/core-app/standingsHighlights.ts` — a selection from the table, never a second set of numbers.
 *
 * No hooks, so these render on the server with the rest of the screen.
 */

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/**
 * Your seat, drawn: one pip per team in table order, the bye and playoff seeds shaded, a gap at the
 * line, and yours lit. "6th of 12" is a number; the track shows how far inside the line 6th is.
 */
export function SeasonBanner({ board, me, headline }: { board: StandingsBoard; me: BoardTeam; headline: string }) {
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  const byes = Math.min(board.rules.byes, field)
  const streak = board.hasHeadToHead ? currentStreak(me.form) : null
  const gap = me.seed - me.powerRank
  return (
    <section className="af-st-banner" data-zone={me.clinched ? 'clinched' : me.zone} aria-label="Your season">
      <div className="af-st-banner-top">
        <span className="af-st-banner-seed af-num" aria-hidden>
          {ordinal(me.seed)}
        </span>
        <div className="af-st-banner-text">
          <p className="af-st-banner-line">{headline}</p>
          <p className="af-st-banner-chips">
            {streak && streak.n >= 2 && streak.kind !== 'T' ? (
              <span className="af-st-chip" data-tone={streak.kind === 'W' ? 'good' : 'bad'}>
                {streak.kind === 'W' ? `🔥 Won ${streak.n >= 5 ? '5+' : streak.n} straight` : `Lost ${streak.n >= 5 ? '5+' : streak.n} straight`}
              </span>
            ) : null}
            {board.hasHeadToHead && Math.abs(me.luck) >= LUCK_FLOOR ? (
              <span className="af-st-chip" data-tone={me.luck > 0 ? 'warn' : 'bad'}>
                {me.luck > 0
                  ? `Lucky: ${me.luck.toFixed(1)} wins more than your scoring earned`
                  : `Unlucky: ${Math.abs(me.luck).toFixed(1)} wins fewer than your scoring earned`}
              </span>
            ) : null}
            {gap >= 2 ? (
              <span className="af-st-chip" data-tone="accent">
                AF Power has you {ordinal(me.powerRank)} — better than your record
              </span>
            ) : gap <= -2 ? (
              <span className="af-st-chip" data-tone="info">
                AF Power has you {ordinal(me.powerRank)} — your record is ahead of your scoring
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="af-st-track-wrap">
        <ol
          className="af-st-track"
          aria-label={`Table order: you are ${ordinal(me.seed)} of ${board.teams.length}; the top ${field} make the playoffs`}
        >
          {board.teams.map((t) => (
            <li
              key={t.rosterId}
              className="af-st-pip"
              title={`${t.seed}. ${t.name}${board.hasHeadToHead ? ` · ${formatRecord(t.record)}` : ''}`}
              data-field={t.seed <= field || undefined}
              data-bye={t.seed <= byes || undefined}
              data-cut={t.seed === field && field < board.teams.length ? true : undefined}
              data-you={t.isYou || undefined}
            >
              <span className="af-sr">
                {t.seed}. {t.name}
                {t.isYou ? ' (you)' : ''}
              </span>
            </li>
          ))}
        </ol>
        <div className="af-st-track-key" aria-hidden>
          <span>1st</span>
          <span>
            Playoffs: top {field}
            {byes > 0 ? ` · byes: top ${byes}` : ''}
          </span>
          <span>{ordinal(board.teams.length)}</span>
        </div>
      </div>
    </section>
  )
}

export function LeagueAwards({ board }: { board: StandingsBoard }) {
  const awards = leagueAwards(board)
  if (awards.length === 0) return null
  return (
    <section className="af-st-awards" aria-labelledby="af-st-awards-title">
      <h2 id="af-st-awards-title" className="af-label af-st-seclabel">
        League awards
      </h2>
      <ul className="af-st-awards-row">
        {awards.map((a) => (
          <AwardCard key={a.key} award={a} />
        ))}
      </ul>
    </section>
  )
}

function AwardCard({ award: a }: { award: Award }) {
  return (
    <li className="af-st-award" data-tone={a.tone} data-you={a.isYou ? 'true' : undefined}>
      <span className="af-st-award-k">{a.label}</span>
      <span className="af-st-award-v af-num">{a.stat}</span>
      <span className="af-st-award-team">
        {a.team}
        {a.isYou ? <span className="af-stb-you">You</span> : null}
      </span>
      <span className="af-st-award-d">{a.detail}</span>
    </li>
  )
}

export function YourHeadToHead({ board }: { board: StandingsBoard }) {
  const h2h = yourHeadToHead(board)
  if (!h2h) return null
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  return (
    <section className="af-st-section" aria-labelledby="af-st-h2h-title">
      <h2 id="af-st-h2h-title" className="af-label af-st-seclabel">
        Your head-to-head
      </h2>
      <div className="af-st-panel">
        {h2h.vsField ? (
          <p className="af-st-h2h-sum">
            <span className="af-num">{formatRecord(h2h.vsField)}</span> against teams in the top {field} today.
          </p>
        ) : null}
        <ul className="af-st-h2h">
          {h2h.cells.map((c) => (
            <li key={c.rosterId} data-verdict={c.verdict}>
              <span className="af-st-h2h-seed af-num">{c.seed}</span>
              <span className="af-st-h2h-name">{c.name}</span>
              <span className="af-st-h2h-rec af-num">
                <span className="af-sr">{c.verdict === 'W' ? 'you lead' : c.verdict === 'L' ? 'you trail' : 'level'} </span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
