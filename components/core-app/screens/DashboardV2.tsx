import { LeaguePanel } from '@/components/core-app/dash-v2/LeaguePanel'
import { ToolsGrid } from '@/components/core-app/dash-v2/ToolsGrid'
import { SectionHeader } from '@/components/core-app/dash-v2/SectionHeader'
import { Priorities } from '@/components/core-app/dash-v2/Priorities'
import { ChimmyFab } from '@/components/core-app/dash-v2/ChimmyFab'
import { Legacy } from '@/components/core-app/dash-v2/Legacy'
import { PortfolioInventory } from '@/components/core-app/dash-v2/PortfolioInventory'
import { DraftHqAll } from '@/components/core-app/dash-v2/DraftHqAll'
import { YourWeek } from '@/components/core-app/dash-v2/YourWeek'
import { Exposure } from '@/components/core-app/dash-v2/Exposure'
import { TodayRecord } from '@/components/core-app/dash-v2/TodayRecord'
import { LeagueHealth } from '@/components/core-app/dash-v2/LeagueHealth'
import { Next24 } from '@/components/core-app/dash-v2/Next24'
import { TopBar } from '@/components/core-app/dash-v2/TopBar'
import { GeoRestrictionNotice } from '@/components/core-app/GeoRestrictionNotice'
import { MobileChrome } from '@/components/core-app/dash-v2/MobileChrome'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'
import type { CareerData } from '@/lib/core-app/career'
import type { PortfolioData } from '@/lib/core-app/portfolio'
import type { DraftHqAllData } from '@/lib/core-app/draftHqAll'
import type { WeekAllData } from '@/lib/core-app/weekAll'
import type { TodayStripData } from '@/lib/core-app/todayStrip'
// af-core.css carries the .af-core token layer. This screen renders OUTSIDE
// AfCoreShell (it brings its own left panel), so the shell does not import it
// here — without this line every var(--surface) / var(--line) below computes to
// nothing and the page paints as text on a void. That exact failure shipped on
// the landing page and on /login before being caught, so it is loaded explicitly.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-v2.css'

/**
 * Dashboard v2 — shell slice.
 *
 * Built so far: the 300px league panel, the section-header system, the
 * account-wide notice, Today's priorities (real, from firstLock + the ranked
 * league list), and the Chimmy launcher.
 *
 * Also real: Draft Season HQ (cross-league aggregator), Portfolio (league
 * inventory) and Rankings & Legacy (career engine).
 *
 * Still placeholders: season timeline, your week and player exposure. Those are
 * NOT simple composition — the projection loader is per-matchup and there are no
 * results to score against, so each needs work before it can say anything true.
 *
 * ⚠ THE PLACEHOLDER LINES ARE DELIBERATE AND SPECIFIC. They name the missing
 * source rather than saying "Loading…" — the handoff's own build rule is that no
 * module ships a loading or empty state, and a vague placeholder is how a screen
 * ends up looking broken rather than honest. Where a number cannot be shown, the
 * reason is the copy.
 */
export function DashboardV2({
  data,
  weekLabel = null,
  career = null,
  portfolio = null,
  drafts = null,
  week = null,
  strip = null,
  nowIso,
  planName = null,
  syncedLabel = null,
  commissionerCount = 0,
}: {
  data: Dash34Data | null
  /** From the loader's result, not from Dash34Data — passed in rather than
   *  widening this prop to the server-only return type. */
  weekLabel?: string | null
  /** Cross-league reads. Both are real; each module documents what the handoff
   *  asks for that its loader cannot answer. */
  career?: CareerData | null
  portfolio?: PortfolioData | null
  /** Cross-league draft states, from the aggregator — not the per-league loader. */
  drafts?: DraftHqAllData | null
  /** Real scored matchups. Carries its own season — do not assume current. */
  week?: WeekAllData | null
  /**
   * The three cross-league cards at the top: today's record, league health and
   * the next 24 hours. Each carries its own availability — see todayStrip.ts for
   * which gates are open on production and why.
   */
  strip?: TodayStripData | null
  /** Server instant for the bar clock; localised after hydration. */
  nowIso: string
  planName?: string | null
  /** Real sync age when one exists; null means nothing has ever synced, which
   *  the bar states outright rather than showing an invented age. */
  syncedLabel?: string | null
  commissionerCount?: number
}) {
  // The panel browses everything; the priority cards still use the capped list.
  const leagues = data?.allLeagues ?? data?.leagues ?? []
  const total = data?.totalLeagues ?? 0
  const quiet = data?.quiet ?? null

  return (
    <div className="af-core af-d2 af-d2-shell">
      <MobileChrome leagueCount={total > 0 ? total : null}>
        <LeaguePanel
        leagues={leagues}
        totalLeagues={total}
        commissionerCount={commissionerCount}
        /*
         * The identity footer shows the career level beside the name. It comes
         * from the same `career` object Rankings & Legacy renders, so the two
         * cannot disagree — and it is omitted rather than defaulted when the
         * career engine has no level for this account, because "LEVEL 1" on an
         * unranked account is a measurement nobody took.
         */
        levelLabel={
          career?.levelName
            ? career.level != null
              ? `LEVEL ${career.level} · ${career.levelName}`
              : career.levelName
            : career?.level != null
              ? `LEVEL ${career.level}`
              : null
        }
        /*
         * `quiet` only — never quiet + overflow. The Dash34Data type carries an
         * explicit warning that adding them printed "53 leagues are quiet —
         * nothing needs you" over an account where nearly all 53 had a flagged
         * starter. An overflowed league is hidden by a list cap; a quiet one has
         * been looked at and cleared. They are different claims.
         */
        quietSummary={
          quiet && quiet.count > 0
            ? {
                count: quiet.count,
                text: quiet.sample
                  ? `${quiet.sample} — nothing needs you.`
                  : `${quiet.count} ${quiet.count === 1 ? 'league is' : 'leagues are'} quiet — nothing needs you.`,
              }
            : null
        }
        />
      </MobileChrome>

      <main className="af-d2-main">
        {/*
          ⚠ COMPLIANCE, NOT CHROME. AfCoreShell renders this once so every screen
          inside it inherits the check — and this screen deliberately sits OUTSIDE
          that shell, so it has to render it itself. The component's own note is
          explicit: every other item on the cutover ledger costs a feature, this
          one costs compliance. Without it a dashboard offering paid plans would
          do so in states where we have determined we cannot sell them.

          It renders nothing while the hook is loading, by design — showing a
          restriction before we know where someone is would tell unrestricted
          users they cannot buy.
        */}
        <GeoRestrictionNotice />

        {/*
          syncedLabel is null whenever the account carries the never-synced
          notice — the bar then states that outright instead of showing an age it
          cannot compute. lastSyncedAt is null on all 98 leagues.
        */}
        <TopBar
          nowIso={nowIso}
          weekLabel={weekLabel}
          planName={planName}
          syncedLabel={syncedLabel}
          leagueCount={total > 0 ? total : null}
        />

        {/*
          One account-wide fact, stated once. This is the 604-row fix: the old
          home derived a "League data is stale" issue per league and rendered it
          604 times. Sync having never run is one fact about the connection, not
          N facts about N leagues.
        */}
        {data?.notice ? (
          <div className="af-d2-notice">
            <p className="af-d2-notice-title">{data.notice.title}</p>
            <p className="af-d2-notice-body">{data.notice.body}</p>
            {data.notice.href && data.notice.label ? (
              <a className="af-d2-notice-link" href={data.notice.href}>
                {data.notice.label}
              </a>
            ) : null}
          </div>
        ) : null}

        {/*
          The top strip. Health always renders — as a score or as an explicit
          unknown — because a league exists whether or not we have read it, and
          an absent health tile lets the reader fill in the blank themselves
          (they fill it in with "fine"). The record tile renders only when
          something is actually scored: a 0–0 reads as a day that was played and
          lost, which is worse than saying nothing.
        */}
        {strip ? (
          <section>
            <div className="af-d2-strip">
              <TodayRecord state={strip.record} />
              <LeagueHealth state={strip.health} />
            </div>
            {/*
              The record's reason, stated once under the strip rather than inside
              a tile that is deliberately absent. Without this the account is
              never told why there is no scoreboard — with it, the omission is a
              sentence instead of a gap.
            */}
            {!strip.record.available ? (
              <p className="af-d2-strip-note">{strip.record.reason}</p>
            ) : null}
          </section>
        ) : null}

        <section>
          <SectionHeader
            label="Today's priorities"
            counter={
              leagues.length > 0 ? `${leagues.length} OF ${total} LEAGUES RANKED` : null
            }
          />
          <Priorities data={data} />
        </section>

        {/*
          ⚠ REPLACES "Needs your call — all leagues", WHICH RENDERED `dash34.next24`.
          That list was game kickoffs only; this one is the same kickoffs plus
          real waiver runs, so keeping both would print every kickoff twice under
          two headings that make the same claim. NeedsYourCall.tsx is still on
          disk — restoring it is one section block.

          ⚠ AND IT IS NOT THE SEASON TIMELINE. This is a cross-league "what needs
          me before tomorrow" strip. The season timeline — playoff start, trade
          deadline, the shape of a league's year — is per-league and belongs on
          the league dashboard, reached by choosing a league. Putting a playoff
          week next to a waiver run makes neither legible.
        */}
        <section>
          <SectionHeader
            label="Next 24 hours — all leagues"
            counter={strip?.next24.length ? `${strip.next24.length} ITEMS` : null}
          />
          <Next24 rows={strip?.next24 ?? []} />
        </section>

        <section>
          <SectionHeader
            label="Draft Season HQ"
            counter={
              drafts
                ? [
                    drafts.counts.live > 0 ? `${drafts.counts.live} LIVE` : null,
                    drafts.counts.upcoming > 0 ? `${drafts.counts.upcoming} UPCOMING` : null,
                    drafts.counts.done > 0 ? `${drafts.counts.done} DONE` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || null
                : null
            }
          />
          <DraftHqAll data={drafts} />
        </section>

        <section>
          {/* The counter states the season these numbers are from. Every cached
              row is 2025 while the clock reads 2026, so an unlabelled "your week"
              would read as live. */}
          <SectionHeader
            label="Your week — every matchup"
            counter={
              week?.season != null && week.week != null
                ? `WEEK ${week.week} · ${week.season}`
                : null
            }
          />
          <YourWeek data={week} />
        </section>

        <section>
          {/*
            Titled "league inventory", not "roster market value". getPortfolio
            returns the former; the latter needs per-player values summed per
            roster, which is separate work. Naming the section after the module
            we wish we had would be the dishonest half of shipping this one.
          */}
          <SectionHeader
            label="Portfolio — league inventory"
            counter={
              portfolio?.commissionedCount
                ? `${portfolio.commissionedCount} COMMISSIONED`
                : null
            }
          />
          <PortfolioInventory data={portfolio} />
        </section>

        <section>
          <SectionHeader
            label="Player exposure"
            counter={
              data?.book?.[0]?.exposureTotal
                ? `ACROSS ${data.book[0].exposureTotal} LEAGUES`
                : null
            }
          />
          <Exposure data={data} />
        </section>

        <section>
          <SectionHeader
            label="Rankings &amp; Legacy"
            counter={career?.level != null ? `LEVEL ${career.level}` : null}
          />
          <Legacy data={career} />
        </section>

        {/*
          The handoff's six-tile grid. It sits last because every tile is a way
          OUT of this screen — the sections above are what the dashboard is for,
          and a grid of exits above them competes with the work.
        */}
        <section>
          <SectionHeader label="Tools" />
          <ToolsGrid
            totalLeagues={total}
            commissionerCount={commissionerCount}
            levelName={career?.levelName ?? null}
            hasCareer={Boolean(career && !career.isEmpty)}
          />
        </section>
      </main>

      {/*
        Collapsed by default; opening is the user's decision. Nothing is generated
        on load — see the note in ChimmyFab for why a proactive opening line would
        bill for every dashboard visit.
      */}
      <ChimmyFab unread={data?.chatUnread ?? 0} />
    </div>
  )
}

export default DashboardV2
