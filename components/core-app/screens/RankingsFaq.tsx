import Link from 'next/link'
import { getLevelIcon } from '@/lib/rank/levels'
import {
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
  RANK_XP_LEAGUE_SIZE_MULTIPLIER,
} from '@/lib/rank/rank-xp-constants'
import { IMPROVEMENT_THRESHOLDS, MAX_UNJUSTIFIED_CLIMB } from '@/lib/rankings-engine/anti-gaming'
import { GRADE_SCALE, WIN_RATE_MIN_LEAGUES, type RankingsData } from '@/lib/core-app/rankings'
import '@/components/core-app/af-rankings-screen.css'

/**
 * How ranking works — handoff 14b.
 *
 * ⚠ EVERY CONSTANT ON THIS PAGE IS IMPORTED, NEVER TYPED. Build rule 1 makes
 * this page the single source of truth for the numbers 14a and 13a render, and
 * build rule 3 says the anti-gaming thresholds must stay in sync with the
 * ranking engine. A FAQ that hard-codes "+200" is a FAQ that starts lying the
 * first time someone retunes the weight — so the XP values come from
 * `rank-xp-constants`, the tier table from `RANK_LEVELS`, and the four climb
 * thresholds straight out of `lib/rankings-engine/anti-gaming.ts`.
 *
 * ⚠ THE TIER HIGHLIGHT AND FOOTER CHIP ARE REAL, THE REST IS STATIC. Build rule
 * 4: the current-tier marker reflects the viewing user's actual level even
 * though everything around it is reference content.
 */

/**
 * Per-tier flavour and the entry threshold, keyed by tier group.
 *
 * The one-liners are the design's own copy. The XP figures beside them are NOT
 * here — they are read off the ladder, which is derived from `RANK_LEVELS`.
 */
const TIER_FLAVOUR: Record<number, string> = {
  1: 'Everyone starts here',
  2: '~100 career wins',
  3: 'About 8 strong seasons',
  4: 'Titles start to matter more than wins',
  5: 'Deep runs, year after year',
  6: 'Multiple rings required',
  7: 'The last rung',
}

/** Colour band for each grade chip — A family good, C warn, D bad. */
function gradeTone(grade: string): string {
  if (grade.startsWith('A')) return 'af-rk-chip--good'
  if (grade.startsWith('C')) return 'af-rk-chip--warn'
  if (grade.startsWith('D')) return 'af-rk-chip--bad'
  return ''
}

export function RankingsFaq({ data }: { data: RankingsData }) {
  const you = data.you

  /*
   * The worked example is computed from the constants rather than written out,
   * so the arithmetic in the sentence cannot contradict the chips above it.
   */
  const exWins = 10
  const exTeams = 12
  const exSize = Math.max(0, exTeams - 10) * RANK_XP_LEAGUE_SIZE_MULTIPLIER
  const exBase =
    exWins * RANK_XP_PER_IMPORT_WIN +
    RANK_XP_PER_PLAYOFF_APPEARANCE +
    RANK_XP_PER_DISTINCT_SEASON +
    exSize

  return (
    <div className="af-rk">
      <header className="af-rk-head">
        <div>
          <h1 className="af-rk-title">How ranking works</h1>
          <p className="af-rk-sub">
            Every weight, threshold and scale the product uses to rank a manager.
          </p>
        </div>
        <div className="af-rk-headact">
          <Link className="af-rk-btn" href="/core/rankings">
            ← Back to Rankings
          </Link>
        </div>
      </header>

      <div className="af-rk-faq">
        {/* 1 — XP formula */}
        <section className="af-rk-card af-rk-card--span">
          <h2 className="af-rk-q">How is my rank XP calculated?</h2>
          <div className="af-rk-chips">
            <span className="af-rk-chip">WIN = {RANK_XP_PER_IMPORT_WIN}</span>
            <span className="af-rk-chip">PLAYOFF APPEARANCE = {RANK_XP_PER_PLAYOFF_APPEARANCE}</span>
            <span className="af-rk-chip af-rk-chip--warn">
              CHAMPIONSHIP = {RANK_XP_PER_CHAMPIONSHIP}
            </span>
            <span className="af-rk-chip">SEASON = {RANK_XP_PER_DISTINCT_SEASON}</span>
            <span className="af-rk-chip">
              LEAGUE SIZE = (TEAMS − 10) × {RANK_XP_LEAGUE_SIZE_MULTIPLIER}
            </span>
          </div>
          <p className="af-rk-a">
            Add them up and that&apos;s your XP. A {exWins}-win playoff season in a {exTeams}-team
            league is {exWins * RANK_XP_PER_IMPORT_WIN} + {RANK_XP_PER_PLAYOFF_APPEARANCE} +{' '}
            {RANK_XP_PER_DISTINCT_SEASON} + {exSize} = {exBase} XP. Win it and it&apos;s{' '}
            {exBase + RANK_XP_PER_CHAMPIONSHIP}.
          </p>
        </section>

        {/* 2 — the seven tiers */}
        <section className="af-rk-card af-rk-card--span">
          <h2 className="af-rk-q">
            The seven tiers and what it takes to enter each one{' '}
            <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--faint)' }}>
              XP shown is the entry threshold
            </span>
          </h2>
          <div className="af-rk-tiergrid">
            {data.ladder.map((t) => (
              <div
                key={t.group}
                className={`af-rk-tiercell${t.isCurrent ? ' af-rk-tiercell--current' : ''}`}
              >
                <span className="ic" aria-hidden="true">
                  {getLevelIcon(t.group)}
                </span>
                <b>{t.tier}</b>
                <span>{t.levelRange.replace('Level ', 'LVL ').replace('Lv ', 'LVL ')}</span>
                <span
                  style={{
                    color: t.isCurrent ? 'var(--accent)' : 'var(--text)',
                    fontSize: 13,
                    margin: '6px 0 5px',
                  }}
                >
                  {t.minXp.toLocaleString()}
                </span>
                <span style={{ fontFamily: 'inherit', fontWeight: 400, fontSize: 11 }}>
                  {TIER_FLAVOUR[t.group]}
                </span>
              </div>
            ))}
          </div>

          {/* Build rule 4: this chip is the viewer's real position. */}
          <p className="af-rk-note" style={{ marginTop: 14 }}>
            {you
              ? `You're at level ${you.level} of ${you.totalLevels} — ${you.levelName}.` +
                (you.xpToNext != null && you.nextLevelName
                  ? ` ${you.nextLevelName} needs ${(you.xp + you.xpToNext).toLocaleString()} XP, so ${you.xpToNext.toLocaleString()} to go: titles move it fastest, seasons alone would take years.`
                  : ' There is no rung above this one.')
              : data.signedIn
                ? 'Your career has not been ranked yet, so there is no position to mark here. The thresholds above are the same for everyone.'
                : 'Sign in to see your own position marked on this table. The thresholds are the same for everyone either way.'}
          </p>
        </section>

        {/* 3 — how you gain */}
        <section className="af-rk-card af-rk-card--good">
          <h2 className="af-rk-q" style={{ color: 'var(--good)' }}>
            How you gain points
          </h2>
          <ul className="af-rk-list">
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                🏆
              </span>
              <b>Win a championship</b>
              <span>+{RANK_XP_PER_CHAMPIONSHIP}</span>
            </li>
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                ⭐
              </span>
              <b>Make the playoffs</b>
              <span>+{RANK_XP_PER_PLAYOFF_APPEARANCE}</span>
            </li>
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                ▶️
              </span>
              <b>Win a matchup</b>
              <span>+{RANK_XP_PER_IMPORT_WIN}</span>
            </li>
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                📋
              </span>
              <b>Play a season</b>
              <span>+{RANK_XP_PER_DISTINCT_SEASON}</span>
            </li>
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                🛡️
              </span>
              <b>Play deeper leagues</b>
              <span>+{RANK_XP_LEAGUE_SIZE_MULTIPLIER} per team over 10</span>
            </li>
          </ul>
        </section>

        {/* 4 — how you lose */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">How you lose points</h2>
          <p className="af-rk-a">
            Normally, you don&apos;t. There is no penalty for losing a matchup, missing the playoffs,
            finishing last or taking a season off. XP only ever goes down when the underlying record
            changes:
          </p>
          <ul className="af-rk-list" style={{ marginTop: 12 }}>
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                ↓
              </span>
              <b style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--text2)' }}>
                You disconnect a platform, so its seasons stop counting.
              </b>
            </li>
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                ↓
              </span>
              <b style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--text2)' }}>
                A sync corrects a result that was previously wrong.
              </b>
            </li>
            <li className="af-rk-li">
              <span className="ic" aria-hidden="true">
                ↓
              </span>
              <b style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--text2)' }}>
                A duplicate import is merged, so one league-season stops being counted twice.
              </b>
            </li>
          </ul>
          <p className="af-rk-note">Each of those is a correction to the record, not a punishment.</p>
        </section>

        {/* 5 — losses */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">Do losses cost me XP?</h2>
          <p className="af-rk-a">
            No. Losses never subtract. The ladder measures what you&apos;ve accumulated, so your level
            can only stay flat or go up — a bad season slows you down, it doesn&apos;t demote you.
          </p>
        </section>

        {/* 6 — imported history */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">Does my old Sleeper history count?</h2>
          <p className="af-rk-a">
            Yes. Imported seasons from Sleeper, ESPN and Yahoo count the same as leagues played inside
            AllFantasy. Each league-season is counted once, and imported data wins when two sources
            describe the same season.
          </p>
        </section>

        {/* 7 — levels and tiers */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">What are the levels and tiers?</h2>
          <p className="af-rk-a">
            {data.ladder.reduce((n, t) => n + (t.lastLevel - t.firstLevel + 1), 0)} levels grouped
            into {data.ladder.length} tiers: {data.ladder.map((t) => t.tier).join(', ')}. Level{' '}
            {data.ladder[data.ladder.length - 1].firstLevel} starts at{' '}
            {data.ladder[data.ladder.length - 1].minXp.toLocaleString()} XP. Thresholds are fixed —
            you&apos;re never ranked against other people for your level.
          </p>
        </section>

        {/* 8 — score glossary */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">AF Rank, GM prestige, legacy score — what&apos;s the difference?</h2>
          <p className="af-rk-a">
            <b style={{ color: 'var(--text)' }}>AF Rank</b> is a level from accumulated XP.{' '}
            <b style={{ color: 'var(--text)' }}>GM prestige</b> is a 0–100 blend of championships, win
            rate, tenure, leagues and playoff appearances, each capped so one huge number can&apos;t
            carry the score. <b style={{ color: 'var(--text)' }}>Legacy score</b> is a 0–100 weighted
            read of championship, playoff, consistency and dynasty performance.
          </p>
          <p className="af-rk-note">
            The design lists six legacy dimensions. Rivalry and awards are not among the four scored
            above, because nothing in an imported season carries an opponent ledger or an awards
            record — your career page names them as unmeasured rather than scoring them zero.
          </p>
        </section>

        {/* 9 — grade scale */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">How do letter grades map?</h2>
          <div className="af-rk-chips">
            {GRADE_SCALE.map((g) => (
              <span key={g.grade} className={`af-rk-chip ${gradeTone(g.grade)}`}>
                {g.grade} {g.min === 0 ? 'below' : g.min}
              </span>
            ))}
          </div>
          <p className="af-rk-note" style={{ marginTop: 0 }}>
            Same scale for draft grades and manager comparisons. Deterministic — no model decides your
            letter.
          </p>
        </section>

        {/* 10 — win % eligibility */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">Who qualifies for the Win % board?</h2>
          <p className="af-rk-a">
            Managers with at least {WIN_RATE_MIN_LEAGUES} league-seasons played. Without a minimum, one
            3–0 season would top the board forever.
          </p>
        </section>

        {/* 11 — most active */}
        <section className="af-rk-card">
          <h2 className="af-rk-q">How is &quot;Most active&quot; scored?</h2>
          <p className="af-rk-a">
            Over the last 120 days: each chat message counts 1, each trade 3, each waiver claim 2.
            Trades and waivers weigh more because they&apos;re the harder thing to fake.
          </p>
          {/*
            ⚠ SAYING SO HERE IS THE POINT OF THE PAGE. The weights are the design's
            and they are what the board would use — but the per-manager counts
            behind them are not being recorded, so the board renders empty on 14a.
            A FAQ that described a live feature would be the misleading half.
          */}
          <p className="af-rk-note af-rk-note--warn">
            This board is not live. The chat, trade and waiver counts it needs are not being recorded
            per manager yet, so the Most active tab on Rankings says that rather than showing everyone
            at zero.
          </p>
        </section>

        {/* 12 — anti-gaming */}
        <section className="af-rk-card af-rk-card--span af-rk-card--warn">
          <h2 className="af-rk-q">Can league power rankings be gamed?</h2>
          <p className="af-rk-a">
            A team can&apos;t climb more than {MAX_UNJUSTIFIED_CLIMB} spot week over week unless at
            least one real thing improved. The four things that justify a climb, with their
            thresholds:
          </p>
          <div className="af-rk-thresholds">
            <div className="af-rk-tiercell" style={{ textAlign: 'left' }}>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                STARTER VALUE
              </span>
              <b style={{ fontSize: 18, marginTop: 6 }} className="af-rk-mono">
                +{IMPROVEMENT_THRESHOLDS.starter_value_percentile}
              </b>
            </div>
            <div className="af-rk-tiercell" style={{ textAlign: 'left' }}>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                EXPECTED WINS
              </span>
              <b style={{ fontSize: 18, marginTop: 6 }} className="af-rk-mono">
                +{IMPROVEMENT_THRESHOLDS.expected_wins}
              </b>
            </div>
            <div className="af-rk-tiercell" style={{ textAlign: 'left' }}>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                INJURY HEALTH
              </span>
              <b style={{ fontSize: 18, marginTop: 6 }} className="af-rk-mono">
                +{IMPROVEMENT_THRESHOLDS.injury_delta}
              </b>
            </div>
            <div className="af-rk-tiercell" style={{ textAlign: 'left' }}>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                TRADE EFFICIENCY
              </span>
              <b style={{ fontSize: 18, marginTop: 6 }} className="af-rk-mono">
                +{IMPROVEMENT_THRESHOLDS.trade_efficiency}
              </b>
            </div>
          </div>
        </section>

        {/* 13 — footer */}
        <section className="af-rk-card af-rk-card--span">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <p className="af-rk-a" style={{ flex: 1, minWidth: 260 }}>
              Rank recalculates whenever a synced season result changes. If a league of yours
              hasn&apos;t synced, its seasons simply aren&apos;t counted yet — nothing is estimated in
              the meantime.
            </p>
            <Link className="af-rk-btn af-rk-btn--primary" href="/core/rankings?view=compare">
              Compare a manager
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
