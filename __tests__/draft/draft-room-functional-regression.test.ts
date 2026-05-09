/**
 * Draft Room Functional Regression — Commit 18
 *
 * Integrated invariants proving the full canonical draft room loop:
 *   /drafts/[draftId] → initialSnapshot → pick → board merge → queue →
 *   live-sync reconciliation → timer/currentPick → error recovery.
 *
 * Mixes two test styles:
 *   A. Pure function unit tests — import real library functions; zero mocks.
 *   B. Source-level invariants — readFileSync over component source; fast.
 *
 * Covers all 18 required MVP verification behaviors:
 *  1. /drafts/[draftId] loads with initialSnapshot
 *  2. Board/session state visible immediately (no loading flash)
 *  3. Pick uses canonical /api/leagues/[leagueId]/draft/pick
 *  4. Successful pick merges returned session snapshot
 *  5. Successful pick advances currentPick / currentTeam / round
 *  6. Successful pick removes player from pool / marks drafted
 *  7. Successful pick removes drafted player from queue
 *  8. Queue uses canonical /api/leagues/[leagueId]/draft/queue
 *  9. Queue change survives live-sync reconciliation
 * 10. Timer/currentPick updates from returned snapshot or live-sync
 * 11. Failed pick does not advance local current pick
 * 12. Failed queue save does not corrupt queue
 * 13. Live-sync after pick does not revert to stale data
 * 14. InitialSnapshot remains visible if live-sync briefly fails
 * 15. Commissioner force-autopick through useCommissionerActions
 * 16. AutopickMeToggle updates viewerAutopick locally
 * 17. No legacy endpoints in this integrated loop
 * 18. NFL and NBA playerId flows work
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildDraftRoomCoreState,
  isPickCommitAllowed,
  isPickCommitAllowedByName,
  resolveEffectiveCurrentPick,
} from '@/lib/live-draft-engine'
import {
  mergeDraftSessionSnapshot,
  isStaleDraftSessionSnapshot,
  repairDraftSessionAuthority,
} from '@/lib/draft-room/mergeDraftSessionSnapshot'
import type { DraftSessionSnapshot, DraftPickSnapshot } from '@/lib/live-draft-engine/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function basePick(overall: number, name: string, playerId: string | null = null): DraftPickSnapshot {
  return {
    id: `pick-${overall}`,
    overall,
    round: Math.ceil(overall / 4),
    slot: ((overall - 1) % 4) + 1,
    rosterId: `roster-${((overall - 1) % 4) + 1}`,
    displayName: `Team ${((overall - 1) % 4) + 1}`,
    playerName: name,
    position: 'RB',
    team: 'KC',
    byeWeek: 6,
    playerId,
    tradedPickMeta: null,
    source: 'user',
    pickLabel: `${Math.ceil(overall / 4)}.${((overall - 1) % 4) + 1}`,
    createdAt: new Date().toISOString(),
  }
}

function baseSession(overrides: Partial<DraftSessionSnapshot> = {}): DraftSessionSnapshot {
  return {
    id: 'sess-1',
    leagueId: 'lg-1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 3,
    teamCount: 4,
    thirdRoundReversal: false,
    onClockTradeTimerBehavior: 'inherit_remaining',
    inDraftPlayerTradesEnabled: false,
    customRankingsEnabled: false,
    timerSeconds: 60,
    timerEndAt: null,
    pausedRemainingSeconds: null,
    slotOrder: [
      { slot: 1, rosterId: 'roster-1', displayName: 'Team 1' },
      { slot: 2, rosterId: 'roster-2', displayName: 'Team 2' },
      { slot: 3, rosterId: 'roster-3', displayName: 'Team 3' },
      { slot: 4, rosterId: 'roster-4', displayName: 'Team 4' },
    ],
    tradedPicks: [],
    version: 1,
    picks: [],
    currentPick: { overall: 1, round: 1, slot: 1, rosterId: 'roster-1', displayName: 'Team 1', pickLabel: '1.01' },
    timer: { status: 'running', remainingSeconds: 55, timerEndAt: null },
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Part A: Pure function tests (real imports, zero mocks)
// ---------------------------------------------------------------------------

// Behavior 5 — successful pick advances currentPick / currentTeam / currentRound
describe('mergeDraftSessionSnapshot — pick advances the clock', () => {
  it('after pick 1 is committed, incoming snapshot shows currentPick.overall = 2', () => {
    const prev = baseSession()
    const next = baseSession({
      version: 2,
      updatedAt: '2026-01-01T00:01:00Z',
      picks: [basePick(1, 'Player A', 'p-a')],
      currentPick: { overall: 2, round: 1, slot: 2, rosterId: 'roster-2', displayName: 'Team 2', pickLabel: '1.02' },
    })
    const merged = mergeDraftSessionSnapshot(prev, next)
    expect(merged).not.toBeNull()
    expect(merged!.currentPick?.overall).toBe(2)
    expect(merged!.currentPick?.rosterId).toBe('roster-2')
  })

  it('merged snapshot includes the new pick in picks array', () => {
    const prev = baseSession()
    const next = baseSession({
      version: 2,
      updatedAt: '2026-01-01T00:01:00Z',
      picks: [basePick(1, 'Player A', 'p-a')],
      currentPick: { overall: 2, round: 1, slot: 2, rosterId: 'roster-2', displayName: 'Team 2', pickLabel: '1.02' },
    })
    const merged = mergeDraftSessionSnapshot(prev, next)!
    expect(merged.picks.length).toBe(1)
    expect(merged.picks[0]!.playerName).toBe('Player A')
    expect(merged.picks[0]!.playerId).toBe('p-a')
  })

  it('merging a null incoming returns prev unchanged', () => {
    const prev = baseSession()
    const result = mergeDraftSessionSnapshot(prev, null)
    expect(result).toEqual(prev)
  })

  it('does not regress in_progress to pre_draft when same pick count (stale read)', () => {
    const prev = baseSession({ status: 'in_progress' })
    const stale = baseSession({ status: 'pre_draft', version: 0 })
    const result = mergeDraftSessionSnapshot(prev, stale)
    expect(result!.status).toBe('in_progress')
  })

  it('preserves prev currentPick when incoming has none for same pick epoch', () => {
    const cp = { overall: 1, round: 1, slot: 1, rosterId: 'roster-1', displayName: 'Team 1', pickLabel: '1.01' }
    const prev = baseSession({ currentPick: cp })
    const incoming = baseSession({
      version: 2,
      updatedAt: '2026-01-01T00:00:30Z',
      currentPick: null,
      // same pick count — no new pick committed
      picks: [],
    })
    const merged = mergeDraftSessionSnapshot(prev, incoming)
    // Same pick epoch: currentPick must not be blanked
    expect(merged!.currentPick).not.toBeNull()
  })
})

// Behavior 10 — timer / currentPick updates from returned snapshot
describe('buildDraftRoomCoreState — derives timer and currentPick anchor', () => {
  it('returns draftStarted=false for pre_draft sessions', () => {
    const s = baseSession({ status: 'pre_draft' })
    const core = buildDraftRoomCoreState(s)
    expect(core.draftStarted).toBe(false)
  })

  it('returns draftStarted=true for in_progress sessions', () => {
    const s = baseSession({ status: 'in_progress' })
    const core = buildDraftRoomCoreState(s)
    expect(core.draftStarted).toBe(true)
  })

  it('currentOverall matches currentPick.overall from session', () => {
    const s = baseSession()
    const core = buildDraftRoomCoreState(s)
    expect(core.currentOverall).toBe(1)
  })

  it('currentTeamId matches currentPick.rosterId from session', () => {
    const s = baseSession()
    const core = buildDraftRoomCoreState(s)
    expect(core.currentTeamId).toBe('roster-1')
  })

  it('currentOverall advances after a pick', () => {
    const s = baseSession({
      picks: [basePick(1, 'Player A')],
      currentPick: { overall: 2, round: 1, slot: 2, rosterId: 'roster-2', displayName: 'Team 2', pickLabel: '1.02' },
    })
    const core = buildDraftRoomCoreState(s)
    expect(core.currentOverall).toBe(2)
    expect(core.currentTeamId).toBe('roster-2')
  })
})

// Behavior 6 — player detected as drafted (removed from pool)
describe('isPickCommitAllowed / isPickCommitAllowedByName — drafted detection', () => {
  it('blocks pick when playerId is in draftedPlayerIds', () => {
    const draftedPlayerIds = new Set(['p-a'])
    expect(isPickCommitAllowed({ canDraft: true, playerId: 'p-a', draftedPlayerIds })).toBe(false)
  })

  it('allows pick when playerId is NOT in draftedPlayerIds', () => {
    const draftedPlayerIds = new Set(['p-a'])
    expect(isPickCommitAllowed({ canDraft: true, playerId: 'p-b', draftedPlayerIds })).toBe(true)
  })

  it('allows pick when playerId is null (no id — name check handles it)', () => {
    const draftedPlayerIds = new Set(['p-a'])
    expect(isPickCommitAllowed({ canDraft: true, playerId: null, draftedPlayerIds })).toBe(true)
  })

  it('blocks pick by name when name is in draftedNames', () => {
    const draftedNames = new Set(['patrick mahomes'])
    expect(isPickCommitAllowedByName({ canDraft: true, playerName: 'Patrick Mahomes', draftedNames })).toBe(false)
  })

  it('allows pick by name when name is NOT in draftedNames', () => {
    const draftedNames = new Set(['patrick mahomes'])
    expect(isPickCommitAllowedByName({ canDraft: true, playerName: 'Travis Kelce', draftedNames })).toBe(true)
  })

  it('blocks pick when canDraft is false even with valid id', () => {
    expect(isPickCommitAllowed({ canDraft: false, playerId: null, draftedPlayerIds: new Set() })).toBe(false)
  })
})

// Behavior 13 — live-sync does not revert stale data
describe('isStaleDraftSessionSnapshot — prevents live-sync stale overwrites', () => {
  it('returns true when incoming snapshot has older timestamp', () => {
    const prev = baseSession({ updatedAt: '2026-01-01T00:05:00Z', version: 3 })
    const stale = baseSession({ updatedAt: '2026-01-01T00:01:00Z', version: 2 })
    expect(isStaleDraftSessionSnapshot(prev, stale)).toBe(true)
  })

  it('returns false when incoming snapshot is newer', () => {
    const prev = baseSession({ updatedAt: '2026-01-01T00:01:00Z', version: 2 })
    const fresh = baseSession({ updatedAt: '2026-01-01T00:05:00Z', version: 3 })
    expect(isStaleDraftSessionSnapshot(prev, fresh)).toBe(false)
  })

  it('returns false when prev is null', () => {
    const next = baseSession()
    expect(isStaleDraftSessionSnapshot(null, next)).toBe(false)
  })
})

// Behavior 5 extra — resolveEffectiveCurrentPick uses session.currentPick or infers
describe('resolveEffectiveCurrentPick — derives on-clock from session', () => {
  it('returns session.currentPick when present', () => {
    const s = baseSession()
    const cp = resolveEffectiveCurrentPick(s)
    expect(cp?.overall).toBe(1)
    expect(cp?.rosterId).toBe('roster-1')
  })

  it('infers currentPick from picks array when session.currentPick is null', () => {
    // After pick 1 is committed but currentPick was not sent
    const s = baseSession({
      picks: [basePick(1, 'Player A')],
      currentPick: null,
    })
    const cp = resolveEffectiveCurrentPick(s)
    // Inferred: overall 2 for a 4-team snake
    expect(cp?.overall).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Part B: Source-level invariants
// ---------------------------------------------------------------------------

const root = resolve(__dirname, '..', '..')

const pageSrc = readFileSync(resolve(root, 'app/drafts/[draftId]/page.tsx'), 'utf8')
const boardWrapperSrc = readFileSync(resolve(root, 'components/draft/DraftBoard.tsx'), 'utf8')
const clientSrc = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)
const hookSrc = readFileSync(resolve(root, 'hooks/useLiveDraftSync.ts'), 'utf8')
const commSrc = readFileSync(resolve(root, 'hooks/useCommissionerActions.ts'), 'utf8')
const autopickSrc = readFileSync(
  resolve(root, 'components/app/draft-room/AutopickMeToggle.tsx'),
  'utf8',
)

// Scoped extracts
const makePickMatch = clientSrc.match(
  /const handleMakePick = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const makePickSrc = makePickMatch?.[0] ?? ''

const queueSaveMatch = clientSrc.match(
  /const handleQueueSave = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const queueSaveSrc = queueSaveMatch?.[0] ?? ''

// Behavior 1 — /drafts/[draftId] loads with initialSnapshot
describe('/drafts/[draftId] page — initialSnapshot seeding chain (Behavior 1)', () => {
  it('page calls buildSessionSnapshot to build the initialSnapshot server-side', () => {
    expect(pageSrc).toMatch(/buildSessionSnapshot\(/)
  })

  it('page passes initialSnapshot to DraftBoard', () => {
    expect(pageSrc).toMatch(/initialSnapshot=\{initialSnapshot\}/)
  })

  it('DraftBoard wrapper passes initialSnapshot to DraftRoomPageClient', () => {
    expect(boardWrapperSrc).toMatch(/initialSnapshot=\{props\.initialSnapshot/)
  })

  it('DraftRoomPageClient accepts initialSnapshot as a prop', () => {
    expect(clientSrc).toMatch(/initialSnapshot\?:\s*DraftSessionSnapshot/)
  })

  it('DraftRoomPageClient initializes session state from initialSnapshot', () => {
    expect(clientSrc).toMatch(/useState<DraftSessionSnapshot \| null>\(initialSnapshot \?\? null\)/)
  })
})

// Behavior 2 — Board visible immediately (no empty flash)
describe('DraftRoomPageClient — session visible immediately (Behavior 2)', () => {
  it('loading is initialized to false when initialSnapshot is present', () => {
    expect(clientSrc).toMatch(/useState\(initialSnapshot \? false : true\)/)
  })

  it('sessionRef is also initialized from initialSnapshot (stable ref for live-sync)', () => {
    expect(clientSrc).toMatch(/useRef<DraftSessionSnapshot \| null>\(initialSnapshot \?\? null\)/)
  })

  it('DraftRoomPageClient does not navigate away if initialSnapshot is provided but live-sync is slow', () => {
    // The page never calls router.push / router.replace based on session state
    expect(clientSrc).not.toMatch(/router\.push\(/)
    expect(clientSrc).not.toMatch(/router\.replace\(/)
  })
})

// Behavior 3 — Pick uses canonical endpoint
describe('handleMakePick — canonical pick endpoint (Behavior 3)', () => {
  it('handleMakePick source is extracted', () => {
    expect(makePickSrc).not.toBe('')
  })

  it('posts to /api/leagues/[leagueId]/draft/pick (canonical)', () => {
    expect(makePickSrc).toMatch(/\/api\/leagues\/.*\/draft\/pick/)
  })

  it('uses POST method', () => {
    expect(makePickSrc).toMatch(/method: 'POST'/)
  })

  it('encodes leagueId for safety', () => {
    expect(makePickSrc).toMatch(/encodeURIComponent\(leagueId\)/)
  })
})

// Behavior 4 — Successful pick merges returned session snapshot
describe('handleMakePick — success path merges snapshot (Behavior 4)', () => {
  it('calls mergeDraftSessionSnapshot with prev and data.session on success', () => {
    expect(makePickSrc).toMatch(/mergeDraftSessionSnapshot\(prev, data\.session/)
  })

  it('does not directly setSession(data.session) — always goes through merge', () => {
    // Raw setSession(data.session) is NOT present; only the merge form is used
    expect(makePickSrc).not.toMatch(/setSession\(data\.session\)/)
  })
})

// Behavior 5 — Successful pick advances currentPick (via merge, tested above in pure-fn section)
describe('DraftRoomPageClient — currentPick derived from merged session (Behavior 5)', () => {
  it('currentPick is computed via resolveEffectiveCurrentPick in a useMemo', () => {
    expect(clientSrc).toMatch(/resolveEffectiveCurrentPick\(session\)/)
  })

  it('draftCore is computed via buildDraftRoomCoreState(session) in a useMemo', () => {
    expect(clientSrc).toMatch(/buildDraftRoomCoreState\(session\)/)
  })

  it('both are memoized from the session state — update automatically after pick merge', () => {
    // Both live inside useMemo(() => ..., [session]) calls
    const coreMatch = clientSrc.match(/useMemo[\s\S]*?buildDraftRoomCoreState\(session\)/)
    const pickMatch = clientSrc.match(/useMemo[\s\S]*?resolveEffectiveCurrentPick\(session\)/)
    expect(coreMatch).not.toBeNull()
    expect(pickMatch).not.toBeNull()
  })
})

// Behavior 6 — Successful pick removes player from pool / marks drafted
describe('DraftRoomPageClient — draftedNames and draftedPlayerIds from session.picks (Behavior 6)', () => {
  it('draftedNames is a Set derived from session.picks using normalizeDraftedPlayerName', () => {
    expect(clientSrc).toMatch(/new Set\([\s\S]*?session\?\.picks[\s\S]*?normalizeDraftedPlayerName/)
  })

  it('draftedPlayerIds is a Set built from picks[].playerId', () => {
    expect(clientSrc).toMatch(/draftedPlayerIds[\s\S]*?session\?\.picks/)
    expect(clientSrc).toMatch(/p\.playerId/)
  })

  it('draftedNames memoized on session.picks (auto-updates after pick merge)', () => {
    const match = clientSrc.match(
      /const draftedNames = useMemo\([\s\S]*?\[session\?\.picks\]\)/,
    )
    expect(match).not.toBeNull()
  })

  it('draftedPlayerIds memoized on session.picks', () => {
    const match = clientSrc.match(
      /const draftedPlayerIds = useMemo\([\s\S]*?\[session\?\.picks\]\)/,
    )
    expect(match).not.toBeNull()
  })
})

// Behavior 7 — Successful pick removes player from queue
describe('handleMakePick — removes drafted player from queue (Behavior 7)', () => {
  it('filters queue by comparing normalized player names after successful pick', () => {
    expect(makePickSrc).toMatch(/normalizeDraftedPlayerName\(e\.playerName\).*normalizeDraftedPlayerName\(player\.name\)/)
  })

  it('setQueue filters the previous queue — does not blank it', () => {
    const successBlock = makePickSrc.slice(
      makePickSrc.indexOf('if (res.ok && data.session)'),
      makePickSrc.indexOf('} else if (res.ok)'),
    )
    expect(successBlock).toMatch(/setQueue\(\(prev\) =>/)
    expect(successBlock).toMatch(/prev\.filter/)
  })
})

// Behavior 8 — Queue uses canonical endpoint
describe('handleQueueSave — canonical queue endpoint (Behavior 8)', () => {
  it('PUTs to /api/leagues/[leagueId]/draft/queue (canonical)', () => {
    expect(queueSaveSrc).toMatch(/\/api\/leagues\/.*\/draft\/queue/)
    expect(queueSaveSrc).toMatch(/method: 'PUT'/)
  })

  it('sends the queue array in the body', () => {
    expect(queueSaveSrc).toMatch(/JSON\.stringify\(\{ queue:/)
  })
})

// Behavior 9 — Queue change survives live-sync reconciliation
describe('useLiveDraftSync — queue update does not overwrite local changes unnecessarily (Behavior 9)', () => {
  it('setQueue in live-sync is guarded by JSON.stringify comparison (only updates when different)', () => {
    const match = hookSrc.match(
      /setQueue\(\(prev\) => \(JSON\.stringify\(prev\) === JSON\.stringify\(next\) \? prev : next\)\)/,
    )
    expect(match).not.toBeNull()
  })

  it('live-sync only includes queue on configured ticks or when user is on clock', () => {
    expect(hookSrc).toMatch(/shouldRefreshQueue/)
    expect(hookSrc).toMatch(/includeQueue: shouldRefreshQueue/)
  })
})

// Behavior 10 — Timer/currentPick from snapshot or live-sync
describe('live-sync — session and timer merged via mergeDraftSessionSnapshot (Behavior 10)', () => {
  it('live-sync uses mergeDraftSessionSnapshot (not direct setSession) for session updates', () => {
    expect(hookSrc).toMatch(/mergeDraftSessionSnapshot\(prev, data\.session/)
  })

  it('live-sync passes since= from sessionRef.current.updatedAt (anti-stale)', () => {
    expect(hookSrc).toMatch(/sessionRef\.current\?\.updatedAt/)
    expect(hookSrc).toMatch(/if \(opts\.since\) sp\.set\('since'/)
  })
})

// Behavior 11 — Failed pick does not advance local current pick (source invariant)
describe('handleMakePick — failure path does not advance clock (Behavior 11)', () => {
  it('failure else branch does not call setSession(null) or advance pick count', () => {
    const elseSection = makePickSrc.slice(
      makePickSrc.indexOf('} else {'),
      makePickSrc.indexOf('} catch'),
    )
    expect(elseSection).not.toMatch(/setSession\(null\)/)
    expect(elseSection).not.toMatch(/currentPickNumber\s*\+[+=]/)
  })

  it('pickInflightRef prevents double-submission on rapid clicks', () => {
    expect(makePickSrc).toMatch(/if \(pickInflightRef\.current\) return/)
  })
})

// Behavior 12 — Failed queue save does not corrupt queue
describe('handleQueueSave — failure falls back to server state (Behavior 12)', () => {
  it('failure path calls fetchQueue() — never setQueue(null)', () => {
    expect(queueSaveSrc).toMatch(/await fetchQueue\(\)/)
    expect(queueSaveSrc).not.toMatch(/setQueue\(null\)/)
  })

  it('session state is never touched by handleQueueSave', () => {
    expect(queueSaveSrc).not.toMatch(/setSession/)
  })
})

// Behavior 13 — Live-sync does not revert stale data (pure fn above + source checks)
describe('live-sync — controlActionInflightRef guard prevents stale merge (Behavior 13)', () => {
  it('live-sync skips session merge when controlActionInflightRef.current > 0', () => {
    expect(hookSrc).toMatch(/controlActionInflightRef\.current === 0/)
    const match = hookSrc.match(
      /if \(data\.session && controlActionInflightRef\.current === 0\)/,
    )
    expect(match).not.toBeNull()
  })
})

// Behavior 14 — InitialSnapshot visible if live-sync fails (source invariant)
describe('fetchLiveSync — board stays visible on live-sync failure (Behavior 14)', () => {
  it('fetchLiveSync returns false on non-ok — never calls setSession(null)', () => {
    const fetchLiveSyncMatch = hookSrc.match(
      /const fetchLiveSync = useCallback\([\s\S]*?\},\s*\[leagueId\],?\s*\)/,
    )
    const fetchLiveSyncSrc = fetchLiveSyncMatch?.[0] ?? ''
    expect(fetchLiveSyncSrc).toMatch(/if \(!res\.ok\) return false/)
    expect(fetchLiveSyncSrc).not.toMatch(/setSession\(null\)/)
  })
})

// Behavior 15 — Commissioner force-autopick through useCommissionerActions
describe('useCommissionerActions — force_autopick wired from DraftRoomPageClient (Behavior 15)', () => {
  it('DraftRoomPageClient imports and calls useCommissionerActions', () => {
    expect(clientSrc).toMatch(/from '@\/hooks\/useCommissionerActions'/)
    expect(clientSrc).toMatch(/useCommissionerActions\(/)
  })

  it('DraftRoomPageClient destructures handleCommissionerAction from the hook', () => {
    expect(clientSrc).toMatch(/handleCommissionerAction.*=[\s\S]*?useCommissionerActions\(/)
  })

  it('force_autopick success copy is Auto-pick executed', () => {
    expect(commSrc).toMatch(/force_autopick[\s\S]*?Auto-pick executed/)
  })

  it('useCommissionerActions POSTs to controls endpoint with { action, ...payload }', () => {
    expect(commSrc).toMatch(/\/api\/leagues\/.*\/draft\/controls/)
    expect(commSrc).toMatch(/JSON\.stringify\(\{ action, \.\.\.payload \}\)/)
  })
})

// Behavior 16 — AutopickMeToggle updates viewerAutopick locally
describe('AutopickMeToggle and handleAutopickMeUpdate (Behavior 16)', () => {
  it('handleAutopickMeUpdate updates session.viewerAutopick via setSession', () => {
    expect(clientSrc).toMatch(/viewerAutopick: updated/)
    expect(clientSrc).toMatch(/handleAutopickMeUpdate/)
  })

  it('AutopickMeToggle is mounted with viewerAutopick={session.viewerAutopick}', () => {
    expect(clientSrc).toMatch(/viewerAutopick=\{session\.viewerAutopick\}/)
  })

  it('viewerAutopick is part of DraftSessionSnapshot type', () => {
    const typesSrc = readFileSync(resolve(root, 'lib/live-draft-engine/types.ts'), 'utf8')
    expect(typesSrc).toMatch(/viewerAutopick\?:/)
    expect(typesSrc).toMatch(/enabled: boolean/)
    expect(typesSrc).toMatch(/mode: 'standard' \| 'ai_queue'/)
  })

  it('AutopickMeToggle posts to canonical autopick/me endpoint', () => {
    expect(autopickSrc).toMatch(/\/api\/leagues\/.*\/draft\/autopick\/me/)
  })
})

// Behavior 17 — No legacy endpoints in the full loop
describe('full loop — no legacy draft endpoints used anywhere (Behavior 17)', () => {
  const legacyEndpoints = [
    /fetch\(['"`]\/api\/draft\/session['"`]/,
    /fetch\(['"`]\/api\/draft\/pick['"`]/,
    /fetch\(['"`]\/api\/draft\/queue['"`]/,
    /fetch\(['"`]\/api\/draft\/controls['"`]/,
    /\/api\/draft\/autopick\/toggle/,
    /fetch\(['"`]\/api\/draft\/live-sync['"`]/,
  ]

  it('useLiveDraftSync references no legacy endpoints', () => {
    for (const re of legacyEndpoints) {
      expect(hookSrc).not.toMatch(re)
    }
  })

  it('useCommissionerActions references no legacy endpoints', () => {
    for (const re of legacyEndpoints) {
      expect(commSrc).not.toMatch(re)
    }
  })

  it('AutopickMeToggle references no legacy endpoints', () => {
    for (const re of legacyEndpoints) {
      expect(autopickSrc).not.toMatch(re)
    }
  })

  it('all fetch calls in useLiveDraftSync use the canonical /api/leagues/ prefix', () => {
    const fetchCalls = [...hookSrc.matchAll(/fetch\(`([^`]+)`/g)]
    for (const m of fetchCalls) {
      expect(m[1]).toMatch(/\/api\/leagues\//)
    }
  })

  it('all fetch calls in useCommissionerActions use the canonical /api/leagues/ prefix', () => {
    const fetchCalls = [...commSrc.matchAll(/fetch\(`([^`]+)`/g)]
    for (const m of fetchCalls) {
      expect(m[1]).toMatch(/\/api\/leagues\//)
    }
  })

  it('DraftRoomPageClient handleMakePick uses canonical endpoint', () => {
    expect(makePickSrc).not.toMatch(/['"`]\/api\/draft\/pick['"`]/)
    expect(makePickSrc).toMatch(/\/api\/leagues\//)
  })

  it('DraftRoomPageClient handleQueueSave uses canonical endpoint', () => {
    expect(queueSaveSrc).not.toMatch(/['"`]\/api\/draft\/queue['"`]/)
    expect(queueSaveSrc).toMatch(/\/api\/leagues\//)
  })
})

// Behavior 18 — NFL and NBA playerId flows work
describe('playerId wiring through pick → drafted detection (Behavior 18)', () => {
  it('stablePlayerId is resolved from player.display.playerId or player.playerId', () => {
    expect(makePickSrc).toMatch(/display\?\.playerId/)
    expect(makePickSrc).toMatch(/stablePlayerId/)
  })

  it('stablePlayerId is included in the pick POST body as playerId field', () => {
    expect(makePickSrc).toMatch(/playerId: stablePlayerId/)
  })

  it('draftedPlayerIds uses p.playerId from picks (stable ID detection)', () => {
    expect(clientSrc).toMatch(/if \(p\.playerId\) s\.add\(String\(p\.playerId\)/)
  })

  it('isPickCommitAllowed blocks by playerId matching draftedPlayerIds (blocks drafted player)', () => {
    // Pure function test confirms this; source invariant locks the call site
    expect(makePickSrc).toMatch(/isPickCommitAllowed\(\{/)
    expect(makePickSrc).toMatch(/draftedPlayerIds/)
  })

  it('isPickCommitAllowedByName provides name-based fallback when no stable id', () => {
    expect(makePickSrc).toMatch(/isPickCommitAllowedByName\(\{/)
    expect(makePickSrc).toMatch(/draftedNames/)
  })
})
