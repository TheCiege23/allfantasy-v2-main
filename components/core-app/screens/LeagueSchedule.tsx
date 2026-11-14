'use client'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import LocalDateTime from '../LocalDateTime'
import TeamDeadlineAlertTarget from '../TeamDeadlineAlertTarget'
import { LeagueScoreboardPanel } from './LeagueScoreboardPanel'
import { PageHeader } from '@/components/core-app/primitives/PageHeader'
import { useMessages } from '@/components/i18n/useMessages'
import { scheduleGuideMessages } from '@/lib/core-app/messages/scheduleGuide'
import { scheduleHeadline, whatsNext, type NextItem, type ScheduleHeadline } from '@/lib/core-app/scheduleGuide'
import type { GameLeft } from '@/lib/core-app/remainingSchedule'
import '@/components/core-app/af-team-workspace.css'
import '@/components/core-app/af-league-home.css'
import '@/components/core-app/af-schedule-guide.css'

/**
 * A league's Schedule tab.
 *
 * ── 2026-11-13: ONE SENTENCE ABOUT THIS WEEK, AND ONE "WHAT'S NEXT" LIST ─────────────────────────────
 *
 * The owner's ask, for every /core page: users should know what the page is for and what to do. The
 * h1 now says this week's game ("Week 10 · you vs X — you lead 20.3 to 18.1"), or, with no head-to-head
 * game, the phase you are in and what comes next (lib/core-app/scheduleGuide.ts). The "League calendar"
 * placeholder and the raw "Season phases" list became one "What's next" list that says each phase in
 * weeks from now; the games list keeps the shared scoreboard panel under a compact week switcher.
 */
type Copy = typeof scheduleGuideMessages.en

function whenText(item: NextItem, m: Copy): string | null {
  if (item.away === 0) return m.thisWeek
  if (item.away === 1) return m.nextWeek
  if (item.away != null) return m.inWeeks(item.away)
  return null
}

function headlineText(h: ScheduleHeadline, m: Copy): string {
  if (h.kind === 'game') return m.headGame(h.week, h.opponent, h.you, h.them, h.started)
  if (h.kind === 'phase') {
    const next = h.next
    /* Before week 1 nothing is "in N weeks": a range reads as when it starts, a single week as that week. */
    const span = next?.span ?? null
    const when = next ? (whenText(next, m) ?? (span ? (span.end === span.start ? m.weeks(span.start, span.end) : m.startsWeek(span.start)) : null)) : null
    return m.headPhase(h.week, m.phase(h.label), next && when ? m.nextInline(m.phase(next.label), when) : null)
  }
  return m.headNone
}

export default function LeagueSchedule({
  data,
  gamesLeft = null,
}: {
  data: LeagueHomeData
  /** Your unplayed games after this week (lib/core-app/remainingSchedule.ts); null when it could not be read. */
  gamesLeft?: GameLeft[] | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const m = useMessages(scheduleGuideMessages)
  const selectWeek = (value: string | number) => {
    const next = new URLSearchParams(params?.toString())
    next.set('week', String(value))
    router.push(`${pathname}?${next}`, { scroll: false })
  }

  const leagueId = encodeURIComponent(data.league.id)
  const currentWeek = data.weekPicker?.current ?? data.league.currentWeek ?? null
  const items = whatsNext({
    timeline: data.timeline?.available ? data.timeline.data : null,
    calendar: data.calendar ?? null,
    currentWeek,
  })
  const matchup = data.matchup?.available ? data.matchup.data : null
  const headline = scheduleHeadline({ matchup, currentWeek, items })
  /*
   * 2026-11-13 follow-up: a schedule answers "who do I play the rest of the way?". The games left are the
   * regular season's — they stop where the playoffs start, when the timeline says where that is — and the
   * headline says how many and the next one. This week's score moves to one line under it.
   */
  const playoffStart = items.find((i) => i.label === 'Playoffs')?.span?.start ?? null
  const left = (gamesLeft ?? []).filter((g) => playoffStart == null || g.week < playoffStart)
  const nextGame = left[0] ?? null
  const title = nextGame
    ? m.headAhead(left.length, playoffStart != null, nextGame.week, nextGame.opponentName, nextGame.record)
    : headlineText(headline, m)

  const picker = data.weekPicker ?? null
  const weeks = picker?.weeks ?? []
  const at = picker ? weeks.indexOf(picker.selected) : -1
  const prev = at > 0 ? weeks[at - 1] : null
  const nextWk = at >= 0 && at < weeks.length - 1 ? weeks[at + 1] : null

  return (
    <div className="af-tw af-sg">
      <PageHeader
        className="af-tw-heading"
        eyebrow={m.eyebrow(data.league.name)}
        title={title}
        sub={m.intro}
        actions={<Link href={`/core/my-team?league=${leagueId}`}>Plan your roster</Link>}
      />
      <TeamDeadlineAlertTarget leagueId={data.league.id} events={data.calendar ?? []} query={params?.toString() ?? ''} />
      {nextGame && headline.kind === 'game' ? (
        <p className="af-sg-thisweek">{m.thisWeekScore(headline.week, headline.opponent, headline.you, headline.them, headline.started)}</p>
      ) : null}

      {/* ── Your games left: every regular-season opponent after this week, the tough ones marked ──── */}
      {left.length > 0 ? (
        <section className="af-tw-panel af-sg-left" aria-labelledby="af-sg-left-title" data-testid="schedule-games-left">
          <h2 id="af-sg-left-title">{m.gamesLeftTitle}</h2>
          <p className="af-sg-note">{m.gamesLeftSub(playoffStart != null)}</p>
          <ol className="af-sg-left-list">
            {left.map((g) => (
              <li key={`${g.week}-${g.opponentId}`} className="af-sg-left-row" data-tough={g.tough || undefined}>
                <span className="af-sg-left-week af-num">{m.gameLeftWeek(g.week)}</span>
                <span className="af-sg-left-opp">{g.opponentName}</span>
                <span className="af-sg-left-rec af-num">{m.gameLeftRecord(g.record)}</span>
                {g.tough ? (
                  <span className="af-sg-badge" data-tone="tough" title={m.toughTitle}>
                    {m.tough}
                  </span>
                ) : (
                  <span aria-hidden />
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}


      {/* ── What's next: the phase you are in, the ones to come, and any dated deadline ─────────── */}
      {items.length > 0 ? (
        <section className="af-tw-panel af-sg-next" aria-labelledby="af-sg-next-title">
          <h2 id="af-sg-next-title">{m.whatsNext}</h2>
          <ol className="af-sg-list">
            {items.map((item) => {
              const when = whenText(item, m)
              return (
                <li key={item.key} className="af-sg-item" data-state={item.state}>
                  <span className="af-sg-item-main">
                    <strong className="af-sg-label">{m.phase(item.label)}</strong>
                    <span className="af-sg-weeks">
                      {item.at ? (
                        <LocalDateTime value={item.at} />
                      ) : item.span ? (
                        m.weeks(item.span.start, item.span.end)
                      ) : (
                        item.whenText
                      )}
                      {item.teams != null ? ` · ${m.teamsIn(item.teams)}` : null}
                    </span>
                    {item.detail ? <span className="af-sg-detail">{m.phaseDetail(item.detail)}</span> : null}
                  </span>
                  {item.state === 'now' ? (
                    <span className="af-sg-badge" data-tone="now">
                      {m.now}
                    </span>
                  ) : when ? (
                    <span className="af-sg-badge">{when}</span>
                  ) : null}
                </li>
              )
            })}
          </ol>
          <nav className="af-tw-links af-sg-links">
            <Link href={`/core/waivers?league=${leagueId}`}>{m.rulesWaivers}</Link>
            <Link href={`/core/trades?league=${leagueId}`}>{m.rulesTrades}</Link>
          </nav>
        </section>
      ) : null}

      {/* ── This week's games: the shared scoreboard panel under a compact week switcher ───────────── */}
      <section className="af-tw-panel af-sg-games" aria-labelledby="af-sg-games-title">
        <div className="af-sg-games-head">
          <h2 id="af-sg-games-title">{m.games}</h2>
          {picker ? (
            <div className="af-sg-weeknav">
              <button type="button" className="af-sg-step" aria-label={m.prevWeek} disabled={prev == null} onClick={() => prev != null && selectWeek(prev)}>
                ‹
              </button>
              <label className="af-sg-select">
                <span className="af-sg-sr">{m.weekLabel}</span>
                <select value={picker.selected} onChange={(e) => selectWeek(e.target.value)}>
                  {weeks.map((week) => (
                    <option key={week} value={week}>
                      {m.weekLabel} {week}
                      {week === picker.current ? ` · ${m.current}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="af-sg-step" aria-label={m.nextWeekBtn} disabled={nextWk == null} onClick={() => nextWk != null && selectWeek(nextWk)}>
                ›
              </button>
            </div>
          ) : null}
        </div>
        {picker?.isFuture ? <p className="af-sg-note">{m.futureWeek(picker.selected)}</p> : null}
        {data.scoreboard.available ? (
          <>
            {headline.kind === 'game' ? <p className="af-sg-note">{m.yourGame}</p> : null}
            <LeagueScoreboardPanel board={data.scoreboard.data} />
          </>
        ) : (
          <p>{data.scoreboard.reason}</p>
        )}
      </section>
    </div>
  )
}
