'use client'

import Link from 'next/link'
import type { CareerData, PrestigeComponent } from '@/lib/core-app/career'
import '@/components/core-app/af-career.css'

/**
 * Career — handoff 13a, desktop frame.
 *
 * ⚠ THIS SCREEN HAS NOW BEEN CUT TWICE. An interim version was invented before
 * any career design existed; 33a replaced that with the trophy room; 13a is a
 * later handoff for the same screen and replaces the trophy room's frame. Four
 * pieces of 33a survive the re-cut by explicit decision — the platform filter,
 * the legacy contribution arithmetic, the ring shelf and the READ-ONLY / tab
 * stats row — because each does work 13a has no slot for. `CareerDesktop`
 * carries the reasoning for each.
 *
 * ⚠ EVERY FIGURE COMES FROM getCareerData, WHICH READS IMPORTED HISTORY. None of
 * the handoff's demo values (@guap, 187-134, 47.7, the 2024 Dynasty Dragons ring)
 * are hard-coded anywhere. Where the design shows something imports cannot
 * answer, the card keeps its place and names the missing data rather than
 * printing the mock's number:
 *
 *   Rivalry / Awards   shown on the legacy card, dashed, marked NOT MEASURED
 *   Reputation         card renders; no trade/dispute/lineup records exist
 *   Hall of Fame       card renders; the table has never held a row
 *   Achievements       card renders; no definitions and no unlock records
 *   Awards & records   card renders; no awards ledger
 *   Title odds         omitted from the open slot; needs a projection
 *
 * The tabs are links, not state, so the view is deep-linkable exactly as the
 * handoff asks (`?view=seasons`). Only Overview is implemented; the others are
 * marked so nobody clicks into a blank panel.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'seasons', label: 'Seasons' },
  { key: 'hall', label: 'Hall of Fame' },
  { key: 'records', label: 'Records' },
] as const

/** Legacy bar ramp. Not tokens — the handoff lists these four literally. */
const LEGACY_COLORS: Record<string, string> = {
  championship: 'var(--warn)',
  playoff: 'var(--accent)',
  consistency: '#4d9be0',
  dynasty: '#7c8bd0',
}

function nf(n: number): string {
  return n.toLocaleString('en-US')
}

function HelpDot({ body, left }: { body: string; left?: boolean }) {
  return (
    <span className="af-cr-help" data-left={left ? '' : undefined} tabIndex={0} role="note">
      ?<span className="af-cr-helpbody">{body}</span>
    </span>
  )
}

/** Radial prestige gauge. Geometry is the handoff's: r=52 on a 128 viewBox. */
function Gauge({ value }: { value: number }) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const dash = Math.max(0, Math.min(value / 100, 1)) * circumference
  return (
    <svg className="af-cr-gauge" viewBox="0 0 128 128" width={116} height={116} aria-hidden="true">
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--line2)" strokeWidth="11" />
      <circle
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90 64 64)"
      />
      <text
        x="64"
        y="62"
        textAnchor="middle"
        fill="var(--text)"
        style={{ font: "700 26px var(--font-jetbrains-mono, 'JetBrains Mono'), monospace" }}
      >
        {value.toFixed(1)}
      </text>
      <text
        x="64"
        y="80"
        textAnchor="middle"
        fill="var(--faint)"
        style={{ font: "500 10px var(--font-jetbrains-mono, 'JetBrains Mono'), monospace" }}
      >
        / 100
      </text>
    </svg>
  )
}

function componentTone(c: PrestigeComponent): string {
  if (c.key === 'championships') return 'var(--warn)'
  if (c.key === 'winRate') return 'var(--good)'
  return 'var(--accent)'
}

/**
 * Career arc. The handoff hard-codes a ten-point path; this projects whatever
 * seasons actually exist onto the same 700x196 viewBox, so it is correct for a
 * two-season career as well as a ten-season one.
 */
function CareerArc({ data }: { data: CareerData }) {
  const pts = data.seasons.filter((s) => s.winRate != null)
  if (pts.length < 2) {
    return (
      <p className="af-cr-caption">
        {pts.length === 0
          ? 'No completed seasons yet, so there is no arc to draw.'
          : 'One completed season so far — an arc needs at least two to mean anything.'}
      </p>
    )
  }

  const X0 = 40
  const X1 = 676
  const BASE = 170
  const step = pts.length > 1 ? (X1 - X0) / (pts.length - 1) : 0
  // The handoff's window: 35%-85% mapped across 130px above the baseline.
  const y = (v: number) => BASE - ((Math.max(0.35, Math.min(v, 0.85)) - 0.35) / 0.5) * 130
  const coords = pts.map((s, i) => ({
    x: X0 + i * step,
    y: y(s.winRate as number),
    s,
  }))
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const area = `${line} L${X1},${BASE} L${X0},${BASE} Z`
  const peak = coords.reduce((a, b) => ((b.s.winRate as number) > (a.s.winRate as number) ? b : a))

  return (
    <>
      <svg className="af-cr-arc" viewBox="0 0 700 196" preserveAspectRatio="none" role="img"
        aria-label={`Win rate by season, ${pts[0].season} to ${pts[pts.length - 1].season}`}>
        {[17, 69, 121].map((gy) => (
          <line key={gy} x1={X0} x2={X1} y1={gy} y2={gy} stroke="var(--line)" strokeWidth="1" />
        ))}
        <line x1={X0} x2={X1} y1={BASE} y2={BASE} stroke="var(--line2)" strokeWidth="1" />
        {[
          { v: 0.85, y: 21 },
          { v: 0.65, y: 73 },
          { v: 0.45, y: 125 },
        ].map((t) => (
          <text key={t.v} x={30} y={t.y} textAnchor="end" fill="var(--faint)"
            style={{ font: "500 9px var(--font-jetbrains-mono, 'JetBrains Mono'), monospace" }}>
            {Math.round(t.v * 100)}%
          </text>
        ))}
        <defs>
          <linearGradient id="af-cr-arcfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#af-cr-arcfill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c) => {
          const isTitle = c.s.championships > 0
          return (
            <g key={c.s.season}>
              <circle
                cx={c.x}
                cy={c.y}
                r={isTitle ? 6.5 : 4}
                fill={isTitle ? 'var(--warn)' : 'var(--bg)'}
                stroke={isTitle ? 'var(--warn)' : 'var(--accent)'}
                strokeWidth={isTitle ? 0 : 2.5}
              />
              {/* Nodes are 4-6.5px; the design asks for a >=24px hit area. */}
              <circle cx={c.x} cy={c.y} r={12} fill="transparent">
                <title>
                  {`${c.s.season}: ${c.s.wins}-${c.s.losses}${c.s.ties ? `-${c.s.ties}` : ''} · ${(
                    (c.s.winRate as number) * 100
                  ).toFixed(1)}% · ${c.s.leagueCount} ${c.s.leagueCount === 1 ? 'league' : 'leagues'}${
                    c.s.championships ? ` · ${c.s.championships} title${c.s.championships > 1 ? 's' : ''}` : ''
                  }`}
                </title>
              </circle>
            </g>
          )
        })}
        <text x={peak.x} y={Math.max(14, peak.y - 16)} textAnchor="middle" fill="var(--warn)"
          style={{ font: "700 10px var(--font-jetbrains-mono, 'JetBrains Mono'), monospace" }}>
          {`${((peak.s.winRate as number) * 100).toFixed(0)}% · PEAK`}
        </text>
        {coords.map((c) => (
          <text key={c.s.season} x={c.x} y={188} textAnchor="middle"
            fill={c.s.championships > 0 ? 'var(--warn)' : 'var(--faint)'}
            style={{
              font: `${c.s.championships > 0 ? 700 : 500} 10px var(--font-jetbrains-mono, 'JetBrains Mono'), monospace`,
            }}>
            {String(c.s.season).slice(2)}
          </text>
        ))}
      </svg>
      <p className="af-cr-caption">
        Regular-season win rate across every league you played that year, weighted by games. Completed
        seasons only — leagues still being played are not in this line.
      </p>
    </>
  )
}

/** Compact arc for the mobile frame — the handoff's 320x96 box at height 72. */
function MobileArc({ data }: { data: CareerData }) {
  const pts = data.seasons.filter((s) => s.winRate != null)
  if (pts.length < 2) return null
  const X0 = 12
  const X1 = 318
  const BASE = 88
  const step = (X1 - X0) / (pts.length - 1)
  const y = (v: number) => BASE - ((Math.max(0.35, Math.min(v, 0.85)) - 0.35) / 0.5) * 68
  const coords = pts.map((s, i) => ({ x: X0 + i * step, y: y(s.winRate as number), s }))
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  return (
    <svg className="af-crm-arc" viewBox="0 0 320 96" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="af-crm-arcfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${X1},${BASE} L${X0},${BASE} Z`} fill="url(#af-crm-arcfill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c) => (
        <circle
          key={c.s.season}
          cx={c.x}
          cy={c.y}
          r={c.s.championships > 0 ? 5 : 4}
          fill={c.s.championships > 0 ? 'var(--warn)' : 'var(--accent)'}
        />
      ))}
    </svg>
  )
}

/**
 * Mobile frame (390x844).
 *
 * ⚠ THE HANDOFF'S BOTTOM TAB BAR IS DELIBERATELY NOT HERE. The mock is a
 * standalone phone frame, so it carries its own five-item nav (Home, Portfolio,
 * Career, Trades, Chimmy). This screen renders INSIDE AfCoreShell, which already
 * owns navigation — shipping the bar would put two navs on one screen, disagreeing
 * about which item is current. The shell's nav is the real one.
 */
function CareerMobile({ data }: { data: CareerData }) {
  const titles = data.titles.slice(0, 3)
  const peak = data.seasons
    .filter((s) => s.winRate != null)
    .reduce<null | { season: number; winRate: number }>(
      (a, s) => (a == null || (s.winRate as number) > a.winRate ? { season: s.season, winRate: s.winRate as number } : a),
      null
    )

  return (
    <div className="af-crm">
      <header className="af-crm-head">
        <div className="af-crm-badge">RANK ART PENDING</div>
        <h1 className="af-crm-handle">{data.handle ?? 'Your career'}</h1>
        <div className="af-crm-chips">
          {data.level != null ? (
            <span className="af-crm-chip">
              LVL {data.level}{data.levelName ? ` · ${data.levelName.toUpperCase()}` : ''}
            </span>
          ) : null}
          <span className="af-crm-chip af-crm-chip--ro">READ-ONLY</span>
        </div>
      </header>

      <div className="af-crm-body">
        {data.isEmpty ? (
          <>
            <p className="af-crm-note">
              No completed seasons yet. The trophy room is built from finished seasons —
              {data.activeLeagues.length > 0
                ? ` your ${data.activeLeagues.length} live ${data.activeLeagues.length === 1 ? 'league' : 'leagues'} will land here once they finish.`
                : ' import past seasons to backfill it.'}
            </p>
            <Link className="af-crm-cta" href="/import?returnTo=%2Fcore%2Fcareer">Import past seasons</Link>
          </>
        ) : (
          <>
            <div className="af-crm-tiles">
              <div className="af-crm-tile af-crm-tile--rings">
                <span className="af-crm-tile-l">RINGS</span>
                <span className="af-crm-tile-v af-crm-tile-v--warn">{data.championships}</span>
              </div>
              <div className="af-crm-tile">
                <span className="af-crm-tile-l">WIN %</span>
                <span className={`af-crm-tile-v${data.winRate != null ? ' af-crm-tile-v--good' : ' af-crm-tile-v--none'}`}>
                  {data.winRate != null ? (data.winRate * 100).toFixed(1) : 'no games'}
                </span>
              </div>
              <div className="af-crm-tile">
                <span className="af-crm-tile-l">SEASONS</span>
                <span className="af-crm-tile-v">{data.seasonsPlayed}</span>
              </div>
            </div>

            {data.seasons.filter((s) => s.winRate != null).length >= 2 ? (
              <section className="af-crm-card">
                <div className="af-crm-cardhead">
                  <h2 className="af-crm-cardtitle">CAREER ARC</h2>
                  <span className="af-crm-titlesflag">◉ TITLES</span>
                </div>
                <MobileArc data={data} />
                <div className="af-crm-arcfoot">
                  <span>
                    {data.firstSeason} — {data.lastSeason} · win rate, games-weighted
                  </span>
                  {peak ? <span className="af-crm-peak">PEAK {(peak.winRate * 100).toFixed(0)}%</span> : null}
                </div>
              </section>
            ) : null}

            {data.prestige || data.legacy ? (
              <section className="af-crm-card">
                {data.prestige ? (
                  <div className="af-crm-score">
                    <div className="af-crm-scorerow">
                      <span className="af-crm-scoreval af-crm-scoreval--accent">
                        {data.prestige.total.toFixed(1)}
                      </span>
                      <span className="af-crm-scoreof">/ 100</span>
                      <span className="af-crm-scorelabel">GM PRESTIGE</span>
                    </div>
                    <div className="af-crm-bar">
                      <i style={{ width: `${data.prestige.total}%`, background: 'var(--accent)' }} />
                    </div>
                  </div>
                ) : null}
                {data.legacy ? (
                  <div className="af-crm-score">
                    <div className="af-crm-scorerow">
                      <span className="af-crm-scoreval af-crm-scoreval--warn">{data.legacy.total}</span>
                      <span className="af-crm-scoreof">/ 100</span>
                      <span className="af-crm-scorelabel">LEGACY</span>
                    </div>
                    <div className="af-crm-bar">
                      {data.legacy.dimensions.map((d) => (
                        <i key={d.key} style={{ width: `${d.contribution}%`, background: LEGACY_COLORS[d.key] }} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {titles.length > 0 ? (
              <section className="af-crm-card">
                <div className="af-crm-cardhead">
                  <h2 className="af-crm-cardtitle">
                    THE SHELF · {data.championships} {data.championships === 1 ? 'TITLE' : 'TITLES'}
                  </h2>
                </div>
                {titles.map((t) => (
                  <div key={`${t.season}-${t.leagueName}`} className="af-crm-shelfrow">
                    <span className="af-crm-shelf-glyph" aria-hidden="true">◉</span>
                    <span className="af-crm-shelf-year">{t.season}</span>
                    <span className="af-crm-shelf-name">{t.leagueName}</span>
                    <span className="af-crm-shelf-plat" data-platform={t.platform} title={t.platform}>
                      {t.platform.charAt(0).toUpperCase()}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            {/* Share generator does not exist yet — see the desktop action row. */}
          </>
        )}
      </div>
    </div>
  )
}

export function Career({ data, view }: { data: CareerData; view?: string | null }) {
  const active = TABS.some((t) => t.key === view) ? (view as string) : 'overview'
  return (
    <>
      <CareerDesktop data={data} view={active} />
      <CareerMobile data={data} />
    </>
  )
}

/** Honest panel for a tab that exists in the design but is not built. */
function UnbuiltView({ label }: { label: string }) {
  return (
    <div className="af-cr-empty">
      <p className="af-cr-empty-t">{label} is not built yet.</p>
      <p className="af-cr-empty-b">
        It is in the design and listed here so the tabs match it, but the panel behind it does not
        exist — so this says so rather than showing you an empty one. Overview is the built view.
      </p>
      <Link href="/core/career" className="af-cr-btn af-cr-btn--primary">Back to Overview</Link>
    </div>
  )
}

/**
 * Platform selector. Links rather than a <select>, because the filter is a
 * server round-trip on ?platform= — a select would need JS to navigate, and
 * these are one-click targets either way. Only rendered when there is more than
 * one platform to choose between; a dropdown with a single option is furniture.
 */
function PlatformFilter({ data }: { data: CareerData }) {
  if (data.platforms.length < 2) return null
  return (
    <div className="af-cr-filter" role="group" aria-label="Filter by platform">
      <Link
        href="/core/career"
        className="af-cr-filter-opt"
        aria-current={data.platform == null ? 'true' : undefined}
      >
        All platforms
      </Link>
      {data.platforms.map((p) => (
        <Link
          key={p}
          href={`/core/career?platform=${encodeURIComponent(p)}`}
          className="af-cr-filter-opt"
          aria-current={data.platform === p ? 'true' : undefined}
        >
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </Link>
      ))}
    </div>
  )
}

/**
 * Career overview — handoff 13a.
 *
 * ⚠ 13a SUPERSEDES 33a FOR THIS SCREEN, BUT NOT WHOLESALE. 33a's trophy room was
 * a fixed identity rail beside one column; 13a is a full-width identity banner
 * over 340 / 1fr / 300. Four things 33a had and 13a has no slot for are kept at
 * the user's explicit direction, because each does work the new design does not
 * replace:
 *
 *   Platform filter      `career.ts` reads BOTH data sources specifically so this
 *                        can exist — legacy rows can only ever answer "Sleeper",
 *                        so a filter built on them alone would silently drop
 *                        every ESPN and Yahoo season.
 *   Contribution math    `score × weight% = contribution` per legacy dimension.
 *                        13a shows a weight label only; without the arithmetic
 *                        the total cannot be audited, which is the disclosure
 *                        principle 13a's own build rule 1 rests on.
 *   Ring shelf           championships as rings that link to the league they were
 *                        won in. 13a demotes these to text in the timeline and
 *                        loses the link, so the shelf stays below the timeline.
 *   READ-ONLY + tab stats
 *
 * ⚠ NOTHING HERE IS INVENTED. Reputation, Hall of Fame, achievements and awards
 * are all in 13a and none has a populated table behind it, so each renders as a
 * card naming the missing data. Same for rivalry and awards on the legacy card:
 * shown with their design weights, dashed and labelled unmeasured, never scored
 * zero — a zero would drag a real total down to represent data we never had.
 */
function CareerDesktop({ data, view }: { data: CareerData; view: string }) {
  const { prestige, legacy, titles, activeLeagues, leagueCounts, currentSeason } = data

  const record = data.games > 0 ? `${nf(data.wins)}–${nf(data.losses)}` : null
  const openSlot = activeLeagues[0] ?? null

  return (
    <div className="af-c13">
      {/* ── header: eyebrow, read-only marker, tabs, tab stats, actions ──── */}
      <div className="af-cr-idhead" style={{ padding: '0 2px' }}>
        <svg className="af-cr-crest" width="24" height="26" viewBox="0 0 24 26" aria-hidden="true">
          <path d="M12 1 22 6.5v13L12 25 2 19.5v-13Z" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
          <text x="12" y="16" textAnchor="middle" fill="var(--accent)"
            style={{ font: "800 8px var(--font-archivo, 'Archivo'), sans-serif" }}>AF</text>
        </svg>
        <span className="af-cr-eyebrow">
          {data.firstSeason && data.lastSeason
            ? `YOUR CAREER · ${data.firstSeason}—${data.lastSeason}`
            : 'YOUR CAREER'}
        </span>
        {/* Kept from 33a: this screen writes nothing, and says so. */}
        <span className="af-cr-ro">READ-ONLY</span>
      </div>

      <nav className="af-cr-tabs" aria-label="Career views">
        {TABS.map((t) =>
          t.key === view ? (
            <span key={t.key} className="af-cr-tab" aria-current="page">{t.label}</span>
          ) : (
            <Link key={t.key} className="af-cr-tab" href={`/core/career?view=${t.key}`}>
              {t.label}
            </Link>
          ),
        )}
        {/* Kept from 33a. */}
        <div className="af-cr-tabstats">
          <span className="af-cr-tabstat">{nf(data.distinctLeagues)} leagues</span>
          <span className="af-cr-tabstat">{nf(data.leaguesPlayed)} league-seasons</span>
          {data.sports.length > 0 ? (
            <span className="af-cr-tabstat">{data.sports.join(' · ')}</span>
          ) : null}
        </div>
        <div className="af-cr-actions">
          <Link className="af-cr-btn af-cr-btn--ghost" href="/core/career?view=records">Records</Link>
        </div>
      </nav>

      {view !== 'overview' ? (
        <UnbuiltView label={TABS.find((t) => t.key === view)?.label ?? 'This view'} />
      ) : data.isEmpty ? (
        <div className="af-cr-empty">
          <p className="af-cr-empty-t">No completed seasons yet.</p>
          <p className="af-cr-empty-b">
            This page is built from finished seasons. You have {activeLeagues.length}{' '}
            {activeLeagues.length === 1 ? 'league' : 'leagues'} in progress — once they finish, your
            record, rings and career arc land here. Nothing is shown until then rather than a page of
            zeroes.
          </p>
          <Link href="/import?returnTo=%2Fcore%2Fcareer" className="af-cr-btn af-cr-btn--primary">
            Import past seasons
          </Link>
        </div>
      ) : (
        <>
          {/* ── identity banner ──────────────────────────────────────────── */}
          <section className="af-c13-banner">
            <span className="af-c13-av" aria-hidden="true">
              {(data.handle ?? '?').charAt(0).toUpperCase()}
            </span>
            <div className="af-c13-who">
              <h1 className="af-c13-handle">
                {data.handle ? `@${data.handle}` : 'Your career'}
                {data.level != null ? (
                  <span className="af-c13-chip">
                    LVL {data.level}
                    {data.levelName ? ` · ${data.levelName.toUpperCase()}` : ''}
                  </span>
                ) : null}
                {/*
                  13a puts a TRUSTED · 78 chip here. There are no reputation rows
                  on this path, so the chip keeps its place and names what it is
                  waiting on rather than printing the mock's number.
                */}
                <span
                  className="af-c13-chip af-c13-chip--unmeasured"
                  title="Reputation scoring needs completed-trade, dispute and lineup-consistency records, none of which are being written yet."
                >
                  TRUSTED · NOT SCORED
                </span>
              </h1>
              <p className="af-c13-subline">
                {data.firstSeason ? `Since ${data.firstSeason}` : 'Career'}
                {data.sports.length > 0 ? ` · ${data.sports.join(', ')}` : ''}
                {` · ${nf(leagueCounts.active)} live ${leagueCounts.active === 1 ? 'league' : 'leagues'}`}
                {` · ${nf(data.leaguesPlayed)} league-seasons of history`}
              </p>
            </div>
            <div className="af-c13-stats">
              <div className="af-c13-stat">
                <span>Championships</span>
                <b className="warn">{data.championships}</b>
              </div>
              <div className="af-c13-stat">
                <span>Record</span>
                <b>{record ?? '—'}</b>
              </div>
              <div className="af-c13-stat">
                <span>Win %</span>
                <b className="good">
                  {data.winRate != null ? (Math.round(data.winRate * 1000) / 10).toFixed(1) : '—'}
                </b>
              </div>
              <div className="af-c13-stat">
                <span>Seasons</span>
                <b>{nf(data.seasonsPlayed)}</b>
              </div>
            </div>
          </section>

          {/* Kept from 33a. */}
          <PlatformFilter data={data} />

          <div className="af-c13-body">
            {/* ── left column ──────────────────────────────────────────── */}
            <div className="af-c13-col">
              {prestige ? (
                <section className="af-c13-card">
                  <p className="af-c13-head">
                    GM prestige
                    <span className="sp" />
                    <HelpDot body="Championships 30%, win rate 20%, tenure 20%, leagues 15%, playoff appearances 15%. Each is capped, so one huge number cannot carry the score." />
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                    <Gauge value={prestige.total} />
                  </div>
                  {prestige.components.map((c) => (
                    <div key={c.key} className="af-c13-row">
                      <span>{c.label}</span>
                      <span className="af-c13-track">
                        <i style={{ width: `${c.ratio * 100}%`, background: componentTone(c) }} />
                      </span>
                      <span className="v">{c.saturated ? 'MAXED' : c.display}</span>
                    </div>
                  ))}
                </section>
              ) : null}

              {data.xp ? (
                <section className="af-c13-card">
                  <p className="af-c13-head">Career XP</p>
                  <p className="af-c13-big">
                    {nf(data.xp.total)}
                    {data.levelName ? <small>{data.levelName.toUpperCase()}</small> : null}
                  </p>
                  <span className="af-c13-track" style={{ display: 'block', marginTop: 12 }}>
                    <i style={{ width: `${data.xp.progressPct ?? 0}%`, background: 'var(--accent)' }} />
                  </span>
                  {data.xp.toNext != null && data.nextLevelName ? (
                    <p className="af-c13-note">
                      {nf(data.xp.toNext)} XP to {data.nextLevelName}.
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="af-c13-card">
                <p className="af-c13-head">Reputation</p>
                <p className="af-c13-none">
                  13a shows an overall and a commissioner-trust score built from completed trades,
                  dispute history and lineup consistency. None of those are recorded per manager, so
                  there is nothing to score — this is unmeasured, not zero.
                </p>
              </section>
            </div>

            {/* ── centre column ────────────────────────────────────────── */}
            <div className="af-c13-col">
              {legacy ? (
                <section className="af-c13-card">
                  <p className="af-c13-head">
                    Legacy score
                    <span className="sp" />
                    <span className="af-c13-big warn" style={{ fontSize: 26 }}>
                      {legacy.total}
                    </span>
                    <HelpDot
                      left
                      body="Each dimension is scored 0-100 from recorded results, then multiplied by its weight. Weights are re-normalised across the dimensions that can actually be scored, so an unmeasurable one does not silently drag the total down."
                    />
                  </p>
                  <div className="af-cr-stack">
                    {legacy.dimensions.map((d) => (
                      <i
                        key={d.key}
                        style={{ width: `${d.contribution}%`, background: LEGACY_COLORS[d.key] }}
                      />
                    ))}
                  </div>
                  <div className="af-c13-lgrid" style={{ marginTop: 14 }}>
                    {legacy.dimensions.map((d) => (
                      <div key={d.key} className="af-c13-ldim">
                        <p className="af-c13-ldimhead">
                          {d.label}
                          <b>{d.score}</b>
                        </p>
                        <span className="af-c13-track" style={{ display: 'block', marginTop: 7 }}>
                          <i style={{ width: `${d.score}%`, background: LEGACY_COLORS[d.key] }} />
                        </span>
                        {/* Kept from 33a: the arithmetic, not just the weight. */}
                        <p className="af-c13-ldimmeta">
                          {d.score} × {Math.round(d.weight * 100)}% = {d.contribution.toFixed(1)}
                        </p>
                      </div>
                    ))}
                    {legacy.unavailable.map((label) => (
                      <div key={label} className="af-c13-ldim af-c13-ldim--none">
                        <p className="af-c13-ldimhead">
                          {label}
                          <b>—</b>
                        </p>
                        <span className="af-c13-track" style={{ display: 'block', marginTop: 7 }} />
                        <p className="af-c13-ldimmeta">NOT MEASURED</p>
                      </div>
                    ))}
                  </div>
                  <p className="af-c13-note">
                    13a lists six dimensions. Rivalry needs head-to-head results against a named
                    manager and awards needs an awards record; an imported season carries a record,
                    not an opponent ledger. Both are shown unweighted rather than scored zero, and the
                    four above are re-normalised across what can be scored.
                  </p>
                </section>
              ) : null}

              <section className="af-c13-card">
                <p className="af-c13-head">
                  Season timeline
                  <span className="sp" />
                  <span>
                    {data.firstSeason && data.lastSeason
                      ? `${data.firstSeason} — ${data.lastSeason}`
                      : ''}
                  </span>
                </p>
                <CareerArc data={data} />
                {titles.length > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    {titles.slice(0, 4).map((t) => (
                      <div
                        key={`ms-${t.season}-${t.leagueName}`}
                        className="af-c13-row"
                        style={{ gridTemplateColumns: '54px minmax(0,1fr) auto' }}
                      >
                        <span className="v" style={{ color: 'var(--warn)' }}>
                          {t.season}
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Champion — {t.leagueName}
                        </span>
                        <span className="v">{t.record ?? t.settingsLabel ?? ''}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="af-c13-note">No championship seasons to mark on the timeline yet.</p>
                )}
              </section>

              {/* Kept from 33a — 13a has no equivalent that links a ring to its league. */}
              <section className="af-c13-card">
                <div className="af-cr-sechead">
                  <h2 className="af-cr-sectitle">
                    THE SHELF · {data.championships}{' '}
                    {data.championships === 1 ? 'CHAMPIONSHIP' : 'CHAMPIONSHIPS'}
                  </h2>
                  <span className="af-cr-sechint">Every ring links to the league it was won in</span>
                </div>
                {titles.length === 0 ? (
                  <p className="af-c13-none">
                    {nf(data.leaguesPlayed)} completed league-seasons and no title so far. The shelf
                    fills the first time you win one.
                  </p>
                ) : (
                  <div className="af-cr-shelf">
                    {titles.slice(0, 3).map((t) => (
                      <div key={`${t.season}-${t.leagueName}`} className="af-cr-ring">
                        <div className="af-cr-ring-top">
                          <span className="af-cr-ring-glyph" aria-hidden="true">
                            ◉
                          </span>
                          <span className="af-cr-ring-year">{t.season}</span>
                          <span className="af-cr-plat" data-platform={t.platform} title={t.platform}>
                            {t.platform.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <h3 className="af-cr-ring-name">{t.leagueName}</h3>
                          {t.record ? <p className="af-cr-ring-detail">{t.record}</p> : null}
                        </div>
                        {t.settingsLabel ? (
                          <span className="af-cr-ring-set">{t.settingsLabel}</span>
                        ) : null}
                      </div>
                    ))}
                    <div className="af-cr-slot">
                      <span className="af-cr-slot-l">
                        OPEN SLOT{currentSeason ? ` · ${currentSeason}` : ''}
                      </span>
                      {openSlot ? (
                        <>
                          <p className="af-cr-slot-h">{openSlot.leagueName}</p>
                          <p className="af-cr-slot-p">
                            {openSlot.record
                              ? `${openSlot.record} this season`
                              : 'Season has not started'}
                            {leagueCounts.active > 1 ? ` · ${leagueCounts.active} leagues live` : ''}
                          </p>
                        </>
                      ) : (
                        <p className="af-cr-slot-p">No leagues in progress this season.</p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* ── right column ─────────────────────────────────────────── */}
            <div className="af-c13-col">
              <section className="af-c13-card">
                <p className="af-c13-head">
                  AF rank
                  {data.level != null ? <span className="sp">LEVEL {data.level} OF 25</span> : null}
                </p>
                {data.level != null ? (
                  <>
                    <p
                      style={{
                        margin: 0,
                        font: "900 21px/1.1 var(--font-archivo, Archivo), system-ui, sans-serif",
                        color: 'var(--text)',
                      }}
                    >
                      {data.levelName}
                    </p>
                    <span className="af-c13-track" style={{ display: 'block', marginTop: 12 }}>
                      <i
                        style={{ width: `${data.xp?.progressPct ?? 0}%`, background: 'var(--accent)' }}
                      />
                    </span>
                    {data.xp?.toNext != null && data.nextLevelName ? (
                      <p className="af-c13-note">
                        {nf(data.xp.toNext)} XP to {data.nextLevelName}.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="af-c13-none">Your career has not been ranked yet.</p>
                )}
                <p style={{ marginTop: 12 }}>
                  <Link className="af-cr-xplink" href="/core/rankings">
                    Rankings →
                  </Link>
                </p>
              </section>

              <section className="af-c13-card">
                <p className="af-c13-head">Hall of fame</p>
                <p className="af-c13-none">
                  No entries. The Hall of Fame table has never been populated for an account on this
                  path, so there is nothing to list — empty, not hidden.
                </p>
              </section>

              <section className="af-c13-card">
                <p className="af-c13-head">Achievements</p>
                <p className="af-c13-none">
                  13a shows five achievements with a rarity and an XP reward each. No achievement
                  definitions or per-user unlock records exist yet, so there is no set to show
                  progress against.
                </p>
              </section>

              <section className="af-c13-card">
                <p className="af-c13-head">Awards &amp; records</p>
                <p className="af-c13-none">
                  Awards won and league records held both need an awards ledger. Imported seasons
                  carry a final standing and a champion flag, and nothing else that resolves to an
                  award.
                </p>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Career
