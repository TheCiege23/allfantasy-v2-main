import Link from 'next/link'

import '@/components/core-app/af-scout.css'
import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { ScoutEdge, ScoutEdgeManager } from '@/lib/competitive-edge/scoutEdgeLoader'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { ScoutData, ScoutedManager, ScoutStanding } from '@/lib/core-app/scout'
import type { Record3, Zone } from '@/lib/core-app/standingsModel'

/**
 * Scout — the first room of the War Room.
 *
 * Every manager in the league, where they stand and how they have played lately, with the one you
 * play this week pinned above the rest and your head-to-head record against them.
 *
 * ── 🛑 WHAT THIS SCREEN REFUSES TO DO ───────────────────────────────────────
 *
 * ❌ IT DOES NOT CHARACTERISE A MANAGER. Every line is a fact from the Standings screen's own table —
 *    seed, record, points, last five results, playoff zone. No label, no score, no "type". See the
 *    loader's header (lib/core-app/scout.ts) for why.
 *
 * ❌ IT DOES NOT COMPUTE A PROJECTION. The matchup's projected score and win odds live on Matchup,
 *    priced through My Team's own lineup rules; a second, simpler number here would disagree with
 *    them. The banner links there instead.
 *
 * ❌ IT DOES NOT HIDE THE BASIS. "Through week 3" is printed before the cards, because it changes how
 *    every record under it reads — the same rule the old coverage line followed.
 */

export type ScoutProps = {
  data: ScoutData
  /**
   * The War Room's other room, and the two screens the opponent banner hands off to.
   *
   * Passed in rather than built here: the league query param belongs to the
   * router, and a screen that assembles its own sibling's href is a screen that
   * can silently disagree with it.
   */
  gamePlanHref: string
  matchupHref: string
  tradesHref: string
  /**
   * Competitive Edge — every other manager's trade and waiver record. Null to a viewer whose plan
   * does not include it: the server never loaded it, and `edgeAccess` draws the lock in its place.
   */
  edge?: SectionState<ScoutEdge> | null
  edgeAccess?: CoreDepthAccess | null
}

/** "Sep 21, 2025" — pinned to en-US and Eastern so the server paint is the only paint. */
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
function day(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : DAY.format(d)
}

/**
 * One manager's record as counts — "7 trades · last Sep 21, 2025 · 12 waiver claims won · $64 FAAB
 * left". Facts only, the Competitive Edge contract: nothing here says what kind of trader they are.
 */
function EdgeLine({ m }: { m: ScoutEdgeManager }) {
  const parts: string[] = []
  if (m.trades != null) {
    const last = day(m.lastTradeAt)
    parts.push(m.trades === 0 ? 'no completed trades' : `${m.trades} ${m.trades === 1 ? 'trade' : 'trades'}${last ? ` · last ${last}` : ''}`)
  }
  if (m.waiverClaims != null) parts.push(`${m.waiverClaims} waiver ${m.waiverClaims === 1 ? 'claim' : 'claims'} won`)
  if (m.faabRemaining != null) parts.push(`$${Math.round(m.faabRemaining).toLocaleString('en-US')} FAAB left`)
  if (parts.length === 0) return null
  return <p className="af-sc-edge af-num">{parts.join(' · ')}</p>
}

/** What the edge counts are measured over — said once, above the cards, like the standings basis. */
function EdgeBasis({ edge, access }: { edge: SectionState<ScoutEdge>; access: CoreDepthAccess | null }) {
  if (!edge.available) {
    return <p className="af-sc-edge-basis">Competitive Edge: {edge.reason.replace(/\.$/, '')}.</p>
  }
  const t = edge.data.trades
  const w = edge.data.waivers
  const seasons = t.available ? t.data.seasons : []
  const span = seasons.length > 1 ? `${[...seasons].sort()[0]}–${[...seasons].sort().slice(-1)[0]}` : seasons[0] ?? null
  return (
    <p className="af-sc-edge-basis">
      <strong>Competitive Edge</strong>
      {' · '}
      {t.available
        ? `completed trades${span ? ` across ${span}` : ''}, read ${day(t.data.asOf) ?? 'recently'}${t.data.stale ? ' (may be out of date)' : ''}`
        : `trades: ${t.reason}`}
      {' · '}
      {w.available
        ? `waiver claims won in ${w.data.season}${w.data.stale ? ' (may be out of date)' : ''} — Sleeper records only winning claims`
        : `waivers: ${w.reason}`}
      .{access ? <> <FreeUntilNote access={access} /></> : null}
    </p>
  )
}

const ZONE_LABEL: Record<Zone, string> = {
  bye: 'Bye spot',
  playoff: 'Playoff spot',
  bubble: 'On the bubble',
  out: 'Outside the playoffs',
  eliminated: 'Eliminated',
}

const ZONE_TONE: Record<Zone, 'good' | 'warn' | 'bad' | 'info'> = {
  bye: 'good',
  playoff: 'good',
  bubble: 'warn',
  out: 'info',
  eliminated: 'bad',
}

function recordText(r: Record3): string {
  return `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}`
}

/** Points with one decimal, pinned to en-US so the server and any client agree on the separator. */
function points(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function gamesBackText(gb: number): string {
  if (gb > 0) return `${gb} GB`
  if (gb < 0) return `${-gb} clear of the cut`
  return 'on the playoff line'
}

/** Last five head-to-head results as chips — the letters carry the meaning, the colour only repeats it. */
function Form({ form }: { form: ScoutStanding['form'] }) {
  if (form.length === 0) return null
  return (
    <span className="af-sc-form" aria-label={`Last ${form.length}: ${form.join(' ')}`}>
      {form.map((r, i) => (
        <span key={i} className="af-sc-form-r" data-r={r} aria-hidden>
          {r}
        </span>
      ))}
    </span>
  )
}

function Facts({ s }: { s: ScoutStanding }) {
  return (
    <dl className="af-sc-facts">
      <div>
        <dt>Seed</dt>
        <dd className="af-num">#{s.seed}</dd>
      </div>
      <div>
        <dt>Record</dt>
        <dd className="af-num">{recordText(s.record)}</dd>
      </div>
      <div>
        <dt>Points for</dt>
        <dd className="af-num">{points(s.pointsFor)}</dd>
      </div>
      <div>
        <dt>Power</dt>
        <dd className="af-num">#{s.powerRank}</dd>
      </div>
    </dl>
  )
}

function ManagerCard({ m, tradesHref, edge }: { m: ScoutedManager; tradesHref: string; edge: ScoutEdgeManager | null }) {
  const s = m.standing
  return (
    <li>
      <article
        className="af-card af-sc-card"
        data-opponent={m.isNextOpponent || undefined}
        data-you={m.isYou || undefined}
      >
        <header className="af-sc-card-head">
          {m.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="af-sc-face" src={m.avatarUrl} alt="" width={36} height={36} loading="lazy" />
          ) : (
            <span className="af-sc-face af-sc-face--none" aria-hidden>
              {m.teamName.charAt(0).toUpperCase()}
            </span>
          )}

          <span className="af-sc-who">
            <span className="af-sc-team">{m.teamName}</span>
            <span className="af-sc-owner">{m.ownerName ?? 'Manager not named'}</span>
          </span>

          {m.isNextOpponent ? (
            <span className="af-sc-tag" data-sev="bad">
              THIS WEEK
            </span>
          ) : m.isYou ? (
            <span className="af-sc-tag" data-sev="info">
              YOU
            </span>
          ) : null}
        </header>

        {s ? (
          <>
            <Facts s={s} />
            <p className="af-sc-line">
              <span className="af-sc-zone" data-tone={ZONE_TONE[s.zone]}>
                {ZONE_LABEL[s.zone]}
              </span>
              {s.gamesBack != null ? <span className="af-num">{gamesBackText(s.gamesBack)}</span> : null}
              <Form form={s.form} />
            </p>
          </>
        ) : (
          <p className="af-sc-unavailable">Not on the standings table yet.</p>
        )}

        {edge ? <EdgeLine m={edge} /> : null}

        {m.isYou ? null : (
          <footer className="af-sc-card-foot">
            {/*
              The Trade Center grades a deal with them, and its Competitive Edge section binds their
              trade record to the positions in that deal — more than the counts above can say.
            */}
            <Link className="af-sc-cta" href={tradesHref}>
              Build a trade &rarr;
            </Link>
          </footer>
        )}
      </article>
    </li>
  )
}

function OpponentBanner({ data, matchupHref, tradesHref }: { data: ScoutData; matchupHref: string; tradesHref: string }) {
  const opp = data.opponent
  if (!opp) return null
  const them = data.managers.available ? data.managers.data.find((m) => m.managerId === opp.managerId) ?? null : null
  const youStanding = data.you?.standing ?? null
  const h2h = opp.headToHead

  return (
    <section className="af-frame af-sc-vs" aria-labelledby="af-sc-vs-h">
      <h2 className="af-label af-sc-vs-label" id="af-sc-vs-h">
        This week{data.week ? ` · week ${data.week.week}` : ''}
      </h2>
      <div className="af-sc-vs-sides">
        <div className="af-sc-vs-side" data-side="you">
          <span className="af-sc-vs-name">{data.you?.teamName ?? 'You'}</span>
          <span className="af-sc-vs-meta af-num">
            {youStanding ? `#${youStanding.seed} · ${recordText(youStanding.record)}` : 'not on the table yet'}
          </span>
        </div>
        <span className="af-sc-vs-v" aria-hidden>
          vs
        </span>
        <div className="af-sc-vs-side" data-side="them">
          <span className="af-sc-vs-name">{opp.teamName}</span>
          <span className="af-sc-vs-meta af-num">
            {them?.standing ? `#${them.standing.seed} · ${recordText(them.standing.record)}` : 'not on the table yet'}
          </span>
          {them?.standing ? <Form form={them.standing.form} /> : null}
        </div>
      </div>
      <p className="af-sc-vs-h2h">
        {h2h ? (
          <>
            You are <span className="af-num">{recordText(h2h)}</span> against them this season.
          </>
        ) : (
          'You have not played them yet this season.'
        )}
      </p>
      <div className="af-sc-vs-links">
        <Link className="af-sc-cta af-sc-cta--primary" href={matchupHref}>
          Projected score &amp; win odds &rarr;
        </Link>
        <Link className="af-sc-cta" href={tradesHref}>
          Build a trade &rarr;
        </Link>
      </div>
    </section>
  )
}

export function Scout({ data, gamePlanHref, matchupHref, tradesHref, edge = null, edgeAccess = null }: ScoutProps) {
  const edgeBy = edge?.available ? edge.data.byManager : null
  return (
    <div className="af-sc">
      <header className="af-frame af-sc-head">
        <div className="af-sc-head-text">
          <h1 className="af-display af-sc-title">Scout · {data.league.name}</h1>
          <p className="af-sc-blurb">
            Where every manager in this league stands, and how they have played lately.
            {data.week ? ` Week ${data.week.week} of ${data.week.seasonYear}.` : ''}
          </p>
        </div>
        {/*
          The War Room's other room. Scout is about WHO you are playing; Game
          Plan is about what you must do before kickoff — different questions,
          so they are two rooms rather than one crowded screen.
        */}
        <Link className="af-sc-switch" href={gamePlanHref}>
          Game plan &rarr;
        </Link>
      </header>

      <OpponentBanner data={data} matchupHref={matchupHref} tradesHref={tradesHref} />

      {/*
        ⚠ BEFORE THE CARDS, ALWAYS. What the records are measured over changes how every one of them
        reads; a basis printed after the evidence is a caveat that arrives too late.
      */}
      {/* Only beside a list: with no managers the list's own reason is the whole story, said once. */}
      {data.managers.available ? (
        <p className="af-sc-basis" data-available={data.basis.available || undefined}>
          {data.basis.available ? (
            <>
              Standings through week <span className="af-num">{data.basis.data.throughWeek}</span> of{' '}
              <span className="af-num">{data.basis.data.season}</span>
              {data.basis.data.seasonComplete ? ' — final' : ''}. {data.basis.data.orderBasis}
            </>
          ) : (
            <>No standings yet: {data.basis.reason.replace(/\.$/, '')}.</>
          )}
        </p>
      ) : null}

      {/*
        Competitive Edge, once, above the cards. A viewer without the plan sees the lock in its place —
        and was never sent the counts (loadScoutEdgeForScreen returns null for them).
      */}
      {data.managers.available ? (
        edgeAccess && !edgeAccess.unlocked ? (
          <CoreDepthLock access={edgeAccess} what="Every manager’s trade and waiver record" />
        ) : edge ? (
          <EdgeBasis edge={edge} access={edgeAccess} />
        ) : null
      ) : null}

      {data.managers.available ? (
        <ul className="af-sc-list">
          {data.managers.data.map((m) => (
            <ManagerCard key={m.managerId} m={m} tradesHref={tradesHref} edge={m.isYou ? null : (edgeBy?.[m.managerId] ?? null)} />
          ))}
        </ul>
      ) : (
        <section className="af-frame af-sc-section">
          <p className="af-sc-unavailable">{data.managers.reason}</p>
        </section>
      )}
    </div>
  )
}

export default Scout
