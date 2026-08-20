import Link from 'next/link'
import type { CareerData } from '@/lib/core-app/career'

/**
 * Rankings & Legacy — wired to the real career engine.
 *
 * Every number here is read, not derived for display: `getCareerData` reads the
 * same denormalised columns /api/user/rank uses, deliberately, because two
 * surfaces disagreeing about someone's level is worse than either being stale.
 *
 * ⚠ NULL AND ZERO ARE DIFFERENT AND THE TYPE SAYS SO. `winRate` is null when no
 * games are recorded — "a 0% career is not the same as no data". Each tile below
 * omits itself rather than printing 0, which would read as a measured result.
 *
 * ⚠ `legacy.unavailable` NAMES THE DIMENSIONS IMPORTS CANNOT ANSWER. It is
 * rendered rather than hidden: a legacy score that silently drops what it could
 * not measure invites the reader to treat it as complete.
 */
export function Legacy({ data }: { data: CareerData | null }) {
  if (!data || data.isEmpty) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">
          No career history yet. Import a league with completed seasons and this
          fills in — level, record, titles and playoff appearances all come from
          imported history rather than from play on AllFantasy.
        </p>
      </div>
    )
  }

  const tiles: Array<{ label: string; value: string }> = []
  if (data.games > 0) {
    tiles.push({
      label: 'ALL-TIME',
      value: data.ties > 0
        ? `${data.wins}–${data.losses}–${data.ties}`
        : `${data.wins}–${data.losses}`,
    })
  }
  if (data.championships > 0) tiles.push({ label: 'TITLES', value: String(data.championships) })
  if (data.playoffAppearances > 0) {
    tiles.push({ label: 'PLAYOFFS', value: String(data.playoffAppearances) })
  }
  if (data.seasonsPlayed > 0) tiles.push({ label: 'SEASONS', value: String(data.seasonsPlayed) })
  if (data.distinctLeagues > 0) {
    tiles.push({ label: 'LEAGUES', value: String(data.distinctLeagues) })
  }

  const xp = data.xp

  return (
    <div className="af-d2-card af-d2-legacy">
      <div className="af-d2-legacy-top">
        <div className="af-d2-legacy-id">
          {data.levelName ? (
            <span className="af-d2-legacy-tier af-num">{data.levelName.toUpperCase()}</span>
          ) : null}
          <span className="af-d2-legacy-level">
            {data.level != null ? `Level ${data.level}` : 'Unranked'}
            {data.levelName ? ` · ${data.levelName}` : ''}
          </span>
          {xp && xp.toNext != null && data.nextLevelName ? (
            <span className="af-d2-legacy-xp af-num">
              {xp.total.toLocaleString()} XP · {xp.toNext.toLocaleString()} to{' '}
              {data.nextLevelName}
            </span>
          ) : null}
        </div>

        {/*
          The grade ring. The handoff draws a circular badge with a letter; the
          number inside is real (the prestige engine's 0–100), so it is rendered
          as a ring around that value rather than as a letter.

          ⚠ NO LETTER IS INVENTED. Mapping 75 to "B+" means choosing a grading
          curve nothing in this codebase defines, and a letter reads as an
          assessment rather than as a score — the same failure as a "C" trade
          grade that actually meant no data. The ring shows the measured number
          and the scale it is out of.

          ⚠ NO LEVEL ARTWORK EITHER. The design pairs this with a rank badge
          image; there is no level/rank/tier asset anywhere in public/, so the
          tier renders as its name in accent rather than as a placeholder graphic
          standing in for art that does not exist.
        */}
        {data.prestige ? (
          <div
            className="af-d2-legacy-score"
            style={{ ['--af-d2-ring' as string]: `${Math.max(0, Math.min(100, data.prestige.total))}%` }}
          >
            <span className="af-d2-legacy-ring" aria-hidden />
            <span className="af-d2-legacy-score-num af-num">
              {Math.round(data.prestige.total)}
            </span>
            <span className="af-d2-legacy-score-label af-num">PRESTIGE / 100</span>
          </div>
        ) : null}
      </div>

      {xp?.progressPct != null ? (
        <div className="af-d2-legacy-bar" aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, xp.progressPct))}%` }} />
        </div>
      ) : null}

      {tiles.length > 0 ? (
        <div className="af-d2-legacy-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className="af-d2-legacy-tile">
              <span className="af-d2-legacy-tile-val af-num">{tile.value}</span>
              <span className="af-d2-legacy-tile-lab af-num">{tile.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="af-d2-empty">
          No completed seasons on file yet, so there is no record, title count or
          playoff history to show.
        </p>
      )}

      {data.legacy && data.legacy.unavailable.length > 0 ? (
        <p className="af-d2-legacy-gaps">
          Not scored, because imports do not carry it:{' '}
          {data.legacy.unavailable.join(', ')}.
        </p>
      ) : null}

      <Link href="/core/career" className="af-d2-legacy-link">
        Open Career &amp; Legacy
      </Link>
    </div>
  )
}

export default Legacy
