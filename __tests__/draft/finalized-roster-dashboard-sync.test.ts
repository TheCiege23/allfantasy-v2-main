/**
 * Completed-draft → league dashboard Roster tab sync.
 *
 * Pins the two-sided fix for the bug surfaced on league
 * `ff789927-99f5-4346-9c1c-03308990ea63`: a completed draft renders
 * an empty Roster tab on the league dashboard.
 *
 * Root cause:
 *   - `Roster.playerData` is the source of truth for the dashboard.
 *   - The TeamTab uses `buildLineupListsFromPlayerData` which reads
 *     `lineup_sections.starters` then falls back to legacy
 *     `playerData.starters` — but does NOT look at `playerData.draftPicks`.
 *   - During the draft, `appendPickToRosterDraftSnapshot` writes
 *     `playerData.draftPicks` as an audit trail.
 *   - On completion, `completeDraftSession` calls
 *     `runPostDraftFinalizationArtifacts` → `finalizeRosterAssignments`
 *     which materializes `lineup_sections` from `session.picks`.
 *   - But: if finalize errors, the roster template is missing, or the
 *     completion took a code path that bypassed `completeDraftSession`,
 *     `lineup_sections` never lands and the dashboard renders empty.
 *
 * Two-sided fix:
 *   1. **Read-side resilience** — `buildLineupListsFromPlayerData` now
 *      falls back to `playerData.draftPicks` when both
 *      `lineup_sections.starters` and legacy `playerData.starters` are
 *      empty. Greedy fill: first `starterSlotCount` picks become starters,
 *      the rest go to bench. Uses `playerId` when present, falls back to
 *      `playerName` for the row id.
 *   2. **Write-side self-heal** — `/api/league/roster` (non-Sleeper path)
 *      now calls `syncPostDraftArtifactsIfCompletedThrottled` before
 *      reading the roster. Throttle (60s success window) prevents
 *      redundant work on dashboard reloads. Failures are swallowed and
 *      the read-side fallback above keeps the dashboard renderable.
 *
 * Both halves are independent and idempotent. Either one alone keeps the
 * dashboard from rendering empty; together they self-heal both the
 * persisted state AND the live render.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('buildLineupListsFromPlayerData — existing behavior preserved', () => {
  it('returns all-empty starters padded to slot count when playerData is null', () => {
    const result = buildLineupListsFromPlayerData(null, 9)
    expect(result.starters).toHaveLength(9)
    expect(result.starters.every((s) => s === '')).toBe(true)
    expect(result.bench).toEqual([])
  })

  it('uses lineup_sections.starters when present', () => {
    const playerData = {
      lineup_sections: {
        starters: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        bench: [{ id: 'b1' }, { id: 'b2' }],
      },
    }
    const result = buildLineupListsFromPlayerData(playerData, 3)
    expect(result.starters).toEqual(['p1', 'p2', 'p3'])
    expect(result.bench).toEqual(['b1', 'b2'])
  })

  it('falls back to legacy playerData.starters when lineup_sections is empty', () => {
    const playerData = {
      starters: ['legacy1', 'legacy2'],
    }
    const result = buildLineupListsFromPlayerData(playerData, 3)
    expect(result.starters).toEqual(['legacy1', 'legacy2', ''])
  })

  it('legacy starters can be objects with id', () => {
    const playerData = {
      starters: [{ id: 'obj1' }, { id: 'obj2' }],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['obj1', 'obj2'])
  })

  it('truncates starters when more than slot count', () => {
    const playerData = {
      lineup_sections: {
        starters: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
      },
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['p1', 'p2'])
  })

  it('preserves ir / taxi / devy sections when set', () => {
    const playerData = {
      lineup_sections: {
        starters: [{ id: 's1' }],
        bench: [],
        ir: [{ id: 'ir1' }],
        taxi: [{ id: 't1' }],
        devy: [{ id: 'd1' }],
      },
    }
    const result = buildLineupListsFromPlayerData(playerData, 1)
    expect(result.ir).toEqual(['ir1'])
    expect(result.taxi).toEqual(['t1'])
    expect(result.devy).toEqual(['d1'])
  })
})

describe('buildLineupListsFromPlayerData — completed-draft draftPicks fallback', () => {
  it('greedy-fills starters then bench from draftPicks when no lineup_sections / starters exist', () => {
    const playerData = {
      draftPicks: [
        { playerId: 'qb1', playerName: 'Josh Allen', position: 'QB', team: 'BUF' },
        { playerId: 'rb1', playerName: 'Saquon Barkley', position: 'RB', team: 'PHI' },
        { playerId: 'rb2', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' },
        { playerId: 'wr1', playerName: 'Justin Jefferson', position: 'WR', team: 'MIN' },
        { playerId: 'wr2', playerName: 'CeeDee Lamb', position: 'WR', team: 'DAL' },
        { playerId: 'te1', playerName: 'Travis Kelce', position: 'TE', team: 'KC' },
        { playerId: 'flex1', playerName: 'Puka Nacua', position: 'WR', team: 'LAR' },
        { playerId: 'k1', playerName: 'Justin Tucker', position: 'K', team: 'BAL' },
        { playerId: 'def1', playerName: 'Cowboys D/ST', position: 'DEF', team: 'DAL' },
        { playerId: 'b1', playerName: 'Tony Pollard', position: 'RB', team: 'TEN' },
        { playerId: 'b2', playerName: 'Tee Higgins', position: 'WR', team: 'CIN' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 9)
    expect(result.starters).toEqual([
      'qb1',
      'rb1',
      'rb2',
      'wr1',
      'wr2',
      'te1',
      'flex1',
      'k1',
      'def1',
    ])
    expect(result.bench).toEqual(['b1', 'b2'])
  })

  it('uses playerName when playerId is missing', () => {
    const playerData = {
      draftPicks: [
        { playerName: 'Josh Allen', position: 'QB' },
        { playerName: 'Saquon Barkley', position: 'RB' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['Josh Allen', 'Saquon Barkley'])
  })

  it('skips picks with neither playerId nor playerName', () => {
    const playerData = {
      draftPicks: [
        { playerId: 'p1', playerName: 'A' },
        {}, // empty
        { playerId: '', playerName: '' }, // empty strings
        { playerId: 'p2', playerName: 'B' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['p1', 'p2'])
  })

  it('does NOT use draftPicks when lineup_sections.starters is non-empty', () => {
    const playerData = {
      lineup_sections: {
        starters: [{ id: 'real1' }, { id: 'real2' }],
      },
      draftPicks: [
        { playerId: 'pick1', playerName: 'A' },
        { playerId: 'pick2', playerName: 'B' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['real1', 'real2'])
  })

  it('does NOT use draftPicks when legacy playerData.starters is non-empty', () => {
    const playerData = {
      starters: ['legacy1'],
      draftPicks: [{ playerId: 'pick1', playerName: 'A' }],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['legacy1', ''])
  })

  it('uses draftPicks when starters are empty even if bench is non-empty (heals stale bench-only data)', () => {
    // Pre-existing behaviour gated this fallback on `bench.length === 0`, which
    // blocked the heal whenever a partial finalize had already written stale
    // rows to `lineup_sections.bench` while leaving `starters` empty. Loosened
    // the guard to fire on `starters.length === 0` alone — the
    // `playerData.starters` legacy short-circuit (asserted in the test above)
    // still protects real lineups from being clobbered.
    const playerData = {
      lineup_sections: {
        bench: [{ id: 'stale-b1' }, { id: 'stale-b2' }],
      },
      draftPicks: [
        { playerId: 'pick1', playerName: 'A' },
        { playerId: 'pick2', playerName: 'B' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['pick1', 'pick2'])
    // Stale bench is overwritten; the canonical post-draft order comes from draftPicks.
    expect(result.bench).toEqual([])
  })

  it('heals empty starters from draftPicks while preserving overflow into bench (post-draft repair shape)', () => {
    // Realistic shape for the league dashboard Roster tab when finalize ran
    // partially: starters empty, lineup_sections.bench populated with stale
    // pre-finalize rows, draftPicks fully populated.
    const playerData = {
      lineup_sections: {
        bench: [{ id: 'stale-b1' }],
      },
      draftPicks: [
        { playerId: 'p1', playerName: 'QB' },
        { playerId: 'p2', playerName: 'RB' },
        { playerId: 'p3', playerName: 'WR' },
        { playerId: 'p4', playerName: 'TE' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    // First 2 picks fill the starter slots, remainder goes to bench (in pick order).
    expect(result.starters).toEqual(['p1', 'p2'])
    expect(result.bench).toEqual(['p3', 'p4'])
  })

  it('handles draftPicks shorter than starter slot count by padding with empty', () => {
    const playerData = {
      draftPicks: [
        { playerId: 'p1', playerName: 'A' },
        { playerId: 'p2', playerName: 'B' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 5)
    expect(result.starters).toEqual(['p1', 'p2', '', '', ''])
    expect(result.bench).toEqual([])
  })

  it('does nothing when draftPicks is empty / missing', () => {
    const result1 = buildLineupListsFromPlayerData({ draftPicks: [] }, 3)
    expect(result1.starters).toEqual(['', '', ''])
    expect(result1.bench).toEqual([])

    const result2 = buildLineupListsFromPlayerData({}, 3)
    expect(result2.starters).toEqual(['', '', ''])
    expect(result2.bench).toEqual([])
  })

  it('does nothing when starterSlotCount is 0 (defensive)', () => {
    const playerData = {
      draftPicks: [
        { playerId: 'p1', playerName: 'A' },
        { playerId: 'p2', playerName: 'B' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 0)
    expect(result.starters).toEqual([])
    // bench gets all the picks since cap = 0
    expect(result.bench).toEqual(['p1', 'p2'])
  })

  it('trims whitespace on playerId / playerName', () => {
    const playerData = {
      draftPicks: [
        { playerId: '  trimmed1  ', playerName: 'A' },
        { playerId: '', playerName: '  trimmed-name  ' },
      ],
    }
    const result = buildLineupListsFromPlayerData(playerData, 2)
    expect(result.starters).toEqual(['trimmed1', 'trimmed-name'])
  })
})

describe('Source contract — read-side fallback wired in lineup-swap.ts', () => {
  const src = read('lib/league/lineup-swap.ts')

  it('exposes buildLineupListsFromPlayerData with the canonical signature', () => {
    expect(src).toMatch(
      /export function buildLineupListsFromPlayerData\(\s*playerData: unknown,\s*starterSlotCount: number,?\s*\): RosterLineupLists/,
    )
  })

  it('declares the draftPicks fallback path with the no-existing-lineup gate', () => {
    expect(src).toMatch(
      /if \(\s*starters\.length === 0 && playerData && typeof playerData === 'object' && !Array\.isArray\(playerData\)\s*\) \{\s*const pd = playerData as Record<string, unknown>\s*const draftPicks = Array\.isArray\(pd\.draftPicks\)/,
    )
    expect(src).not.toMatch(/if \(\s*starters\.length === 0 && bench\.length === 0/)
  })

  it('greedy-fills starters first, then bench', () => {
    expect(src).toMatch(/starters = ids\.slice\(0, cap\)/)
    expect(src).toMatch(/bench = ids\.slice\(cap\)/)
  })

  it('falls back to playerName when playerId is missing or empty', () => {
    expect(src).toMatch(
      /typeof pid === 'string' && pid\.trim\(\)[\s\S]+?return pid\.trim\(\)/,
    )
    expect(src).toMatch(
      /typeof name === 'string' && name\.trim\(\)[\s\S]+?return name\.trim\(\)/,
    )
  })

  it('respects starterSlotCount cap (clamped to >= 0)', () => {
    expect(src).toMatch(/const cap = Math\.max\(0, starterSlotCount\)/)
  })
})

describe('Source contract — write-side self-heal wired in /api/league/roster', () => {
  const src = read('app/api/league/roster/route.ts')

  it('imports + invokes syncPostDraftArtifactsIfCompletedThrottled before reading the roster', () => {
    expect(src).toMatch(
      /import\(\s*'@\/lib\/live-draft-engine\/postDraftFinalizeArtifacts'\s*\)/,
    )
    expect(src).toMatch(/await syncPostDraftArtifactsIfCompletedThrottled\(leagueId\)/)
  })

  it('only runs the self-heal on the non-Sleeper branch (Sleeper rosters are read-only)', () => {
    // The self-heal block lives inside the `if (league.platform !== 'sleeper')`
    // branch and runs before the roster lookup. Match via regex so CRLF / LF
    // line endings both work.
    const guardIdx = src.indexOf("if (league.platform !== 'sleeper')")
    const healIdx = src.indexOf('syncPostDraftArtifactsIfCompletedThrottled')
    const findFirstMatch = src.match(
      /const roster = await prisma\.roster\.findFirst\(\{\s+where: \{ leagueId, platformUserId: targetUserId \}/,
    )
    expect(guardIdx).toBeGreaterThan(0)
    expect(healIdx).toBeGreaterThan(guardIdx)
    expect(findFirstMatch).not.toBeNull()
    expect(findFirstMatch!.index!).toBeGreaterThan(healIdx)
  })

  it('wraps the heal in try/catch so a heal failure does not break the roster read', () => {
    expect(src).toMatch(
      /try \{[\s\S]+?syncPostDraftArtifactsIfCompletedThrottled[\s\S]+?\} catch \{[\s\S]+?\}/,
    )
  })
})

describe('runPostDraftFinalizationArtifacts is the canonical materializer (write-side contract)', () => {
  const src = read('lib/live-draft-engine/postDraftFinalizeArtifacts.ts')

  it('runPostDraftFinalizationArtifacts calls finalizeRosterAssignments', () => {
    expect(src).toMatch(
      /export async function runPostDraftFinalizationArtifacts[\s\S]+?await finalizeRosterAssignments\(leagueId\)/,
    )
  })

  it('syncPostDraftArtifactsIfCompletedThrottled gates on session.status === "completed"', () => {
    expect(src).toMatch(/session\?\.status !== 'completed'/)
  })

  it('throttle is 60s success window, deletes throttle key on failure (so next call retries)', () => {
    expect(src).toMatch(/POST_DRAFT_ARTIFACT_STABLE_THROTTLE_MS = 60_000/)
    expect(src).toMatch(/postDraftArtifactOkAt\.delete\(leagueId\)/)
  })
})

describe('Idempotency — finalizeRosterAssignments + draftPicks fallback', () => {
  const src = read('lib/live-draft-engine/RosterAssignmentService.ts')

  it('finalizeRosterAssignments only runs after session.status === "completed"', () => {
    expect(src).toMatch(/if \(!session \|\| session\.status !== 'completed'\) return/)
  })

  it('finalizeRosterAssignments does NOT clobber existing lineup (idempotent)', () => {
    expect(src).toMatch(
      /Only materialize a starter lineup when the roster doesn't already have/,
    )
    expect(src).toMatch(/!hasExistingLineup\(data\)/)
  })

  it('finalizeRosterAssignments always refreshes draftPicks audit trail (idempotent overwrite)', () => {
    expect(src).toMatch(/Always refresh the flat draftPicks audit trail/)
    expect(src).toMatch(/nextPlayerData: Record<string, unknown> = \{ \.\.\.data, draftPicks: players \}/)
  })

  it('skips empty draft pick rows when bucketing per-roster', () => {
    expect(src).toMatch(/isDraftPickRowEmpty\(/)
  })
})

describe('No mechanics regression (sanity)', () => {
  it('PickSubmissionService still uses the canonical post-draft completion chain', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(/import \{ completeDraftSession \} from '\.\/DraftSessionService'/)
    expect(sps).toMatch(/if \(overall >= totalPicks\)/)
    expect(sps).toMatch(/await completeDraftSession\(input\.leagueId\)/)
  })

  it('completeDraftSession still calls runPostDraftFinalizationArtifacts after the transaction', () => {
    const ds = read('lib/live-draft-engine/DraftSessionService.ts')
    expect(ds).toMatch(
      /export async function completeDraftSession[\s\S]+?const \{ runPostDraftFinalizationArtifacts \} = await import\('@\/lib\/live-draft-engine\/postDraftFinalizeArtifacts'\)/,
    )
    expect(ds).toMatch(/await runPostDraftFinalizationArtifacts\(leagueId\)/)
  })
})
