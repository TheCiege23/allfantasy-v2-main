'use client'

import { useMemo, useState } from 'react'
import { ImportedLeaguePreviewPanel } from '@/components/league-creation/ImportedLeaguePreviewPanel'
import type { ImportPreviewResponse } from '@/lib/league-import/ImportedLeaguePreviewBuilder'

export function ImportPreviewHarnessClient() {
  const [createClicks, setCreateClicks] = useState(0)
  const [backClicks, setBackClicks] = useState(0)

  const preview = useMemo<ImportPreviewResponse>(
    () => ({
      dataQuality: {
        fetchedAt: Date.now(),
        sources: {
          users: true,
          rosters: true,
          matchups: true,
          trades: true,
          draftPicks: true,
          playerMap: true,
          history: false,
        },
        rosterCoverage: 100,
        matchupWeeksCovered: 0,
        completenessScore: 87,
        tier: 'FULL',
        signals: [],
        coverageSummary: [
          { key: 'leagueSettings', label: 'League settings', state: 'full', count: 1 },
          { key: 'currentRosters', label: 'Current rosters', state: 'full', count: 3 },
          { key: 'scoringSettings', label: 'Scoring settings', state: 'full', count: 1 },
        ],
      },
      league: {
        id: 'e2e-import-preview',
        name: 'Imported E2E League',
        sport: 'NFL',
        season: 2026,
        type: 'Dynasty',
        teamCount: 12,
        playoffTeams: 6,
        avatar: 'https://cdn.example/league-avatar.png',
        settings: {
          ppr: true,
          superflex: true,
          tep: false,
          rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BENCH'],
        },
      },
      managers: [
        {
          rosterId: 'roster-1',
          ownerId: 'owner-1',
          username: 'manager1',
          displayName: 'Manager One',
          teamName: 'Kansas City',
          teamAbbreviation: 'KC',
          teamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png',
          managerAvatar: 'https://cdn.example/manager-1.png',
          avatar: 'https://cdn.example/manager-1.png',
          wins: 11,
          losses: 3,
          ties: 0,
          pointsFor: '1432.54',
          rosterSize: 24,
          starters: ['p1', 'p2'],
          players: ['p1', 'p2', 'p3'],
          reserve: [],
          taxi: [],
        },
        {
          rosterId: 'roster-2',
          ownerId: 'owner-2',
          username: 'manager2',
          displayName: 'Manager Two',
          teamName: 'Dallas',
          teamAbbreviation: 'DAL',
          teamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png',
          managerAvatar: null,
          avatar: null,
          wins: 8,
          losses: 6,
          ties: 0,
          pointsFor: '1277.12',
          rosterSize: 23,
          starters: ['p4', 'p5'],
          players: ['p4', 'p5', 'p6'],
          reserve: [],
          taxi: [],
        },
        {
          rosterId: 'roster-3',
          ownerId: 'owner-3',
          username: 'manager3',
          displayName: 'Manager Three',
          teamName: 'Unknown Team',
          teamAbbreviation: null,
          teamLogo: null,
          managerAvatar: null,
          avatar: null,
          wins: 6,
          losses: 8,
          ties: 0,
          pointsFor: '1189.50',
          rosterSize: 22,
          starters: ['p7', 'p8'],
          players: ['p7', 'p8', 'p9'],
          reserve: [],
          taxi: [],
        },
      ],
      rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'],
      playerMap: {},
      draftPickCount: 42,
      transactionCount: 15,
      matchupWeeks: 14,
      source: {
        source_provider: 'sleeper',
        source_league_id: 'sleeper-import-1',
        imported_at: new Date('2026-03-21T00:00:00Z').toISOString(),
      },
    }),
    []
  )

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Import Preview Harness</h1>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-white/70">
        <span data-testid="import-preview-create-clicks">Create clicks: {createClicks}</span>
        <span data-testid="import-preview-back-clicks">Back clicks: {backClicks}</span>
      </div>
      <ImportedLeaguePreviewPanel
        provider="sleeper"
        preview={preview}
        loading={false}
        createLoading={false}
        onCreateFromImport={() => setCreateClicks((v) => v + 1)}
        onBack={() => setBackClicks((v) => v + 1)}
      />
    </main>
  )
}
