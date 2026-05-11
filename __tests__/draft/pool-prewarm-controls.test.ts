/**
 * Pool prewarm / resume-fast-path invariants.
 *
 * Root cause fixed:
 *   ensureDraftPoolReady ran a 60–90 s synchronous cold build inside the
 *   resume/start POST. Two concurrent cold builds (pool GET + controls POST)
 *   hit the same serverless function instances, causing DB contention and
 *   blocking the resume response for 90 s.
 *
 * New behavior:
 *   - checkDraftPoolCacheFast: DB-only check, returns in <50 ms.
 *   - Cold path: triggerDraftPoolPrewarmBackground fires fire-and-forget,
 *     returns POOL_NOT_READY (503) immediately.
 *   - Warm path: resume proceeds without building the pool.
 *   - pause: no pool check at all.
 *   - [draft-perf] logs at every decision point.
 *
 * Invariants locked:
 *   1.  checkDraftPoolCacheFast is exported from ensureDraftPoolReady.ts.
 *   2.  checkDraftPoolCacheFast does NOT call getResolvedDraftPoolForLeague.
 *   3.  triggerDraftPoolPrewarmBackground is exported and calls ensureDraftPoolReady.
 *   4.  Controls resume uses checkDraftPoolCacheFast, NOT ensureDraftPoolReady directly.
 *   5.  Controls start uses checkDraftPoolCacheFast, NOT ensureDraftPoolReady directly.
 *   6.  Cold resume: triggerDraftPoolPrewarmBackground called + POOL_NOT_READY 503 returned.
 *   7.  Cold resume: resumeDraftSession is NOT called (timer does not start).
 *   8.  Warm resume: resumeDraftSession IS called.
 *   9.  Cold start: triggerDraftPoolPrewarmBackground called + POOL_NOT_READY 503.
 *   10. Warm start: startDraftSession IS called.
 *   11. Pause: no checkDraftPoolCacheFast call at all.
 *   12. [draft-perf] log emitted by checkDraftPoolCacheFast.
 *   13. Pool route strips diagnostic-only fields from display.stats and display.metadata.
 *   14. Pool route still includes required fields: display.assets.headshotUrl, display.stats.fantasyPointsPerGame.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const root = resolve(__dirname, '..', '..')
const prewarmSrc = readFileSync(resolve(root, 'lib/draft-room/ensureDraftPoolReady.ts'), 'utf8')
const controlsSrc = readFileSync(
  resolve(root, 'app/api/leagues/[leagueId]/draft/controls/route.ts'),
  'utf8',
)
const poolRouteSrc = readFileSync(
  resolve(root, 'app/api/leagues/[leagueId]/draft/pool/route.ts'),
  'utf8',
)

// ---------------------------------------------------------------------------
// Invariant 1-3: ensureDraftPoolReady module exports
// ---------------------------------------------------------------------------

describe('Invariant 1: checkDraftPoolCacheFast is exported', () => {
  it('exports checkDraftPoolCacheFast function', () => {
    expect(prewarmSrc).toContain('export async function checkDraftPoolCacheFast(')
  })
})

describe('Invariant 2: checkDraftPoolCacheFast does not cold-build', () => {
  it('checkDraftPoolCacheFast body contains NO call to getResolvedDraftPoolForLeague', () => {
    const funcStart = prewarmSrc.indexOf('export async function checkDraftPoolCacheFast(')
    // Next exported function starts at triggerDraftPoolPrewarmBackground
    const funcEnd = prewarmSrc.indexOf('\nexport function triggerDraftPoolPrewarmBackground(')
    const body = prewarmSrc.slice(funcStart, funcEnd)
    expect(body).not.toContain('getResolvedDraftPoolForLeague')
  })

  it('checkDraftPoolCacheFast only does a DB findFirst query', () => {
    const funcStart = prewarmSrc.indexOf('export async function checkDraftPoolCacheFast(')
    const funcEnd = prewarmSrc.indexOf('\nexport function triggerDraftPoolPrewarmBackground(')
    const body = prewarmSrc.slice(funcStart, funcEnd)
    expect(body).toContain('model.findFirst(')
  })

  it('checkDraftPoolCacheFast emits [draft-perf] log', () => {
    const funcStart = prewarmSrc.indexOf('export async function checkDraftPoolCacheFast(')
    const funcEnd = prewarmSrc.indexOf('\nexport function triggerDraftPoolPrewarmBackground(')
    const body = prewarmSrc.slice(funcStart, funcEnd)
    expect(body).toContain('[draft-perf]')
  })
})

describe('Invariant 3: triggerDraftPoolPrewarmBackground fires ensureDraftPoolReady', () => {
  it('exports triggerDraftPoolPrewarmBackground', () => {
    expect(prewarmSrc).toContain('export function triggerDraftPoolPrewarmBackground(')
  })

  it('background trigger calls ensureDraftPoolReady', () => {
    const funcStart = prewarmSrc.indexOf('export function triggerDraftPoolPrewarmBackground(')
    const funcEnd = prewarmSrc.indexOf('\nexport async function ensureDraftPoolReady(')
    const body = prewarmSrc.slice(funcStart, funcEnd)
    expect(body).toContain('ensureDraftPoolReady(leagueId)')
  })

  it('background trigger emits [draft-perf] log when done', () => {
    const funcStart = prewarmSrc.indexOf('export function triggerDraftPoolPrewarmBackground(')
    const funcEnd = prewarmSrc.indexOf('\nexport async function ensureDraftPoolReady(')
    const body = prewarmSrc.slice(funcStart, funcEnd)
    expect(body).toContain('[draft-perf]')
  })
})

// ---------------------------------------------------------------------------
// Invariant 4-5: controls route uses fast check, not blocking build
// ---------------------------------------------------------------------------

describe('Invariant 4: controls resume uses checkDraftPoolCacheFast not ensureDraftPoolReady directly', () => {
  it('imports checkDraftPoolCacheFast from the prewarm lib', () => {
    expect(controlsSrc).toContain('checkDraftPoolCacheFast')
    expect(controlsSrc).toContain("from '@/lib/draft-room/ensureDraftPoolReady'")
  })

  it('resume branch calls checkDraftPoolCacheFast', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    expect(resumeIdx).toBeGreaterThan(-1)
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 600)
    expect(block).toContain('checkDraftPoolCacheFast(leagueId)')
  })

  it('resume branch does NOT call ensureDraftPoolReady synchronously (await)', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 600)
    // Should NOT have "await ensureDraftPoolReady" — that was the blocking path
    expect(block).not.toMatch(/await ensureDraftPoolReady/)
  })
})

describe('Invariant 5: controls start uses checkDraftPoolCacheFast not ensureDraftPoolReady directly', () => {
  it('start branch calls checkDraftPoolCacheFast', () => {
    const startIdx = controlsSrc.indexOf("if (action === 'start')")
    expect(startIdx).toBeGreaterThan(-1)
    const block = controlsSrc.slice(startIdx, startIdx + 600)
    expect(block).toContain('checkDraftPoolCacheFast(leagueId)')
  })

  it('start branch does NOT await ensureDraftPoolReady synchronously', () => {
    const startIdx = controlsSrc.indexOf("if (action === 'start')")
    const block = controlsSrc.slice(startIdx, startIdx + 600)
    expect(block).not.toMatch(/await ensureDraftPoolReady/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 6-7: cold path returns POOL_NOT_READY immediately
// ---------------------------------------------------------------------------

describe('Invariant 6: cold resume triggers background prewarm + returns POOL_NOT_READY', () => {
  it('resume cold path calls triggerDraftPoolPrewarmBackground', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 900)
    expect(block).toContain('triggerDraftPoolPrewarmBackground(leagueId)')
  })

  it('resume cold path returns 503 POOL_NOT_READY', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 900)
    expect(block).toContain('POOL_NOT_READY')
    expect(block).toContain('503')
  })

  it('resume cold path includes warming:true in the 503 response', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 900)
    expect(block).toContain('warming: true')
  })
})

describe('Invariant 7: cold resume does NOT call resumeDraftSession (timer does not start)', () => {
  it('triggerDraftPoolPrewarmBackground is called before any resumeDraftSession call in resume branch', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 1000)
    const bgIdx = block.indexOf('triggerDraftPoolPrewarmBackground')
    const returnIdx = block.indexOf('return NextResponse.json')
    const resumeDraftIdx = block.indexOf('resumeDraftSession')
    // background trigger fires and 503 is returned BEFORE resumeDraftSession is called
    expect(bgIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(bgIdx)
    // resumeDraftSession appears AFTER the cold-path return block (warm path only)
    expect(resumeDraftIdx).toBeGreaterThan(returnIdx)
  })
})

// ---------------------------------------------------------------------------
// Invariant 8-10: warm path and start path
// ---------------------------------------------------------------------------

describe('Invariant 8: warm resume calls resumeDraftSession', () => {
  it('resume branch contains resumeDraftSession(leagueId) after the warm-cache check', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 1200)
    expect(block).toContain('resumeDraftSession(leagueId)')
  })
})

describe('Invariant 9: cold start fires background prewarm + returns POOL_NOT_READY', () => {
  it('start cold path calls triggerDraftPoolPrewarmBackground', () => {
    const startIdx = controlsSrc.indexOf("if (action === 'start')")
    const block = controlsSrc.slice(startIdx, startIdx + 700)
    expect(block).toContain('triggerDraftPoolPrewarmBackground(leagueId)')
  })

  it('start cold path returns 503 POOL_NOT_READY', () => {
    const startIdx = controlsSrc.indexOf("if (action === 'start')")
    const block = controlsSrc.slice(startIdx, startIdx + 700)
    expect(block).toContain('POOL_NOT_READY')
    expect(block).toContain('503')
  })
})

describe('Invariant 10: warm start calls startDraftSession', () => {
  it('start branch contains startDraftSession(leagueId) after the warm-cache check', () => {
    const startIdx = controlsSrc.indexOf("if (action === 'start')")
    const block = controlsSrc.slice(startIdx, startIdx + 800)
    expect(block).toContain('startDraftSession(leagueId)')
  })
})

// ---------------------------------------------------------------------------
// Invariant 11: pause never checks pool cache
// ---------------------------------------------------------------------------

describe("Invariant 11: pause branch has no pool cache check", () => {
  it("pause branch does not call checkDraftPoolCacheFast", () => {
    const pauseIdx = controlsSrc.indexOf("if (action === 'pause')")
    expect(pauseIdx).toBeGreaterThan(-1)
    // End of pause block is at the next if (action === 'resume')
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const pauseBlock = controlsSrc.slice(pauseIdx, resumeIdx)
    expect(pauseBlock).not.toContain('checkDraftPoolCacheFast')
    expect(pauseBlock).not.toContain('ensureDraftPoolReady')
    expect(pauseBlock).not.toContain('triggerDraftPoolPrewarmBackground')
  })
})

// ---------------------------------------------------------------------------
// Invariant 12: [draft-perf] logs in controls resume path
// ---------------------------------------------------------------------------

describe('Invariant 12: [draft-perf] logs in resume and cache check', () => {
  it('resume branch emits [draft-perf] log for cache check', () => {
    const resumeIdx = controlsSrc.indexOf("if (action === 'resume')")
    const block = controlsSrc.slice(resumeIdx, resumeIdx + 800)
    expect(block).toContain('[draft-perf]')
  })

  it('ensureDraftPoolReady emits [draft-perf] log for cold build duration', () => {
    expect(prewarmSrc).toMatch(/\[draft-perf\].*cold build/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 13-14: pool route payload strip (P1 slim)
// ---------------------------------------------------------------------------

describe('Invariant 13: pool route strips diagnostic-only nested fields', () => {
  it('stripPoolEntryFallbacks strips rollingInsightsSupplemental from display.stats', () => {
    expect(poolRouteSrc).toContain('rollingInsightsSupplemental')
    // Must appear in the strip function (destructuring)
    const stripFnIdx = poolRouteSrc.indexOf('function stripPoolEntryFallbacks(')
    const stripBody = poolRouteSrc.slice(stripFnIdx, stripFnIdx + 1700)
    expect(stripBody).toContain('rollingInsightsSupplemental')
  })

  it('stripPoolEntryFallbacks strips projectionSource from display.stats', () => {
    const stripFnIdx = poolRouteSrc.indexOf('function stripPoolEntryFallbacks(')
    const stripBody = poolRouteSrc.slice(stripFnIdx, stripFnIdx + 1700)
    expect(stripBody).toContain('projectionSource')
  })

  it('stripPoolEntryFallbacks strips rookieYearsExpSource from display.metadata', () => {
    const stripFnIdx = poolRouteSrc.indexOf('function stripPoolEntryFallbacks(')
    const stripBody = poolRouteSrc.slice(stripFnIdx, stripFnIdx + 1700)
    expect(stripBody).toContain('rookieYearsExpSource')
  })
})

describe('Invariant 14: strip function still preserves required SleeperPoolTable fields', () => {
  it('display.assets.headshotUrl is not stripped', () => {
    const stripFnIdx = poolRouteSrc.indexOf('function stripPoolEntryFallbacks(')
    const stripBody = poolRouteSrc.slice(stripFnIdx, stripFnIdx + 1700)
    // headshotUrl should NOT appear as a destructured stripped key
    // The strip removes headshotFallbackUrl, not headshotUrl
    expect(stripBody).not.toMatch(/headshotUrl:\s*_/)
    expect(stripBody).toContain('headshotFallbackUrl')
  })

  it('display.stats is only partially stripped (not entire stats object)', () => {
    const stripFnIdx = poolRouteSrc.indexOf('function stripPoolEntryFallbacks(')
    const stripBody = poolRouteSrc.slice(stripFnIdx, stripFnIdx + 1700)
    // The strip destructures stats but spreads ...stats (keeping fantasyPointsPerGame etc)
    expect(stripBody).toMatch(/\.\.\.stats\b/)
  })

  it('display.metadata is only partially stripped (not entire metadata object)', () => {
    const stripFnIdx = poolRouteSrc.indexOf('function stripPoolEntryFallbacks(')
    const stripBody = poolRouteSrc.slice(stripFnIdx, stripFnIdx + 1700)
    expect(stripBody).toMatch(/\.\.\.metadata\b/)
  })
})

// ---------------------------------------------------------------------------
// Behavioral: controls route mock tests
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() =>
  vi.fn(async () => ({ user: { id: 'commissioner-1' } } as null | { user?: { id?: string } })),
)
const assertLeagueActionGateMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const })),
)
const checkDraftPoolCacheFastMock = vi.hoisted(() =>
  vi.fn(async (_leagueId: string) => ({ warm: true })),
)
const triggerDraftPoolPrewarmBackgroundMock = vi.hoisted(() => vi.fn((_leagueId: string) => {}))
const startDraftSessionMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })))
const resumeDraftSessionMock = vi.hoisted(() => vi.fn(async () => true))
const buildSessionSnapshotMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('next-auth', () => ({
  getServerSession: (...a: unknown[]) => getServerSessionMock(...a),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/server/services/leagueActionGate', () => ({
  assertLeagueActionGate: (...a: unknown[]) => assertLeagueActionGateMock(...a),
}))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  checkDraftPoolCacheFast: (...a: [string]) => checkDraftPoolCacheFastMock(...a),
  triggerDraftPoolPrewarmBackground: (...a: [string]) => triggerDraftPoolPrewarmBackgroundMock(...a),
  ensureDraftPoolReady: vi.fn(async () => ({ ok: true, source: 'db-cache' as const })),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  startDraftSession: (...a: [string]) => startDraftSessionMock(...a),
  resumeDraftSession: (...a: [string]) => resumeDraftSessionMock(...a),
  pauseDraftSession: vi.fn(async () => true),
  buildSessionSnapshot: (...a: unknown[]) => buildSessionSnapshotMock(...a),
  resetTimer: vi.fn(async () => true),
  undoLastPick: vi.fn(async () => false),
  swapDraftManagers: vi.fn(async () => ({ ok: false, code: 'NO_SESSION', error: 'no session' })),
  completeDraftSession: vi.fn(async () => false),
  resetDraftSession: vi.fn(async () => false),
  setTimerSeconds: vi.fn(async () => false),
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: vi.fn(async () => ({ success: false, error: 'unused' })),
}))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: vi.fn(async () => {}),
  finalizeRosterAssignments: vi.fn(async () => {}),
}))
vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({
  runSlowDraftAutomationTick: vi.fn(async () => ({ changed: false, actions: [] })),
}))
vi.mock('@/lib/live-draft-engine/auction', () => ({
  runAuctionAutomationTick: vi.fn(async () => ({ changed: false, actions: [] })),
}))
vi.mock('@/lib/live-draft-engine/keeper', () => ({
  runKeeperAutomationTick: vi.fn(async () => ({ changed: false, actions: [] })),
}))
vi.mock('@/lib/draft-notifications', () => ({
  notifyDraftStartingSoon: vi.fn(async () => {}),
  notifyDraftResumed: vi.fn(async () => {}),
  notifyDraftPaused: vi.fn(async () => {}),
  notifyDraftIntelOnClockUrgent: vi.fn(async () => {}),
  notifyDraftIntelQueueReady: vi.fn(async () => {}),
  notifyDraftIntelPickConfirmation: vi.fn(async () => {}),
  notifyDraftIntelPlayerTaken: vi.fn(async () => {}),
  notifyDraftIntelTierBreak: vi.fn(async () => {}),
  notifyDraftIntelOrphanTeamPick: vi.fn(async () => {}),
  notifyAutoPickFired: vi.fn(async () => {}),
  notifyOnTheClockAfterPick: vi.fn(async () => {}),
  notifyQueuePlayerUnavailable: vi.fn(async () => {}),
  notifyDraftIntelPostDraftRecap: vi.fn(async () => {}),
  getLeagueMemberAppUserIds: vi.fn(async () => []),
}))
vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn(async () => []),
  sendDraftIntelDm: vi.fn(async () => {}),
  publishDraftIntelRecap: vi.fn(async () => null),
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  getCurrentUserRosterIdForLeague: vi.fn(async () => null),
}))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({
  getOrphanRosterIdsForLeague: vi.fn(async () => []),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    commissionerPauseControlsEnabled: true,
    commissionerForceAutoPickEnabled: true,
    autoPickEnabled: true,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu',
    timerMode: 'normal',
  })),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => null),
}))
vi.mock('@/lib/provider-config', () => ({
  getProviderStatus: () => ({ anyAi: false }),
}))
vi.mock('@/lib/league/roster-configuration-gate-error', () => ({
  rosterConfigurationIncompleteBody: () => ({ error: 'incomplete' }),
  DRAFT_ROSTER_CONFIGURATION_CLIENT_MESSAGE: 'incomplete',
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = vi.fn(async () => ({ hasAccess: false }))
  },
}))
vi.mock('@/lib/live-draft-engine/LiveDraftAutopickPreferenceService', () => ({
  getViewerAutopickPreference: vi.fn(async () => ({
    enabled: false,
    mode: 'standard',
    isProEligible: false,
    updatedAt: null,
  })),
}))
vi.mock('@/lib/adp-data', () => ({ getLiveADP: vi.fn(async () => []) }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: vi.fn(async () => []),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: vi.fn(async () => null) },
    roster: { findUnique: vi.fn(async () => null) },
    league: { findUnique: vi.fn(async () => null) },
    draftPickAuditLog: { create: vi.fn(async () => ({})) },
  },
}))

import { NextRequest } from 'next/server'

const { POST: controlsPOST } = await import(
  '@/app/api/leagues/[leagueId]/draft/controls/route'
)

function makeReq(action: string, leagueId = 'league-1') {
  return [
    new NextRequest(`http://localhost/api/leagues/${leagueId}/draft/controls`, {
      method: 'POST',
      body: JSON.stringify({ action }),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ leagueId }) },
  ] as const
}

beforeEach(() => {
  vi.clearAllMocks()
  checkDraftPoolCacheFastMock.mockResolvedValue({ warm: true })
  startDraftSessionMock.mockResolvedValue({ ok: true })
  resumeDraftSessionMock.mockResolvedValue(true)
})

describe('Behavioral: warm resume calls resumeDraftSession and does not return 503', () => {
  it('calls checkDraftPoolCacheFast before resumeDraftSession', async () => {
    const [req, ctx] = makeReq('resume')
    await controlsPOST(req, ctx)
    expect(checkDraftPoolCacheFastMock).toHaveBeenCalledWith('league-1')
    const checkOrder = checkDraftPoolCacheFastMock.mock.invocationCallOrder[0]
    const resumeOrder = resumeDraftSessionMock.mock.invocationCallOrder[0]
    expect(checkOrder).toBeLessThan(resumeOrder)
  })

  it('does not trigger background prewarm on warm cache', async () => {
    const [req, ctx] = makeReq('resume')
    await controlsPOST(req, ctx)
    expect(triggerDraftPoolPrewarmBackgroundMock).not.toHaveBeenCalled()
  })
})

describe('Behavioral: cold resume returns 503 immediately, does NOT call resumeDraftSession', () => {
  it('returns 503 POOL_NOT_READY when cache is cold', async () => {
    checkDraftPoolCacheFastMock.mockResolvedValueOnce({ warm: false })
    const [req, ctx] = makeReq('resume')
    const res = await controlsPOST(req, ctx)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('POOL_NOT_READY')
    expect(body.warming).toBe(true)
  })

  it('does NOT call resumeDraftSession when cache is cold', async () => {
    checkDraftPoolCacheFastMock.mockResolvedValueOnce({ warm: false })
    const [req, ctx] = makeReq('resume')
    await controlsPOST(req, ctx)
    expect(resumeDraftSessionMock).not.toHaveBeenCalled()
  })

  it('calls triggerDraftPoolPrewarmBackground when cache is cold', async () => {
    checkDraftPoolCacheFastMock.mockResolvedValueOnce({ warm: false })
    const [req, ctx] = makeReq('resume')
    await controlsPOST(req, ctx)
    expect(triggerDraftPoolPrewarmBackgroundMock).toHaveBeenCalledWith('league-1')
  })
})

describe('Behavioral: cold start returns 503 immediately, does NOT call startDraftSession', () => {
  it('returns 503 POOL_NOT_READY when cache is cold', async () => {
    checkDraftPoolCacheFastMock.mockResolvedValueOnce({ warm: false })
    const [req, ctx] = makeReq('start')
    const res = await controlsPOST(req, ctx)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('POOL_NOT_READY')
  })

  it('does NOT call startDraftSession when cache is cold', async () => {
    checkDraftPoolCacheFastMock.mockResolvedValueOnce({ warm: false })
    const [req, ctx] = makeReq('start')
    await controlsPOST(req, ctx)
    expect(startDraftSessionMock).not.toHaveBeenCalled()
  })
})

describe('Behavioral: pause never checks pool cache', () => {
  it('does NOT call checkDraftPoolCacheFast on pause', async () => {
    const [req, ctx] = makeReq('pause')
    await controlsPOST(req, ctx)
    expect(checkDraftPoolCacheFastMock).not.toHaveBeenCalled()
  })

  it('does NOT call triggerDraftPoolPrewarmBackground on pause', async () => {
    const [req, ctx] = makeReq('pause')
    await controlsPOST(req, ctx)
    expect(triggerDraftPoolPrewarmBackgroundMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Invariant 15: draft room page triggers prewarm on cold cache
// ---------------------------------------------------------------------------

const draftPageSrc = readFileSync(resolve(root, 'app/drafts/[draftId]/page.tsx'), 'utf8')

describe('Invariant 15: drafts page imports prewarm helpers', () => {
  it('imports checkDraftPoolCacheFast', () => {
    expect(draftPageSrc).toContain('checkDraftPoolCacheFast')
    expect(draftPageSrc).toContain("from '@/lib/draft-room/ensureDraftPoolReady'")
  })

  it('imports triggerDraftPoolPrewarmBackground', () => {
    expect(draftPageSrc).toContain('triggerDraftPoolPrewarmBackground')
  })

  it('calls checkDraftPoolCacheFast with leagueId', () => {
    expect(draftPageSrc).toContain('checkDraftPoolCacheFast(context.leagueId)')
  })

  it('calls triggerDraftPoolPrewarmBackground on cold cache', () => {
    expect(draftPageSrc).toContain('triggerDraftPoolPrewarmBackground(context.leagueId)')
  })

  it('runs cache check concurrently with buildSessionSnapshot via Promise.all', () => {
    const promiseAllIdx = draftPageSrc.indexOf('Promise.all(')
    expect(promiseAllIdx).toBeGreaterThan(-1)
    // Both calls must appear INSIDE the Promise.all block (after it in source)
    const poolCheckCallIdx = draftPageSrc.indexOf('checkDraftPoolCacheFast(context.leagueId)')
    const snapshotCallIdx = draftPageSrc.indexOf('buildSessionSnapshot(')
    expect(poolCheckCallIdx).toBeGreaterThan(promiseAllIdx)
    expect(snapshotCallIdx).toBeGreaterThan(promiseAllIdx)
  })
})

// ---------------------------------------------------------------------------
// Invariant 16: warm script uses the same cache key version as pool route
// ---------------------------------------------------------------------------

const warmScriptSrc = readFileSync(resolve(root, 'scripts/draft-pool-cache-warm.ts'), 'utf8')

describe('Invariant 16: warm script cache key matches pool route (dbmerge_v4)', () => {
  it('warm script uses dbmerge_v4 in buildRouteCacheKey', () => {
    expect(warmScriptSrc).toContain('dbmerge_v4')
    expect(warmScriptSrc).not.toContain('dbmerge_v2')
  })

  it('pool route uses dbmerge_v4 in cacheKey', () => {
    expect(poolRouteSrc).toContain('dbmerge_v4')
    expect(poolRouteSrc).not.toContain('dbmerge_v2')
  })
})

// ---------------------------------------------------------------------------
// Invariant 17: pool cold build emits [draft-perf] timing log unconditionally
// ---------------------------------------------------------------------------

const resolvedPoolSrc = readFileSync(
  resolve(root, 'lib/draft-room/getResolvedDraftPoolForLeague.ts'),
  'utf8',
)

describe('Invariant 17: pool cold build always logs [draft-perf] timing', () => {
  it('logs [draft-perf] pool cold build done with totalMs', () => {
    expect(resolvedPoolSrc).toContain('[draft-perf] pool cold build done')
    expect(resolvedPoolSrc).toContain('totalMs')
  })

  it('timing log is NOT inside perfStart (runs unconditionally, not behind PERF_LOG)', () => {
    const logIdx = resolvedPoolSrc.indexOf('[draft-perf] pool cold build done')
    const perfStartIdx = resolvedPoolSrc.indexOf('function perfStart(')
    // The log must appear after the function definition (inside the function body),
    // not inside the perfStart helper
    expect(logIdx).toBeGreaterThan(perfStartIdx)
    // It must use console.info, not be wrapped in a perfStart closure
    const consoleIdx = resolvedPoolSrc.lastIndexOf('console.info', logIdx)
    expect(consoleIdx).toBeGreaterThan(-1)
    // Ensure the log is not gated by an if(PERF_LOG) block right before it
    const snippet = resolvedPoolSrc.slice(logIdx - 100, logIdx)
    expect(snippet).not.toMatch(/if\s*\(\s*PERF_LOG\s*\)/)
  })
})
