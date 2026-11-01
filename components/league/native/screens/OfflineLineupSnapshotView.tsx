'use client'

import type { OfflineLineupRow, OfflineLineupSnapshot } from '@/lib/pwa/offlineLineupSnapshots'
import { snapshotAgeLabel } from '@/lib/pwa/offlineLineupSnapshots'
import { InjuryFlag, PosPill } from './NativeScreenParts'

/**
 * The lineup as it was at the last online load, shown when `/api/league/roster` cannot be reached.
 *
 * READ-ONLY ON PURPOSE. There is no tap-to-swap here and no save: a change made offline needs a
 * queue that the server re-checks against kickoff when it arrives, and that is a separate piece of
 * work. Showing an editor that cannot save would be worse than showing none.
 */
function Rows({ label, rows }: { label: string; rows: OfflineLineupRow[] }) {
  if (!rows.length) return null
  return (
    <section className="nls-card nls-card-flush" aria-label={label}>
      <h3 className="nls-label nls-card-head">{label}</h3>
      <ul className="nls-rows">
        {rows.map((r, i) => (
          <li key={`${label}-${i}`}>
            <div className="nls-lrow" data-cols="3">
              <PosPill label={r.slot} />
              <div className="nls-player">
                {r.name ? (
                  <>
                    <strong>
                      {r.name} <InjuryFlag status={r.injury} />
                    </strong>
                    <small>{[r.position, r.team, r.game].filter(Boolean).join(' · ')}</small>
                  </>
                ) : (
                  <span className="nls-muted">Empty</span>
                )}
              </div>
              <span className="nls-proj" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function OfflineLineupSnapshotView({ snapshot }: { snapshot: OfflineLineupSnapshot }) {
  return (
    <div className="nls nls-stack" data-testid="offline-lineup-snapshot">
      <div className="nls-lockbar" data-tone="locked" role="status">
        <span className="nls-chip" data-tone="warn">Offline</span>
        <span>
          {snapshotAgeLabel(snapshot.savedAt)}
          {snapshot.week ? ` · Week ${snapshot.week}` : ''}. You can view your lineup, but changes are off until you reconnect.
        </span>
      </div>
      <Rows label="Starters" rows={snapshot.starters} />
      <Rows label="Bench" rows={snapshot.bench} />
      <Rows label="Injured reserve" rows={snapshot.ir} />
      <Rows label="Taxi squad" rows={snapshot.taxi} />
    </div>
  )
}
