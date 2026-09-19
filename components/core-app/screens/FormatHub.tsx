'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { FormatHubData, HubFormat } from '@/lib/core-app/formatHubs'
import '@/components/core-app/af-format-hubs.css'
import { WorkbookBarChart } from '@/components/core-app/charts/WorkbookChart'
import { HUB_TABS, HubSwitcher } from '@/components/core-app/hubs/HubSwitcher'
import { HubHeroMedia } from '@/components/core-app/hubs/HubHeroMedia'
import { HubBroadcast } from '@/components/core-app/hubs/HubBroadcast'

/**
 * Multi-league format hub — design_handoff_multi_league_hubs (2026-09-13).
 *
 * One component, six themes. The theme table holds copy and key art only; every
 * number on the page comes from `getFormatHub`. Sample data in the handoff
 * (league names, @mikek, "Sun 11:59PM") is never rendered.
 *
 * ⚠ THE KEY ART IS THE SAME FILES THE CREATE-LEAGUE CONCEPT CARDS USE. Four of the
 * six pairs were already on main byte-for-byte as `public/league-type-*`; only the
 * Guillotine and EFL clips are new, transcoded HEVC → H.264 because HEVC does not
 * play in Chrome or Firefox on most machines.
 */

type Theme = {
  tab: string
  title: string
  glyph: string
  desc: string
  connect: string
  leaguesLabel: string
  meterLabel: string
  tradesLabel: string
  mentionsLabel: string
  broadcastLabel: string
  emptyTitle: string
  canCreate: boolean
  foot: string
  video: string
  poster: string
}

const THEMES: Record<HubFormat, Theme> = {
  zombie: {
    tab: HUB_TABS.zombie,
    title: 'Zombie League Hub',
    glyph: '☣︎',
    desc: 'When a team dies, it doesn’t leave the league — it comes back wrong. Every outbreak and every reanimated roster you play in, from one command center.',
    connect: '+ Connect a league',
    leaguesLabel: 'Infected leagues',
    meterLabel: 'Infection spread',
    tradesLabel: 'Bite reports · trades',
    mentionsLabel: 'Mentions across your outbreak',
    broadcastLabel: 'Broadcast to the horde',
    emptyTitle: 'You’re not in a zombie league yet',
    canCreate: true,
    foot: 'Infections, revivals and commissioner rulings are logged inside each league.',
    video: '/league-type-zombie.mp4',
    poster: '/league-type-zombie.png',
  },
  tournament: {
    tab: HUB_TABS.tournament,
    title: 'Tournament Hub',
    glyph: '♜︎',
    desc: 'Every bracket you play in, one command center. Rounds, advancement and the road to the trophy across your tournament leagues.',
    connect: '+ Connect imported leagues',
    leaguesLabel: 'Connected brackets',
    meterLabel: 'Round',
    tradesLabel: 'Trades before the deadline',
    mentionsLabel: 'Mentions across your brackets',
    broadcastLabel: 'Broadcast to every bracket',
    emptyTitle: 'You’re not in a tournament league',
    canCreate: false,
    foot: 'Advancement and round changes are logged by the tournament that owns them.',
    video: '/league-type-tournament.mp4',
    poster: '/league-type-tournament.png',
  },
  survivor: {
    tab: HUB_TABS.survivor,
    title: 'Tribal Council Hub',
    glyph: '✺︎',
    desc: 'Immunity, exile and the blindside — every Survivor league you play in, from one fire. Exile Island reports straight to you.',
    connect: '+ Connect a tribe',
    leaguesLabel: 'Your tribes',
    meterLabel: 'Still in the game',
    tradesLabel: 'Alliances · trades',
    mentionsLabel: 'Mentions around the fire',
    broadcastLabel: 'Broadcast to every tribe',
    emptyTitle: 'You’re not in a Survivor league yet',
    canCreate: true,
    foot: 'Votes, idols and exile returns are logged inside each league.',
    video: '/league-type-survivor.mp4',
    poster: '/league-type-survivor.png',
  },
  c2c: {
    tab: HUB_TABS.c2c,
    title: 'Campus ⇄ Canton Hub',
    glyph: '⇄',
    desc: 'College and pro rosters in one dynasty. Every C2C league you play in — campus and canton weighting, sync freshness and trades — in one place.',
    connect: '+ Connect a C2C league',
    leaguesLabel: 'Your C2C leagues',
    meterLabel: 'Sync freshness',
    tradesLabel: 'C2C trades',
    mentionsLabel: 'Mentions across your C2C leagues',
    broadcastLabel: 'Broadcast to every C2C league',
    emptyTitle: 'You’re not in a C2C league yet',
    canCreate: true,
    foot: 'AllFantasy never writes back to Sleeper, ESPN or Yahoo — sync reads only.',
    video: '/league-type-c2c.mp4',
    poster: '/league-type-c2c.png',
  },
  guillotine: {
    tab: HUB_TABS.guillotine,
    title: 'Guillotine League Hub',
    glyph: '⚔︎',
    desc: 'Lowest score of the week doesn’t just lose — it’s executed. Every guillotine league you play in, and its weekly chop, from one hub.',
    connect: '+ Connect a league',
    leaguesLabel: 'Leagues on the block',
    meterLabel: 'Field remaining',
    tradesLabel: 'Chopping block trades',
    mentionsLabel: 'Mentions across your leagues',
    broadcastLabel: 'Broadcast the weekly chop',
    emptyTitle: 'You’re not in a guillotine league yet',
    canCreate: true,
    foot: 'Every chop is final and logged — visible to every manager in the league it happened in.',
    video: '/league-type-guillotine-hub.mp4',
    poster: '/league-type-guillotine-hub.webp',
  },
  efl: {
    tab: HUB_TABS.efl,
    title: 'Empire Fantasy League Hub',
    glyph: '♛︎',
    desc: 'Every dynasty you rule, one throne room. Standings, succession and the road to empire across every league running EFL rules.',
    connect: '+ Connect a dynasty',
    leaguesLabel: 'Your dynasties',
    meterLabel: 'Your standing',
    tradesLabel: 'Royal decrees · trades',
    mentionsLabel: 'Mentions across your empire',
    broadcastLabel: 'Broadcast a royal decree',
    emptyTitle: 'None of your leagues run EFL rules',
    canCreate: false,
    foot: 'Promotions, relegations and freezes are logged by Commissioner OS for each league.',
    video: '/league-type-efl-dynasty.mp4',
    poster: '/league-type-efl-dynasty.webp',
  },
}

const PLATFORM_MARK: Record<string, string> = {
  sleeper: 'S',
  espn: 'E',
  yahoo: 'Y',
  fantrax: 'F',
  mfl: 'M',
  fleaflicker: 'FL',
  cbs: 'C',
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export default function FormatHub({ data }: { data: FormatHubData }) {
  const theme = THEMES[data.format]
  const [connectOpen, setConnectOpen] = useState(false)
  const [tradesTab, setTradesTab] = useState<'pending' | 'completed'>('pending')
  const has = data.totalLeagues > 0
  const tradeRows = data.trades ? data.trades[tradesTab] : null

  return (
    <div className="afh" data-format={data.format}>
      <HubSwitcher current={data.format} counts={data.counts} />

      <header className="afh-head">
        <div className="afh-title">
          <div className="afh-label">Core · Format hubs</div>
          <div className="afh-title-row">
            <span className="afh-badge" aria-hidden>
              {theme.glyph}
            </span>
            <h1>{theme.title}</h1>
          </div>
          <p className="afh-desc">{theme.desc}</p>
        </div>
        <button
          type="button"
          className="afh-btn"
          aria-expanded={connectOpen}
          aria-controls="afh-connect"
          onClick={() => setConnectOpen((v) => !v)}
        >
          {theme.connect}
        </button>
      </header>

      {data.format === 'tournament' ? (
        <section className="afh-connect" aria-label="Tournament management">
          <p>Connect leagues already imported into AllFantasy. Get manager standings and weekly top scorers across all conferences, then copy or download the Excel report.</p>
          <div className="afh-connect-row">
            <Link className="afh-btn" href="/tournament-hub/new">Connect imported leagues</Link>
            <Link className="afh-btn" href="/tournament-hub">Your tournaments and weekly reports</Link>
          </div>
        </section>
      ) : null}
      {connectOpen ? (
        <section id="afh-connect" className="afh-connect" aria-label="Connect a league">
          <div className="afh-connect-head">
            <div className="afh-label">Bring a league into this hub</div>
            <button type="button" className="afh-close" aria-label="Close" onClick={() => setConnectOpen(false)}>
              ✕
            </button>
          </div>
          {data.format === 'tournament' ? <div className="afh-connect-row">
            <div className="afh-row-main"><span className="afh-row-title">Already imported?</span><span className="afh-row-detail">Select your leagues and group them into a tournament.</span></div>
            <Link className="afh-btn afh-btn--sm" href="/tournament-hub/new">Connect leagues</Link>
          </div> : null}
          <p>
            This hub gathers every {theme.tab} league you’re already in. To add one, import it from the platform it
            lives on{theme.canCreate ? ', or start a new one on AllFantasy' : ''}. Nothing changes on the original
            platform.
          </p>
          <div className="afh-connect-row">
            <span className="afh-pmark" aria-hidden>
              ↓
            </span>
            <div className="afh-row-main">
              <span className="afh-row-title">Import from Sleeper, ESPN, Yahoo, Fantrax or MFL</span>
              <span className="afh-row-detail">It appears here as soon as it is recognised as a {theme.tab} league.</span>
            </div>
            <Link className="afh-btn afh-btn--sm" href="/import">
              Import
            </Link>
          </div>
          {theme.canCreate ? (
            <div className="afh-connect-row">
              <span className="afh-pmark" aria-hidden>
                +
              </span>
              <div className="afh-row-main">
                <span className="afh-row-title">Start a {theme.tab} league on AllFantasy</span>
                <span className="afh-row-detail">Pick the {theme.tab} format in league creation.</span>
              </div>
              <Link className="afh-btn afh-btn--sm" href="/create-league">
                Create
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="afh-hero" aria-label={`${theme.tab} at a glance`}>
        <HubHeroMedia video={theme.video} poster={theme.poster} />
        <div className="afh-seal" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={theme.poster} alt="" />
        </div>
        <div className="afh-hero-body">
          {has ? (
            <>
              <div className="afh-label">
                Across your {data.totalLeagues} {data.totalLeagues === 1 ? 'league' : 'leagues'}
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
                <span>{theme.tab} leagues you play in</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {has ? (
        <>
          <WorkbookBarChart
            title={`${theme.tab} league comparison`}
            subtitle={theme.meterLabel}
            valueLabel="Percent"
            data={data.leagues
              .filter((league) => league.meter)
              .map((league) => ({
                // By id: an account can hold several leagues under one name.
                key: league.leagueId,
                label: league.name,
                value: league.meter?.pct ?? 0,
                displayValue: league.meter?.value,
                tone: league.meter?.tone ?? 'accent',
              }))}
          />
          <section aria-labelledby="afh-leagues" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="afh-rule">
              <h2 id="afh-leagues" className="afh-label" style={{ margin: 0 }}>
                {theme.leaguesLabel}
              </h2>
            </div>
            <div className="afh-grid">
              {data.leagues.map((l) => (
                <article
                  key={l.leagueId}
                  className="afh-card"
                  data-tone={l.statusTone === 'good' || l.statusTone === 'warn' || l.statusTone === 'bad' ? l.statusTone : undefined}
                >
                  <div className="afh-card-head">
                    <span className="afh-pmark" data-p={l.platform} aria-hidden>
                      {PLATFORM_MARK[l.platform] ?? 'AF'}
                    </span>
                    <div className="afh-row-main">
                      <span className="afh-card-name">{l.name}</span>
                      <span className="afh-card-sub">
                        {l.sub}
                        {l.youCommission ? ' · you commish' : ''}
                      </span>
                    </div>
                  </div>
                  {l.meter ? (
                    <div className="afh-meter">
                      <div className="afh-meter-top">
                        <span className="afh-label">{theme.meterLabel}</span>
                        <span className="afh-meter-val" data-tone={l.meter.tone}>
                          {l.meter.value}
                        </span>
                      </div>
                      <div
                        className="afh-bar"
                        role="meter"
                        aria-label={theme.meterLabel}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={l.meter.pct}
                      >
                        <i data-tone={l.meter.tone === 'muted' ? undefined : l.meter.tone} style={{ width: `${l.meter.pct}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="afh-meter">
                      <div className="afh-meter-top">
                        <span className="afh-label">{theme.meterLabel}</span>
                      </div>
                      <span className="afh-row-detail">{l.detail ?? 'Nothing on file yet'}</span>
                    </div>
                  )}
                  {l.meter && l.detail ? <span className="afh-row-detail">{l.detail}</span> : null}
                  <span className="afh-chip" data-tone={l.statusTone === 'muted' ? undefined : l.statusTone}>
                    {l.status}
                  </span>
                  <nav className="afh-card-actions" aria-label={`${l.name} tools`}>
                    <Link href={l.href}>Overview</Link>
                    <Link href={`/core/standings?league=${encodeURIComponent(l.leagueId)}`}>Standings</Link>
                    <Link href={`/core/trades?league=${encodeURIComponent(l.leagueId)}`}>Trades</Link>
                    <Link href={`/core/draft-hq?league=${encodeURIComponent(l.leagueId)}`}>Draft</Link>
                    {l.youCommission ? (
                      <Link className="afh-card-commissioner" href={`/core/commissioner?league=${encodeURIComponent(l.leagueId)}`}>
                        Commissioner
                      </Link>
                    ) : null}
                  </nav>
                </article>
              ))}
            </div>
            {data.totalLeagues > data.leagues.length ? (
              <p className="afh-row-detail" style={{ margin: 0 }}>
                Showing {data.leagues.length} of {data.totalLeagues}. Every league is in{' '}
                <Link className="afh-link" href="/core/portfolio">
                  Portfolio →
                </Link>
              </p>
            ) : null}
          </section>

          <div className="afh-pair">
            <section className="afh-panel" aria-labelledby="afh-trades">
              <div className="afh-panel-head">
                <h2 id="afh-trades" className="afh-label" style={{ margin: 0 }}>
                  {theme.tradesLabel}
                </h2>
                <div className="afh-seg" role="group" aria-label="Trade status">
                  <button type="button" aria-pressed={tradesTab === 'pending'} onClick={() => setTradesTab('pending')}>
                    Pending
                  </button>
                  <button type="button" aria-pressed={tradesTab === 'completed'} onClick={() => setTradesTab('completed')}>
                    Completed
                  </button>
                </div>
              </div>
              {tradeRows == null ? (
                <p className="afh-none">Trades couldn’t be read just now. This is a read failure, not an empty trade log.</p>
              ) : tradeRows.length === 0 ? (
                <p className="afh-none">
                  {tradesTab === 'pending' ? 'No offers waiting in these leagues.' : 'No completed trades on file for these leagues.'}
                </p>
              ) : (
                tradeRows.map((t) => (
                  <div className="afh-row" key={t.id}>
                    <div className="afh-row-main">
                      <span className="afh-row-title">{t.title}</span>
                      <span className="afh-row-detail">{t.detail}</span>
                    </div>
                    <span className="afh-chip" data-tone={tradesTab === 'pending' ? 'warn' : 'accent'}>
                      {tradesTab === 'pending' ? 'Pending' : 'Done'}
                    </span>
                  </div>
                ))
              )}
            </section>

            <section className="afh-panel" aria-labelledby="afh-mentions">
              <div className="afh-panel-head">
                <h2 id="afh-mentions" className="afh-label" style={{ margin: 0 }}>
                  {theme.mentionsLabel}
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
              <HubBroadcast label={theme.broadcastLabel} leagueIds={data.broadcastLeagueIds} />
            </section>
          </div>
        </>
      ) : (
        <section className="afh-empty">
          <div>
            <h2>{theme.emptyTitle}</h2>
            <p>
              This hub fills in by itself the moment one of your leagues is a {theme.tab} league — imported or created.
              {data.partial ? ' Some league data couldn’t be read just now, so this count may be low.' : ''}
            </p>
          </div>
          <button type="button" className="afh-btn" onClick={() => setConnectOpen(true)}>
            {theme.connect}
          </button>
        </section>
      )}

      <footer className="afh-foot">
        <p>
          {theme.foot}
          {has && data.partial ? ' Some figures couldn’t be read just now and may be low.' : ''}
        </p>
        <Link className="afh-link" href="/core/commissioner">
          Commissioner hub →
        </Link>
      </footer>
    </div>
  )
}
