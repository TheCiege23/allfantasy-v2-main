import Link from 'next/link'
import '@/components/core-app/af-format-hubs.css'
import type { CommissionerOverviewData, OverviewLeagueCard } from '@/lib/core-app/commissionerOverview'
import { ROBOT_KING_ART } from '@/lib/core-app/commissioner/leagueArt'
import { HubSwitcher } from '@/components/core-app/hubs/HubSwitcher'
import { HubHeroMedia } from '@/components/core-app/hubs/HubHeroMedia'
import { FocusComposerButton, HubBroadcast } from '@/components/core-app/hubs/HubBroadcast'
import { OverviewQueue } from '@/components/core-app/hubs/OverviewQueue'

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
      </div>
      <div className="afh-chips">
        {l.needsYou > 0 ? (
          <span className="afh-chip" data-tone={l.worst ? NEEDS_TONE[l.worst] : 'accent'}>
            {l.needsYou} {l.needsYou === 1 ? 'needs you' : 'need you'}
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
        <Link href={`/core/standings?league=${encodeURIComponent(l.leagueId)}`}>Standings</Link>
      </nav>
    </article>
  )
}

export function CommissionerOverview({ data }: { data: CommissionerOverviewData }) {
  const has = data.runCount > 0
  const canSend = data.broadcastLeagueIds.length > 0

  return (
    <div className="afh" data-format="all" data-testid="commissioner-overview">
      <HubSwitcher current="all" counts={data.formatCounts} runCount={data.runCount} />

      <header className="afh-head">
        <div className="afh-title">
          <div className="afh-label">Core · Commissioner</div>
          <div className="afh-title-row">
            <span className="afh-badge" aria-hidden>
              ⚑
            </span>
            <h1>Commissioner Hub</h1>
          </div>
          <p className="afh-desc">
            Every league you run: what needs a commissioner, who has gone quiet, and where each league stands.
            AllFantasy reads your platforms — rulings are still made there.
          </p>
        </div>
        {canSend ? <FocusComposerButton /> : null}
      </header>

      <section className="afh-hero" data-art="still" aria-label="Across the leagues you run">
        <HubHeroMedia video={ROBOT_KING_ART.video} poster={ROBOT_KING_ART.poster} />
        <div className="afh-hero-body">
          {has ? (
            <>
              <div className="afh-label">
                Across the {data.runCount} {data.runCount === 1 ? 'league' : 'leagues'} you run
              </div>
              <div className="afh-stats">
                {data.stats.map((s) => (
                  <div className="afh-stat" key={s.label}>
                    <b data-tone={s.tone === 'plain' ? undefined : s.tone}>{s.value}</b>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="afh-stats">
              <div className="afh-stat">
                <b data-tone="accent">0</b>
                <span>leagues you run</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {has ? (
        <>
          <section aria-labelledby="afh-run" className="afh-stack">
            <div className="afh-rule">
              <h2 id="afh-run" className="afh-label" style={{ margin: 0 }}>
                Leagues you run
              </h2>
            </div>
            <div className="afh-grid">
              {data.leagues.map((l) => (
                <LeagueCard key={l.leagueId} l={l} />
              ))}
            </div>
            {data.runCount > data.leagues.length ? (
              <p className="afh-row-detail" style={{ margin: 0 }}>
                Showing the {data.leagues.length} that need you most, of {data.runCount}. Manager activity is checked for
                these; the queue below covers every league. The rest are in{' '}
                <Link className="afh-link" href="/core/portfolio">
                  Portfolio →
                </Link>
              </p>
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
          </section>

          <div className="afh-pair">
            <OverviewQueue rows={data.queue} />

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
              <HubBroadcast label="Broadcast to your AllFantasy leagues" leagueIds={data.broadcastLeagueIds} />
            </section>
          </div>
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
          {data.ownsAny ? ' Health trends, manager intelligence and reports are in Commissioner OS.' : ''}
          {has && data.partial ? ' Some figures couldn’t be read just now and may be low.' : ''}
        </p>
        <Link className="afh-link" href={`/core/hubs`}>
          Format hubs →
        </Link>
        {data.ownsAny ? (
          <Link className="afh-link" href="/commissioner-os">
            Open Commissioner OS →
          </Link>
        ) : null}
      </footer>
    </div>
  )
}

export default CommissionerOverview
