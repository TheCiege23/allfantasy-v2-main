'use client'

import type { LiveGameCard } from '@/lib/live/liveScoresPage'

/**
 * One live game, with the fantasy tie-in that makes it yours.
 *
 * ⚠ THE WIN-PROBABILITY BAR IS OUR OWN MODEL AND IS LABELLED AS SUCH. No feed
 * supplies a game win probability, so `estimateWinProbability` computes one from
 * score margin and time remaining. Rendering it next to feed-sourced scores
 * without the "AF estimate" label would let a model output pass as a reported
 * fact, and the difference matters most in exactly the close games people stare
 * at. When the game cannot be timed the model returns null and the whole block
 * is omitted rather than shown at 50/50.
 */
export function MatchupCard({ game }: { game: LiveGameCard }) {
  const leading =
    game.home.score === game.away.score ? null : game.home.score > game.away.score ? 'home' : 'away'
  const wp = game.winProbability

  return (
    <article
      className="rounded-2xl p-5"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--live-line2)',
      }}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="live-mono rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: 'var(--live-chip)', color: 'var(--muted)' }}
          >
            {game.sport}
            {game.week != null ? ` · Week ${game.week}` : ''}
          </span>
          {game.clockLabel ? (
            <span
              className="live-mono flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold"
              style={{
                background: game.isLive ? 'color-mix(in srgb, var(--bad) 12%, transparent)' : 'var(--live-chip)',
                color: game.isLive ? 'var(--bad)' : 'var(--muted)',
              }}
            >
              {game.isLive ? <span className="live-dot" aria-hidden="true" /> : null}
              {game.clockLabel}
            </span>
          ) : null}
        </div>
      </header>

      <TeamRow side={game.away} dimmed={leading === 'home'} />
      <TeamRow side={game.home} dimmed={leading === 'away'} />

      {wp ? (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span
              className="live-mono text-[10px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--muted)' }}
            >
              Win prob
            </span>
            <span className="live-mono text-[11px] font-bold" style={{ color: 'var(--muted)' }}>
              {game.home.abbrev} {wp.home}% · {game.away.abbrev} {wp.away}%
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--live-line2)' }}
            role="img"
            aria-label={`AllFantasy estimate: ${game.home.abbrev} ${wp.home} percent, ${game.away.abbrev} ${wp.away} percent`}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${wp.home}%`, background: 'var(--live-accent)' }}
            />
          </div>
          {/*
            ⚠ THE LABEL IS NOT OPTIONAL. This is the one number on the card that
            no provider reported. Removing this line would make a model output
            indistinguishable from the score above it.
          */}
          <p className="live-display mt-1.5 text-[10px]" style={{ color: 'var(--faint)' }}>
            AF estimate — from score and time remaining. Not a provider figure.
          </p>
        </div>
      ) : null}

      {game.topPerformer ? (
        <div
          className="mt-4 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
          style={{ background: 'var(--live-chip)' }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="live-mono text-[10px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--muted)' }}
            >
              Top performer
            </span>
            <span className="live-display truncate text-[14px] font-extrabold">
              {game.topPerformer.name}
            </span>
          </div>
          <span
            className="live-mono flex-none text-[12px] font-bold"
            style={{ color: 'var(--muted)' }}
          >
            {game.topPerformer.statLine}
          </span>
        </div>
      ) : null}

      {game.tieIns.length > 0 ? <TieInPanel game={game} /> : null}
    </article>
  )
}

function TeamRow({ side, dimmed }: { side: LiveGameCard['home']; dimmed: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className="live-mono flex h-10 w-10 flex-none items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: 'var(--live-chip)', color: 'var(--muted)' }}
      >
        {/* Logos come from the feed and are often absent; initials are the
            fallback rather than a broken image icon. */}
        {side.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={side.logo} alt="" className="h-7 w-7 object-contain" />
        ) : (
          side.abbrev
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="live-display truncate text-[17px] font-extrabold leading-tight">{side.name}</p>
        {side.record ? (
          <p className="live-mono text-[11px]" style={{ color: 'var(--muted2)' }}>
            {side.record}
          </p>
        ) : null}
      </div>
      {/* Trailing score dimmed to --muted, per the handoff's colour contract. */}
      <span
        className="live-mono flex-none text-[28px] font-extrabold leading-none"
        style={{ color: dimmed ? 'var(--muted)' : 'var(--text)' }}
      >
        {side.score}
      </span>
    </div>
  )
}

/**
 * "Rostered in N of your leagues".
 *
 * ⚠ BENCH PLAYERS ARE DIMMED, NEVER HIDDEN. Build rule 4: a player you did not
 * start still explains why this game is on your screen, so omitting him would
 * undercount the game's relevance to you.
 *
 * ⚠ THE SAME PLAYER LEGITIMATELY SHOWS DIFFERENT POINTS PER LEAGUE. Each row is
 * that league's own scoring as the source platform reported it — a TE-premium
 * league and a standard league price the identical performance differently, and
 * showing one number for all of them would be wrong everywhere but one.
 */
function TieInPanel({ game }: { game: LiveGameCard }) {
  return (
    <div
      className="mt-4 rounded-xl p-3"
      style={{
        background: 'var(--live-accent-soft)',
        border: '1px solid var(--live-accent-line)',
      }}
    >
      <p
        className="live-mono mb-2 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: 'var(--live-accent)' }}
      >
        Rostered in {game.leaguesAffected} of your{' '}
        {game.leaguesAffected === 1 ? 'league' : 'leagues'}
      </p>
      <ul className="flex flex-col gap-1.5">
        {game.tieIns.map((t, i) => (
          <li
            key={`${t.leagueId}-${t.playerId}-${i}`}
            className="flex items-center justify-between gap-3"
            style={{ opacity: t.isStarter ? 1 : 0.55 }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="live-mono flex-none rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: 'var(--live-chip)',
                  color: t.isStarter ? 'var(--live-accent)' : 'var(--faint)',
                  border: `1px solid ${t.isStarter ? 'var(--live-accent-line)' : 'var(--live-line2)'}`,
                }}
              >
                {t.leagueName} · {t.isStarter ? 'Starting' : 'Bench'}
              </span>
              <span className="live-display truncate text-[13px] font-bold">{t.playerName}</span>
            </div>
            {/*
              A null score is "this league has not reported yet", which is NOT
              zero points. Showing 0.0 would claim he has done nothing.
            */}
            <span
              className="live-mono flex-none text-[13px] font-bold"
              style={{ color: t.points == null ? 'var(--faint)' : 'var(--good)' }}
            >
              {t.points == null ? '— pts' : `${t.points.toFixed(1)} pts`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
