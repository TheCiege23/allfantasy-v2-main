import Link from 'next/link'
import { getLevelIcon } from '@/lib/rank/levels'
import {
  WIN_RATE_MIN_LEAGUES,
  type LadderTier,
  type LeaderRow,
  type LeaderboardTab,
  type RankingsData,
  type XpRow,
} from '@/lib/core-app/rankings'
import '@/components/core-app/af-rankings-screen.css'

/**
 * Rankings — handoff 14a, the cross-user ladder.
 *
 * ⚠ THIS REPLACES A BLURRED "COMING SOON" LEADERBOARD. `AfRankingsPageSections`
 * rendered three invented rows at 40% opacity behind a blur, which is a picture
 * of a feature rather than the feature. Every row below is a real ranked
 * profile, and where a board cannot be computed it says which data is missing
 * instead of mocking up what it would look like.
 *
 * ⚠ NO CLIENT JAVASCRIPT. The tabs are links and the ladder is static, exactly
 * as the handoff describes them — the leaderboard tab is `?board=`, so a chosen
 * board is shareable and survives a reload. 14c's search is a plain GET form for
 * the same reason.
 *
 * ⚠ THE POPULATION IS STATED, NOT IMPLIED. Five managers have ever been ranked
 * on the full-data database. A board that reads "#1" without saying "of 5" would
 * let a five-person list pass as a global standing.
 */

function initials(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 1).toUpperCase() || '?'
}

/** Caution marker for a figure derived from self-contradicting career counters. */
function Suspect({ what }: { what: string }) {
  return (
    <span
      className="af-rk-suspect"
      title={`${what} is derived from career counters that contradict each other — this manager's championship and playoff totals exceed their recorded league-seasons. Shown because the profile was ranked, marked because the number cannot be relied on.`}
      aria-label={`${what} unreliable`}
    >
      !
    </span>
  )
}

/* ────────────────────────────── your rank ───────────────────────────────── */

function YourRankCard({ data }: { data: RankingsData }) {
  const you = data.you
  if (!you) {
    return (
      <section className="af-rk-card">
        <p className="af-rk-eyebrow">Your rank</p>
        <p className="af-rk-a">
          {data.signedIn
            ? 'Your career has not been ranked yet. Import a league and your XP, level and tier appear here — the ladder on the right is the one you will be climbing.'
            : 'Sign in to see where you sit on the ladder. The tiers and their thresholds are the same for everyone and are shown in full either way.'}
        </p>
      </section>
    )
  }

  return (
    <section className="af-rk-card">
      <div className="af-rk-rank-top">
        <p className="af-rk-eyebrow" style={{ margin: 0 }}>
          Your rank
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
      <div className="af-rk-bar">
        <i style={{ width: `${you.progressPct}%` }} />
      </div>

      {you.xpToNext != null && you.nextLevelName ? (
        <p className="af-rk-next">
          {you.xpToNext.toLocaleString()} XP to <b>{you.nextLevelName}</b>.
        </p>
      ) : (
        <p className="af-rk-next">
          <b>Level {you.totalLevels}</b> — the last rung. There is nothing above this.
        </p>
      )}
    </section>
  )
}

/* ──────────────────────────── XP breakdown ──────────────────────────────── */

const XP_BAR_TONE: Record<XpRow['key'], string> = {
  wins: '',
  // The handoff's colour contract: championship-derived XP is --warn,
  // playoff-derived is --good, everything else rides the accent.
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
      <p className="af-rk-eyebrow">
        Where your XP came from
        <span className="af-rk-spacer" />
      </p>

      {data.xpRows.map((r) => (
        <div className="af-rk-xprow" key={r.key}>
          <div className="af-rk-xpline">
            <span className="af-rk-xplabel">{r.detail}</span>
            <span className="af-rk-xpval">{r.xp.toLocaleString()}</span>
          </div>
          {r.hasBar ? (
            <div className={`af-rk-xpbar ${XP_BAR_TONE[r.key]}`}>
              <i style={{ width: `${Math.round(r.share * 100)}%` }} />
            </div>
          ) : null}
        </div>
      ))}

      <div className="af-rk-total">
        <b>Total</b>
        <span>{data.you.xp.toLocaleString()}</span>
      </div>

      {/*
        ⚠ THIS BLOCK IS LOAD-BEARING, NOT DECORATION. When the stored total and
        the published rules disagree, the page says so and names which number it
        is showing. The alternative — quietly back-solving the difference into
        the league-size bonus — puts a six-figure fabricated row in a card whose
        entire purpose is disclosing the formula.
      */}
      {rec?.divergent ? (
        <p className="af-rk-note af-rk-note--warn">
          Your stored XP total is {rec.stored?.toLocaleString()}, but the published rules above score
          your career at {rec.fromEvents.toLocaleString()}. The rules are the source of truth, so that
          is the figure shown here and the level it produces is the level above. The stored total was
          written by a second ranking path that does not use these weights.
        </p>
      ) : null}

      <p className="af-rk-note">
        Losses never subtract XP — the ladder only moves up or stays flat. Imported Sleeper, ESPN and
        Yahoo seasons count exactly the same as leagues played here, and each league-season is counted
        once.
      </p>
    </section>
  )
}

/* ─────────────────────────────── the ladder ─────────────────────────────── */

function Ladder({ tiers }: { tiers: LadderTier[] }) {
  return (
    <section className="af-rk-card">
      <p className="af-rk-eyebrow">
        The ladder
        <span className="af-rk-spacer" />
        <span>25 levels · 7 tiers</span>
      </p>

      <div className="af-rk-ladder">
        {tiers.map((t) => (
          <div
            key={t.group}
            className={`af-rk-rung${t.isCurrent ? ' af-rk-rung--current' : ''}`}
            style={{ ['--rung-color' as string]: t.color }}
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
              {t.maxXp == null
                ? `${t.minXp.toLocaleString()}+`
                : `${t.minXp.toLocaleString()} – ${t.maxXp.toLocaleString()}`}
            </span>
          </div>
        ))}
      </div>

      <div className="af-rk-ladder-foot">
        <span>
          Levels are absolute, not graded on a curve — nobody is demoted because someone else
          climbed.
        </span>
        <Link href="/core/rankings?view=faq">Read the FAQ →</Link>
      </div>
    </section>
  )
}

/* ───────────────────────────── leaderboards ─────────────────────────────── */

function LeaderRowView({ row, warnScore }: { row: LeaderRow; warnScore?: boolean }) {
  return (
    <div className={`af-rk-lrow${row.isYou ? ' af-rk-lrow--you' : ''}`}>
      <span className="af-rk-lpos">{row.rank}</span>
      {row.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-rk-lav" src={row.avatarUrl} alt="" width={30} height={30} />
      ) : (
        <span className="af-rk-lav" aria-hidden="true">
          {initials(row.handle)}
        </span>
      )}
      <div className="af-rk-lbody">
        <p className="af-rk-lname">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{row.handle}
          </span>
          {row.isYou ? <i>· you</i> : null}
        </p>
        <p className="af-rk-lctx">{row.context}</p>
      </div>
      <span className={`af-rk-lscore${warnScore ? ' af-rk-lscore--warn' : ''}`}>
        {row.score}
        {row.suspect ? <Suspect what="This score" /> : null}
      </span>
    </div>
  )
}

function LeaderboardCard({
  boards,
  active,
  population,
}: {
  boards: LeaderboardTab[]
  active: LeaderboardTab['key']
  population: number
}) {
  const board = boards.find((b) => b.key === active) ?? boards[0]

  return (
    <section className="af-rk-card">
      <div className="af-rk-tabs">
        {boards.map((b) => (
          <Link
            key={b.key}
            href={`/core/rankings?board=${b.key}`}
            className="af-rk-tab"
            aria-current={b.key === board.key ? 'true' : undefined}
          >
            {b.label}
          </Link>
        ))}
      </div>

      <p className="af-rk-eyebrow">
        {board.label}
        <span className="af-rk-spacer" />
        <span>{board.metricLabel}</span>
      </p>

      {board.unavailable ? (
        <p className="af-rk-empty">{board.unavailable}</p>
      ) : (
        <div>
          {board.rows.map((r) => (
            <LeaderRowView key={`${board.key}-${r.userId}`} row={r} warnScore={board.key === 'titles'} />
          ))}
        </div>
      )}

      {/*
        ⚠ THE DENOMINATOR IS THE POINT. "#1" out of five managers is a very
        different claim from "#1" on a global board, and only one of them is
        true here.
      */}
      <p className="af-rk-note">
        {population === 0
          ? 'No manager has been ranked yet.'
          : `Ranked across ${population} ${population === 1 ? 'manager' : 'managers'} — everyone whose career has been scored so far, not the whole user base. Scores here come from each manager's last rank calculation, so a career page recomputed since can differ slightly.`}
        {board.key === 'winRate' ? ` Managers need ${WIN_RATE_MIN_LEAGUES}+ league-seasons to appear here.` : ''}
      </p>
    </section>
  )
}

/* ─────────────────────────────── the screen ─────────────────────────────── */

export function Rankings({
  data,
  board,
}: {
  data: RankingsData
  board?: string | null
}) {
  const activeBoard = (data.boards.find((b) => b.key === board)?.key ??
    'top') as LeaderboardTab['key']

  return (
    <div className="af-rk">
      <header className="af-rk-head">
        <div>
          <h1 className="af-rk-title">Rankings</h1>
          <p className="af-rk-sub">
            {data.calculatedAt
              ? `Recalculated after every synced result · yours last ran ${new Date(
                  data.calculatedAt,
                ).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'Recalculated after every synced result'}
          </p>
        </div>
        <div className="af-rk-headact">
          <Link className="af-rk-btn" href="/core/rankings?view=compare">
            Compare a manager
          </Link>
          <Link className="af-rk-btn af-rk-btn--primary" href="/core/rankings?view=faq">
            How ranking works
          </Link>
        </div>
      </header>

      {data.suspectCount > 0 ? (
        <p className="af-rk-note af-rk-note--warn" style={{ margin: 0 }}>
          {data.suspectCount} of {data.rankedPopulation} ranked{' '}
          {data.suspectCount === 1 ? 'profile has' : 'profiles have'} career counters that contradict
          each other — more championships or playoff appearances than recorded league-seasons.
          Affected figures are marked rather than hidden, because the profiles were genuinely ranked
          and dropping them would quietly change the standings.
        </p>
      ) : null}

      <div className="af-rk-grid">
        <div className="af-rk-col">
          <YourRankCard data={data} />
          <XpBreakdownCard data={data} />
        </div>

        <div className="af-rk-col">
          <Ladder tiers={data.ladder} />
        </div>

        <div className="af-rk-col">
          <LeaderboardCard
            boards={data.boards}
            active={activeBoard}
            population={data.rankedPopulation}
          />
        </div>
      </div>
    </div>
  )
}
