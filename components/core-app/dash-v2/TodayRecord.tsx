import type { SectionState } from '@/lib/core-app/leagueHome'
import type { TodayRecord as TodayRecordData } from '@/lib/core-app/todayStrip'

/**
 * Today's record — how many of your live matchups you are winning right now.
 *
 * ⚠ THE UNAVAILABLE BRANCH RENDERS NOTHING AT ALL, AND THAT IS THE FEATURE.
 * Every other module on this screen states why a number is missing, because a
 * missing section reads as broken. This one is the exception: the handoff's own
 * instruction is that a 0–0 reads as a day that was played and lost rather than
 * a day with nothing scored, and the same is true of a tile that sits there
 * saying "no results yet" next to a live-looking scoreboard. A record is a
 * scoreboard or it is absent.
 *
 * The reason is not discarded — the parent puts it in the strip's own footnote
 * once, alongside the health tile's, so the account gets told once instead of
 * each tile apologising separately.
 */
export function TodayRecord({ state }: { state: SectionState<TodayRecordData> }) {
  if (!state.available) return null

  const { wins, losses, week, season } = state.data

  return (
    <div className="af-d2-card af-d2-stat">
      <p className="af-d2-stat-label">Today&rsquo;s record</p>
      <p className="af-d2-stat-value af-num">
        <b>{wins}</b>
        <span className="af-d2-stat-sep">–</span>
        <i>{losses}</i>
      </p>
      {/*
        The season and week are stamped on the tile for the same reason "Your
        week" carries them: this screen has shipped with 2025 rows under a 2026
        clock before, and an unlabelled record is the one number nobody
        double-checks the date on.
      */}
      <p className="af-d2-stat-sub">
        Week {week} · {season}
      </p>
    </div>
  )
}

export default TodayRecord
