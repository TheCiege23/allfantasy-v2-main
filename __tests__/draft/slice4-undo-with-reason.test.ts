import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('Slice 4 — undo route requires reason (1-500 chars)', () => {
  const pickUndoRoute = read('app/api/draft/pick/undo/route.ts')
  const controlsRoute = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('pick undo route returns 400 UNDO_REASON_REQUIRED on empty reason', () => {
    expect(pickUndoRoute).toMatch(/code: 'UNDO_REASON_REQUIRED'/)
    expect(pickUndoRoute).toMatch(/!reasonRaw/)
  })

  it('pick undo route returns 400 UNDO_REASON_TOO_LONG when > 500 chars', () => {
    expect(pickUndoRoute).toMatch(/code: 'UNDO_REASON_TOO_LONG'/)
    expect(pickUndoRoute).toMatch(/reasonRaw\.length > 500/)
  })

  it('pick undo route passes reason + actorUserId to undoLastPick', () => {
    expect(pickUndoRoute).toMatch(/undoLastPick\(parsed\.id, \{ reason: reasonRaw, actorUserId: userId \}\)/)
  })

  it('controls route undo_pick action requires reason and forwards to undoLastPick', () => {
    expect(controlsRoute).toMatch(/code: 'UNDO_REASON_REQUIRED'/)
    expect(controlsRoute).toMatch(/code: 'UNDO_REASON_TOO_LONG'/)
    expect(controlsRoute).toMatch(/undoLastPick\(leagueId, \{ reason: reasonRaw, actorUserId: userId \}\)/)
  })
})

describe('Slice 4 — undoLastPick writes DraftPickAuditLog entry', () => {
  const src = read('lib/live-draft-engine/DraftSessionService.ts')

  it('accepts options { reason, actorUserId }', () => {
    expect(src).toMatch(/options\?: \{ reason\?: string; actorUserId\?: string \| null \}/)
  })

  it('creates a DraftPickAuditLog entry with action=undo_pick when actorUserId is present', () => {
    expect(src).toMatch(/action: 'undo_pick'/)
    expect(src).toMatch(/draftPickAuditLog\.create/)
    expect(src).toMatch(/reason: reason \? reason : null/)
  })
})

describe('Slice 4 — commissioner-only audit log read endpoint', () => {
  const src = read('app/api/leagues/[leagueId]/draft/audit-log/route.ts')

  it('rejects non-commissioner with 403 AUDIT_LOG_COMMISSIONER_ONLY', () => {
    expect(src).toMatch(/code: 'AUDIT_LOG_COMMISSIONER_ONLY'/)
    expect(src).toMatch(/status: 403/)
  })

  it('returns reason field in audit entries (commissioner-only context)', () => {
    expect(src).toMatch(/reason: true/)
    expect(src).toMatch(/draftPickAuditLog\.findMany/)
  })

  it('uses isCommissioner from canonical permissions module', () => {
    expect(src).toMatch(/import \{ isCommissioner \} from '@\/lib\/commissioner\/permissions'/)
  })
})

describe('Slice 4 — chat-event payload re-adds aiManager / commissionerOverride / headshotUrl', () => {
  const src = read('lib/live-draft-engine/PickSubmissionService.ts')

  it('forwards pick.playerImageUrl as headshotUrl', () => {
    expect(src).toMatch(/headshotUrl: pick\.playerImageUrl \?\? input\.playerImageUrl \?\? null/)
  })

  it('flips aiManager=true when input.source === "auto"', () => {
    expect(src).toMatch(/aiManager: input\.source === 'auto',/)
  })

  it('flips commissionerOverride=true when input.source === "commissioner"', () => {
    expect(src).toMatch(/commissionerOverride: input\.source === 'commissioner',/)
  })
})

describe('Slice 4 — undo UI forces non-empty reason', () => {
  const src = read('components/app/draft-room/CommissionerControlCenterModal.tsx')

  it('opens a reason prompt instead of firing undo immediately', () => {
    expect(src).toMatch(/setUndoPromptOpen\(true\)/)
    expect(src).toMatch(/data-testid="draft-commissioner-undo-prompt"/)
  })

  it('confirm button is disabled when reason is empty', () => {
    expect(src).toMatch(/disabled=\{undoSubmitting \|\| undoReason\.trim\(\)\.length === 0\}/)
  })

  it('passes reason in onAction undo_pick payload', () => {
    expect(src).toMatch(/onAction\('undo_pick', \{ reason: trimmed \}\)/)
  })

  it('caps the textarea at 500 characters', () => {
    expect(src).toMatch(/maxLength=\{500\}/)
    expect(src).toMatch(/\.slice\(0, 500\)/)
  })
})
