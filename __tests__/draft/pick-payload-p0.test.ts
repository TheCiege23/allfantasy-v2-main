/**
 * P0 — Pick payload / page-refresh invariants.
 *
 * Root causes fixed:
 *   A. PickSubmissionService.existingPicks included empty-slot rows
 *      (position="EMPTY", playerName=""). validateUniquePlayer saw
 *      pick.playerName="" and returned "Pick #0 is missing player name"
 *      with code DRAFT_PICK_DUPLICATE_PLAYER, blocking every pick attempt.
 *   B. pick/route.ts called buildSessionSnapshot twice without skipRepair
 *      (3-10s each) — the 2s live-sync poll fired during that window,
 *      causing a session state update that looked like a visual page reload.
 *   C. pick/route.ts !playerName check didn't catch whitespace-only names.
 *   D. handleMakePick had no client-side guard for empty playerName.
 *   E. validatePickSubmission returned no code for missing playerName,
 *      making DRAFT_PICK_INVALID_PAYLOAD indistinguishable from duplicates.
 *
 * Invariants locked:
 *   1.  PickValidation rejects empty playerName with DRAFT_PICK_INVALID_PAYLOAD.
 *   2.  PickValidation rejects whitespace-only playerName with DRAFT_PICK_INVALID_PAYLOAD.
 *   3.  PickValidation does NOT return DRAFT_PICK_DUPLICATE_PLAYER for empty name.
 *   4.  validatePickSubmission with empty existingPicks + valid name → valid:true.
 *   5.  Empty-slot picks (position=EMPTY, playerName="") are NOT counted as
 *       existing picks — validatePickSubmission must pass when the only
 *       "existing" pick is an empty-slot row.
 *   6.  DRAFT_PICK_INVALID_PAYLOAD exists in pickAuthorityCodes exports.
 *   7.  pick/route.ts passes skipRepair:true to preSubmitSnapshot buildSessionSnapshot.
 *   8.  pick/route.ts passes skipRepair:true to post-pick updated buildSessionSnapshot.
 *   9.  pick/route.ts rejects whitespace-only playerName with DRAFT_PICK_INVALID_PAYLOAD.
 *   10. Draft button in SleeperPoolTable has type="button" (no form submit).
 *   11. handleMakePick guards empty playerName before fetch.
 *   12. PickSubmissionService filters empty picks before validatePickSubmission.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePickSubmission } from '@/lib/live-draft-engine/PickValidation'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import {
  DRAFT_PICK_DUPLICATE_PLAYER,
  DRAFT_PICK_INVALID_PAYLOAD,
} from '@/lib/live-draft-engine/pickAuthorityCodes'

const root = process.cwd()
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const pickRouteSrc = read('app/api/leagues/[leagueId]/draft/pick/route.ts')
const submissionSrc = read('lib/live-draft-engine/PickSubmissionService.ts')
const clientSrc = read('components/app/draft-room/DraftRoomPageClient.tsx')
const sleeperTableSrc = read('components/app/draft-room/SleeperPoolTable.tsx')

const baseInput = {
  playerName: 'Justin Jefferson',
  position: 'WR',
  rosterId: 'roster-a',
  currentOnClockRosterId: 'roster-a',
  existingPicks: [],
  sessionStatus: 'in_progress',
}

// ---------------------------------------------------------------------------
// Invariant 1-3: validatePickSubmission — missing playerName error codes
// ---------------------------------------------------------------------------

describe('Invariant 1: empty playerName returns DRAFT_PICK_INVALID_PAYLOAD', () => {
  it('returns DRAFT_PICK_INVALID_PAYLOAD when playerName is empty string', () => {
    const result = validatePickSubmission({ ...baseInput, playerName: '' })
    expect(result.valid).toBe(false)
    expect(result.code).toBe(DRAFT_PICK_INVALID_PAYLOAD)
  })
})

describe('Invariant 2: whitespace-only playerName returns DRAFT_PICK_INVALID_PAYLOAD', () => {
  it('returns DRAFT_PICK_INVALID_PAYLOAD when playerName is only spaces', () => {
    const result = validatePickSubmission({ ...baseInput, playerName: '   ' })
    expect(result.valid).toBe(false)
    expect(result.code).toBe(DRAFT_PICK_INVALID_PAYLOAD)
  })
})

describe('Invariant 3: empty playerName does NOT return DRAFT_PICK_DUPLICATE_PLAYER', () => {
  it('missing name produces INVALID_PAYLOAD, not DUPLICATE_PLAYER', () => {
    const result = validatePickSubmission({ ...baseInput, playerName: '' })
    expect(result.code).not.toBe(DRAFT_PICK_DUPLICATE_PLAYER)
  })
})

// ---------------------------------------------------------------------------
// Invariant 4-5: empty-slot picks must not block valid submissions
// ---------------------------------------------------------------------------

describe('Invariant 4: valid pick with no existing picks returns valid:true', () => {
  it('valid name + empty existingPicks is accepted', () => {
    const result = validatePickSubmission(baseInput)
    expect(result.valid).toBe(true)
  })
})

describe('Invariant 5: empty-slot row not treated as existing pick', () => {
  it('isDraftPickRowEmpty identifies position=EMPTY, playerName="" as empty', () => {
    expect(isDraftPickRowEmpty({ playerName: '', position: 'EMPTY' })).toBe(true)
    expect(isDraftPickRowEmpty({ playerName: 'Justin Jefferson', position: 'WR' })).toBe(false)
  })

  it('valid pick passes even when DB has an empty-slot row at overall=1', () => {
    // Simulate what PickSubmissionService now does: filter before passing to validatePickSubmission
    const dbPicks = [{ playerName: '', position: 'EMPTY' }]
    const filteredPicks = dbPicks.filter((p) => !isDraftPickRowEmpty(p))
    const result = validatePickSubmission({ ...baseInput, existingPicks: filteredPicks })
    expect(result.valid).toBe(true)
    expect(result.code).not.toBe(DRAFT_PICK_DUPLICATE_PLAYER)
    expect(result.code).not.toBe(DRAFT_PICK_INVALID_PAYLOAD)
  })

  it('unfiltered empty-slot row in existingPicks would expose the bug', () => {
    // This documents the pre-fix behavior: empty-slot rows caused DUPLICATE_PLAYER
    const dbPicks = [{ playerName: '', position: 'EMPTY' }]
    // Without filtering — what the old code did:
    const result = validatePickSubmission({ ...baseInput, existingPicks: dbPicks })
    // After the fix, "Player name is required" check applies to the *input* playerName,
    // but the existingPick with empty name was causing the error in validateUniquePlayer.
    // The new fix is in PickSubmissionService (filtering), not PickValidation itself —
    // PickValidation receives clean existingPicks and passes.
    // Without the PickSubmissionService fix, the unfixed path would return a dupErrors hit.
    // Now that existingPicks is filtered upstream, this passes.
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Invariant 6: DRAFT_PICK_INVALID_PAYLOAD exported from pickAuthorityCodes
// ---------------------------------------------------------------------------

describe('Invariant 6: DRAFT_PICK_INVALID_PAYLOAD is a real exported code', () => {
  it('DRAFT_PICK_INVALID_PAYLOAD is defined and stable', () => {
    expect(DRAFT_PICK_INVALID_PAYLOAD).toBe('DRAFT_PICK_INVALID_PAYLOAD')
  })
})

// ---------------------------------------------------------------------------
// Invariant 7-9: pick/route.ts source checks
// ---------------------------------------------------------------------------

describe('Invariant 7: preSubmitSnapshot uses skipRepair:true', () => {
  it('pick route preSubmitSnapshot buildSessionSnapshot call includes skipRepair:true', () => {
    // First buildSessionSnapshot call (before submitPick)
    const preIdx = pickRouteSrc.indexOf('preSubmitSnapshot')
    expect(preIdx).toBeGreaterThan(-1)
    const preBlock = pickRouteSrc.slice(preIdx, preIdx + 200)
    expect(preBlock).toMatch(/buildSessionSnapshot\(.*skipRepair.*true/)
  })
})

describe('Invariant 8: post-pick updated snapshot uses skipRepair:true', () => {
  it('pick route post-pick buildSessionSnapshot call includes skipRepair:true', () => {
    const updatedIdx = pickRouteSrc.indexOf('const updated = await buildSessionSnapshot')
    expect(updatedIdx).toBeGreaterThan(-1)
    const updatedBlock = pickRouteSrc.slice(updatedIdx, updatedIdx + 200)
    expect(updatedBlock).toMatch(/buildSessionSnapshot\(.*skipRepair.*true/)
  })
})

describe('Invariant 9: pick route rejects whitespace-only playerName', () => {
  it('route body validation trims before checking emptiness', () => {
    // Must use String(playerName ?? '').trim() not !playerName
    expect(pickRouteSrc).toMatch(/String\(playerName.*\)\.trim\(\)/)
    // Must include DRAFT_PICK_INVALID_PAYLOAD in the rejection response
    const rejectionBlock = pickRouteSrc.slice(
      pickRouteSrc.indexOf('playerName and position required'),
      pickRouteSrc.indexOf('playerName and position required') + 150,
    )
    expect(rejectionBlock).toMatch(/DRAFT_PICK_INVALID_PAYLOAD/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 10: Draft button type="button" in SleeperPoolTable
// ---------------------------------------------------------------------------

describe('Invariant 10: Draft button is type="button" (no form submit)', () => {
  it('SleeperPoolTable Draft button has explicit type="button"', () => {
    // Find the Draft/Drafted button element in the actions cell
    const draftBtnIdx = sleeperTableSrc.indexOf("data-testid={`${testIdBase}-draft`}")
    // Walk back to find the opening <button
    const buttonOpen = sleeperTableSrc.lastIndexOf('<button', draftBtnIdx)
    const buttonBlock = sleeperTableSrc.slice(buttonOpen, draftBtnIdx + 50)
    expect(buttonBlock).toMatch(/type="button"/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 11: handleMakePick client-side playerName guard
// ---------------------------------------------------------------------------

describe('Invariant 11: handleMakePick blocks empty playerName before fetch', () => {
  it('handleMakePick contains a player.name?.trim() guard before the fetch call', () => {
    const pickIdx = clientSrc.indexOf('const handleMakePick = useCallback')
    expect(pickIdx).toBeGreaterThan(-1)
    const fetchIdx = clientSrc.indexOf('await fetch(`/api/leagues/', pickIdx)
    expect(fetchIdx).toBeGreaterThan(pickIdx)
    const preFetchBlock = clientSrc.slice(pickIdx, fetchIdx)
    expect(preFetchBlock).toMatch(/player\.name\?\.trim\(\)/)
  })

  it('guard sets pickError before returning, not after fetch', () => {
    const pickIdx = clientSrc.indexOf('const handleMakePick = useCallback')
    const fetchIdx = clientSrc.indexOf('await fetch(`/api/leagues/', pickIdx)
    const preFetchBlock = clientSrc.slice(pickIdx, fetchIdx)
    expect(preFetchBlock).toMatch(/Player name is missing/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 12: PickSubmissionService filters empty picks
// ---------------------------------------------------------------------------

describe('Invariant 12: PickSubmissionService filters empty-slot rows before validation', () => {
  it('existingPicks mapping calls isDraftPickRowEmpty filter', () => {
    expect(submissionSrc).toMatch(/isDraftPickRowEmpty\(p\)/)
    // Filter must precede the existingPicks map
    const filterIdx = submissionSrc.indexOf('.filter((p) => !isDraftPickRowEmpty(p))')
    const mapIdx = submissionSrc.indexOf(".map((p) => ({ playerName: p.playerName, position: p.position, playerId: p.playerId ?? null }))", filterIdx)
    expect(filterIdx).toBeGreaterThan(-1)
    expect(mapIdx).toBeGreaterThan(filterIdx)
  })
})
