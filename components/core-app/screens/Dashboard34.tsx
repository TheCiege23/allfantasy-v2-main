import Link from 'next/link'
import { Dash34Countdown, Dash34Time } from './Dashboard34Live'
import '@/components/core-app/af-dash34.css'

/**
 * Dashboard 34a — the post-sign-in home, desktop (1360×1080) and mobile (390×844).
 *
 * ⚠ THIS IS THE VISUAL LAYER ONLY. It renders from `Dash34Data` and reads
 * nothing itself, so the loader can be built and swapped without touching a
 * single style. Every field on that type is optional or nullable for one
 * reason: most of what this screen shows does not exist in the data yet — live
 * scores, projections, exposure deltas, league chatter and the 24-hour deadline
 * feed all need work that has not happened, and sync has never run for any
 * imported league. A card with nothing behind it is omitted or states why;
 * nothing is filled with the mock's numbers.
 *
 * ⚠ ROWS RESERVE THEIR HEIGHT. The handoff sets CLS 0.02 with live scores
 * streaming into the list, so `.af-d34-row` carries a min-height and the score
 * and projection cells are fixed-width with tabular figures. A score arriving
 * must never reflow the rows beneath it.
 *
 * ⚠ THE ASSISTANT IS CHIMMY. The 34a README says "Ask Chimmy Intelligence" and
 * "Chimmy tokens" throughout; the "Ask AO" buttons in the older screenshot are
 * stale. It is also the only thing that spends tokens, which is why the meter
 * belongs in the chrome and not here.
 *
 * The 76px rail and 62px top bar belong to AfCoreShell and are not re-rendered.
 */

export type Dash34Platform = 'sleeper' | 'espn' | 'yahoo' | 'allfantasy' | string

export type Dash34StateChip = {
  label: string
  tone?: 'bad' | 'warn' | 'good' | 'live' | null
}

export type Dash34League = {
  id: string
  name: string
  platform: Dash34Platform
  /** Platform league avatar; falls back to initials. */
  imageUrl?: string | null
  /** "2026 12-Team Dynasty PPR" */
  formatLabel?: string | null
  /** League sport (NFL / NBA / NHL …). Carried so a sport filter can be real
   *  rather than decorative — the loader already selects it. */
  sport?: string | null
  /** Your handle IN THAT LEAGUE — per-league identity, not the AF account name. */
  usernameInLeague?: string | null
  chips?: Dash34StateChip[]
  /** Null until live scoring exists for this league. */
  score?: { you: number; opponent: number; opponentName: string } | null
  /** Kickoff/opponent line shown when there is no live score yet. */
  matchupNote?: string | null
  /** AF projection in that league's own scoring. `unit` carries "final proj",
   *  "cats won", "Chimmy pick" — the handoff switches it by league type. */
  projection?: { value: string; unit: string } | null
  /** Drives the accent fill on the action and the row border. */
  priority?: 'urgent' | 'draft' | null
  href: string
  actionLabel?: string
}

export type Dash34Data = {
  firstLock?: {
    /** Pre-formatted "1:04:12" — the server's paint, and the ticker's starting value. */
    countdown: string
    /** ISO target. When set, `Dash34Countdown` ticks from it after hydration. */
    countdownTo?: string | null
    /**
     * What the countdown is counting to.
     *
     * ⚠ NOT ALWAYS "FIRST LOCK". A lineup lock is a per-league rule we hold for no
     * league, so the loader labels this "FIRST KICKOFF" — a real deadline, and a
     * different claim from the one the handoff's mock makes.
     */
    countdownLabel?: string | null
    kickoffLabel: string
    headline: string
    slots: Array<{ key?: string | null; label: string; tone?: 'bad' | 'warn' | null }>
    openHref: string
    openLabel: string
  } | null
  today?: { wins: number; losses: number; health?: { score: number; label: string } | null } | null
  /** `time` is an ISO timestamp; `Dash34Time` localises it after hydration. */
  next24?: Array<{ text: string; time: string; tone?: 'warn' | 'accent' | null }> | null
  leagues: Dash34League[]
  /** Uncapped ranked list for the v2 left panel. `leagues` above stays capped. */
  allLeagues?: Dash34League[]
  /** Leagues with nothing needing attention, collapsed to the footnote row. */
  quiet?: { count: number; sample?: string | null } | null
  /**
   * Leagues that DO need attention but did not fit the cap.
   *
   * ⚠ NOT THE SAME NUMBER AS `quiet`, AND THEY WERE ADDED TOGETHER ONCE. That
   * printed "53 leagues are quiet — nothing needs you" over an account where
   * nearly all 53 had a flagged starter. An overflowed league is hidden by a list
   * limit; a quiet one has been looked at and cleared.
   */
  overflow?: number
  totalLeagues: number
  brief?: { title: string; headline: string; body: string; time?: string | null; avatarUrl?: string | null } | null
  book?: Array<{
    initials: string
    name: string
    /** Player headshot when SportsPlayer carries one. */
    imageUrl?: string | null
    /** The leagues carrying this player — names an exposure count cannot. */
    leagues?: Array<{ id: string; name: string; platform: string; imageUrl: string | null }>
    note: string
    /** Human form, e.g. "7 of 61". */
    exposure?: string | null
    /** Same fact as numbers, so a share bar does not parse the string above. */
    exposureCount?: number | null
    exposureTotal?: number | null
    tone?: 'bad' | 'warn' | null
  }> | null
  chatUnread?: number
  /**
   * One account-wide fact stated once, above the list.
   *
   * ⚠ THIS IS THE 604-ROW FIX. The old home derived one "League data is stale"
   * issue per league and rendered 604 of them for a real account — the same
   * sentence, 604 times, burying everything that actually needed a decision.
   * "Sync has never run" is one fact about the connection, not N facts about N
   * leagues, so it is said once and carries the action the rows carried.
   */
  notice?: { title: string; body: string; href?: string | null; label?: string | null } | null
  /**
   * What this screen is NOT watching.
   *
   * Carried over from the old home deliberately. A dashboard with no warnings on
   * it reads as "everything is fine", which is only true if everything is being
   * checked — and most of this is not. Naming the gaps is what stops a quiet
   * screen from being a lie.
   */
  coverage?: Array<{ label: string; reason: string }> | null
  /**
   * AF Legacy board rows kept out of the list — historical season snapshots from
   * the career import, not leagues you play. Stated, never silently dropped.
   */
  legacyCount?: number
}

/*
 * ⚠ EVERY ONE OF THESE POINTS AT A SCREEN THAT EXISTS. Rankings and Commissioner
 * HQ used to point at `/core/rankings` and `/core/commissioner`, which are listed
 * in the route's SCREEN_KEYS but render the "not built yet" apology — a nav link
 * whose only job is to say sorry. They go to `/rankings` and `/commissioner-os`,
 * which are real, even though both leave the /core shell.
 *
 * Trade lab and Waiver plan are league-scoped: without a `?league=` they land on
 * a screen that asks which league, which is honest but is a wasted click, so the
 * loader's league context is threaded through when there is one.
 */
const TOOLS: ReadonlyArray<{ href: string; glyph: string; name: string; leagueScoped?: boolean }> = [
  { href: '/core/players', glyph: '●', name: 'Player finder' },
  { href: '/core/trades', glyph: '⇄', name: 'Trade lab', leagueScoped: true },
  { href: '/core/waivers', glyph: '◷', name: 'Waiver plan', leagueScoped: true },
  { href: '/rankings', glyph: '↑', name: 'Rankings' },
  { href: '/core/career', glyph: '★', name: 'Career & Legacy' },
  { href: '/commissioner-os', glyph: '⚑', name: 'Commissioner HQ' },
]

/** Chimmy's chat surface. `/chimmy` is the marketing page, not the assistant. */
const CHIMMY_HREF = '/chimmy/chat'

function toolHref(t: { href: string; leagueScoped?: boolean }, leagueId: string | null): string {
  if (!t.leagueScoped || !leagueId) return t.href
  return `${t.href}?league=${encodeURIComponent(leagueId)}`
}

/**
 * League initials for the avatar fallback.
 *
 * ⚠ THIS BROKE HYDRATION, NOT JUST THE GLYPH. Real league names start with emoji
 * — "🪓 Elimination Station 2", "$20 Pirate League". The first cut did
 * `parts[0][0]`, which is a UTF-16 code UNIT, so it cut "🪓" in half and emitted a
 * lone surrogate. The server and the client serialise that differently, React saw
 * "E" against "�E", and the mismatch took down hydration for the whole
 * document — "the server HTML was replaced with client content". A cosmetic-looking
 * string bug that cost the entire page its server render.
 *
 * So: iterate CODE POINTS, and prefer letters and digits, which is what a monogram
 * is for. A name with nothing alphanumeric in it keeps its first whole code point
 * rather than falling back to "??" — an emoji tile is a better handle than a shrug.
 */
const ALNUM = /[\p{L}\p{N}]/u

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '??'

  const words = trimmed.split(/\s+/).filter(Boolean)
  const firstAlnum = words
    .map((w) => Array.from(w).find((ch) => ALNUM.test(ch)))
    .filter((ch): ch is string => Boolean(ch))

  if (firstAlnum.length >= 2) return (firstAlnum[0] + firstAlnum[1]).toUpperCase()

  if (firstAlnum.length === 1) {
    const word = words.find((w) => Array.from(w).some((ch) => ALNUM.test(ch))) ?? ''
    const chars = Array.from(word).filter((ch) => ALNUM.test(ch))
    return chars.slice(0, 2).join('').toUpperCase()
  }

  return Array.from(trimmed)[0] ?? '??'
}

function LeagueTile({ l }: { l: Dash34League }) {
  return (
    <span className="af-d34-tile" data-platform={l.platform} aria-hidden="true">
      {l.imageUrl ? <img src={l.imageUrl} alt="" /> : initials(l.name)}
    </span>
  )
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

function priorityAttr(p: Dash34League['priority']): string | undefined {
  if (p === 'urgent') return 'true'
  if (p === 'draft') return 'draft'
  return undefined
}

/* ── Desktop ─────────────────────────────────────────────────────────────── */

function Desktop({ data, leagueId }: { data: Dash34Data; leagueId: string | null }) {
  const { firstLock, today, next24, leagues, quiet, brief, book, notice, coverage } = data

  return (
    <div className="af-d34">
      <div className="af-d34-main">
        {/* First-lock band — the single most time-critical thing. */}
        {firstLock ? (
          <section className="af-d34-lock" aria-label="Most urgent">
            <div className="af-d34-lockcard">
              <div className="af-d34-count">
                <span className="af-d34-count-l">{firstLock.countdownLabel ?? 'FIRST LOCK'}</span>
                <span className="af-d34-count-v">
                  {firstLock.countdownTo ? (
                    <Dash34Countdown to={firstLock.countdownTo} initial={firstLock.countdown} />
                  ) : (
                    firstLock.countdown
                  )}
                </span>
                <span className="af-d34-count-sub">{firstLock.kickoffLabel}</span>
              </div>
              <span className="af-d34-lockrule" aria-hidden="true" />
              <div className="af-d34-lockbody">
                <div className="af-d34-lockhead">
                  <h2 className="af-d34-lockh">{firstLock.headline}</h2>
                </div>
                {firstLock.slots.length ? (
                  <div className="af-d34-slots">
                    {firstLock.slots.map((s) => (
                      <span key={`${s.key ?? ''}${s.label}`} className="af-d34-slot" data-tone={s.tone ?? undefined}>
                        {s.key ? <span className="af-d34-slot-k">{s.key}</span> : null}
                        {s.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="af-d34-lockcta">
                {/*
                  ⚠ `target="_blank"` ONLY WHEN THE LINK ACTUALLY LEAVES. The handoff's
                  CTA opens Sleeper, but the loader points this at an AF screen
                  whenever it has no platform deep link — and opening our own page
                  in a new tab, with an "↗" claiming it left, is a small lie the
                  reader notices immediately.
                */}
                <Link
                  className="af-d34-open"
                  href={firstLock.openHref}
                  {...(isExternal(firstLock.openHref)
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                >
                  {firstLock.openLabel}
                  {isExternal(firstLock.openHref) ? ' ↗' : ''}
                </Link>
                {/* AF is read-only. The promise belongs under a CTA that leaves. */}
                {isExternal(firstLock.openHref) ? (
                  <p className="af-d34-ro">AF reads your league. Lineups change on the platform.</p>
                ) : null}
              </div>
            </div>

            <div className="af-d34-bandside">
              {today ? (
                <div className="af-d34-card">
                  <div className="af-d34-cardhead">
                    <span>TODAY&apos;S RECORD</span>
                    {today.health ? <span>HEALTH</span> : null}
                  </div>
                  <div className="af-d34-recrow">
                    <span className="af-d34-rec">
                      <b>{today.wins}</b> – <i>{today.losses}</i>
                    </span>
                    <span className="af-d34-rec-l">live</span>
                    {today.health ? (
                      <>
                        <span className="af-d34-health">{today.health.score}</span>
                        <span className="af-d34-health-l">{today.health.label.toUpperCase()}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {next24 && next24.length ? (
                <div className="af-d34-card">
                  <div className="af-d34-cardhead"><span>NEXT 24 HOURS</span></div>
                  <div className="af-d34-feed">
                    {next24.map((n, i) => (
                      <div className="af-d34-feedrow" key={`${n.time}-${i}`}>
                        <span className="af-d34-feeddot" data-tone={n.tone ?? undefined} />
                        <span className="af-d34-feedtxt">{n.text}</span>
                        <span className="af-d34-feedtime">
                          <Dash34Time iso={n.time} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Your leagues — the primary list. */}
        <section aria-label="Your leagues">
          <div className="af-d34-lhead">
            <h1 className="af-d34-h1">Your leagues</h1>
            <span className="af-d34-lsub">
              {data.totalLeagues} {data.totalLeagues === 1 ? 'league' : 'leagues'} · sorted by what needs you first.
            </span>
            <Link className="af-d34-llink" href="/core/portfolio">Portfolio view →</Link>
          </div>

          {notice ? (
            <div className="af-d34-notice" role="status">
              <div className="af-d34-notice-b">
                <strong className="af-d34-notice-t">{notice.title}</strong>
                <p className="af-d34-notice-p">{notice.body}</p>
              </div>
              {notice.href ? (
                <Link className="af-d34-jumpbtn" href={notice.href}>{notice.label ?? 'Fix this'}</Link>
              ) : null}
            </div>
          ) : null}

          <div className="af-d34-cols" aria-hidden="true">
            <span>LEAGUE</span><span>MATCHUP</span><span>AF PROJ</span><span />
          </div>

          <div className="af-d34-rows">
            {leagues.map((l) => (
              <article className="af-d34-row" key={l.id} data-priority={priorityAttr(l.priority)}>
                <div className="af-d34-lg">
                  <LeagueTile l={l} />
                  <div className="af-d34-lgbody">
                    <div className="af-d34-lgtop">
                      <h3 className="af-d34-lgname">{l.name}</h3>
                      {(l.chips ?? []).map((c) => (
                        <span key={c.label} className="af-d34-chip" data-tone={c.tone ?? undefined}>{c.label}</span>
                      ))}
                    </div>
                    <div className="af-d34-lgtop">
                      <span className="af-d34-chip" data-platform={l.platform}>{l.platform.toUpperCase()}</span>
                      {l.formatLabel ? <span className="af-d34-lgmeta">{l.formatLabel}</span> : null}
                    </div>
                  </div>
                </div>

                <div className="af-d34-mu">
                  {l.score ? (
                    <>
                      <span className="af-d34-mu-you">
                        <span className="af-d34-mu-name">{l.usernameInLeague ?? 'You'}</span>
                        <span className="af-d34-mu-score">{l.score.you.toFixed(2)}</span>
                      </span>
                      <span className="af-d34-mu-vs">vs.</span>
                      <span className="af-d34-mu-you">
                        <span className="af-d34-mu-name af-d34-mu-opp-name">{l.score.opponentName}</span>
                        <span className="af-d34-mu-score">{l.score.opponent.toFixed(2)}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      {l.usernameInLeague ? <span className="af-d34-mu-name">{l.usernameInLeague}</span> : null}
                      <span className="af-d34-mu-none">{l.matchupNote ?? 'No live scoring yet'}</span>
                    </>
                  )}
                </div>

                <div className="af-d34-proj">
                  {l.projection ? (
                    <>
                      <span className="af-d34-proj-v">{l.projection.value}</span>
                      <span className="af-d34-proj-l">{l.projection.unit}</span>
                    </>
                  ) : (
                    /* Not a projection of zero — we do not have one. */
                    <span className="af-d34-proj-none">not set</span>
                  )}
                </div>

                <Link className="af-d34-ask" href={l.href} data-priority={priorityAttr(l.priority)}>
                  {l.actionLabel ?? 'Ask Chimmy'}
                </Link>
              </article>
            ))}
          </div>

          {/*
            The empty state is two different sentences, because they are two
            different situations. "You have no leagues" is an onboarding problem
            with an import button; "all of your leagues are quiet" is a good
            outcome and must not be dressed up as a failure.
          */}
          {leagues.length === 0 ? (
            <div className="af-d34-empty">
              <strong className="af-d34-notice-t">
                {data.totalLeagues === 0 ? 'No leagues connected yet' : 'Nothing needs you right now'}
              </strong>
              <p className="af-d34-notice-p">
                {data.totalLeagues === 0
                  ? 'Connect Sleeper, ESPN or Yahoo and your leagues appear here. Read-only, about a minute.'
                  : `Across ${data.totalLeagues} ${data.totalLeagues === 1 ? 'league' : 'leagues'}, nothing we can currently detect is waiting on a decision.`}
              </p>
              <Link className="af-d34-open" href={data.totalLeagues === 0 ? '/import' : '/core/portfolio'}>
                {data.totalLeagues === 0 ? 'Connect a platform' : 'Open Portfolio'}
              </Link>
            </div>
          ) : null}

          {data.overflow && data.overflow > 0 ? (
            <div className="af-d34-quiet" style={{ marginTop: 10 }}>
              <span className="af-d34-quiet-t">
                {data.overflow} more {data.overflow === 1 ? 'league' : 'leagues'} also {data.overflow === 1 ? 'has' : 'have'} something
                flagged — this list shows the {leagues.length} that need you most.
              </span>
              <Link className="af-d34-llink" href="/core/portfolio">Show all {data.totalLeagues} →</Link>
            </div>
          ) : null}

          {quiet && quiet.count > 0 ? (
            <div className="af-d34-quiet" style={{ marginTop: 10 }}>
              <span className="af-d34-quiet-t">
                {quiet.sample
                  ? `${quiet.sample} — nothing needs you.`
                  : `${quiet.count} ${quiet.count === 1 ? 'league is' : 'leagues are'} quiet — nothing needs you.`}
              </span>
              <Link className="af-d34-llink" href="/core/portfolio">Show all {data.totalLeagues} →</Link>
            </div>
          ) : null}

          {/*
            The AF Legacy tail, named rather than dropped. These are past-season
            snapshots from the career import — 543 of them on one production
            account — and putting them in a list headed "what needs you first"
            is exactly how that list became unreadable.
          */}
          {data.legacyCount && data.legacyCount > 0 ? (
            <div className="af-d34-quiet" style={{ marginTop: 8 }}>
              <span className="af-d34-quiet-t">
                {data.legacyCount} past {data.legacyCount === 1 ? 'season' : 'seasons'} imported from your
                history — not leagues you play now.
              </span>
              <Link className="af-d34-llink" href="/core/career">Career &amp; Legacy →</Link>
            </div>
          ) : null}
        </section>

        {/* Tool nav, under the league list. */}
        <section aria-label="Tools">
          <h2 className="af-d34-cols" style={{ padding: '0 0 8px' }}>EVERYTHING ELSE</h2>
          <div className="af-d34-tools">
            {TOOLS.map((t) => (
              <Link key={t.href} className="af-d34-tool" href={toolHref(t, leagueId)}>
                <span className="af-d34-tool-g" aria-hidden="true">{t.glyph}</span>
                <span className="af-d34-tool-n">{t.name}</span>
              </Link>
            ))}
          </div>
        </section>

        {/*
          What is NOT being watched.

          Carried over from the screen this replaces, and the one thing from it
          worth keeping wholesale. A home page showing no problems reads as an
          all-clear; it has only earned that if every category is actually being
          checked, and most are not. Collapsed by default so it informs without
          competing with the list.
        */}
        {coverage && coverage.length ? (
          <details className="af-d34-cov">
            <summary className="af-d34-cov-s">
              Not yet watched: {coverage.length} {coverage.length === 1 ? 'thing' : 'things'}
            </summary>
            <ul className="af-d34-cov-l">
              {coverage.map((c) => (
                <li key={c.label}>
                  <b>{c.label}</b>
                  <span>{c.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {/* Right column */}
      <aside className="af-d34-side" aria-label="Briefing and activity">
        {brief ? (
          <section className="af-d34-card af-d34-brief">
            <div className="af-d34-briefhead">
              {brief.avatarUrl ? (
                <img className="af-d34-avatar" src={brief.avatarUrl} alt="" />
              ) : (
                <span className="af-d34-avatar" aria-hidden="true" />
              )}
              <span className="af-d34-briefname">{brief.title.toUpperCase()}</span>
              {brief.time ? <span className="af-d34-brieftime">{brief.time}</span> : null}
            </div>
            <h2 className="af-d34-briefh">{brief.headline}</h2>
            <p className="af-d34-briefb">{brief.body}</p>
            <div className="af-d34-briefcta">
              <Link className="af-d34-open" href={CHIMMY_HREF}>Ask Chimmy</Link>
            </div>
          </section>
        ) : null}

        {book && book.length ? (
          <section className="af-d34-card">
            <div className="af-d34-cardhead"><span>MOVING YOUR BOOK</span></div>
            <div className="af-d34-book">
              {book.map((b) => (
                <div className="af-d34-bookrow" key={b.name}>
                  <span className="af-d34-bookav" data-tone={b.tone ?? undefined}>{b.initials}</span>
                  <div className="af-d34-bookbody">
                    <div className="af-d34-bookname">{b.name}</div>
                    <p className="af-d34-booksub">{b.note}</p>
                  </div>
                  {b.exposure ? <span className="af-d34-bookcount">{b.exposure}</span> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="af-d34-card">
          <div className="af-d34-cardhead"><span>JUMP BACK IN</span></div>
          <div className="af-d34-jump">
            <Link className="af-d34-jumpbtn" href={toolHref({ href: '/core/trades', leagueScoped: true }, leagueId)}>
              <span aria-hidden="true">⇄</span>Trade lab
            </Link>
            <Link className="af-d34-jumpbtn" href={toolHref({ href: '/core/waivers', leagueScoped: true }, leagueId)}>
              <span aria-hidden="true">◈</span>Waiver plan
            </Link>
          </div>
        </section>

        {/*
          ⚠ LEAGUE CHATTER WAS REMOVED, NOT HIDDEN. The handoff's card is fed by a
          Discord ingest that does not exist, and its only control — "Open
          communications →" — pointed at `/core/communications`, which is not a
          route: the catch-all would have swallowed it and quietly re-rendered
          this same home page. A card that can never hold data, whose one button
          goes nowhere, is not worth carrying. It comes back when there is an
          ingest and a destination.
        */}
      </aside>
    </div>
  )
}

/* ── Mobile ──────────────────────────────────────────────────────────────── */

function Mobile({ data, leagueId }: { data: Dash34Data; leagueId: string | null }) {
  const { firstLock, leagues, quiet, notice } = data
  // Three leagues, rest behind "Show all" — the handoff's mobile delta.
  const shown = leagues.slice(0, 3)

  return (
    <div className="af-d34m">
      <div className="af-d34m-rail">
        {leagues.slice(0, 10).map((l) => (
          <Link key={l.id} href={l.href} className="af-d34m-railtile" data-platform={l.platform}
            aria-label={l.name}>
            {initials(l.name)}
          </Link>
        ))}
      </div>

      {firstLock ? (
        <section className="af-d34m-lock" aria-label="Most urgent">
          <div className="af-d34m-lockrow">
            <span className="af-d34m-count">
              {firstLock.countdownTo ? (
                <Dash34Countdown to={firstLock.countdownTo} initial={firstLock.countdown} />
              ) : (
                firstLock.countdown
              )}
            </span>
            <span className="af-d34m-lockl">{firstLock.countdownLabel ?? 'FIRST LOCK'}</span>
          </div>
          <h2 className="af-d34m-lockh">{firstLock.headline}</h2>
          {firstLock.slots.length ? (
            <div className="af-d34-slots">
              {firstLock.slots.map((s) => (
                <span key={`${s.key ?? ''}${s.label}`} className="af-d34-slot" data-tone={s.tone ?? undefined}>
                  {s.key ? <span className="af-d34-slot-k">{s.key}</span> : null}
                  {s.label}
                </span>
              ))}
            </div>
          ) : null}
          <Link
            className="af-d34m-rowask"
            data-priority="true"
            href={firstLock.openHref}
            {...(isExternal(firstLock.openHref) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {firstLock.openLabel}
            {isExternal(firstLock.openHref) ? ' ↗' : ''}
          </Link>
          {isExternal(firstLock.openHref) ? (
            <p className="af-d34-ro" style={{ maxWidth: 'none', textAlign: 'left' }}>
              AF reads your league. Lineups change on the platform.
            </p>
          ) : null}
        </section>
      ) : null}

      <h1 className="af-d34-h1" style={{ fontSize: 20 }}>Your leagues</h1>

      {notice ? (
        <div className="af-d34-notice" role="status">
          <div className="af-d34-notice-b">
            <strong className="af-d34-notice-t">{notice.title}</strong>
            <p className="af-d34-notice-p">{notice.body}</p>
          </div>
          {notice.href ? (
            <Link className="af-d34-jumpbtn" href={notice.href}>{notice.label ?? 'Fix this'}</Link>
          ) : null}
        </div>
      ) : null}

      {shown.map((l) => (
        <article className="af-d34m-row" key={l.id} data-priority={priorityAttr(l.priority)}>
          <div className="af-d34m-rowtop">
            <LeagueTile l={l} />
            <h3 className="af-d34m-rowname">{l.name}</h3>
          </div>
          <span className="af-d34m-rowmeta">
            {l.usernameInLeague ? `${l.usernameInLeague} · ` : ''}{l.formatLabel ?? l.platform.toUpperCase()}
          </span>
          <div className="af-d34m-rowsc">
            {l.score ? (
              <>
                <span>{l.score.you.toFixed(2)}</span>
                <span className="af-d34-mu-vs">vs.</span>
                <span>{l.score.opponent.toFixed(2)}</span>
              </>
            ) : (
              <span className="af-d34-mu-none">{l.matchupNote ?? 'No live scoring yet'}</span>
            )}
            <span style={{ flex: 1 }} />
            {l.projection ? (
              <span className="af-d34-proj-v">{l.projection.value}</span>
            ) : (
              <span className="af-d34-proj-none">not set</span>
            )}
          </div>
          <Link className="af-d34m-rowask" href={l.href} data-priority={priorityAttr(l.priority)}>
            {l.actionLabel ?? 'Ask Chimmy'}
          </Link>
        </article>
      ))}

      {leagues.length === 0 ? (
        <div className="af-d34-empty">
          <strong className="af-d34-notice-t">
            {data.totalLeagues === 0 ? 'No leagues connected yet' : 'Nothing needs you right now'}
          </strong>
          <p className="af-d34-notice-p">
            {data.totalLeagues === 0
              ? 'Connect Sleeper, ESPN or Yahoo and your leagues appear here. Read-only, about a minute.'
              : `Across ${data.totalLeagues} ${data.totalLeagues === 1 ? 'league' : 'leagues'}, nothing we can currently detect is waiting on a decision.`}
          </p>
          <Link className="af-d34-open" href={data.totalLeagues === 0 ? '/import' : '/core/portfolio'}>
            {data.totalLeagues === 0 ? 'Connect a platform' : 'Open Portfolio'}
          </Link>
        </div>
      ) : null}

      {leagues.length > shown.length || (data.overflow ?? 0) > 0 || (quiet && quiet.count > 0) ? (
        <div className="af-d34-quiet">
          <span className="af-d34-quiet-t">
            {(() => {
              // Mobile shows three rows, so its hidden count is the desktop
              // overflow PLUS the rows this frame trimmed — otherwise the number
              // under the list contradicts the list above it.
              const hidden = leagues.length - shown.length + (data.overflow ?? 0)
              if (hidden > 0 && quiet && quiet.count > 0) return `${hidden} more flagged · ${quiet.count} quiet`
              if (hidden > 0) return `${hidden} more ${hidden === 1 ? 'league' : 'leagues'} flagged`
              return `${quiet!.count} quiet — nothing needs you.`
            })()}
          </span>
          <Link className="af-d34-llink" href="/core/portfolio">Show all →</Link>
        </div>
      ) : null}

      {data.legacyCount && data.legacyCount > 0 ? (
        <div className="af-d34-quiet">
          <span className="af-d34-quiet-t">
            {data.legacyCount} past {data.legacyCount === 1 ? 'season' : 'seasons'} from your history.
          </span>
          <Link className="af-d34-llink" href="/core/career">Career &amp; Legacy →</Link>
        </div>
      ) : null}

      <div className="af-d34m-chips">
        {TOOLS.map((t) => (
          <Link key={t.href} className="af-d34m-chiplink" href={toolHref(t, leagueId)}>{t.name}</Link>
        ))}
      </div>
    </div>
  )
}

export function Dashboard34({ data }: { data: Dash34Data }) {
  /*
   * League context for the league-scoped tools. The list is already sorted by
   * what needs you first, so the top row is the league a manager is most likely
   * to be acting on — better than dropping them on a screen that asks which one.
   * Null when there are no leagues, and the links then go to the unscoped screen
   * rather than to `?league=undefined`.
   */
  const leagueId = data.leagues[0]?.id ?? null

  return (
    <>
      <Desktop data={data} leagueId={leagueId} />
      <Mobile data={data} leagueId={leagueId} />
      {/* Chat is a floating bubble, not a tab. Desktop 60px, mobile 56px above
          the bottom nav; the right column reserves 88px so nothing sits under it. */}
      <Link className="af-d34-fab" href={CHIMMY_HREF} aria-label="Open chat">
        Ask Chimmy
        {data.chatUnread ? <span className="af-d34-fabdot">{data.chatUnread}</span> : null}
      </Link>
    </>
  )
}

export default Dashboard34
