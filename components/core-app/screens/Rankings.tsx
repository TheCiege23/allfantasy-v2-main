import Link from 'next/link'
import { getLevelIcon } from '@/lib/rank/levels'
import {
  SCORE_WEIGHTS,
  filterParams,
  type ManagerScore,
  type SortKey,
} from '@/lib/core-app/rankingsEngine'
import type {
  BoardTableRow,
  GlobalView,
  LadderTier,
  LeagueView,
  Movement,
  PortfolioView,
  RankingsData,
  XpRow,
} from '@/lib/core-app/rankings'
import '@/components/core-app/af-rankings-screen.css'
import { WorkbookBarChart } from '@/components/core-app/charts/WorkbookChart'
import { RankTable, type RankColumn, type RankRow } from '@/components/core-app/rankings/RankTable'
import { TrendLine } from '@/components/core-app/rankings/TrendLine'
import { RankingsFilterBar } from '@/components/core-app/rankings/RankingsFilterBar'
import { ShareMomentButton } from '@/components/core-app/screens/ShareMomentButton'

/**
 * Rankings — handoff 14a, rebuilt around three separate scopes.
 *
 * ⚠ COMMUNITY, PORTFOLIO AND LEAGUE ARE TABS, NOT SECTIONS OF ONE PAGE. The
 * previous screen stacked a portfolio count card over a community leaderboard
 * beside your personal XP, so "#1" could be read as any of the three. Each scope
 * now has its own heading, its own explanation and its own freshness line.
 *
 * ⚠ EVERY RANK CAN BE EXPLAINED. A community row links to `?explain=` — the
 * same page with that manager's components, the measurement behind each, and
 * the weight it carried. Nothing on the board is a number without a reason.
 *
 * ⚠ THE POPULATION IS STATED, NOT IMPLIED. Seven managers were ranked on
 * production when this was written. A board that says "#1" without "of 7" lets
 * a seven-person list pass as a global standing.
 *
 * Server-rendered throughout. The table is the only client component, and only
 * because windowing a long list needs to know the scroll position.
 */

const ET: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York' }

function fmtDate(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleDateString('en-US', { ...ET, month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * A `YYYY-MM-DD` calendar key (a snapshot date), formatted as that same day.
 * ⚠ NOT `fmtDate`: `new Date('2026-09-09')` is UTC midnight, which is still
 * Sep 8 in New York — formatting it in Eastern time printed the day before.
 */
function fmtDay(key: string | null): string {
  if (!key) return 'never'
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtStamp(iso: string | null): string {
  if (!iso) return 'unknown'
  return `${new Date(iso).toLocaleString('en-US', { ...ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

function qs(pairs: Array<[string, string | null | undefined]>): string {
  const p = new URLSearchParams()
  for (const [k, v] of pairs) if (v != null && v !== '') p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

function moveText(n: number | null): { text: string; tone?: 'good' | 'bad' | 'muted'; label: string } {
  if (n == null) return { text: '—', tone: 'muted', label: 'not tracked' }
  if (n === 0) return { text: '=', tone: 'muted', label: 'no change' }
  return n > 0
    ? { text: `▲${n}`, tone: 'good', label: `up ${n} ${n === 1 ? 'place' : 'places'}` }
    : { text: `▼${-n}`, tone: 'bad', label: `down ${-n} ${n === -1 ? 'place' : 'places'}` }
}

/* ────────────────────────────── scope tabs ──────────────────────────────── */

const SCOPES = [
  { key: 'global', label: 'Community', hint: 'Every ranked AllFantasy manager' },
  { key: 'portfolio', label: 'My portfolio', hint: 'You, across all your imports' },
  { key: 'league', label: 'One league', hint: 'A single league’s standings' },
] as const

function ScopeTabs({ data, leagueId }: { data: RankingsData; leagueId: string | null }) {
  const keep = filterParams(data.filters)
  return (
    <nav className="af-rk-scopes" aria-label="Ranking scope">
      {SCOPES.map((s) => {
        const href = `/core/rankings${qs([
          ['scope', s.key === 'global' ? null : s.key],
          ['league', s.key === 'league' ? leagueId : null],
          ...(s.key === 'league' ? [] : keep),
        ])}`
        const current = data.scope === s.key
        return (
          <Link key={s.key} href={href} className="af-rk-scope-tab" aria-current={current ? 'page' : undefined}>
            <b>{s.label}</b>
            <small>{s.hint}</small>
          </Link>
        )
      })}
    </nav>
  )
}

/* ─────────────────────────── shared score pieces ────────────────────────── */

function MovementChips({ m, tracked }: { m: Movement; tracked: boolean }) {
  const items: Array<[string, number | null]> = [
    ['7 days', m.sevenDay],
    ['This week', m.week],
    ['Since last season', m.season],
  ]
  return (
    <ul className="af-rk-moves" aria-label="Rank movement on the Overall board">
      {items.map(([label, n]) => {
        const t = moveText(n)
        return (
          <li key={label} className={t.tone ? `af-rk-tone-${t.tone}` : undefined}>
            <span>{label}</span>
            <b aria-label={`${label}: ${t.label}`}>{t.text}</b>
          </li>
        )
      })}
      {!tracked ? <li className="af-rk-moves-note">Movement is tracked on the unfiltered Overall board.</li> : null}
    </ul>
  )
}

function ComponentBars({ score }: { score: ManagerScore }) {
  return (
    <table className="af-rk-components">
      <caption className="af-rk-sr">How the AF manager score is built</caption>
      <thead>
        <tr>
          <th scope="col">Component</th>
          <th scope="col">Measured</th>
          <th scope="col" className="af-rk-right">
            Weight
          </th>
          <th scope="col" className="af-rk-right">
            Points
          </th>
        </tr>
      </thead>
      <tbody>
        {score.components.map((c) => (
          <tr key={c.key} className={c.available ? undefined : 'af-rk-muted-row'}>
            <th scope="row">
              {c.label}
              <span className="af-rk-cellsub">{c.basis}</span>
            </th>
            <td>
              {c.value}
              <div className="af-rk-xpbar" aria-hidden="true">
                <i style={{ width: `${Math.round((c.credit ?? 0) * 100)}%` }} />
              </div>
              <span className="af-rk-cellsub">{c.explain}</span>
            </td>
            <td className="af-rk-right">
              {c.available ? `${Math.round(c.appliedWeight * 100)}%` : 'not measured'}
              {c.available && Math.abs(c.appliedWeight - c.weight) > 0.001 ? (
                <span className="af-rk-cellsub">nominal {Math.round(c.weight * 100)}%</span>
              ) : null}
            </td>
            <td className="af-rk-right af-rk-mono">{c.available ? c.points.toFixed(1) : '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={3}>
            AF manager score
          </th>
          <td className="af-rk-right af-rk-mono">{score.score == null ? '—' : score.score.toFixed(1)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

function ConfidenceTag({ c }: { c: ManagerScore['confidence'] }) {
  const text = c === 'high' ? 'High confidence' : c === 'medium' ? 'Medium confidence' : 'Low confidence'
  return <span className={`af-rk-chip ${c === 'high' ? 'af-rk-chip--good' : c === 'low' ? 'af-rk-chip--warn' : ''}`}>{text}</span>
}

/* ─────────────────────────────── community ──────────────────────────────── */

const SORTABLE: Array<{ key: SortKey; col: string }> = [
  { key: 'rank', col: 'rank' },
  { key: 'manager', col: 'manager' },
  { key: 'winRate', col: 'winRate' },
  { key: 'titles', col: 'titles' },
  { key: 'playoffs', col: 'playoffs' },
  { key: 'scoring', col: 'scoring' },
  { key: 'sample', col: 'sample' },
  { key: 'move', col: 'move' },
]

function boardColumns(g: GlobalView, data: RankingsData): RankColumn[] {
  const base: Array<[string, string]> = [
    ...(data.baseQuery ? [...new URLSearchParams(data.baseQuery.slice(1)).entries()] : []),
  ]
  const sortHref = (key: SortKey) => {
    const nextDir = g.sort === key ? (g.dir === 'asc' ? 'desc' : 'asc') : key === 'rank' || key === 'manager' ? 'asc' : 'desc'
    return `/core/rankings${qs([...base, ['sort', key === 'rank' ? null : key], ['dir', key === 'rank' && nextDir === 'asc' ? null : nextDir]])}`
  }
  const state = (key: SortKey): RankColumn['sort'] =>
    g.sort === key ? (g.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  const sortable = (key: SortKey) => (SORTABLE.some((s) => s.key === key) ? { sortHref: sortHref(key), sort: state(key) } : {})
  return [
    { key: 'rank', label: '#', srLabel: 'Rank', align: 'right', ...sortable('rank') },
    { key: 'manager', label: 'Manager', ...sortable('manager') },
    { key: 'metric', label: g.label === 'Overall' ? 'Score' : g.label, srLabel: g.metricLabel, align: 'right' },
    { key: 'winRate', label: 'Win %', srLabel: 'Adjusted win rate', align: 'right', hideOnPhone: true, ...sortable('winRate') },
    { key: 'titles', label: 'Titles', srLabel: 'Titles won over titles expected', align: 'right', hideOnPhone: true, ...sortable('titles') },
    { key: 'playoffs', label: 'Playoffs', srLabel: 'Playoff berths against expectation', align: 'right', hideOnPhone: true, ...sortable('playoffs') },
    { key: 'scoring', label: 'Scoring', srLabel: 'Scoring index, 100 is average', align: 'right', hideOnPhone: true, ...sortable('scoring') },
    { key: 'sample', label: 'Sample', srLabel: 'League-seasons and games with results', align: 'right', hideOnPhone: true, ...sortable('sample') },
    { key: 'move', label: '7d', srLabel: 'Places moved in seven days', align: 'center', ...sortable('move') },
    { key: 'why', label: 'Why', srLabel: 'Explain this rank', align: 'center' },
  ]
}

function boardRows(rows: BoardTableRow[]): RankRow[] {
  return rows.map((r) => {
    const m = moveText(r.movement)
    return {
      id: r.userId,
      highlight: r.isYou,
      cells: [
        { text: String(r.rank), tone: r.isYou ? 'accent' : undefined },
        {
          text: `@${r.handle}${r.isYou ? ' (you)' : ''}`,
          href: r.compareHref ?? undefined,
          title: r.compareHref ? `Compare your career with @${r.handle}` : undefined,
          sub: `Lvl ${r.level} · ${r.confidence} confidence${r.updated ? ` · data ${fmtDate(r.updated)}` : ''}`,
        },
        { text: r.metric, tone: r.isYou ? 'accent' : undefined },
        { text: r.winRate },
        { text: r.titles },
        { text: r.playoffs },
        { text: r.scoring },
        { text: r.sample },
        { text: m.text, tone: m.tone, title: m.label },
        { text: 'Why', href: r.explainHref, title: `Explain #${r.rank} @${r.handle}` },
      ],
    }
  })
}

function ExplainPanel({ g, data }: { g: GlobalView; data: RankingsData }) {
  const ex = g.explain
  if (!ex) return null
  const s = ex.score
  const close = `/core/rankings${data.baseQuery}`
  return (
    <section className="af-rk-card af-rk-explain" id="rk-explain" aria-labelledby="rk-explain-h">
      <div className="af-rk-explain-head">
        <h2 id="rk-explain-h" className="af-rk-q">
          Why @{ex.handle} is #{ex.rank} on {g.label}
        </h2>
        <ConfidenceTag c={s.confidence} />
        <Link className="af-rk-btn" href={close} scroll={false}>
          Close
        </Link>
      </div>
      <p className="af-rk-a">
        Scored over {s.sample.resultSeasons} league-seasons with results ({s.sample.games.toLocaleString()} games,{' '}
        {s.sample.completedSeasons} completed) across {s.sample.seasons} {s.sample.seasons === 1 ? 'year' : 'years'}
        {data.filtersLabel !== 'All leagues' ? `, filtered to ${data.filtersLabel}` : ''}. Average field{' '}
        {s.field.avgSize == null ? 'unknown' : `${s.field.avgSize} teams`}
        {s.field.avgPlayoffShare == null ? '' : `, ${Math.round(s.field.avgPlayoffShare * 100)}% of each league makes the playoffs`}.
      </p>
      <ComponentBars score={s} />
      <p className="af-rk-note">
        Newest data behind this row: {fmtDate(s.newestUpdate)}. Opponent quality is not part of the score — imported
        history stores only each manager&apos;s own roster, so the field is judged by its size and playoff cut instead.
      </p>
    </section>
  )
}

function CommunityView({ data, g }: { data: RankingsData; g: GlobalView }) {
  return (
    <>
      {g.you ? (
        <section className="af-rk-card af-rk-youstrip" aria-label="Your place on this board">
          <div>
            <p className="af-rk-eyebrow">You on {g.label}</p>
            <p className="af-rk-bigrank">
              #{g.you.rank}
              <small> of {g.you.of}</small>
            </p>
            <p className="af-rk-sub">
              {g.metricLabel}: <b>{g.you.display}</b>
            </p>
          </div>
          <MovementChips m={g.you.movement} tracked={g.movementTracked} />
          <div className="af-rk-headact">
            <Link className="af-rk-btn" href={`${g.rows.find((r) => r.isYou)?.explainHref ?? '#'}`} scroll={false}>
              Why this rank?
            </Link>
            <Link className="af-rk-btn" href={`/core/rankings${qs([['scope', 'portfolio'], ...filterParams(data.filters)])}`}>
              My portfolio
            </Link>
          </div>
        </section>
      ) : data.signedIn ? (
        <p className="af-rk-note">
          You are not on this board yet — it needs {data.filters.minSample}+ league-seasons with results
          {data.filtersLabel !== 'All leagues' ? ` in ${data.filtersLabel}` : ''}. Your portfolio tab shows everything you have imported.
        </p>
      ) : null}

      <ExplainPanel g={g} data={data} />

      <section className="af-rk-card">
        <nav className="af-rk-tabs" aria-label="Leaderboards">
          {g.tabs.map((t) => (
            <Link key={t.key} href={t.href} className="af-rk-tab" aria-current={t.key === g.board ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>

        <p className="af-rk-eyebrow">
          {g.label}
          <span className="af-rk-spacer" />
          <span>{g.metricLabel}</span>
        </p>

        {g.unavailable ? (
          <p className="af-rk-empty">{g.unavailable}</p>
        ) : (
          <RankTable
            caption={`${g.label} — ${data.filtersLabel}`}
            columns={boardColumns(g, data)}
            rows={boardRows(g.rows)}
            emptyText={
              g.belowSample > 0
                ? `Nobody has ${data.filters.minSample}+ league-seasons with results in ${data.filtersLabel}. Lower the minimum sample to see ${g.belowSample} more ${g.belowSample === 1 ? 'manager' : 'managers'}.`
                : `No ranked manager has results in ${data.filtersLabel}.`
            }
          />
        )}

        <p className="af-rk-note">
          {data.population === 0
            ? 'No manager has been ranked yet.'
            : `Ranked across ${g.rows.length} of the ${data.population} ${data.population === 1 ? 'manager' : 'managers'} whose careers have been scored — not the whole user base.`}
          {g.belowSample > 0
            ? ` ${g.belowSample} more ${g.belowSample === 1 ? 'is' : 'are'} under the ${data.filters.minSample}-league-season minimum.`
            : ''}
          {g.unmeasured > 0 ? ` ${g.unmeasured} ${g.unmeasured === 1 ? 'has' : 'have'} nothing this board can measure.` : ''}
          {g.movementTracked
            ? g.trackingSince
              ? ` Movement is measured against daily snapshots kept since ${fmtDay(g.trackingSince)}.`
              : ' Movement starts once the first daily snapshot is written.'
            : ' Movement is shown on the unfiltered Overall board only.'}
        </p>
        <p className="af-rk-fresh">
          <b>Freshness</b> Built from {g.freshness.ledgerRows.toLocaleString()} league-seasons · newest import{' '}
          {fmtDate(g.freshness.newestImport)} · least recently updated manager {fmtDate(g.freshness.stalestManager)} ·
          calculated {fmtStamp(data.computedAt)}
        </p>
      </section>

      <MethodCard />
    </>
  )
}

function MethodCard() {
  const pct = (n: number) => `${Math.round(n * 100)}%`
  return (
    <section className="af-rk-card">
      <p className="af-rk-eyebrow">How the Overall board is scored</p>
      <ul className="af-rk-method">
        <li>
          <b>Win rate · {pct(SCORE_WEIGHTS.winRate)}</b> per game, so a 13- and a 17-week season weigh by games played.
        </li>
        <li>
          <b>Scoring · {pct(SCORE_WEIGHTS.scoring)}</b> points per game against teams in the same sport, season and scoring
          format.
        </li>
        <li>
          <b>Titles · {pct(SCORE_WEIGHTS.titles)}</b> against each league’s 1-in-N chance, so bigger fields count for more.
        </li>
        <li>
          <b>Playoffs · {pct(SCORE_WEIGHTS.playoffs)}</b> against each league’s own playoff cut.
        </li>
      </ul>
      <p className="af-rk-note">
        Platform and league type never change a score — they are filters. Small samples are pulled toward average.{' '}
        <Link href="/core/rankings?view=faq#rk-faq-score">Full method →</Link>
      </p>
    </section>
  )
}

/* ─────────────────────────────── portfolio ──────────────────────────────── */

function YourRankCard({ data }: { data: RankingsData }) {
  const you = data.you
  if (!you) {
    return (
      <section className="af-rk-card">
        <p className="af-rk-eyebrow">Your rank</p>
        <p className="af-rk-a">
          {data.signedIn
            ? 'Nothing you have imported has a season result yet. Import a league and your XP, level and tier appear here.'
            : 'Sign in to see where you sit on the ladder. The tiers and their thresholds are the same for everyone.'}
        </p>
      </section>
    )
  }
  return (
    <section className="af-rk-card">
      <div className="af-rk-rank-top">
        <p className="af-rk-eyebrow" style={{ margin: 0 }}>
          Your level
        </p>
        <span className="af-rk-level">
          LEVEL {you.level} OF {you.totalLevels}
        </span>
      </div>
      <div className="af-rk-rankid">
        <span className="af-rk-crest" aria-hidden="true">
          {getLevelIcon(you.tierGroup)}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="af-rk-rankname">{you.levelName}</p>
          <p className="af-rk-ranktier">{you.tier} tier</p>
        </div>
      </div>
      <p className="af-rk-xp">
        {you.xp.toLocaleString()}
        <small>XP</small>
      </p>
      <div
        className="af-rk-bar"
        role="progressbar"
        aria-valuenow={you.progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress to the next level"
      >
        <i style={{ width: `${you.progressPct}%` }} />
      </div>
      <p className="af-rk-next">
        {you.xpToNext != null && you.nextLevelName ? (
          <>
            {you.xpToNext.toLocaleString()} XP to <b>{you.nextLevelName}</b>.
          </>
        ) : (
          <>
            <b>Level {you.totalLevels}</b> — the last rung.
          </>
        )}
      </p>
    </section>
  )
}

const XP_BAR_TONE: Record<XpRow['key'], string> = {
  wins: '',
  championships: 'af-rk-xpbar--warn',
  playoffs: 'af-rk-xpbar--good',
  seasons: '',
  leagueSize: '',
}

function XpBreakdownCard({ data }: { data: RankingsData }) {
  if (!data.you || data.xpRows.length === 0) return null
  const rec = data.reconciliation
  return (
    <section className="af-rk-card">
      <p className="af-rk-eyebrow">Where your XP came from</p>
      {data.xpRows.map((r) => (
        <div className="af-rk-xprow" key={r.key}>
          <div className="af-rk-xpline">
            <span className="af-rk-xplabel">{r.detail}</span>
            <span className="af-rk-xpval">{r.xp.toLocaleString()}</span>
          </div>
          {r.hasBar ? (
            <div className={`af-rk-xpbar ${XP_BAR_TONE[r.key]}`} aria-hidden="true">
              <i style={{ width: `${Math.round(r.share * 100)}%` }} />
            </div>
          ) : null}
        </div>
      ))}
      <div className="af-rk-total">
        <b>Total</b>
        <span>{data.you.xp.toLocaleString()}</span>
      </div>
      {rec && !rec.matches ? (
        <p className="af-rk-note af-rk-note--warn">
          Your saved total is {rec.stored?.toLocaleString()} XP, written {fmtDate(rec.storedAt)}. The published rules over
          the leagues on file today give {rec.computed.toLocaleString()}, which is the figure shown here. They will agree
          after your next import recalculates your rank.
        </p>
      ) : null}
      <p className="af-rk-note">
        XP is a ladder, not a ranking: losses never subtract, and imported Sleeper, ESPN and Yahoo seasons count the same
        as leagues played here. Playoff berths only count once games have been played.
      </p>
    </section>
  )
}

function Ladder({ tiers }: { tiers: LadderTier[] }) {
  return (
    <section className="af-rk-card">
      <p className="af-rk-eyebrow">
        The ladder
        <span className="af-rk-spacer" />
        <span>
          {tiers.reduce((n, t) => n + (t.lastLevel - t.firstLevel + 1), 0)} levels · {tiers.length} tiers
        </span>
      </p>
      <ol className="af-rk-ladder">
        {tiers.map((t) => (
          <li
            key={t.group}
            className={`af-rk-rung${t.isCurrent ? ' af-rk-rung--current' : ''}`}
            style={{ ['--rung-color' as string]: t.color }}
            aria-current={t.isCurrent ? 'step' : undefined}
          >
            <span className="af-rk-rung-icon" aria-hidden="true">
              {getLevelIcon(t.group)}
            </span>
            <div className="af-rk-rung-body">
              <p className="af-rk-rung-name">
                {t.tier}
                {t.isCurrent ? <span className="af-rk-here">YOU ARE HERE</span> : null}
              </p>
              <p className="af-rk-rung-subs">{t.subRanks.join(' · ')}</p>
            </div>
            <span className="af-rk-rung-xp">
              {t.maxXp == null ? `${t.minXp.toLocaleString()}+` : `${t.minXp.toLocaleString()} – ${t.maxXp.toLocaleString()}`}
            </span>
          </li>
        ))}
      </ol>
      <div className="af-rk-ladder-foot">
        <span>Levels are absolute — nobody is demoted because someone else climbed.</span>
        <Link href="/core/rankings?view=faq">Read the FAQ →</Link>
      </div>
    </section>
  )
}

function portfolioColumns(p: PortfolioView, data: RankingsData): RankColumn[] {
  const base: Array<[string, string]> = [['scope', 'portfolio'], ...filterParams(data.filters)]
  const col = (key: PortfolioView['psort']) => {
    const nextDir = p.psort === key ? (p.pdir === 'asc' ? 'desc' : 'asc') : 'desc'
    return {
      sortHref: `/core/rankings${qs([...base, ['psort', key === 'season' ? null : key], ['pdir', key === 'season' && nextDir === 'desc' ? null : nextDir]])}`,
      sort: (p.psort === key ? (p.pdir === 'asc' ? 'ascending' : 'descending') : 'none') as RankColumn['sort'],
    }
  }
  return [
    { key: 'season', label: 'Season', align: 'right', ...col('season') },
    { key: 'league', label: 'League' },
    { key: 'platform', label: 'Platform', hideOnPhone: true },
    { key: 'type', label: 'Type', hideOnPhone: true },
    { key: 'format', label: 'Format', hideOnPhone: true },
    { key: 'size', label: 'Teams', srLabel: 'Teams and playoff cut', align: 'right', hideOnPhone: true, ...col('size') },
    { key: 'record', label: 'Record', align: 'right', ...col('record') },
    { key: 'ppg', label: 'PPG', srLabel: 'Points per game', align: 'right', hideOnPhone: true },
    { key: 'index', label: 'Index', srLabel: 'Scoring index, 100 is average for the format', align: 'right', ...col('index') },
    { key: 'finish', label: 'Finish' },
  ]
}

function PortfolioBody({ data, p }: { data: RankingsData; p: PortfolioView }) {
  const s = p.score
  return (
    <>
      <div className="af-rk-pgrid">
        <div className="af-rk-col">
          <section className="af-rk-card">
            <div className="af-rk-rank-top">
              <p className="af-rk-eyebrow" style={{ margin: 0 }}>
                My AF manager score · {data.filtersLabel}
              </p>
              <ConfidenceTag c={s.confidence} />
            </div>
            <p className="af-rk-xp">
              {s.score == null ? '—' : s.score.toFixed(1)}
              <small>/ 100</small>
            </p>
            <p className="af-rk-next">
              {p.globalRank
                ? `#${p.globalRank.rank} of ${p.globalRank.of} on the unfiltered community board.`
                : 'Not on the community board yet.'}{' '}
              {s.sample.resultSeasons} league-seasons with results, {s.sample.games.toLocaleString()} games,{' '}
              {s.sample.leagueSeasons - s.sample.resultSeasons} not yet played or draft-only.
            </p>
            <MovementChips m={p.movement} tracked />
          </section>
          <YourRankCard data={data} />
        </div>
        <div className="af-rk-col">
          <XpBreakdownCard data={data} />
        </div>
      </div>

      <section className="af-rk-card">
        <p className="af-rk-eyebrow">Where my score comes from</p>
        {s.score == null ? (
          <p className="af-rk-empty">No league-season in this view has a result yet, so there is nothing to score.</p>
        ) : (
          <ComponentBars score={s} />
        )}
      </section>

      <section className="af-rk-card">
        <p className="af-rk-eyebrow">Trends</p>
        <div className="af-rk-trends">
          <TrendLine
            title="7-day rank"
            invert
            points={p.daily.map((d) => ({ label: d.label, value: d.rank }))}
            format={(n) => String(n)}
            empty={p.trackingSince ? 'No daily snapshot in the last week includes you.' : 'Daily snapshots have not started yet.'}
          />
          <TrendLine
            title="Weekly rank"
            invert
            points={p.weekly.map((d) => ({ label: `Week of ${d.label}`, value: d.rank }))}
            format={(n) => String(n)}
            empty={p.trackingSince ? `Weekly points start ${fmtDay(p.trackingSince)}; none recorded yet.` : 'Weekly snapshots have not started yet.'}
          />
          <TrendLine
            title="Score by season"
            points={p.seasons.map((t) => ({ label: `${t.season} (${t.record})`, value: t.seasonScore }))}
            empty="No season has a result yet."
          />
          <TrendLine
            title="Career score"
            points={p.seasons.map((t) => ({ label: `Through ${t.season}`, value: t.careerScore }))}
            empty="No season has a result yet."
          />
        </div>
        <p className="af-rk-note">
          Season and career lines are computed from your league-seasons. Daily and weekly lines come only from
          snapshots taken at the time{p.trackingSince ? `, kept since ${fmtDay(p.trackingSince)}` : ''} — they are never
          rebuilt after the fact.
        </p>
      </section>

      <section className="af-rk-card">
        <p className="af-rk-eyebrow">
          My league-seasons
          <span className="af-rk-spacer" />
          <span>{p.rows.length.toLocaleString()} rows</span>
        </p>
        <RankTable
          caption={`My league-seasons — ${data.filtersLabel}`}
          columns={portfolioColumns(p, data)}
          rows={p.rows.map((r) => ({
            id: r.key,
            cells: [
              { text: String(r.season) },
              { text: r.league, sub: r.counted ? undefined : 'not counted — no games yet' },
              { text: r.platform },
              { text: r.type },
              { text: r.format },
              { text: r.size },
              { text: r.record },
              { text: r.ppg },
              { text: r.index },
              {
                text: r.finish,
                tone: r.finish === 'Champion' ? 'warn' : r.finish === 'Playoffs' ? 'good' : r.counted ? undefined : 'muted',
              },
            ],
          }))}
          emptyText={`You have no league-seasons in ${data.filtersLabel}.`}
        />
        <p className="af-rk-fresh">
          <b>Freshness</b> {p.freshness.ledgerRows.toLocaleString()} league-seasons · newest import{' '}
          {fmtDate(p.freshness.newestImport)} · rank last saved {fmtDate(p.freshness.rankCalculatedAt)} · calculated{' '}
          {fmtStamp(data.computedAt)}
        </p>
      </section>

      <Ladder tiers={data.ladder} />
    </>
  )
}

/* ──────────────────────────────── league ────────────────────────────────── */

function LeagueBody({ league }: { league: LeagueView }) {
  if (!league.selected) {
    return (
      <section className="af-rk-card">
        <p className="af-rk-eyebrow">Pick a league</p>
        {league.leagues.length === 0 ? (
          <p className="af-rk-empty">You have no connected leagues yet. Import one to see its standings here.</p>
        ) : (
          <ul className="af-rk-leaguepick">
            {league.leagues.map((l) => (
              <li key={l.id}>
                <Link href={`/core/rankings?scope=league&league=${encodeURIComponent(l.id)}`}>
                  <b>{l.name}</b>
                  <small>
                    {l.platform} · {l.season}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  const sel = league.selected
  const board = league.board
  return (
    <section className="af-rk-card">
      <div className="af-rk-explain-head">
        <div>
          <p className="af-rk-eyebrow">One league · {sel.platform} · {sel.season}</p>
          <h2 className="af-rk-q" style={{ margin: 0 }}>
            {sel.name}
          </h2>
        </div>
        <div className="af-rk-headact">
          <Link className="af-rk-btn" href={`/core/rankings?view=compare&kind=teams&league=${encodeURIComponent(sel.id)}`}>
            Compare two teams
          </Link>
          <Link className="af-rk-btn" href="/core/rankings?scope=league">
            Other leagues
          </Link>
        </div>
      </div>
      <p className="af-rk-note" style={{ marginTop: 0 }}>
        This league&apos;s own results only, ranked by points for. Career XP and the community score play no part here.
      </p>

      {!board || !board.available ? (
        <p className="af-rk-empty">{board?.reason ?? 'League standings could not be read just now.'}</p>
      ) : (
        <div className="af-rk-scope-grid">
          <RankTable
            caption={`${sel.name} standings`}
            rowHeaderIndex={1}
            columns={[
              { key: 'rank', label: '#', srLabel: 'Points rank', align: 'right' },
              { key: 'team', label: 'Team' },
              { key: 'record', label: 'Record', align: 'right' },
              { key: 'pf', label: 'PF', srLabel: 'Points for', align: 'right' },
              { key: 'avg', label: 'Avg', srLabel: 'Points per scored week', align: 'right', hideOnPhone: true },
              { key: 'move', label: 'Wk', srLabel: 'Places moved since last week', align: 'center' },
            ]}
            rows={board.rows.map((r) => {
              const m = moveText(r.movement)
              return {
                id: r.rosterId,
                highlight: r.isYou,
                cells: [
                  { text: String(r.rank) },
                  { text: `${r.name}${r.isYou ? ' (you)' : ''}` },
                  { text: r.record },
                  { text: Math.round(r.pointsFor).toLocaleString() },
                  { text: r.average == null ? '—' : r.average.toFixed(1) },
                  { text: m.text, tone: m.tone, title: m.label },
                ],
              }
            })}
            emptyText="No team in this league has a scored week yet."
          />
          <WorkbookBarChart
            title="Points for"
            subtitle="Top ten, same data as the table"
            valueLabel="Points"
            data={board.rows.slice(0, 10).map((row) => ({
              label: row.name,
              value: row.pointsFor,
              displayValue: Math.round(row.pointsFor).toLocaleString(),
              tone: row.isYou ? 'good' : 'accent',
            }))}
          />
        </div>
      )}
      <p className="af-rk-fresh">
        <b>Freshness</b> league last synced {fmtStamp(sel.lastSyncedAt)}
        {board?.available && board.week != null ? ` · through week ${board.week}${board.seasonComplete ? ' (season complete)' : ''}` : ''}
      </p>
    </section>
  )
}

/* ─────────────────────────────── the screen ─────────────────────────────── */

export function Rankings({ data, leagueId = null }: { data: RankingsData; leagueId?: string | null }) {
  const compareHref = `/core/rankings${qs([['view', 'compare'], ...filterParams(data.filters)])}`
  const hidden: Array<[string, string]> = [
    ...(data.scope !== 'global' ? ([['scope', data.scope]] as Array<[string, string]>) : []),
    ...(data.global && data.global.board !== 'overall' ? ([['board', data.global.board]] as Array<[string, string]>) : []),
  ]
  const resetHref = `/core/rankings${qs(hidden)}`

  return (
    <div className="af-rk">
      <header className="af-rk-head">
        <div>
          <h1 className="af-rk-title">Rankings</h1>
          <p className="af-rk-sub">
            Calculated {fmtStamp(data.computedAt)} from {data.population} ranked{' '}
            {data.population === 1 ? 'manager' : 'managers'}
          </p>
        </div>
        <div className="af-rk-headact">
          {data.shareUrl ? (
            <span className="af-rk-share">
              <ShareMomentButton url={data.shareUrl} filename="allfantasy-rank.png" title="My AllFantasy rank" label="Share rank card" />
            </span>
          ) : null}
          <Link className="af-rk-btn" href={compareHref}>
            Compare
          </Link>
          <Link className="af-rk-btn af-rk-btn--primary" href="/core/rankings?view=faq">
            How ranking works
          </Link>
        </div>
      </header>

      <ScopeTabs data={data} leagueId={leagueId} />

      {data.scope !== 'league' ? (
        <RankingsFilterBar
          filters={data.filters}
          options={data.options}
          hidden={hidden}
          resetHref={resetHref}
        />
      ) : null}

      {data.scope === 'global' && data.global ? (
        <CommunityView data={data} g={data.global} />
      ) : data.scope === 'portfolio' ? (
        data.portfolio ? (
          <PortfolioBody data={data} p={data.portfolio} />
        ) : (
          <section className="af-rk-card">
            <p className="af-rk-a">Sign in to see your own portfolio ranking — your score, your XP and every league-season behind them.</p>
          </section>
        )
      ) : data.league ? (
        data.signedIn ? (
          <LeagueBody league={data.league} />
        ) : (
          <section className="af-rk-card">
            <p className="af-rk-a">Sign in to see the standings of your own leagues.</p>
          </section>
        )
      ) : null}
    </div>
  )
}
