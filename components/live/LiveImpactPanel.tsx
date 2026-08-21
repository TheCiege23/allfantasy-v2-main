'use client'

import type { LiveImpact } from '@/lib/live/liveScoresPage'

/**
 * "Your live impact" — the right-hand rail.
 *
 * ⚠ EVERY FIGURE HERE IS SUMMED FROM THE SAME PER-LEAGUE ROWS THE CARDS SHOW.
 * Build rule 3 makes this page a live mirror rather than an independent
 * calculation, so the total is the sum of what each league reported, never a
 * recomputation under some house scoring.
 */
export function LiveImpactPanel({ impact, hasRosterData }: { impact: LiveImpact; hasRosterData: boolean }) {
  return (
    <aside className="flex flex-col gap-4">
      <section
        className="rounded-2xl p-5"
        style={{ background: 'var(--live-accent-soft)', border: '1px solid var(--live-accent-line)' }}
      >
        <h2
          className="live-mono mb-3 text-[10px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--muted)' }}
        >
          Your live impact
        </h2>
        <p className="flex items-baseline gap-2">
          <span className="live-mono text-[34px] font-extrabold leading-none" style={{ color: 'var(--good)' }}>
            {impact.totalPoints.toFixed(1)}
          </span>
          <span className="live-display text-[13px]" style={{ color: 'var(--muted)' }}>
            fantasy pts scored live right now
          </span>
        </p>
        <p className="live-display mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {!hasRosterData
            ? 'Connect or claim a team to see which of your players are playing right now.'
            : impact.livePlayers === 0
              ? 'None of your players are in a live game right now.'
              : `${impact.livePlayers} of your players ${impact.livePlayers === 1 ? 'is' : 'are'} live across ${impact.liveGames} ${impact.liveGames === 1 ? 'game' : 'games'}.`}
        </p>
      </section>

      {impact.biggestMover || impact.upNext.length > 0 ? (
        <section
          className="rounded-2xl p-5"
          style={{ background: 'var(--panel)', border: '1px solid var(--live-line2)' }}
        >
          {impact.biggestMover ? (
            <>
              <h3
                className="live-mono mb-3 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--muted)' }}
              >
                Biggest mover
              </h3>
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-[15px]"
                  style={{ background: 'color-mix(in srgb, var(--good) 14%, transparent)', color: 'var(--good)' }}
                  aria-hidden="true"
                >
                  ↑
                </span>
                <div className="min-w-0">
                  <p className="live-display text-[15px] font-extrabold">{impact.biggestMover.playerName}</p>
                  {/* The headline is pre-composed by the play feed from the real
                      play — never a template filled with guessed numbers. */}
                  <p className="live-display text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {impact.biggestMover.headline}
                    {impact.biggestMover.leagues.length > 0
                      ? ` — ${impact.biggestMover.leagues.join(', ')}`
                      : ''}
                  </p>
                </div>
              </div>
            </>
          ) : null}

          {impact.upNext.length > 0 ? (
            <>
              <h3
                className="live-mono mb-3 mt-5 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--muted)' }}
              >
                Up next for you
              </h3>
              <ul className="flex flex-col gap-2">
                {impact.upNext.map((item, i) => (
                  <li key={`${item.playerName}-${i}`} className="flex items-center justify-between gap-3">
                    <span className="live-display truncate text-[13px] font-bold">
                      {item.playerName} · {item.matchup}
                    </span>
                    <time
                      className="live-mono flex-none text-[12px]"
                      style={{ color: 'var(--muted)' }}
                      dateTime={item.startTime}
                    >
                      {formatKickoff(item.startTime)}
                    </time>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <p
        className="live-display rounded-2xl p-4 text-[12px] leading-relaxed"
        style={{ background: 'var(--panel)', border: '1px solid var(--live-line2)', color: 'var(--muted)' }}
      >
        Scores come from the official league feed. Fantasy points are each league&apos;s own scoring, exactly
        as your platform reported it — not recalculated here.
      </p>
    </aside>
  )
}

/** Local kickoff time. Rendered client-side so it matches the reader's clock. */
function formatKickoff(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
