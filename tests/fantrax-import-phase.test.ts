import { describe, expect, it } from 'vitest'
import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'

function payload(args: {
  seasonState: string | null
  rostered?: boolean
  drafted?: boolean
  finished?: boolean
}): FantraxImportPayload {
  return {
    league: { name: 'Public Fantrax league', sport: 'NFL', season: 2026,
      size: 12, isFinished: args.finished ?? false },
    settings: { scoringType: null, rosterPositions: [], rosterSize: null,
      scoringRules: [], raw: { seasonState: args.seasonState } },
    teams: [{ rosterPlayerIds: args.rostered ? ['player-1'] : [] }],
    draftPicks: args.drafted ? [{ playerId: 'player-1' }] : [],
    schedule: [],
  } as unknown as FantraxImportPayload
}

describe('Fantrax import phase', () => {
  it('marks an empty, undrafted live league pre-draft even after its calendar begins', () => {
    expect(FantraxLeagueMapper.map(payload({ seasonState: 'in_progress' })).status).toBe('pre_draft')
  })

  it('keeps a drafted preseason league in the offseason', () => {
    expect(FantraxLeagueMapper.map(payload({ seasonState: 'preseason', rostered: true })).status).toBe('off_season')
  })

  it('keeps finished seasons complete for placement and history', () => {
    expect(FantraxLeagueMapper.map(payload({ seasonState: 'complete', finished: true })).status).toBe('complete')
  })

  it('keeps CSV snapshots on the previous status path', () => {
    expect(FantraxLeagueMapper.map(payload({ seasonState: null })).status).toBe('in_season')
  })
})
