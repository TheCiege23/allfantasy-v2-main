'use client'

import { useMemo, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-import.css'
import { ImportReviewPanel } from '@/components/import/ImportReviewPanel'
import { buildImportReview } from '@/lib/league-import/review/buildImportReview'
import type { ImportReviewOverrides, ImportReviewPreviewInput } from '@/lib/league-import/review/types'

/** Fixture only — invented names, no real league data. */
function fixture(): ImportReviewPreviewInput {
  const players: Record<string, { name: string; position: string; team: string }> = {}
  const add = (id: string, name: string, position: string, team: string) => (players[id] = { name, position, team })
  add('q1', 'Avery Quinn', 'QB', 'BUF'); add('r1', 'Blake Rivers', 'RB', 'KC'); add('w1', 'Casey Wells', 'WR', 'DAL')
  add('t1', 'Drew Tate', 'TE', 'SF'); add('q2', 'Emery Stone', 'QB', 'MIA'); add('r2', 'Finley Brooks', 'RB', 'DET')
  add('w2', 'Gray Holt', 'WR', 'PHI'); add('x9', 'Jordan Unknown-Rookie', 'WR', 'FA'); add('BUF', 'Buffalo', 'DEF', 'BUF')
  return {
    league: { name: 'Harness Dynasty League', sport: 'NFL', season: 2026, teamCount: 3, playoffTeams: 2, settings: { ppr: true, superflex: true, tep: false } },
    managers: [
      { rosterId: '1', teamName: 'Lake Effect', displayName: 'Manager One', players: ['q1', 'r1', 'w1', 't1', 'BUF'], starters: ['q1', 'r1', 'w1'], reserve: ['t1'], taxi: [] },
      { rosterId: '2', teamName: '', displayName: '', players: ['q2', 'r2', 'w2', 'x9'], starters: ['q2', 'r2'], reserve: [], taxi: ['x9'] },
    ],
    rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'OP', 'BN', 'BN', 'IR', 'TAXI'],
    formatSummary: { detectedFormat: 'Dynasty', unsupportedPositions: ['OP'] },
    playerMap: players,
    draftPickCount: 24,
    matchupWeeks: 9,
    dataQuality: { coverageSummary: [{ key: 'tradeHistory', label: 'Trade history', state: 'missing' }] },
    reviewFacts: { rosterSize: 4, regularSeasonLength: 14, playoffStartWeek: 15, playoffTeamCount: 2, isDynasty: true, scoringFormat: 'ppr', leagueScoring: 'ppr', scoringRuleCount: 42, waiverType: 'faab', faabBudget: 100, tradedPickCount: 3, taxiSlots: 3 },
  }
}

export default function ImportReviewHarnessClient() {
  const [confirmed, setConfirmed] = useState<ImportReviewOverrides | null | undefined>(undefined)
  const review = useMemo(
    () =>
      buildImportReview({
        platform: 'sleeper',
        preview: fixture(),
        playerMatches: { q1: true, r1: true, w1: true, t1: true, q2: true, r2: true, w2: true, x9: false },
        canonical: { warnings: [{ code: 'scoring_rule_collision', message: '', metadata: { statKeys: ['rec_td'] } }] },
        previous: {
          lastImportedAt: '2026-10-28T18:00:00.000Z',
          teams: [
            { teamId: '1', teamName: 'Lake Effect Snow', ownerName: 'Manager One' },
            { teamId: '2', teamName: '', ownerName: '' },
          ],
          rosters: { '1': ['q1', 'r1', 'w1', 'old1'], '2': ['q2', 'r2', 'x9'] },
          playerNames: { old1: 'Harper Old' },
          settings: { teamCount: 3, scoringFormat: 'half', playoffTeamCount: 2 },
        },
      }),
    [],
  )
  return (
    <div className="af-core af-im" style={{ minHeight: '100vh', padding: 16, background: 'var(--bg)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <section className="af-im-card">
          <ImportReviewPanel
            review={review}
            provider="sleeper"
            onConfirm={(o) => setConfirmed(o)}
            onRerun={() => undefined}
            onBack={() => undefined}
          />
        </section>
        {confirmed !== undefined ? (
          <pre data-testid="harness-confirmed" style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(confirmed, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
