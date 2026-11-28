'use client'

import { useState } from 'react'
import {
  PositionEligibilityView,
  type PositionEligibilityLogEntry,
  type PositionEligibilityPlayer,
} from '@/components/league-settings/PositionEligibilityView'
import { resolvePlayerEligibility, type EligibilityChange } from '@/lib/league-eligibility/nbaPositionEligibility'

/** SAMPLE data only — names are real NBA players so the screen reads naturally; every number is invented. */
const ROSTER: Array<{ id: string; name: string; team: string; rosterName: string; listed: string; evidence: PositionEligibilityPlayer['evidence'] }> = [
  { id: 'p1', name: 'Amen Thompson', team: 'HOU', rosterName: 'Bricklayers', listed: 'PG', evidence: [{ position: 'SF', games: 9 }, { position: 'PG', games: 6 }] },
  { id: 'p2', name: 'Stephon Castle', team: 'SAS', rosterName: 'Fast Break FC', listed: 'PG,SG', evidence: [{ position: 'SG', games: 8 }, { position: 'SF', games: 7 }] },
  { id: 'p3', name: 'Josh Hart', team: 'NYK', rosterName: 'Glass Cleaners', listed: 'SG,SF', evidence: [{ position: 'PF', games: 11 }, { position: 'SF', games: 4 }] },
  { id: 'p4', name: 'Caleb Martin', team: 'DAL', rosterName: 'Bricklayers', listed: 'SF', evidence: [{ position: 'SG', games: 10 }] },
  { id: 'p5', name: 'Jaden McDaniels', team: 'MIN', rosterName: 'Fast Break FC', listed: 'SF,PF', evidence: [{ position: 'PF', games: 14 }] },
  { id: 'p6', name: 'Isaiah Hartenstein', team: 'OKC', rosterName: 'Glass Cleaners', listed: 'C', evidence: [{ position: 'C', games: 12 }, { position: 'PF', games: 3 }] },
]

const at = (d: string) => `2026-11-${d}T18:00:00.000Z`
const CHANGES: EligibilityChange[] = [
  { playerId: 'p3', playerName: 'Josh Hart', position: 'PF', action: 'add', reason: 'Listed at PF in 11 of 15 box scores', actorUserId: 'c', actorName: 'Commish Dana', createdAt: at('18') },
  { playerId: 'p4', playerName: 'Caleb Martin', position: 'SG', action: 'add', reason: '10 straight starts at SG', actorUserId: 'c', actorName: 'Commish Dana', createdAt: at('21') },
  { playerId: 'p5', playerName: 'Jaden McDaniels', position: 'SF', action: 'remove', reason: 'League vote: PF only from here on', actorUserId: 'c', actorName: 'Commish Dana', createdAt: at('24') },
  { playerId: 'p1', playerName: 'Amen Thompson', position: 'SF', action: 'add', reason: 'Listed at SF in 9 of 15 box scores', actorUserId: 'c', actorName: 'Commish Dana', createdAt: at('26') },
]

function build(changes: EligibilityChange[]): { players: PositionEligibilityPlayer[]; log: PositionEligibilityLogEntry[] } {
  return {
    players: ROSTER.map((r) => ({
      id: r.id,
      name: r.name,
      team: r.team,
      rosterName: r.rosterName,
      evidence: r.evidence,
      state: resolvePlayerEligibility(r.listed, changes.filter((c) => c.playerId === r.id)),
    })),
    log: [...changes].reverse().map((c) => ({
      playerId: c.playerId,
      playerName: c.playerName,
      position: c.position,
      action: c.action,
      reason: c.reason,
      actorName: c.actorName ?? null,
      createdAt: new Date(c.createdAt).toISOString(),
    })),
  }
}

export default function PositionEligibilityHarnessClient({ view }: { view: 'commissioner' | 'member' | 'empty' }) {
  const [changes, setChanges] = useState<EligibilityChange[]>(view === 'empty' ? [] : CHANGES)
  const { players, log } = build(changes)
  return (
    <main className="min-h-screen px-3 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
        <p className="mb-4 text-[11px] uppercase tracking-wider text-amber-500">Sample data · League settings › Roster</p>
        <PositionEligibilityView
          players={players}
          log={log}
          canEdit={view !== 'member'}
          initialPlayerId={view === 'commissioner' ? 'p2' : null}
          onSubmit={(c) => {
            const p = ROSTER.find((r) => r.id === c.playerId)
            setChanges((prev) => [
              ...prev,
              { ...c, playerName: p?.name ?? c.playerId, reason: c.reason || null, actorUserId: 'c', actorName: 'Commish Dana', createdAt: new Date().toISOString() },
            ])
          }}
        />
      </div>
    </main>
  )
}
