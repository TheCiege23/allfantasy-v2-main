import Link from 'next/link'
import '@/components/core-app/af-format-hubs.css'
import '@/components/core-app/hubs/af-commissioner-guide.css'
import type { CommissionerOverviewData, OverviewLeagueCard } from '@/lib/core-app/commissionerOverview'
import { commissionerGuide } from '@/lib/core-app/commissionerGuide'
import { ROBOT_KING_ART } from '@/lib/core-app/commissioner/leagueArt'
import { HubSwitcher } from '@/components/core-app/hubs/HubSwitcher'
import { HubHeroMedia } from '@/components/core-app/hubs/HubHeroMedia'
import { FocusComposerButton, HubBroadcast } from '@/components/core-app/hubs/HubBroadcast'
import { OverviewQueue } from '@/components/core-app/hubs/OverviewQueue'
import { TopicTip } from '@/components/core-app/TopicTip'
import { InactiveLadderList } from '@/components/core-app/commissioner/InactiveLadderList'

/**
 * Commissioner Hub, all leagues — `/core/commissioner` (five-doors restyle, 2026-09-17).
 *
 * The format hubs' anatomy: switcher, title with its one action, a key-art band
 * carrying the numbers that matter, league cards, paired panels, and a footer that
 * says where changes are made. Every number comes from `getCommissionerOverview`;
 * a figure with no source is not drawn.
 *
 * What the old `/commissioner-hub` carried and where it went is recorded on that
 * route (now a redirect here). The short version: the queue and the broadcast came
 * here; health maps, League/Trade OS panels, Manager DNA and recommendations are
 * Commissioner OS's; import, create and the tournament hub stay one click away.
 */

const PLATFORM_MARK: Record<string, string> = {
  sleeper: 'S',
  espn: 'E',
  yahoo: 'Y',
  fantrax: 'F',
  mfl: 'M',
  fleaflicker: 'FL',
  cbs: 'C',
}

const NEEDS_TONE = { bad: 'bad', warn: 'warn', info: 'accent' } as const

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function LeagueCard({ l }: { l: OverviewLeagueCard }) {
  const measured = 'active' in l.activity ? l.activity : null
  const pct = measured && measured.total > 0 ? Math.round((measured.active / measured.total) * 100) : 0
  return (
    <article className="afh-card" data-tone={l.worst === 'bad' ? 'bad' : l.worst === 'warn' ? 'warn' : undefined}>
      <div className="afh-card-head">
        <span className="afh-pmark" data-p={l.platform} aria-hidden>
          {PLATFORM_MARK[l.platform] ?? 'AF'}
        </span>
        <div className="afh-row-main">
          <span className="afh-card-name">{l.name}</span>
          <span className="afh-card-sub">{l.sub}</span>
        </div>
      </div>
      <div className="afh-meter">
        <div className="afh-meter-top">
          <span className="afh-label">Active managers</span>
          {measured ? (
            <span className="afh-meter-val" data-tone={measured.tone}>
              {measured.active} / {measured.total}
            </span>
          ) : (
            <span className="afh-meter-val" data-tone="muted">
              —
            </span>
          )}
        </div>
        {measured ? (
          <div
            className="afh-bar"
            role="meter"
            aria-label="Active managers"
            aria-valuemin={0}
            aria-valuemax={measured.total}
            aria-valuenow={measured.active}
          >
            <i data-tone={measured.tone === 'muted' ? undefined : measured.tone} style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <span className="afh-row-detail">{'reason' in l.activity ? l.activity.reason : null}</span>
        )}
        {/* Off-season (2026-11-13 guide): a quiet manager is normal then, so the meter is muted and says so. */}
        {measured && l.offSeason ? <span className="afh-row-detail cmg-offseason">Not in season — quiet is normal</span> : null}
      </div>
      <div className="afh-chips">
        {l.needsYou > 0 ? (
          /* What is waiting, by name (2026-11-13 guide) — "2 need you" never said what the two were. */
          <span className="afh-chip cmg-top" data-tone={l.worst ? NEEDS_TONE[l.worst] : 'accent'}>
            {l.topItem ?? `${l.needsYou} ${l.needsYou === 1 ? 'needs you' : 'need you'}`}
            {l.topItem && l.needsYou > 1 ? ` · +${l.needsYou - 1} more` : ''}
          </span>
        ) : (
          <span className="afh-chip" data-tone="good">
            Nothing waiting
          </span>
        )}
        <span className="afh-chip" data-tone={l.sync.tone === 'muted' ? undefined : l.sync.tone}>
          {l.sync.label}
        </span>
      </div>
      <nav className="afh-card-actions" aria-label={`${l.name} tools`}>
        <Link className="afh-card-commissioner" href={l.href}>
          Commissioner
        </Link>
        <Link href={`/core?league=${encodeURIComponent(l.leagueId)}`}>Overview</Link>
        {l.variant === 'survivor_guillotine' && <Link href={`/survivor-guillotine/${encodeURIComponent(l.leagueId)}`}>Survivor control</Link>}
        <Link href={`/core/standings?league=${encodeURIComponent(l.leagueId)}`}>Standings</Link>
      </nav>
    </article>
  )
}

export function CommissionerOverview({ data }: { data: CommissionerOverviewData }) {
  const has = data.runCount > 0
  const canSend = data.broadcastLeagueIds.length > 0
  const g = commissionerGuide(data)
  const waiting = data.leagues.filter((l) => l.needsYou > 0)
  const clear = data.leagues.filter((l) => l.needsYou === 0)

  return (
    // `afh--guide` (2026-11-13): the source order IS the phone order — answer, to-do list, leagues, extras.
    <div className="afh afh--guide" data-format="all" data-testid="commissioner-overview">
      <HubSwitcher current="all" counts={data.formatCounts} runCount={data.runCount} />

      {/*
        The guide band (2026-11-13): the robot-king art as a thin banner behind the answer — how many
        things need you — instead of half the first screen behind four numbers that were mostly noise.
      */}
      <section className="afh-hero cmg-band" data-art="still" aria-label="What needs you">
        <HubHeroMedia video={ROBOT_KING_ART.video} poster={ROBOT_KING_ART.poster} />
        <div className="afh-hero-body cmg-band-body">
          <div className="afh-label">{g.eyebrow}</div>
          <h1 className="cmg-title">{g.headline}</h1>
          <p className="cmg-sub">{g.intro}</p>
          {has && g.chips.length > 0 ? (
            <div className="cmg-chips">
              {g.chips.map((c) => (
                <Link key={c.key} className="cmg-chip" data-tone={c.tone} href={c.href}>
                  {c.label}
                </Link>
              ))}
            </div>
          ) : null}
          {canSend ? (
            <div className="cmg-band-action">
              <FocusComposerButton />
            </div>
          ) : null}
        </div>
      </section>

      {has ? (
        <>
          <p className="cmg-teach">
            <b>Why it matters</b> {g.teach}
          </p>

          {/* The to-do list first: one row per thing, the league, and the button that does it. */}
          <OverviewQueue rows={data.queue} title="Your to-do list" />

          {/* Quiet managers in season, with the next step and a message to copy — only when there are some. */}
          {(data.ladder ?? []).length > 0 ? (
            <section className="afh-panel" id="af-ladder" aria-label="Inactive managers">
              <InactiveLadderList entries={data.ladder ?? []} offSeason={false} />
            </section>
          ) : null}

          <section aria-labelledby="afh-run" className="afh-stack" id="afh-leagues">
            <div className="afh-rule">
              <h2 id="afh-run" className="afh-label" style={{ margin: 0 }}>
                Leagues you run
              </h2>
              {/* Beside the heading, not in it: the h2 names this section (aria-labelledby). One key for every card's meter. */}
              <TopicTip topic="activeManagers" />
            </div>
            {waiting.length > 0 ? (
              <div className="afh-grid">
                {waiting.map((l) => (
                  <LeagueCard key={l.leagueId} l={l} />
                ))}
              </div>
            ) : null}
            {/* Leagues with nothing waiting fold into one line (2026-11-13 guide). */}
            {clear.length > 0 ? (
              <details className="cmg-clear" data-testid="commissioner-clear-leagues" open={waiting.length === 0 || undefined}>
                <summary>
                  {clear.length} {clear.length === 1 ? 'league' : 'leagues'} with nothing waiting
                </summary>
                <div className="afh-grid">
                  {clear.map((l) => (
                    <LeagueCard key={l.leagueId} l={l} />
                  ))}
                </div>
              </details>
            ) : null}
            {data.runCount > data.leagues.length ? (
              <p className="afh-row-detail" style={{ margin: 0 }}>
                Showing the {data.leagues.length} that need you most, of {data.runCount}; the to-do list above covers every
                league. The rest are in{' '}
                <Link className="afh-link" href="/core/portfolio">
                  Portfolio →
                </Link>
              </p>
            ) : null}
          </section>

          {canSend ? (
            <section className="afh-panel" aria-label="Broadcast">
              <HubBroadcast label="Broadcast to your AllFantasy leagues" leagueIds={data.broadcastLeagueIds} />
            </section>
          ) : null}

          {/* Everything else, one tap away (2026-11-13 guide). */}
          <details className="cmg-more" data-testid="commissioner-more">
            <summary>More commissioner tools — mentions, inactive-manager rules, tournaments, Commissioner OS</summary>
            <div className="cmg-more-body">
              <section className="afh-panel" aria-labelledby="afh-mentions">
                <div className="afh-panel-head">
                  <h2 id="afh-mentions" className="afh-label" style={{ margin: 0 }}>
                    Mentions across your leagues
                  </h2>
                </div>
                {data.mentions == null ? (
                  <p className="afh-none">Mentions couldn’t be read just now.</p>
                ) : data.mentions.length === 0 ? (
                  <p className="afh-none">Nobody has @-mentioned you in these league chats.</p>
                ) : (
                  data.mentions.map((m) => (
                    <div className="afh-mention" key={m.id}>
                      <div className="afh-mention-by">
                        <b>{m.author}</b>
                        <span>
                          {m.leagueName} · {ago(m.at)}
                        </span>
                      </div>
                      <p>{m.text}</p>
                    </div>
                  ))
                )}
                {canSend ? null : <HubBroadcast label="Broadcast to your AllFantasy leagues" leagueIds={data.broadcastLeagueIds} />}
              </section>

              {/* The ladder's rules — said here when nobody is on it, so an empty ladder reads as "off-season", not broken. */}
              {(data.ladder ?? []).length === 0 && ((data.ladderLeagues ?? 0) > 0 || data.activityChecked > 0) ? (
                <section className="afh-panel" id="af-ladder" aria-label="Inactive managers">
                  <InactiveLadderList entries={[]} offSeason={(data.ladderLeagues ?? 0) === 0} />
                </section>
              ) : null}

              {data.tournament.show ? (
                <div className="afh-connect-row">
                  <span className="afh-pmark" aria-hidden>
                    ♜
                  </span>
                  <div className="afh-row-main">
                    <span className="afh-row-title">
                      {data.tournament.count > 0
                        ? `You run ${data.tournament.count} ${data.tournament.count === 1 ? 'tournament' : 'tournaments'} across several leagues.`
                        : 'Run one big tournament across several of these leagues?'}
                    </span>
                  </div>
                  <Link className="afh-btn afh-btn--sm" href="/tournament-hub">
                    {data.tournament.count > 0 ? 'Open tournament hub' : 'Group leagues'}
                  </Link>
                </div>
              ) : null}

              <div className="cmg-more-links">
                <Link className="afh-link" href={`/core/hubs`}>
                  Format hubs →
                </Link>
                {data.ownsAny ? (
                  <>
                    <Link className="afh-link" href="/commissioner-os">
                      Open Commissioner OS →
                    </Link>
                    <Link className="afh-link" href="/commissioner-os/networks">
                      Manage commissioner networks →
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </details>
        </>
      ) : (
        <section className="afh-empty">
          <div>
            <h2>You don’t run a league yet</h2>
            <p>
              This hub fills in by itself when you commission a league — one you create here, or one you import from the
              platform it lives on where you’re the commissioner.
              {data.partial ? ' Some league data couldn’t be read just now, so this may be missing leagues.' : ''}
            </p>
          </div>
          <div className="afh-empty-actions">
            <Link className="afh-btn" href="/create-league">
              Create a league
            </Link>
            <Link className="afh-btn afh-btn--ghost" href="/import">
              Import a league
            </Link>
          </div>
        </section>
      )}

      <footer className="afh-foot">
        <p>
          Rulings and settings are applied on each league’s own platform.
          {has && data.partial ? ' Some figures couldn’t be read just now and may be low.' : ''}
        </p>
      </footer>
    </div>
  )
}

export default CommissionerOverview
