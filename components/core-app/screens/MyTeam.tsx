'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import '@/components/core-app/af-my-team.css'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'

/**
 * Screen 4 — My team · roster.
 *
 * "Read-only view of your real lineup, with the fix and where to make it."
 *
 * Two visual rules from the handoff drive this screen:
 *   - the empty starting slot is `--bad-soft` with a countdown, because an
 *     unfilled FLEX at lock time is the most expensive thing on the page;
 *   - the fix is always "open the platform", never an action here.
 */

export type MyTeamProps = {
  data: MyTeamData
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-mt-unavailable">{reason}</p>
}

/** Live countdown to the lineup lock. Ticks so the urgency is real, not a stamp. */
function LockCountdown({ at, anyEmptySlot, platform }: { at: Date; anyEmptySlot: boolean; platform: string }) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ms = at.getTime() - now
  const locked = ms <= 0
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const label = locked
    ? 'Locked'
    : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  // Inside an hour turns --bad, per the handoff's deadline rule; an empty slot
  // is urgent regardless of how far out the lock is.
  const urgent = !locked && (ms <= 3_600_000 || anyEmptySlot)

  return (
    <div className="af-mt-lock" data-urgent={urgent} data-locked={locked}>
      <span className="af-label af-mt-lock-label">Lineup locks</span>
      <span className="af-num af-mt-lock-time">{label}</span>
      <span className="af-mt-lock-note">
        {at.toUTCString().slice(0, 22)} UTC
        {anyEmptySlot ? ' · a starting slot is still empty' : null}
      </span>
      {anyEmptySlot && !locked ? (
        <span className="af-mt-lock-fix">Fix it in {platform}</span>
      ) : null}
    </div>
  )
}

function PlayerCell({ player }: { player: LineupPlayer }) {
  return (
    <div className="af-mt-player">
      {player.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-mt-avatar" src={player.imageUrl} alt="" width={34} height={34} />
      ) : (
        <div className="af-mt-avatar af-mt-avatar--none" aria-hidden>
          {player.name.charAt(0)}
        </div>
      )}
      <div className="af-mt-player-text">
        <div className="af-mt-player-name">{player.name}</div>
        <div className="af-mt-player-meta">
          {player.gameContext ?? 'no scheduled game found'}
        </div>
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: string | null }) {
  if (!status) {
    // No designation is NOT the same as healthy, and the chip says so rather
    // than printing a confident "READY" we did not read anywhere.
    return <span className="af-mt-status" data-tone="none">no designation</span>
  }
  const t = status.toLowerCase()
  const tone = t.includes('out') || t.includes('ir') ? 'bad' : t.includes('question') || t.includes('doubt') ? 'warn' : 'ok'
  return (
    <span className="af-mt-status" data-tone={tone}>
      {status}
    </span>
  )
}

/**
 * A player's projected points, or an em dash.
 *
 * ⚠ THE EM DASH IS NOT DECORATION AND MUST NEVER BECOME "0.0". Null means the feed
 * does not carry this player; zero means we expect him to score nothing. Rendering
 * the first as the second tells a manager to bench someone on the strength of data
 * we do not have.
 */
function ProjectedPoints({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span className="af-mt-proj af-num af-mt-proj--none" title="No projection on file for this player">
        —
      </span>
    )
  }
  return <span className="af-mt-proj af-num">{value.toFixed(1)}</span>
}

function SlotRow({ slot, platform }: { slot: LineupSlot; platform: string }) {
  return (
    <li className="af-mt-row" data-empty={slot.empty}>
      <span className="af-mt-slot af-num">{slot.slotLabel}</span>

      {slot.player ? (
        <>
          <PlayerCell player={slot.player} />
          <StatusChip status={slot.player.injuryStatus} />
          <ProjectedPoints value={slot.player.projectedPoints} />
        </>
      ) : slot.unresolvedId ? (
        // A player IS here — we just could not identify him. Saying "Empty"
        // would send the user to fix a hole that does not exist.
        <div className="af-mt-player af-mt-unresolved">
          <div>
            <div className="af-mt-player-name">Player we could not identify</div>
            <div className="af-mt-player-meta">
              This slot is filled, but id {slot.unresolvedId} does not match any player we hold.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="af-mt-player af-mt-empty-text">
            <div>
              <div className="af-mt-player-name">Empty</div>
              <div className="af-mt-player-meta">Nobody is starting in this slot</div>
            </div>
          </div>
          <Link href="/import" className="af-btn af-mt-fix">
            Fix in {platform}
          </Link>
        </>
      )}
    </li>
  )
}

export function MyTeam({ data }: MyTeamProps) {
  const platform = data.league.platform === 'manual' ? 'your platform' : data.league.platform

  return (
    <div className="af-mt">
      {/* ── Lock banner ─────────────────────────────────────────────── */}
      {data.lock.available ? (
        <LockCountdown
          at={new Date(data.lock.data.at)}
          anyEmptySlot={data.lock.data.anyEmptySlot}
          platform={platform}
        />
      ) : (
        <div className="af-mt-lock" data-urgent={false} data-locked={false}>
          <span className="af-label af-mt-lock-label">Lineup lock</span>
          <span className="af-mt-lock-note">{data.lock.reason}</span>
        </div>
      )}

      {/* ── Team header ─────────────────────────────────────────────── */}
      <header className="af-frame af-mt-head">
        {data.team.available ? (
          <>
            <div className="af-mt-crest" aria-hidden>
              {data.team.data.teamName.slice(0, 2).toUpperCase()}
            </div>
            <div className="af-mt-head-text">
              <h1 className="af-display af-mt-team-name">{data.team.data.teamName}</h1>
              <div className="af-mt-head-meta">
                Your team · {data.league.name}
                {data.team.data.rank != null
                  ? ` · ${data.team.data.rank} of ${data.team.data.teamCount}`
                  : ` · ${data.team.data.teamCount} teams`}
              </div>
            </div>

            <div className="af-mt-tiles">
              <div className="af-mt-tile">
                <div className="af-mt-tile-value af-num">{data.team.data.record}</div>
                <div className="af-label">Record</div>
              </div>
              <div className="af-mt-tile">
                <div className="af-mt-tile-value af-num">
                  {data.team.data.pointsFor > 0 ? data.team.data.pointsFor.toFixed(0) : '—'}
                </div>
                <div className="af-label">Points for</div>
              </div>
              <div className="af-mt-tile">
                <div className="af-mt-tile-value af-num">
                  {data.team.data.pointsAgainst > 0 ? data.team.data.pointsAgainst.toFixed(0) : '—'}
                </div>
                <div className="af-label">Against</div>
              </div>
              <div className="af-mt-tile" data-missing="true">
                <div className="af-mt-tile-value af-num">—</div>
                <div className="af-label">Roster grade</div>
                <div className="af-mt-tile-why">{data.rosterGrade.reason}</div>
              </div>
            </div>
          </>
        ) : (
          <Unavailable reason={data.team.reason} />
        )}
      </header>

      {/* ── Starters ────────────────────────────────────────────────── */}
      <section className="af-frame af-mt-section">
        <header className="af-mt-section-head">
          <h2 className="af-label">Starters</h2>
          <span className="af-mt-section-note">
            Read live from {platform}. To change it, open {platform} — AllFantasy only reads.
          </span>
        </header>

        {data.starters.available ? (
          <ul className="af-mt-list">
            {data.starters.data.map((slot, i) => (
              <SlotRow key={`${slot.slotLabel}-${i}`} slot={slot} platform={platform} />
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.starters.reason} />
        )}
      </section>

      {/* ── Bench ───────────────────────────────────────────────────── */}
      <section className="af-frame af-mt-section">
        <header className="af-mt-section-head">
          <h2 className="af-label">Bench</h2>
        </header>
        {data.bench.available ? (
          <ul className="af-mt-list">
            {data.bench.data.map((p) => (
              <li key={p.sleeperId} className="af-mt-row">
                <span className="af-mt-slot af-num">BN</span>
                <PlayerCell player={p} />
                <StatusChip status={p.injuryStatus} />
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.bench.reason} />
        )}
      </section>

      {/* ── IR / taxi ───────────────────────────────────────────────── */}
      {data.reserve.available ? (
        <section className="af-frame af-mt-section">
          <header className="af-mt-section-head">
            <h2 className="af-label">IR &amp; taxi</h2>
          </header>
          <ul className="af-mt-list">
            {data.reserve.data.map((p) => (
              <li key={p.sleeperId} className="af-mt-row">
                <span className="af-mt-slot af-num">IR</span>
                <PlayerCell player={p} />
                <StatusChip status={p.injuryStatus} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.projections.available ? (
        <section className="af-mt-projtotal">
          <div>
            <div className="af-label">Projected total</div>
            <div className="af-mt-projtotal-value af-num">
              {data.projections.data.total.toFixed(1)}
            </div>
          </div>
          {/*
            ⚠ THE COVERAGE LINE IS LOAD-BEARING, NOT A CAVEAT. A total built from 5
            of 8 starters always reads LOW, and low is the direction that makes a
            manager bench someone they should start. Two of six sampled production
            lineups are only partly priced, so this is the common case, not an edge
            one — the number is only safe to read next to what it was built from.
          */}
          <p className="af-mt-projtotal-note">
            {data.projections.data.unprojected === 0
              ? `All ${data.projections.data.projected} starters projected · ${data.projections.data.season} week ${data.projections.data.week}`
              : `From ${data.projections.data.projected} of ${
                  data.projections.data.projected + data.projections.data.unprojected
                } starters — ${data.projections.data.unprojected} ${
                  data.projections.data.unprojected === 1 ? 'has' : 'have'
                } no projection on file, so this total reads low.`}
          </p>
        </section>
      ) : (
        <p className="af-mt-footnote">
          Projections are not shown because {data.projections.reason}.
        </p>
      )}
    </div>
  )
}

export default MyTeam
