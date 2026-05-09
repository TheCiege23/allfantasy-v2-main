/**
 * useCommissionerActions — source invariants
 *
 * Locks the 10 behavioral contracts of the commissioner actions hook:
 *   1. pause posts { action: 'pause' } to /api/leagues/[leagueId]/draft/controls
 *   2. resume posts { action: 'resume' }
 *   3. undo_pick posts { action: 'undo_pick' }
 *   4. force_autopick posts { action: 'force_autopick' }
 *   5. success response merges session snapshot via mergeDraftSessionSnapshot
 *   6. failure restores priorSession and sets error banner
 *   7. controlActionInflightRef is incremented before the fetch and decremented in finally
 *   8. DraftRoomPageClient imports and uses useLiveDraftSync (regression lock)
 *   9. DraftRoomPageClient imports and uses useCommissionerActions
 *  10. undo_pick confirm-cancelled path returns { ok: false, cancelled: true } without fetching
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const src = readFileSync(resolve(root, 'hooks/useCommissionerActions.ts'), 'utf8')
const clientSrc = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)

// ---------------------------------------------------------------------------
// 1–4: Action payloads posted to the controls endpoint
// ---------------------------------------------------------------------------

describe('useCommissionerActions — posts to canonical controls endpoint', () => {
  it('posts to /api/leagues/[leagueId]/draft/controls', () => {
    expect(src).toMatch(/\/api\/leagues\/.*\/draft\/controls/)
  })

  it('uses POST method', () => {
    expect(src).toMatch(/method: 'POST'/)
  })

  it('sends JSON body with action spread into payload', () => {
    expect(src).toMatch(/JSON\.stringify\(\{ action, \.\.\.payload \}\)/)
  })

  it('uses encodeURIComponent on leagueId', () => {
    expect(src).toMatch(/encodeURIComponent\(leagueId\)/)
  })
})

describe('useCommissionerActions — pause action payload', () => {
  it('optimistic patch sets status to paused', () => {
    expect(src).toMatch(/action === 'pause'/)
    expect(src).toMatch(/status: 'paused'/)
  })

  it('sets pauseReason to commissioner in optimistic timer patch', () => {
    expect(src).toMatch(/pauseReason: 'commissioner'/)
  })
})

describe('useCommissionerActions — resume action payload', () => {
  it('optimistic patch sets status to in_progress', () => {
    expect(src).toMatch(/action === 'resume'/)
    expect(src).toMatch(/status: 'in_progress'/)
  })

  it('clears pausedRemainingSeconds on resume', () => {
    expect(src).toMatch(/pausedRemainingSeconds: null/)
  })
})

describe('useCommissionerActions — undo_pick action', () => {
  it('fetchChat and fetchDraftPool are called after undo_pick', () => {
    const match = src.match(
      /if \(action === 'undo_pick'\) \{[\s\S]*?fetchChat\(\)[\s\S]*?fetchDraftPool\(\)/
    )
    expect(match).not.toBeNull()
  })

  it('fetchDraftAssistantContext is called after undo_pick', () => {
    const match = src.match(
      /if \(action === 'undo_pick'\) \{[\s\S]*?fetchDraftAssistantContext\(\)/
    )
    expect(match).not.toBeNull()
  })
})

describe('useCommissionerActions — force_autopick success copy', () => {
  it('success copy for force_autopick mentions auto-pick', () => {
    expect(src).toMatch(/force_autopick[\s\S]*?Auto-pick executed/)
  })
})

// ---------------------------------------------------------------------------
// 5: Success applies returned session snapshot
// ---------------------------------------------------------------------------

describe('useCommissionerActions — success merges session snapshot', () => {
  it('calls mergeDraftSessionSnapshot when data.session is present', () => {
    expect(src).toMatch(/mergeDraftSessionSnapshot\(prev, data\.session/)
  })

  it('falls back to fetchSession when data.session is absent', () => {
    expect(src).toMatch(/usedSessionFallback = true/)
    expect(src).toMatch(/await fetchSession\(\)/)
  })

  it('sets success governance banner after successful action', () => {
    expect(src).toMatch(/setGovernanceBanner\(\{ variant: 'success'/)
  })
})

// ---------------------------------------------------------------------------
// 6: Failure restores prior session and reports error banner
// ---------------------------------------------------------------------------

describe('useCommissionerActions — failure restores session and shows error', () => {
  it('restores priorSession on non-ok response', () => {
    const match = src.match(
      /if \(!res\.ok\) \{[\s\S]*?setGovernanceBanner\(\{ variant: 'error'[\s\S]*?if \(priorSession\) setSession\(priorSession\)/
    )
    expect(match).not.toBeNull()
  })

  it('restores priorSession on network error (catch block)', () => {
    const match = src.match(
      /} catch \{[\s\S]*?setGovernanceBanner\(\{ variant: 'error'[\s\S]*?if \(priorSession\) setSession\(priorSession\)/
    )
    expect(match).not.toBeNull()
  })

  it('network error message references trying again', () => {
    expect(src).toMatch(/Network error — try your commissioner action again/)
  })
})

// ---------------------------------------------------------------------------
// 7: controlActionInflightRef incremented before fetch, decremented in finally
// ---------------------------------------------------------------------------

describe('useCommissionerActions — controlActionInflightRef lifecycle', () => {
  it('increments controlActionInflightRef.current at the start of the action', () => {
    expect(src).toMatch(/controlActionInflightRef\.current \+= 1/)
  })

  it('decrements controlActionInflightRef.current in the finally block', () => {
    const match = src.match(
      /} finally \{[\s\S]*?controlActionInflightRef\.current = Math\.max\(0, controlActionInflightRef\.current - 1\)/
    )
    expect(match).not.toBeNull()
  })

  it('sets commissionerLoading to false in the finally block', () => {
    const match = src.match(/} finally \{[\s\S]*?setCommissionerLoading\(false\)/)
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 8: DraftRoomPageClient still uses useLiveDraftSync (regression lock)
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — useLiveDraftSync regression lock', () => {
  it('still imports useLiveDraftSync', () => {
    expect(clientSrc).toMatch(/from '@\/hooks\/useLiveDraftSync'/)
  })

  it('still calls useLiveDraftSync in the component body', () => {
    expect(clientSrc).toMatch(/useLiveDraftSync\(/)
  })
})

// ---------------------------------------------------------------------------
// 9: DraftRoomPageClient imports and calls useCommissionerActions
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — useCommissionerActions wiring', () => {
  it('imports useCommissionerActions from the hook', () => {
    expect(clientSrc).toMatch(/from '@\/hooks\/useCommissionerActions'/)
  })

  it('destructures handleCommissionerAction from the hook return', () => {
    expect(clientSrc).toMatch(/handleCommissionerAction.*=[\s\S]*?useCommissionerActions\(/)
  })

  it('passes controlActionInflightRef to the hook', () => {
    const match = clientSrc.match(/useCommissionerActions\(\{[\s\S]*?controlActionInflightRef/)
    expect(match).not.toBeNull()
  })

  it('passes setGovernanceBanner to the hook', () => {
    const match = clientSrc.match(/useCommissionerActions\(\{[\s\S]*?setGovernanceBanner/)
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 10: undo_pick cancelled path — no fetch, returns cancelled: true
// ---------------------------------------------------------------------------

describe('useCommissionerActions — handleCommissionerUndoPick cancel path', () => {
  it('returns { ok: false, cancelled: true } when confirm is rejected', () => {
    expect(src).toMatch(/cancelled: true/)
  })

  it('returns without calling handleCommissionerAction when cancelled', () => {
    const match = src.match(
      /!window\.confirm\([\s\S]*?\) \{[\s\S]*?return Promise\.resolve\(\{ ok: false[\s\S]*?cancelled: true[\s\S]*?\}\)/
    )
    expect(match).not.toBeNull()
  })
})
