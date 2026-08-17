import Link from 'next/link'
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
    /** Pre-formatted "1:04:12" — the ticking is the client's job, not this file's. */
    countdown: string
    kickoffLabel: string
    headline: string
    slots: Array<{ key?: string | null; label: string; tone?: 'bad' | 'warn' | null }>
    openHref: string
    openLabel: string
  } | null
  today?: { wins: number; losses: number; health?: { score: number; label: string } | null } | null
  next24?: Array<{ text: string; time: string; tone?: 'warn' | 'accent' | null }> | null
  leagues: Dash34League[]
  /** Leagues with nothing needing attention, collapsed to the footnote row. */
  quiet?: { count: number; sample?: string | null } | null
  totalLeagues: number
  brief?: { title: string; headline: string; body: string; time?: string | null; avatarUrl?: string | null } | null
  book?: Array<{ initials: string; name: string; note: string; exposure?: string | null; tone?: 'bad' | 'warn' | null }> | null
  chatter?: { unread: number; messages: Array<{ initials: string; who: string; text: string; fromDiscord?: boolean }> } | null
  chatUnread?: number
}

const TOOLS = [
  { href: '/core/players', glyph: '●', name: 'Player finder' },
  { href: '/core/trades', glyph: '⇄', name: 'Trade lab' },
  { href: '/core/waivers', glyph: '◷', name: 'Waiver plan' },
  { href: '/core/rankings', glyph: '↑', name: 'Rankings' },
  { href: '/core/career', glyph: '★', name: 'Career & Legacy' },
  { href: '/core/commissioner', glyph: '⚑', name: 'Commissioner HQ' },
] as const

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function LeagueTile({ l }: { l: Dash34League }) {
  return (
    <span className="af-d34-tile" data-platform={l.platform} aria-hidden="true">
      {l.imageUrl ? <img src={l.imageUrl} alt="" /> : initials(l.name)}
    </span>
  )
}

function priorityAttr(p: Dash34League['priority']): string | undefined {
  if (p === 'urgent') return 'true'
  if (p === 'draft') return 'draft'
  return undefined
}

/* ── Desktop ─────────────────────────────────────────────────────────────── */

function Desktop({ data }: { data: Dash34Data }) {
  const { firstLock, today, next24, leagues, quiet, brief, book, chatter } = data

  return (
    <div className="af-d34">
      <div className="af-d34-main">
        {/* First-lock band — the single most time-critical thing. */}
        {firstLock ? (
          <section className="af-d34-lock" aria-label="Most urgent">
            <div className="af-d34-lockcard">
              <div className="af-d34-count">
                <span className="af-d34-count-l">FIRST LOCK</span>
                <span className="af-d34-count-v">{firstLock.countdown}</span>
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
                <Link className="af-d34-open" href={firstLock.openHref} target="_blank" rel="noreferrer">
                  {firstLock.openLabel} ↗
                </Link>
                {/* AF is read-only. The promise lives under the CTA. */}
                <p className="af-d34-ro">AF reads your league. Lineups change on the platform.</p>
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
                        <span className="af-d34-feedtime">{n.time}</span>
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
        </section>

        {/* Tool nav, under the league list. */}
        <section aria-label="Tools">
          <h2 className="af-d34-cols" style={{ padding: '0 0 8px' }}>EVERYTHING ELSE</h2>
          <div className="af-d34-tools">
            {TOOLS.map((t) => (
              <Link key={t.href} className="af-d34-tool" href={t.href}>
                <span className="af-d34-tool-g" aria-hidden="true">{t.glyph}</span>
                <span className="af-d34-tool-n">{t.name}</span>
              </Link>
            ))}
          </div>
        </section>
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
              <Link className="af-d34-open" href="/core/chimmy">Ask Chimmy</Link>
              <Link className="af-d34-jumpbtn" href="/core/chimmy?full=1">Full briefing</Link>
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
            <Link className="af-d34-jumpbtn" href="/core/trades"><span aria-hidden="true">⇄</span>Trade lab</Link>
            <Link className="af-d34-jumpbtn" href="/core/waivers"><span aria-hidden="true">◈</span>Waiver plan</Link>
          </div>
        </section>

        {chatter && chatter.messages.length ? (
          <section className="af-d34-card">
            <div className="af-d34-cardhead">
              <span>LEAGUE CHATTER</span>
              {chatter.unread > 0 ? <span className="af-d34-badge">{chatter.unread} NEW</span> : null}
            </div>
            <div className="af-d34-chat">
              {chatter.messages.map((m, i) => (
                <div className="af-d34-chatrow" key={`${m.who}-${i}`}>
                  <span className="af-d34-chatav">{m.initials}</span>
                  <p className="af-d34-chatbody">
                    <span className="af-d34-chatwho">{m.who}</span>
                    {m.fromDiscord ? <span className="af-d34-discord">FROM DISCORD</span> : null}
                    {' — '}{m.text}
                  </p>
                </div>
              ))}
            </div>
            <Link className="af-d34-more" href="/core/communications">Open communications →</Link>
          </section>
        ) : null}
      </aside>
    </div>
  )
}

/* ── Mobile ──────────────────────────────────────────────────────────────── */

function Mobile({ data }: { data: Dash34Data }) {
  const { firstLock, leagues, quiet } = data
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
            <span className="af-d34m-count">{firstLock.countdown}</span>
            <span className="af-d34m-lockl">FIRST LOCK</span>
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
          <Link className="af-d34m-rowask" data-priority="true" href={firstLock.openHref} target="_blank" rel="noreferrer">
            {firstLock.openLabel} ↗
          </Link>
          <p className="af-d34-ro" style={{ maxWidth: 'none', textAlign: 'left' }}>
            AF reads your league. Lineups change on the platform.
          </p>
        </section>
      ) : null}

      <h1 className="af-d34-h1" style={{ fontSize: 20 }}>Your leagues</h1>

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

      {leagues.length > shown.length || (quiet && quiet.count > 0) ? (
        <div className="af-d34-quiet">
          <span className="af-d34-quiet-t">
            {quiet && quiet.count > 0 ? `${quiet.count} quiet — nothing needs you.` : 'More leagues'}
          </span>
          <Link className="af-d34-llink" href="/core/portfolio">Show all →</Link>
        </div>
      ) : null}

      <div className="af-d34m-chips">
        {TOOLS.map((t) => (
          <Link key={t.href} className="af-d34m-chiplink" href={t.href}>{t.name}</Link>
        ))}
      </div>
    </div>
  )
}

export function Dashboard34({ data }: { data: Dash34Data }) {
  return (
    <>
      <Desktop data={data} />
      <Mobile data={data} />
      {/* Chat is a floating bubble, not a tab. Desktop 60px, mobile 56px above
          the bottom nav; the right column reserves 88px so nothing sits under it. */}
      <Link className="af-d34-fab" href="/core/chimmy" aria-label="Open chat">
        Ask Chimmy
        {data.chatUnread ? <span className="af-d34-fabdot">{data.chatUnread}</span> : null}
      </Link>
    </>
  )
}

export default Dashboard34
