'use client'

/**
 * 11b + 11d — the commissioner console that now sits above the existing
 * read-only Commissioner Intelligence modules on `/league/[leagueId]/intelligence`.
 *
 * ⚠ FOLDED INTO AN EXISTING ROUTE ON PURPOSE. The handoffs specify
 * `/commissioner/leagues/[id]/health` and `/.../rivalries`. This repo is at
 * roughly 1,914 of Vercel's 2,048-route ceiling and carries a standing rule
 * against new routes, so both screens render here instead — the page that was
 * already the per-league commissioner surface. Nothing about the designs
 * changes; only the URL they live at.
 *
 * ⚠ EVERY NUMBER ON THIS SCREEN ARRIVES AS A PROP FROM THE SERVER. No fetch, no
 * client-side derivation. The health score, its sub-scores, its confidence and
 * the manager rows are all computed once server-side by the same engine
 * `/commissioner-hub` uses, so the ranking on 11a and the detail here cannot
 * disagree — which is the failure mode that would make both untrustworthy.
 */

import type { ManagerHealthRow } from '@/lib/commissioner-hub/managerHealth'
import type { RivalryBoardRow } from '@/lib/rivalry-engine/rivalryBoard'
import HealthScoreCard, {
  FlaggedSignals,
  type FlaggedSignal,
  type HealthScoreCardProps,
  type Intervention,
} from '@/components/commish/HealthScoreCard'
import ManagerHealthTable from '@/components/commish/ManagerHealthTable'
import RivalryCard from '@/components/commish/RivalryCard'
import UniversalMessaging, { type MessagingScope } from '@/components/commish/UniversalMessaging'
import AuditLog, { type AuditEntry } from '@/components/commish/AuditLog'
import StatTiles, { type StatTile } from '@/components/commish/StatTiles'

export type CommissionerConsoleProps = {
  leagueId: string
  leagueName: string
  score: HealthScoreCardProps
  riskTiles: StatTile[]
  signals: FlaggedSignal[]
  interventions: Intervention[]
  managers: ManagerHealthRow[]
  rivalries: RivalryBoardRow[]
  seasonsCovered: number
  audit: AuditEntry[]
  messagingScope: MessagingScope
  /** Sync freshness for the header chip. `null` means never synced. */
  lastSyncedAt: string | null
}

function syncChip(lastSyncedAt: string | null): { tone: 'good' | 'warn' | 'bad'; label: string } {
  /*
   * ⚠ FRESHNESS IS ALWAYS ON THE PAGE. 11b build rule 5: this score is
   * meaningless on stale data, so staleness must be impossible to miss. Never
   * synced is `bad`, not "unknown" — a league we have never read is the worst
   * case for a screen that reports on it.
   */
  if (!lastSyncedAt) return { tone: 'bad', label: 'Never synced' }
  const then = Date.parse(lastSyncedAt)
  if (!Number.isFinite(then)) return { tone: 'bad', label: 'Never synced' }
  const mins = Math.floor((Date.now() - then) / 60_000)
  if (mins < 60) return { tone: 'good', label: `Sync fresh · ${Math.max(1, mins)} min` }
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return { tone: hrs <= 6 ? 'good' : 'warn', label: `Synced ${hrs} hr${hrs === 1 ? '' : 's'} ago` }
  const days = Math.floor(hrs / 24)
  return { tone: 'bad', label: `Stale · ${days} day${days === 1 ? '' : 's'}` }
}

export default function CommissionerConsole(props: CommissionerConsoleProps) {
  const {
    leagueName,
    score,
    riskTiles,
    signals,
    interventions,
    managers,
    rivalries,
    seasonsCovered,
    audit,
    messagingScope,
    lastSyncedAt,
  } = props

  const chip = syncChip(lastSyncedAt)

  return (
    <div className="af-core af-cm-shell" style={{ minHeight: 0, paddingBottom: 32 }}>
      <div className="af-cm">
        {/* ── 11b: league health ──────────────────────────────────────── */}
        <header className="af-cm-head">
          <div className="af-cm-head-titles">
            <h1 className="af-cm-title">League health</h1>
            <span className="af-cm-sub">{leagueName}</span>
          </div>
          <div className="af-cm-head-actions">
            <span className="af-cm-headchip af-num" data-tone={chip.tone}>
              <span className="af-cm-headchip-dot" aria-hidden />
              {chip.label}
            </span>
          </div>
        </header>

        {riskTiles.length > 0 ? <StatTiles tiles={riskTiles} columns={riskTiles.length} /> : null}

        <div className="af-cm-health" style={{ marginTop: riskTiles.length > 0 ? 4 : 0 }}>
          <HealthScoreCard {...score} />
          <FlaggedSignals signals={signals} interventions={interventions} />
        </div>

        <div style={{ marginTop: 18 }}>
          <ManagerHealthTable rows={managers} />
        </div>

        {/* ── 11d: rivalries + messaging + audit ──────────────────────── */}
        <div className="af-cm-body" style={{ marginTop: 26 }}>
          <main>
            <div className="af-cm-section-head">
              <h2 className="af-cm-section-title">Top rivalries</h2>
              <span className="af-cm-section-hint">
                {seasonsCovered > 0
                  ? `${seasonsCovered} season${seasonsCovered === 1 ? '' : 's'} of head-to-head. `
                  : ''}
                Scored on close games, playoff meetings, eliminations, trades and upsets.
              </span>
            </div>

            {rivalries.length === 0 ? (
              <p className="af-cm-empty">
                No rivalries scored yet. The engine builds these from completed head-to-head matchups, so a league in
                its first few weeks will not have any.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rivalries.map((row, i) => (
                  <RivalryCard key={row.id} row={row} featured={i === 0} />
                ))}
              </div>
            )}
          </main>

          <aside className="af-cm-rail">
            <div className="af-label">Universal messaging</div>
            <UniversalMessaging scope={messagingScope} />

            <div className="af-label" style={{ marginTop: 4 }}>
              Audit log
            </div>
            <div className="af-card" style={{ padding: 16 }}>
              <AuditLog entries={audit} />
            </div>

            {/*
              ⚠ THE IMPORTED-LEAGUE BOUNDARY IS RESTATED HERE. 11d build rule 5:
              every commissioner surface repeats it rather than assuming the user
              remembers reading it somewhere else. Commissioner powers only apply
              where AllFantasy hosts the league.
            */}
            <p className="af-cm-rail-foot">
              Commissioner powers apply to AF-hosted leagues. Imported leagues stay read-only.
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}
