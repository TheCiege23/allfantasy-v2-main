import { describe, expect, it } from 'vitest'
import {
  buildImportReview,
  importReviewHasBlockingIssues,
  resolveOutstandingWarnings,
} from '@/lib/league-import/review/buildImportReview'
import { diffImportAgainstPrevious } from '@/lib/league-import/review/importReviewDiff'
import {
  applyImportReviewOverrides,
  parseImportReviewOverrides,
} from '@/lib/league-import/review/importReviewOverrides'
import { readImportReview } from '@/lib/league-import/review/readImportReview'
import type { ImportReviewPreviewInput, PreviousImportSnapshot } from '@/lib/league-import/review/types'
import type { NormalizedImportResult } from '@/lib/league-import/types'

function manager(id: string, over: Partial<ImportReviewPreviewInput['managers'][number]> = {}) {
  return {
    rosterId: id,
    teamName: `Team ${id}`,
    displayName: `Owner ${id}`,
    username: `owner${id}`,
    players: [] as string[],
    starters: [] as string[],
    reserve: [] as string[],
    taxi: [] as string[],
    ...over,
  }
}

function preview(over: Partial<ImportReviewPreviewInput> = {}): ImportReviewPreviewInput {
  return {
    league: { name: 'Sunday Funday', sport: 'NFL', season: 2026, teamCount: 2, settings: { ppr: true, superflex: false, tep: false } },
    managers: [
      manager('1', { players: ['p1', 'p2'], starters: ['p1'] }),
      manager('2', { players: ['p3', 'p4'], starters: ['p3'] }),
    ],
    rosterPositions: ['QB', 'RB', 'BN'],
    formatSummary: { detectedFormat: 'Redraft', unsupportedPositions: [] },
    playerMap: {
      p1: { name: 'Alpha QB', position: 'QB', team: 'BUF' },
      p2: { name: 'Bravo RB', position: 'RB', team: 'KC' },
      p3: { name: 'Charlie QB', position: 'QB', team: 'DAL' },
      p4: { name: 'Delta RB', position: 'RB', team: 'SF' },
    },
    draftPickCount: 6,
    matchupWeeks: 14,
    reviewFacts: { rosterSize: 2, regularSeasonLength: 14, playoffTeamCount: 4, scoringFormat: 'ppr', scoringRuleCount: 30 },
    ...over,
  }
}

const allMatched = { p1: true, p2: true, p3: true, p4: true }

function codes(review: ReturnType<typeof buildImportReview>) {
  return review.warnings.map((w) => w.code)
}

describe('buildImportReview — summary', () => {
  it('reports what came across in plain terms', () => {
    const r = buildImportReview({ platform: 'sleeper', preview: preview(), playerMatches: allMatched })
    expect(r.league).toMatchObject({
      name: 'Sunday Funday',
      platform: 'Sleeper',
      season: 2026,
      leagueType: 'redraft',
      importedTeamCount: 2,
      declaredTeamCount: 2,
    })
    expect(r.teams.map((t) => t.rosterCount)).toEqual([2, 2])
    expect(r.teams[0].players[0]).toMatchObject({ id: 'p1', slot: 'starter', matched: true })
    expect(r.scoring.find((s) => s.label === 'Points per catch')?.value).toMatch(/Full PPR/)
    expect(r.rosterSlots).toEqual([
      { slot: 'QB', count: 1 },
      { slot: 'RB', count: 1 },
      { slot: 'Bench', count: 1 },
    ])
    expect(r.schedule.find((s) => s.label === 'Regular season')?.value).toBe('14 weeks')
    expect(r.playerMatching).toEqual({ checked: true, total: 4, matched: 4, unmatched: 0 })
    expect(r.changes).toBeNull()
  })

  it('a clean league produces no warnings', () => {
    const r = buildImportReview({ platform: 'sleeper', preview: preview(), playerMatches: allMatched })
    expect(r.warnings).toEqual([])
  })

  it('detects keeper and dynasty leagues from the source facts', () => {
    const keeper = buildImportReview({
      platform: 'espn',
      preview: preview({ reviewFacts: { isKeeper: true, maxKeepers: 3 } }),
      playerMatches: allMatched,
    })
    expect(keeper.league.leagueType).toBe('keeper')
    expect(keeper.draft.find((d) => d.label === 'Keepers per team')?.value).toBe('3')

    const dynasty = buildImportReview({ platform: 'mfl', preview: preview({ reviewFacts: { isDynasty: true } }), playerMatches: allMatched })
    expect(dynasty.league.leagueTypeLabel).toBe('Dynasty')
  })

  it('lists coverage the platform did not provide', () => {
    const r = buildImportReview({
      platform: 'fleaflicker',
      preview: preview({
        dataQuality: {
          coverageSummary: [
            { key: 'tradeHistory', label: 'Trade history', state: 'missing' },
            { key: 'draftHistory', label: 'Draft history', state: 'partial' },
            { key: 'currentRosters', label: 'Current rosters', state: 'full' },
          ],
        },
      }),
      playerMatches: allMatched,
    })
    expect(r.notImported.map((n) => n.key)).toEqual(['tradeHistory', 'draftHistory'])
  })
})

describe('buildImportReview — warnings', () => {
  it('flags players that could not be matched, but never team defenses', () => {
    const p = preview()
    p.managers[0].players.push('BUF')
    p.playerMap.BUF = { name: 'Buffalo', position: 'DEF', team: 'BUF' }
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: { p1: true, p2: false, p3: true, p4: false } })
    const w = r.warnings.find((x) => x.code === 'players_unmatched')
    expect(w).toMatchObject({ severity: 'warning', fix: 'player_match', count: 2 })
    expect(w?.playerIds).toEqual(['p2', 'p4'])
    expect(r.teams[0].players.find((x) => x.id === 'BUF')?.matched).toBe(true)
  })

  it('says matching was not checked rather than claiming everything matched', () => {
    const r = buildImportReview({ platform: 'yahoo', preview: preview(), playerMatches: null })
    expect(codes(r)).toContain('player_matching_unchecked')
    expect(codes(r)).not.toContain('players_unmatched')
    expect(r.teams[0].players[0].matched).toBeNull()
    expect(r.playerMatching.checked).toBe(false)
  })

  it('flags a team with no owner and offers an owner fix', () => {
    const p = preview()
    p.managers[1] = manager('2', { displayName: '', username: '', players: ['p3', 'p4'] })
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: allMatched })
    const w = r.warnings.find((x) => x.code === 'team_no_owner')
    expect(w).toMatchObject({ teamId: '2', fix: 'owner', severity: 'warning' })
    expect(r.teams[1].ownerMissing).toBe(true)
  })

  it('treats a provider-declared orphan as ownerless even with a stale name', () => {
    const r = buildImportReview({
      platform: 'espn',
      preview: preview({ reviewFacts: { rosterSize: 2, orphanTeamIds: ['1'] } }),
      playerMatches: allMatched,
    })
    expect(r.warnings.find((w) => w.code === 'team_no_owner')?.teamId).toBe('1')
  })

  it('flags a roster over the league roster size', () => {
    const p = preview()
    p.managers[0].players = ['p1', 'p2', 'x1', 'x2']
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: { ...allMatched, x1: true, x2: true } })
    const over = r.warnings.find((w) => w.code === 'roster_size_mismatch' && w.severity === 'warning')
    expect(over).toMatchObject({ teamId: '1', count: 2 })
    expect(over?.title).toContain('the league allows 2')
  })

  it('treats short rosters after a draft as information, not an error', () => {
    const r = buildImportReview({ platform: 'sleeper', preview: preview(), playerMatches: allMatched, canonical: null })
    // rosterSize 4, each team has 2 → informational only (and only once, aggregated).
    const p = preview({ reviewFacts: { rosterSize: 4 } })
    const r2 = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: allMatched })
    const info = r2.warnings.filter((w) => w.code === 'roster_size_mismatch')
    expect(info).toHaveLength(1)
    expect(info[0].severity).toBe('info')
    // Full rosters (rosterSize 2) say nothing at all.
    expect(r.warnings.filter((w) => w.code === 'roster_size_mismatch')).toHaveLength(0)
    // Before a draft, empty rosters are expected and say nothing either.
    const predraft = buildImportReview({ platform: 'sleeper', preview: { ...p, draftPickCount: 0 }, playerMatches: allMatched })
    expect(predraft.warnings.filter((w) => w.code === 'roster_size_mismatch')).toHaveLength(0)
  })

  it('does not count IR and taxi players against the active roster size', () => {
    const p = preview()
    p.managers[0].players = ['p1', 'p2', 'ir1', 'tx1']
    p.managers[0].reserve = ['ir1']
    p.managers[0].taxi = ['tx1']
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: { ...allMatched, ir1: true, tx1: true } })
    expect(r.warnings.some((w) => w.code === 'roster_size_mismatch' && w.severity === 'warning')).toBe(false)
  })

  it('flags fewer teams than the source league says it has', () => {
    const p = preview()
    p.league.teamCount = 12
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: allMatched })
    const w = r.warnings.find((x) => x.code === 'fewer_teams_than_declared')
    expect(w).toMatchObject({ count: 10, severity: 'warning' })
    expect(w?.title).toBe('2 teams imported, but Sleeper says the league has 12')
    expect(r.league.importedTeamCount).toBe(2)
  })

  it('blocks confirmation when no teams came across', () => {
    const r = buildImportReview({ platform: 'sleeper', preview: preview({ managers: [] }), playerMatches: {} })
    expect(codes(r)[0]).toBe('no_teams')
    expect(importReviewHasBlockingIssues(r)).toBe(true)
  })

  it('explains unsupported lineup spots and what AF will use instead', () => {
    const r = buildImportReview({
      platform: 'mfl',
      preview: preview({ formatSummary: { detectedFormat: 'Redraft', unsupportedPositions: ['IDP_FLEX', 'IDP_FLEX', 'OP'] } }),
      playerMatches: allMatched,
    })
    const w = r.warnings.find((x) => x.code === 'unsupported_roster_slots')
    expect(w?.title).toContain('IDP flex, OP')
    expect(w?.detail).toMatch(/AF will use its standard Redraft lineup/)
  })

  it('turns canonical normalizer warnings into plain-English unsupported-setting warnings', () => {
    const r = buildImportReview({
      platform: 'espn',
      preview: preview(),
      playerMatches: allMatched,
      canonical: {
        warnings: [
          { code: 'concept_unmapped', message: '…', metadata: { rawConcept: 'vampire' } },
          { code: 'scoring_preset_inferred', message: '…' },
          { code: 'scoring_rule_collision', message: '…', metadata: { statKeys: ['rec'] } },
          { code: 'coverage_tradeHistory', message: 'ignored — shown as "did not come across"' },
        ],
      },
    })
    expect(codes(r)).toEqual(expect.arrayContaining(['unsupported_concept', 'scoring_preset_assumed', 'scoring_rule_collision']))
    expect(r.warnings.find((w) => w.code === 'unsupported_concept')?.detail).toMatch(/standard redraft/)
    expect(r.warnings.find((w) => w.code === 'scoring_preset_assumed')?.detail).toMatch(/Half PPR/)
    expect(codes(r)).not.toContain('coverage_tradeHistory')
  })

  it('sorts blocking first, then warnings, then information', () => {
    const p = preview({ managers: [] })
    p.formatSummary = { unsupportedPositions: ['OP'] }
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: null })
    const ranks = r.warnings.map((w) => w.severity)
    expect(ranks).toEqual([...ranks].sort((a, b) => ['blocking', 'warning', 'info'].indexOf(a) - ['blocking', 'warning', 'info'].indexOf(b)))
  })
})

describe('resolveOutstandingWarnings — in-place fixes', () => {
  it('counts an owner name, a team name and player picks as fixes', () => {
    const p = preview()
    p.managers[1] = manager('2', { displayName: '', username: '', teamName: '', players: ['p3', 'p4'] })
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: { p1: true, p2: false, p3: true, p4: true } })
    expect(resolveOutstandingWarnings(r, {}).map((w) => w.code)).toEqual(
      expect.arrayContaining(['team_no_owner', 'team_name_missing', 'players_unmatched']),
    )
    const after = resolveOutstandingWarnings(r, {
      ownerNames: { '2': 'Jamie' },
      teamNames: { '2': 'Night Owls' },
      playerMatches: { p2: { afPlayerId: 'pim-1' } },
    })
    expect(after).toEqual([])
  })

  it('a whitespace-only edit is not a fix', () => {
    const p = preview()
    p.managers[1] = manager('2', { displayName: '', username: '' })
    const r = buildImportReview({ platform: 'sleeper', preview: p, playerMatches: allMatched })
    expect(resolveOutstandingWarnings(r, { ownerNames: { '2': '   ' } }).map((w) => w.code)).toContain('team_no_owner')
  })
})

describe('diffImportAgainstPrevious — re-import shows what changed', () => {
  const previous: PreviousImportSnapshot = {
    lastImportedAt: '2026-10-01T12:00:00.000Z',
    teams: [
      { teamId: '1', teamName: 'Old Name', ownerName: 'Owner 1' },
      { teamId: '2', teamName: 'Team 2', ownerName: 'Owner 2' },
      { teamId: '9', teamName: 'Gone FC', ownerName: 'Leaver' },
    ],
    rosters: { '1': ['p1', 'old1'], '2': ['p3', 'p4'] },
    playerNames: { old1: 'Old Guy' },
    settings: { teamCount: 2, rosterPositions: ['QB', 'RB', 'BN'], scoringFormat: 'half', playoffTeamCount: 6 },
  }

  it('reports added and dropped players, team renames, removed teams and changed settings', () => {
    const next = preview({ reviewFacts: { leagueScoring: 'ppr', playoffTeamCount: 4 } })
    const d = diffImportAgainstPrevious(next, previous)
    expect(d.playersAdded).toBe(1) // p2 onto team 1
    expect(d.playersRemoved).toBe(1) // old1 off team 1
    expect(d.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'added', scope: 'player', label: 'Bravo RB' }),
        expect.objectContaining({ kind: 'removed', scope: 'player', label: 'Old Guy' }),
        expect.objectContaining({ kind: 'changed', scope: 'team', detail: 'Renamed from “Old Name”' }),
        expect.objectContaining({ kind: 'removed', scope: 'team', label: 'Gone FC' }),
        expect.objectContaining({ kind: 'changed', scope: 'setting', label: 'Scoring type', detail: 'half → ppr' }),
        expect.objectContaining({ kind: 'changed', scope: 'setting', label: 'Playoff teams', detail: '6 → 4' }),
      ]),
    )
    expect(d.settingsChanged).toBe(2)
  })

  it('a value the new payload does not report is not a change', () => {
    const d = diffImportAgainstPrevious(preview({ reviewFacts: {} }), previous)
    expect(d.items.some((i) => i.scope === 'setting')).toBe(false)
  })

  it('an unchanged league reports nothing', () => {
    const same: PreviousImportSnapshot = {
      lastImportedAt: null,
      teams: [
        { teamId: '1', teamName: 'Team 1', ownerName: 'Owner 1' },
        { teamId: '2', teamName: 'Team 2', ownerName: 'Owner 2' },
      ],
      rosters: { '1': ['p1', 'p2'], '2': ['p3', 'p4'] },
      settings: { teamCount: 2, rosterPositions: ['BN', 'RB', 'QB'] },
    }
    const d = diffImportAgainstPrevious(preview(), same)
    expect(d.items).toEqual([])
    expect(buildImportReview({ platform: 'sleeper', preview: preview(), playerMatches: allMatched, previous: same }).changes?.items).toEqual([])
  })
})

describe('import review overrides', () => {
  function normalized(): NormalizedImportResult {
    return {
      source: { source_provider: 'sleeper', source_league_id: 'L1', imported_at: '2026-11-01T00:00:00Z' } as NormalizedImportResult['source'],
      league: { name: 'L', sport: 'NFL', season: 2026, leagueSize: 2, rosterSize: 3, scoring: 'ppr', isDynasty: false },
      rosters: [
        { source_team_id: '1', source_manager_id: 'u1', owner_name: 'Owner 1', team_name: 'Team 1', avatar_url: null, wins: 0, losses: 0, ties: 0, points_for: 0, player_ids: ['p1'], starter_ids: [] },
        { source_team_id: '2', source_manager_id: '', owner_name: '', team_name: '', avatar_url: null, wins: 0, losses: 0, ties: 0, points_for: 0, player_ids: ['p2'], starter_ids: [] },
      ],
      scoring: null,
      schedule: [],
      draft_picks: [],
      transactions: [],
      standings: [],
      player_map: { p1: { name: 'A', position: 'QB', team: 'X' }, p2: { name: 'B', position: 'RB', team: 'Y' } },
      identity_mappings: [{ source_provider: 'sleeper', source_id: 'p1', entity_type: 'player', af_id: null }],
      coverage: {} as NormalizedImportResult['coverage'],
    } as NormalizedImportResult
  }

  it('parses untrusted input, dropping anything malformed', () => {
    expect(parseImportReviewOverrides(null)).toBeNull()
    expect(parseImportReviewOverrides({ teamNames: 'x' })).toBeNull()
    const o = parseImportReviewOverrides({
      teamNames: { '2': '  Night\u0000  Owls ', '3': '' },
      ownerNames: { '2': 'Jamie', bad: 7 },
      playerMatches: { p1: { afPlayerId: 'pim-1', name: 'Alpha' }, p2: { name: 'no id' }, p3: 'nope' },
    })
    expect(o).toEqual({
      teamNames: { '2': 'Night Owls' },
      ownerNames: { '2': 'Jamie' },
      playerMatches: { p1: { afPlayerId: 'pim-1', name: 'Alpha', position: null, team: null } },
    })
  })

  it('caps name length', () => {
    const o = parseImportReviewOverrides({ teamNames: { '1': 'x'.repeat(500) } })
    expect(o?.teamNames?.['1']).toHaveLength(80)
  })

  it('applies edits to the fresh fetch keyed on source ids, and ignores unknown teams and players', () => {
    const out = applyImportReviewOverrides(normalized(), {
      teamNames: { '2': 'Night Owls', ghost: 'Nope' },
      ownerNames: { '2': 'Jamie' },
      playerMatches: { p1: { afPlayerId: 'pim-1', name: 'Alpha' }, p2: { afPlayerId: 'pim-2', name: 'Bravo' }, ghost: { afPlayerId: 'pim-9', name: 'G' } },
    })
    expect(out.rosters[1]).toMatchObject({ team_name: 'Night Owls', owner_name: 'Jamie' })
    expect(out.rosters[0]).toMatchObject({ team_name: 'Team 1', owner_name: 'Owner 1' })
    expect(out.identity_mappings?.find((m) => m.source_id === 'p1')?.af_id).toBe('pim-1')
    expect(out.identity_mappings?.find((m) => m.source_id === 'p2')?.af_id).toBe('pim-2')
    expect(out.identity_mappings?.some((m) => m.source_id === 'ghost')).toBe(false)
    const audit = (out.league as Record<string, unknown>).import_review as Record<string, unknown>
    expect(audit.teamNames).toEqual({ '2': 'Night Owls' })
    expect(Object.keys(audit.playerMatches as object)).toEqual(['p1', 'p2'])
  })

  it('no overrides returns the input untouched', () => {
    const n = normalized()
    expect(applyImportReviewOverrides(n, null)).toBe(n)
  })
})

describe('readImportReview', () => {
  it('accepts a real review and rejects anything else', () => {
    const r = buildImportReview({ platform: 'sleeper', preview: preview(), playerMatches: allMatched })
    expect(readImportReview(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(readImportReview(null)).toBeNull()
    expect(readImportReview({ version: 2 })).toBeNull()
    expect(readImportReview({ ...r, teams: 'x' })).toBeNull()
  })
})
