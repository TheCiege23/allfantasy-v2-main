'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect } from 'react'
import { DecisionRecordCard } from '@/components/core-app/career/DecisionRecordCard'
import type { DecisionRecord } from '@/lib/core-app/decisionRecordModel'

type DecisionRecordData = DecisionRecord & { season: number }
import { buildCareerWidgetSnapshot } from '@/lib/core-app/careerWidgetSnapshot'
import { publishRailCareerLines, railCareerLines } from '@/lib/core-app/railCareer'
import { syncCareerWidget } from '@/lib/platform/careerWidgetBridge'
import { careerHref, isUnfiltered, type CareerData, type PrestigeComponent } from '@/lib/core-app/careerModel'
import type { ShareCardData } from '@/lib/core-app/shareCard'
import type { CareerAward } from '@/lib/core-app/careerAwards'
import type { CareerScreenData } from '@/lib/core-app/careerScreen'
import { CareerHallView } from '@/components/core-app/boards/CareerViews'
import { ShareCard, SHARE_CARD_SIZE } from '@/components/career/ShareCard'
import { CareerFilterBar, CareerTabs } from '@/components/core-app/career/CareerChrome'
import { CareerProgressChart } from '@/components/core-app/career/CareerProgressChart'
import { CareerRivalsCard } from '@/components/core-app/career/CareerRivalsCard'
import type { CareerRival } from '@/lib/core-app/careerRecordBook'
import {
  AccomplishmentStrip,
  AwardBadge,
  AwardsPreview,
  AwardsView,
  BestSeasons,
  CoverageSummaryCard,
  CoverageView,
  PeersView,
  ProgressView,
  RecordBookView,
  SeasonStoryRail,
  SeasonTable,
  TimelineView,
} from '@/components/core-app/career/CareerBriefViews'
import { CareerAskChimmy } from '@/components/core-app/career/CareerAskChimmy'
import { LegacyStakes } from '@/components/core-app/career/LegacyStakes'
import { careerChimmyPrompts } from '@/lib/core-app/careerChimmy'
import { buildLegacyStakes } from '@/lib/core-app/careerMilestones'
import type { CareerWireData } from '@/lib/core-app/careerWireModel'
import { CareerWire } from '@/components/core-app/career/CareerWire'
import { WeeklyStory } from '@/components/core-app/career/WeeklyStory'
import type { WeeklyStory as WeeklyStoryData } from '@/lib/core-app/weeklyStoryModel'
import { CareerCompareView } from '@/components/core-app/career/CareerCompareView'
import { HallLayoutToggle, TrophyWall } from '@/components/core-app/career/TrophyWall'
import { buildTrophyWall } from '@/lib/core-app/trophyWall'
import { TopicTip } from '@/components/core-app/TopicTip'
import {
  CareerHead,
  CareerThisSeason,
  CareerXpLine,
  SurvivalFold,
  careerHeadlineText,
  careerSublineText,
  useCareerGuideCopy,
} from '@/components/core-app/career/CareerGuide'
import type { ReactNode } from 'react'
import '@/components/core-app/af-career.css'
import '@/components/core-app/af-career-brief.css'
import '@/components/core-app/af-career-live.css'
// Last on purpose: the phone/tablet layer overrides the three sheets above.
import '@/components/core-app/af-career-devices.css'
import '@/components/core-app/af-career-wall.css'
/* The 2026-11 redesign (board: Career) — overview only, after the stylesheets it restyles. */
import '@/components/core-app/af-career-redesign.css'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

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
 * ⚠ EVERY FIGURE COMES FROM buildCareerData OVER IMPORTED HISTORY. None of
 * the handoff's demo values (@guap, 187-134, 47.7, the 2024 Dynasty Dragons ring)
 * are hard-coded anywhere. Where the design shows something imports cannot
 * answer, the card keeps its place and names the missing data rather than
 * printing the mock's number:
 *
 *   Rivalry / Awards   shown on the legacy card, dashed, marked NOT MEASURED
 *                      (rivalries now have a ledger on Records, but the legacy
 *                      score still does not weight them)
 *   Reputation         not shown (2026-11-14): no trade/dispute/lineup records exist,
 *                      and a card that only said so was a placeholder
 *   Finals             tile renders "Not recorded"; no source stores runner-ups
 *   Title odds         omitted from the open slot; needs a projection
 *
 * Achievements and the awards/records card used to be in this list. Both are
 * built now — awards from recorded thresholds, records from the record book.
 *
 * The tabs are links, not state, so the view is deep-linkable exactly as the
 * handoff asks (`?view=seasons`).
 *
 * ── The 2026-09-16 career brief ─────────────────────────────────────────────
 *
 *   1  accomplishments lead      `AccomplishmentStrip` + best seasons, above everything
 *   2  timeline                  `?view=timeline`
 *   3  filters                   league (`lg`), platform, sport, era (`from`/`to`)
 *   4  completeness              `?view=coverage`, and a card on the overview
 *   5  record books              `?view=records`, six sections
 *   6  progression graph         a metric switch on the overview, rank on `?view=progress`
 *   7  peer comparisons          `?view=peers`
 *   8  shareable awards          `?view=awards`, images from `/api/share/career-card?design=award`
 *   9  precomputed totals        `lib/core-app/careerProfile.ts`
 *  10  mobile story              a swipeable season rail; the desktop table stays
 */

/** Legacy bar ramp. Not tokens — the handoff lists these four literally. */
const LEGACY_COLORS: Record<string, string> = {
  championship: 'var(--warn)',
  playoff: 'var(--accent)',
  consistency: '#4d9be0',
  dynasty: '#7c8bd0',
}

function nf(n: number): string {
  return n.toLocaleString(getAppIntlLocale())
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
 * Mobile frame (390x844) — the overview only.
 *
 * ⚠ THE HANDOFF'S BOTTOM TAB BAR IS DELIBERATELY NOT HERE. This screen renders
 * INSIDE AfCoreShell, which already owns navigation.
 *
 * ⚠ EVERY OTHER TAB RENDERS THE DESKTOP FRAME ON A PHONE. It used to be hidden
 * below 768px with no other route to it, so Seasons, Records and Hall of Fame
 * simply did not exist on a phone. Those views are lists and tables that reflow;
 * only the overview has a phone-specific design.
 *
 * Brief item 10: the season story is a swipeable rail here, newest first; the
 * full table is still one tap away on Seasons.
 */
function CareerMobile({
  screen,
  wire,
  story,
  nowIso,
}: {
  screen: CareerScreenData
  wire: CareerWireData | null
  story: WeeklyStoryData | null
  nowIso?: string
}) {
  const data = screen.data
  const g = useCareerGuideCopy()
  const titles = data.titles.slice(0, 3)
  const peak = data.seasons
    .filter((s) => s.winRate != null)
    .reduce<null | { season: number; winRate: number }>(
      (a, s) => (a == null || (s.winRate as number) > a.winRate ? { season: s.season, winRate: s.winRate as number } : a),
      null,
    )
  const acc = data.accomplishments

  return (
    <div className="af-crm">
      <header className="af-crm-head">
        {/*
          ⚠ A dashed 86px box reading "RANK ART PENDING" stood here — a design placeholder for rank
          art that was never made, shipped to every phone. App Review rejects placeholder content
          (guideline 2.1), and the level it stood in for is already in the chips below. Removed
          rather than filled with invented art; the header's gradient carries the space.
        */}
        {/*
          2026-11-14: the same headline as the desktop header (CareerGuide) — what the career adds up to —
          with the handle, level and history on the line under it. The bare handle was the h1 before.
        */}
        <h1 className="af-crm-handle af-cg-mhead">{careerHeadlineText(data, g)}</h1>
        <p className="af-cg-mwho">{careerSublineText(data, screen.profile.builtAt, g)}</p>
      </header>

      <CareerTabs view="overview" filter={data.filter} />
      <CareerRankingLinks data={data} />

      <div className="af-crm-body">
        {/* Last week as a story — the thing to tap first on a phone. */}
        {story ? <WeeklyStory story={story} /> : null}
        {/*
          The feed first, but COMPACT on a phone: two items, with every platform's sync state and the
          season board folded behind one tap. Measured at 375px before this: the Wire was 1,529px and
          pushed the career itself more than two screens down.
        */}
        {wire && nowIso ? <CareerWire data={wire} nowIso={nowIso} compact /> : null}
        <CareerFilterBar data={data} view="overview" />
        {data.isEmpty ? (
          <>
            <p className="af-crm-note">
              {data.accountIsEmpty
                ? `No completed seasons yet. The trophy room is built from finished seasons — ${
                    data.activeLeagues.length > 0
                      ? `your ${data.activeLeagues.length} live ${data.activeLeagues.length === 1 ? 'league' : 'leagues'} will land here once they finish.`
                      : 'import past seasons to backfill it.'
                  }`
                : 'Nothing matches these filters.'}
            </p>
            {data.accountIsEmpty ? (
              <Link className="af-crm-cta" href="/import?returnTo=%2Fcore%2Fcareer">
                Import past seasons
              </Link>
            ) : null}
            {data.accountIsEmpty ? <CareerLive data={data} awards={[]} /> : null}
          </>
        ) : (
          <>
            {/* 1 — accomplishments first. */}
            <div className="af-crm-tiles af-crx-mtiles">
              <div className="af-crm-tile af-crm-tile--rings">
                <span className="af-crm-tile-l">RINGS</span>
                <span className="af-crm-tile-v af-crm-tile-v--warn">{acc.championships}</span>
              </div>
              <div className="af-crm-tile">
                <span className="af-crm-tile-l">PLAYOFFS</span>
                <span className="af-crm-tile-v af-crm-tile-v--good">{acc.playoffAppearances}</span>
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
            <p className="af-crx-muted af-crx-mnote">
              Finals:{' '}
              {acc.finals == null ? 'not recorded yet' : `${acc.finals} (${acc.championships} won · ${acc.finalsLost} lost)`}{' '}
              <TopicTip topic="careerFinals" />
            </p>

            <CareerLive data={data} awards={screen.awards} />

            <SeasonStoryRail data={data} />

            {acc.bestSeasons.length > 0 ? (
              <section className="af-crm-card">
                <div className="af-crm-cardhead">
                  <h2 className="af-crm-cardtitle">BEST SEASONS</h2>
                </div>
                {acc.bestSeasons.map((b) => (
                  <div key={`${b.season}-${b.leagueKey}`} className="af-crm-shelfrow">
                    <span className="af-crm-shelf-glyph" aria-hidden="true">
                      {b.champion ? '◉' : '○'}
                    </span>
                    <span className="af-crm-shelf-year">{b.season}</span>
                    <span className="af-crm-shelf-name">
                      {b.leagueName} · {b.record}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

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

            {screen.awards.length > 0 ? (
              <section className="af-crm-card">
                <div className="af-crm-cardhead">
                  <h2 className="af-crm-cardtitle">AWARDS · {screen.awards.length}</h2>
                  <Link className="af-crx-mlink" href={careerHref(data.filter, { view: 'awards' })}>
                    All →
                  </Link>
                </div>
                <div className="af-crx-award-stack">
                  {screen.awards.slice(0, 3).map((a) => (
                    <AwardBadge key={a.key} award={a} compact />
                  ))}
                </div>
              </section>
            ) : null}

            {data.prestige || data.legacy ? (
              <section className="af-crm-card">
                {data.prestige ? (
                  <div className="af-crm-score">
                    <div className="af-crm-scorerow">
                      <span className="af-crm-scoreval af-crm-scoreval--accent">{data.prestige.total.toFixed(1)}</span>
                      <span className="af-crm-scoreof">/ 100</span>
                      <span className="af-crm-scorelabel">GM PRESTIGE</span>
                      <TopicTip topic="careerPrestige" />
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
                      <TopicTip topic="careerLegacy" />
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
                    <span className="af-crm-shelf-glyph" aria-hidden="true">
                      ◉
                    </span>
                    <span className="af-crm-shelf-year">{t.season}</span>
                    <span className="af-crm-shelf-name">{t.leagueName}</span>
                    <span className="af-crm-shelf-plat" data-platform={t.platform} title={t.platform}>
                      {t.platform.charAt(0).toUpperCase()}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            <CoverageSummaryCard data={data} href={careerHref(data.filter, { view: 'coverage' })} />
            {/* "Share a card" is in the links row at the top (CareerRankingLinks) since 2026-11-14. */}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The decision record, handed down to `CareerLive` without threading a prop through every layout
 * that renders it (phone and desktop, empty and full). Three states, and they mean different things:
 *   undefined  not read here (another view, a league selected) or the read failed — no card at all
 *   null       read, nothing resolved yet — the card that says how to start one
 *   a record   the record
 */
const DecisionRecordContext = createContext<DecisionRecordData | null | undefined>(undefined)

export function Career({
  screen,
  share,
  wire = null,
  story = null,
  decisionRecord,
  nowIso,
}: {
  screen: CareerScreenData
  share?: ShareCardData | null
  /** Career Wire — read on the overview only; null elsewhere or when the read failed. */
  wire?: CareerWireData | null
  /** Last week's story — overview only; null before a week is played or when the read failed. */
  story?: WeeklyStoryData | null
  /** This season's Chimmy and AutoCoach calls (`lib/core-app/decisionRecord.ts`) — see `DecisionRecordContext`. */
  decisionRecord?: DecisionRecordData | null
  nowIso?: string
}) {
  /*
   * `share` is a view but not a tab. 13a puts "Share card" in the header action
   * row, not in the tab set.
   *
   * The phone overview has its own design (`CareerMobile`); every other view
   * renders the desktop frame on a phone too, because that frame is the only
   * place those views exist.
   */
  const overview = screen.view === 'overview'

  /*
   * Phase 6: keep the iOS home-screen widget in step with what this screen shows. A no-op outside
   * the iOS app, under a filter, and when nothing changed since the last send this session.
   */
  const snapshotAt = nowIso ?? screen.profile.builtAt
  useEffect(() => {
    void syncCareerWidget(buildCareerWidgetSnapshot(screen.data, screen.awards, snapshotAt ? new Date(snapshotAt) : new Date()))
  }, [screen.data, screen.awards, snapshotAt])

  /*
   * Your record in each league, shown under its name in the shell's rail while you are here
   * (`lib/core-app/railCareer.ts`). Cleared on the way out, so no other screen inherits it.
   */
  useEffect(() => {
    publishRailCareerLines(railCareerLines(screen.data))
    return () => publishRailCareerLines(null)
  }, [screen.data])

  return (
    <DecisionRecordContext.Provider value={decisionRecord}>
      <CareerDesktop screen={screen} share={share ?? null} showOnMobile={!overview} wire={wire} story={story} nowIso={nowIso} />
      {overview ? <CareerMobile screen={screen} wire={wire} story={story} nowIso={nowIso} /> : null}
    </DecisionRecordContext.Provider>
  )
}

/**
 * Share card preview — handoff 13b, in the product.
 *
 * ⚠ THE PREVIEW IS THE EXPORT. Both render `<ShareCard>`, so what a user
 * approves here is what the PNG contains — the one exception being the typeface,
 * which is called out below rather than left for someone to discover after they
 * have posted the image.
 *
 * ⚠ THE CARD IS NOT SCALED TO FIT. 13b build rule 1 makes it a fixed 620×780
 * export target that must render identically regardless of viewport, so on a
 * narrow screen the wrapper scrolls rather than the card shrinking. A preview
 * that resized would be showing a layout the export will never produce.
 */
function SharePreview({ share, isEmpty }: { share: ShareCardData | null; isEmpty: boolean }) {
  if (!share) {
    return (
      <div className="af-cr-empty">
        <p className="af-cr-empty-t">Nothing to put on a card yet.</p>
        <p className="af-cr-empty-b">
          {isEmpty
            ? 'The card is built from finished seasons — record, rings, prestige and legacy. Once a league of yours completes a season there is something to share.'
            : 'We could not build your card just now. This is a read failure on our side.'}
        </p>
        <Link href="/core/career" className="af-cr-btn af-cr-btn--primary">
          Back to Overview
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
        <div style={{ width: SHARE_CARD_SIZE.width }}>
          <ShareCard data={share} />
        </div>
      </div>

      <div className="af-c13-card" style={{ maxWidth: SHARE_CARD_SIZE.width }}>
        <p className="af-c13-head">Sharing this</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text2)' }}>
          Every figure on the card is the same one your Overview shows — prestige, legacy, titles,
          record, win rate and XP all come from the same read, so the card cannot claim something the
          career page disagrees with.
        </p>
        <p className="af-c13-note">
          {/*
            Saying this here is the point. The exported PNG renders in the
            default sans because the repo ships no font binaries; the card above
            uses the real faces. Nobody should find that out from the image.
          */}
          The downloadable image is generated server-side at exactly {SHARE_CARD_SIZE.width}×
          {SHARE_CARD_SIZE.height}. It renders in a default sans rather than Archivo and JetBrains
          Mono — the layout is identical, the typeface is not.
        </p>
        <p style={{ marginTop: 14 }}>
          <a
            className="af-cr-btn af-cr-btn--primary"
            href="/api/share/career-card?design=13b"
            target="_blank"
            rel="noreferrer"
          >
            Open the image →
          </a>
        </p>
      </div>
    </div>
  )
}

/**
 * The frame every tab renders in — handoff 13a's header, tabs and filter over
 * whichever view is selected.
 *
 * ⚠ 13a SUPERSEDES 33a FOR THIS SCREEN, BUT NOT WHOLESALE. Four things 33a had
 * are kept at the user's direction: the platform filter (now the full filter
 * bar), the legacy contribution arithmetic, the ring shelf and the READ-ONLY
 * marker with the tab stats.
 *
 * ⚠ NOTHING HERE IS INVENTED. Reputation still has no populated table behind it
 * and renders as a card naming the missing data; the legacy card shows rivalry
 * and awards dashed and unmeasured rather than scored zero.
 */
function CareerRankingLinks({ data }: { data: CareerData }) {
  const params = new URLSearchParams({ scope: 'portfolio' })
  if (data.filter.platform) params.set('platform', data.filter.platform)
  if (data.filter.sport) params.set('sport', data.filter.sport)
  if (data.filter.fromSeason != null && data.filter.fromSeason === data.filter.toSeason) {
    params.set('season', String(data.filter.fromSeason))
  }
  return (
    <nav className="af-cr-actions" aria-label="Career rankings">
      <Link className="af-cr-btn af-cr-btn--ghost" href={`/core/rankings?${params}`}>My Manager Score</Link>
      <Link className="af-cr-btn af-cr-btn--ghost" href="/core/rankings?view=compare">Compare managers</Link>
      <Link className="af-cr-btn af-cr-btn--ghost" href="/find-league">Find a League</Link>
      {/* Was a second share button beside "Share card" in the header (2026-11-14). */}
      <Link className="af-cr-btn af-cr-btn--ghost" href="/core/share">Share a card</Link>
    </nav>
  )
}

function CareerDesktop({
  screen,
  share,
  showOnMobile,
  wire,
  story,
  nowIso,
}: {
  screen: CareerScreenData
  share: ShareCardData | null
  showOnMobile: boolean
  wire: CareerWireData | null
  story: WeeklyStoryData | null
  nowIso?: string
}) {
  const { data, view } = screen
  const g = useCareerGuideCopy()
  /*
    Last week's story and the Career Wire are account-wide and about the season being played, so they sit
    under one "This season" heading after what you have won (CareerOverview), rather than leading a page
    whose headline is your whole career. Above the filter they read as filtered; under their own heading
    they say they are not.
  */
  const thisSeason =
    view === 'overview' && (story || (wire && nowIso)) ? (
      <>
        {story ? <WeeklyStory story={story} /> : null}
        {wire && nowIso ? <CareerWire data={wire} nowIso={nowIso} /> : null}
      </>
    ) : null

  return (
    <div className={`af-c13${showOnMobile ? ' af-crx-mobileok' : ''}`} data-view={view}>
      {/*
        2026-11-14: the page says what your career adds up to, first (CareerHead). It replaces the
        "YOUR CAREER · 2020—2025 · READ-ONLY · Totals as of…" line, the league and league-season counts
        beside the tabs, and the identity banner whose h1 sat below the Wire, the filter and the
        survival table. One share button: "Share a card" joined the links under "This season".
      */}
      <CareerHead data={data} builtAt={screen.profile.builtAt} />

      <div className="af-crx-navrow">
        <CareerTabs view={view === 'share' ? '' : view} filter={data.filter} />
        <div className="af-crx-navside">
          <div className="af-cr-actions">
            <Link className="af-cr-btn af-cr-btn--primary" href="/core/career?view=share">
              {g.shareCard}
            </Link>
          </div>
        </div>
      </div>

      {/* Compare's sides carry their own filters (`ca`/`cb`), so the page filter would only mislead. */}
      {view !== 'share' && view !== 'compare' ? <CareerFilterBar data={data} view={view} /> : null}
      {view === 'seasons' ? <SurvivalTable results={data.survivalResults} /> : null}

      {view === 'share' ? (
        <SharePreview share={share} isEmpty={data.isEmpty} />
      ) : view === 'compare' ? (
        <CareerCompareView compare={screen.compare ?? null} />
      ) : data.isEmpty && view !== 'coverage' ? (
        <>
          {view === 'overview' ? thisSeason : null}
          <EmptyCareer data={data} />
        </>
      ) : view === 'timeline' ? (
        <TimelineView timeline={screen.timeline} data={data} />
      ) : view === 'seasons' ? (
        <SeasonTable seasons={data.seasons} />
      ) : view === 'progress' ? (
        <ProgressView data={data} peers={screen.peers} />
      ) : view === 'peers' ? (
        <PeersView peers={screen.peers} />
      ) : view === 'records' ? (
        <RecordBookView book={screen.records} />
      ) : view === 'awards' ? (
        <AwardsView awards={screen.awards} isEmpty={data.isEmpty} />
      ) : view === 'hall' ? (
        /*
         * The trophy wall and the list are both rendered; CSS shows one (af-career-wall.css) —
         * the wall on a landscape touch tablet or under ?layout=wall, the list otherwise. Decided
         * in CSS, not JS, so the server-rendered page is already the right one on first paint.
         */
        <div className="af-tw-host" data-layout={screen.hallLayout ?? 'auto'}>
          <HallLayoutToggle filter={data.filter} layout={screen.hallLayout ?? null} />
          <div className="af-tw-wallpane">
            <TrophyWall wall={buildTrophyWall(data, screen.awards)} />
          </div>
          <div className="af-tw-listpane">
            <CareerHallView data={data} />
          </div>
        </div>
      ) : view === 'coverage' ? (
        <CoverageView data={data} extras={screen.coverage} />
      ) : (
        <CareerOverview data={data} awards={screen.awards} rivals={screen.rivals} thisSeason={thisSeason} />
      )}
    </div>
  )
}

/**
 * Survival scores, folded (2026-11-14): one line — "30 elimination seasons · best 100.0" — over the table,
 * which was 1,100px on an account with thirty Guillotine seasons and sat above the career itself.
 */
function SurvivalTable({ results }: { results: CareerData['survivalResults'] }) {
  if (!results?.length) return null
  return (
    <SurvivalFold results={results}>
      <div className="af-crx-tablewrap">
        <table className="af-crx-table">
          <caption>Completed elimination seasons. Scores require verified elimination results.</caption>
          <thead>
            <tr><th scope="col">Season</th><th scope="col">League</th><th scope="col">Format</th><th scope="col">Weeks survived</th><th scope="col">Score</th></tr>
          </thead>
          <tbody>
            {results.map(result => (
              <tr key={result.key}>
                <td>{result.season}</td>
                <th scope="row">{result.leagueName}</th>
                <td>{result.format === 'survivor' ? 'Survivor' : 'Guillotine'}</td>
                <td>{result.survival ? [result.survival.periods, result.survival.totalPeriods].join(' / ') : '—'}</td>
                <td>{result.score == null ? 'Unavailable' : result.score.toFixed(1) + ' / 100'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SurvivalFold>
  )
}

function EmptyCareer({ data }: { data: CareerData }) {
  if (!data.accountIsEmpty) {
    return (
      <div className="af-cr-empty">
        <p className="af-cr-empty-t">Nothing matches these filters.</p>
        <p className="af-cr-empty-b">
          No finished season fits this combination of league, platform, sport and seasons. Widen the filter to see the rest
          of your career.
        </p>
        <Link
          href={careerHref({ platform: null, sport: null, league: null, fromSeason: null, toSeason: null })}
          className="af-cr-btn af-cr-btn--primary"
        >
          Clear filters
        </Link>
      </div>
    )
  }
  return (
    <div className="af-cr-empty">
      <p className="af-cr-empty-t">No completed seasons yet.</p>
      <p className="af-cr-empty-b">
        This page is built from finished seasons. You have {data.activeLeagues.length}{' '}
        {data.activeLeagues.length === 1 ? 'league' : 'leagues'} in progress — once they finish, your record, rings and
        career arc land here. Nothing is shown until then rather than a page of zeroes.
      </p>
      <Link href="/import?returnTo=%2Fcore%2Fcareer" className="af-cr-btn af-cr-btn--primary">
        Import past seasons
      </Link>
      <CareerLive data={data} awards={[]} />
    </div>
  )
}

/**
 * The live half of the overview — stakes and milestones beside the Chimmy prompts.
 * Rendered on the desktop overview, the phone overview, and an empty account (a season-1
 * AF user has live stakes long before they have a finished season).
 */
function CareerLive({ data, awards }: { data: CareerData; awards: CareerAward[] }) {
  /*
   * The decision record sits with the live half: what is in play, what Chimmy can tell you, and how
   * taking its calls has gone. Whole-season and whole-account, so not under a Career filter — it
   * would read as "your record in this league" when it is not filtered by league at all.
   */
  const record = useContext(DecisionRecordContext)
  return (
    <div className="af-crl-pair">
      <LegacyStakes data={buildLegacyStakes(data, awards)} />
      <CareerAskChimmy prompts={careerChimmyPrompts(data)} />
      {record !== undefined && isUnfiltered(data.filter) ? <DecisionRecordCard record={record} /> : null}
    </div>
  )
}

/** Career overview — handoff 13a's banner and three columns, accomplishments first. */
function CareerOverview({
  data,
  awards,
  rivals = null,
  thisSeason = null,
}: {
  data: CareerData
  awards: CareerAward[]
  rivals?: CareerRival[] | null
  /** Last week's story and the Career Wire — account-wide, in progress (CareerDesktop). */
  thisSeason?: ReactNode
}) {
  const { prestige, legacy, titles, activeLeagues, leagueCounts, currentSeason } = data
  const openSlot = activeLeagues[0] ?? null
  const leagueHref = (key: string) => careerHref({ ...data.filter, league: key })

  return (
    <>
      {/*
        2026-11-14: the identity banner is gone — the page header (CareerHead) says your handle, level and
        history, with the headline as the h1. Order: what you have won, then this season, then the detail.
      */}
      {/* ── 1: what you have won, before anything else ───────────────────── */}
      <AccomplishmentStrip data={data} />
      <BestSeasons seasons={data.accomplishments.bestSeasons} filterHref={leagueHref} />

      {/* ── 2: this season — the story, the Wire, what is in play, Chimmy ─── */}
      <CareerThisSeason>
        {thisSeason}
        <CareerLive data={data} awards={awards} />
      </CareerThisSeason>
      <CareerRankingLinks data={data} />

      {/*
        "Season by season" (SeasonBars) is not on the overview any more: Career progression below draws
        the same win rate by year, and its Titles tab the rings — the page said it twice.
      */}
      {rivals?.length ? <CareerRivalsCard rivals={rivals} ledgerHref={careerHref(data.filter, { view: 'records' })} /> : null}

      <div className="af-c13-body">
        {/* ── left column ──────────────────────────────────────────────── */}
        <div className="af-c13-col">
          {prestige ? (
            <section className="af-c13-card">
              <p className="af-c13-head">
                GM prestige
                <span className="sp" />
                <TopicTip topic="careerPrestige" />
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

          {/*
            The Career XP card is merged into AF rank (right column), which said the same "XP to next
            level"; the Reputation card only said reputation is not measured (2026-11-14).
          */}
        </div>

        {/* ── centre column ────────────────────────────────────────────── */}
        <div className="af-c13-col">
          {/* 6 — progression, one metric at a time. Rank lives on the Progress tab. */}
          <section className="af-c13-card">
            <p className="af-c13-head">
              Career progression
              <span className="sp">
                <Link className="af-cr-xplink" href={careerHref(data.filter, { view: 'progress' })}>
                  With rank →
                </Link>
              </span>
            </p>
            <CareerProgressChart seasons={data.seasons} rank={null} />
          </section>

          {legacy ? (
            <section className="af-c13-card">
              <p className="af-c13-head">
                Legacy score
                <span className="sp" />
                <span className="af-c13-big warn" style={{ fontSize: 26 }}>
                  {legacy.total}
                </span>
                <TopicTip topic="careerLegacy" />
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
                The legacy score has six dimensions. Rivalry needs head-to-head results against a named
                manager and awards needs an awards record; an imported season carries a record,
                not an opponent ledger. Both are shown unweighted rather than scored zero, and the
                four above are re-normalised across what can be scored.
              </p>
            </section>
          ) : null}

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
                      <h3 className="af-cr-ring-name">
                        <Link href={careerHref({ ...data.filter, league: t.leagueKey })}>{t.leagueName}</Link>
                      </h3>
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

        {/* ── right column ─────────────────────────────────────────────── */}
        <div className="af-c13-col">
          <section className="af-c13-card">
            <p className="af-c13-head">
              AF rank <TopicTip topic="careerXp" />
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
                {data.xp ? <CareerXpLine xp={data.xp.total} toNext={data.xp.toNext} next={data.nextLevelName} /> : null}
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

          <AwardsPreview awards={awards} href={careerHref(data.filter, { view: 'awards' })} />
          <CoverageSummaryCard data={data} href={careerHref(data.filter, { view: 'coverage' })} />
          <section className="af-c13-card">
            <p className="af-c13-head">
              Record book
              <span className="sp">
                <Link className="af-cr-xplink" href={careerHref(data.filter, { view: 'records' })}>
                  Open →
                </Link>
              </span>
            </p>
            <p className="af-c13-note" style={{ marginTop: 0 }}>
              Highest scores, streaks, best seasons, biggest trades, best drafts and your rivalry ledger — each record
              names the week, league and season it came from.
            </p>
          </section>
        </div>
      </div>

      <SurvivalTable results={data.survivalResults} />
    </>
  )
}

export default Career
