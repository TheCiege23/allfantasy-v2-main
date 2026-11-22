/**
 * G.3 — Commissioner Edit Semantics (Slice 2).
 *
 * Per-action timer-reset rules + self-benefit audit flag.
 *
 * Static-source assertions covering:
 *   - REMOVE always triggers shouldResetTimerAfterTx (rewinds on-clock cursor)
 *   - ASSIGN to the on-clock pick triggers shouldResetTimerAfterTx
 *   - CHANGE_PICK_OWNER on an on-clock EMPTY pick triggers reset; if pick has
 *     a player, no reset
 *   - REPLACE never touches the timer (regression guard)
 *   - resetTimer is invoked AFTER the transaction commits, only when the flag
 *     was set during the action
 *   - self-benefit is detected by comparing rosters' platformUserId to actor
 *   - missing confirmSelfBenefit OR missing reason → 409 + SELF_BENEFIT_CONFIRM_REQUIRED
 *   - selfBenefit=true is written to audit metadata when applicable
 *   - API route passes confirmSelfBenefit through, returns 409 with code on rejection
 *   - Client param surface accepts confirmSelfBenefit
 *   - Panel renders the self-benefit prompt + confirm/cancel buttons
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const SERVICE = 'lib/live-draft-engine/commissioner/commissionerPickEditService.ts'
const ROUTE = 'app/api/leagues/[leagueId]/draft/commissioner/pick-edit/route.ts'
const CLIENT = 'lib/live-draft-engine/commissioner/clientCommissionerPickEdit.ts'
const PANEL = 'components/app/draft-room/CommissionerPickEditorPanel.tsx'

describe('G.3 — service: on-clock detection + timer-reset triggers', () => {
  const src = read(SERVICE)

  it('uses resolveCurrentOnTheClock to compute onClockOverall before the action switch', () => {
    expect(src).toMatch(/resolveCurrentOnTheClock/)
    expect(src).toMatch(/const onClockOverall = onClockNow\?\.overall \?\? null/)
  })

  it('REMOVE always resets the timer (rewinds on-clock cursor; product rule)', () => {
    // Must set the flag unconditionally — no `if (onClockOverall === pick.overall)` guard.
    const m = src.match(/case 'REMOVE_PLAYER_FROM_PICK': \{([\s\S]*?)\n {6}case '/)
    expect(m, 'REMOVE block must exist').not.toBeNull()
    expect(m![1]).toMatch(/shouldResetTimerAfterTx = true/)
    expect(m![1]).not.toMatch(/if \(onClockOverall === pick\.overall\) shouldResetTimerAfterTx = true/)
  })

  it('ASSIGN to the on-clock pick sets shouldResetTimerAfterTx', () => {
    expect(src).toMatch(/ASSIGN_PLAYER_TO_PICK[\s\S]{0,800}if \(onClockOverall === overall\) shouldResetTimerAfterTx = true/)
  })

  it('CHANGE_PICK_OWNER on the on-clock EMPTY pick resets; populated picks do not', () => {
    expect(src).toMatch(/onClockOverall === pick\.overall && isDraftPickRowEmpty\(pick\)/)
  })

  it('REPLACE_PLAYER_ON_PICK does NOT touch the reset flag (regression guard)', () => {
    // Extract the REPLACE block and assert no shouldResetTimerAfterTx assignment.
    const m = src.match(/case 'REPLACE_PLAYER_ON_PICK': \{([\s\S]*?)\n {6}case 'ASSIGN_PLAYER_TO_PICK'/)
    expect(m, 'REPLACE block must exist').not.toBeNull()
    expect(m![1]).not.toMatch(/shouldResetTimerAfterTx\s*=\s*true/)
  })

  it('shouldResetTimerAfterTx is captured outside the tx + checked after it commits', () => {
    expect(src).toMatch(/let shouldResetTimerAfterTx = false/)
    // The tx returns its value; the post-tx hook reads it via `audit.shouldResetTimer`.
    expect(src).toMatch(/return \{ ok: true as const, shouldResetTimer: shouldResetTimerAfterTx, auditRow \}/)
  })

  it('resetTimer is dynamically imported AFTER the tx commits (not inside it)', () => {
    expect(src).toMatch(/if \(\(audit as \{ shouldResetTimer\?: boolean \}\)\.shouldResetTimer\)/)
    expect(src).toMatch(/await import\('@\/lib\/live-draft-engine\/DraftSessionService'\)/)
    expect(src).toMatch(/await resetTimer\(params\.leagueId\)/)
  })

  it('resetTimer failure is non-fatal (logged + swallowed; pick edit still succeeds)', () => {
    expect(src).toMatch(/console\.error\('\[commissionerPickEdit\] resetTimer failed \(non-fatal\)'/)
  })
})

describe('G.3 — service: self-benefit detection + confirm gate', () => {
  const src = read(SERVICE)

  it('CommissionerPickEditParams accepts confirmSelfBenefit?: boolean', () => {
    expect(src).toMatch(/confirmSelfBenefit\?: boolean/)
  })

  it('detects self-benefit by matching actorUserId to roster.platformUserId', () => {
    expect(src).toMatch(/r\.platformUserId != null && r\.platformUserId === params\.actorUserId/)
  })

  it('considers BOTH the affected pick rosterId AND newRosterId (CHANGE_OWNER / ASSIGN)', () => {
    expect(src).toMatch(/affectedRosterIds\.add\(targetPickForSelfBenefit\.rosterId\)/)
    expect(src).toMatch(/affectedRosterIds\.add\(params\.newRosterId\.trim\(\)\)/)
  })

  it('rejects with 409 + SELF_BENEFIT_CONFIRM_REQUIRED when reason missing or neither confirm path is used', () => {
    expect(src).toMatch(/typedSelfBenefitConfirm/)
    expect(src).toMatch(/if \(\!\(params\.confirmSelfBenefit \|\| typedSelfBenefitConfirm\) \|\| !trimmedReason\)/)
    expect(src).toMatch(/code: 'SELF_BENEFIT_CONFIRM_REQUIRED'/)
    expect(src).toMatch(/status: 409/)
  })

  it('writes self-benefit metadata (flag + confirmation + reason) when applicable', () => {
    expect(src).toMatch(/if \(isSelfBenefit\) \{/)
    expect(src).toMatch(/o\.selfBenefit = true/)
    expect(src).toMatch(/o\.selfBenefitConfirmed = true/)
    expect(src).toMatch(/o\.selfBenefitReason = trimmedReason/)
  })

  it('post-tx error handler surfaces SELF_BENEFIT_CONFIRM_REQUIRED structured to the route', () => {
    expect(src).toMatch(/if \(status === 409 && err\.code === 'SELF_BENEFIT_CONFIRM_REQUIRED'\)/)
  })
})

describe('G.3 — API route forwards confirmSelfBenefit + structures the rejection', () => {
  const src = read(ROUTE)

  it('POST body forwards confirmSelfBenefit (snake + camel accepted)', () => {
    expect(src).toMatch(/confirmSelfBenefit: Boolean\(body\.confirmSelfBenefit \?\? body\.confirm_self_benefit\)/)
  })

  it('returns 409 with code SELF_BENEFIT_CONFIRM_REQUIRED so the client can prompt', () => {
    expect(src).toMatch(/result\.code === 'SELF_BENEFIT_CONFIRM_REQUIRED'/)
    expect(src).toMatch(/\{ status: 409 \}/)
  })
})

describe('G.3 — Client wrapper surfaces confirmSelfBenefit', () => {
  const src = read(CLIENT)
  it('CommissionerPickEditClientParams includes confirmSelfBenefit?: boolean', () => {
    expect(src).toMatch(/confirmSelfBenefit\?: boolean/)
  })
})

describe('G.3 — Panel UI: self-benefit prompt + confirm flow', () => {
  const src = read(PANEL)

  it('separate selfBenefit state lives alongside the existing warning state', () => {
    expect(src).toMatch(/const \[selfBenefit, setSelfBenefit\] = useState/)
  })

  it('catches err.code === SELF_BENEFIT_CONFIRM_REQUIRED and stages the prompt', () => {
    expect(src).toMatch(/err\.code === 'SELF_BENEFIT_CONFIRM_REQUIRED'/)
    expect(src).toMatch(/setSelfBenefit\(\{ message: err\.message, lastParams: params \}\)/)
  })

  it('exposes a self-benefit confirm CTA gated on a typed reason', () => {
    expect(src).toMatch(/data-testid="commish-edit-self-benefit"/)
    expect(src).toMatch(/data-testid="commish-edit-self-benefit-confirm"/)
    expect(src).toMatch(/disabled=\{submitting \|\| !form\.reason\.trim\(\)\}/)
  })

  it('exposes a Cancel button to dismiss the prompt without submitting', () => {
    expect(src).toMatch(/data-testid="commish-edit-self-benefit-cancel"/)
    expect(src).toMatch(/setSelfBenefit\(null\)/)
  })

  it('confirm flow re-submits with confirmSelfBenefit: true', () => {
    expect(src).toMatch(/confirmSelfBenefit: true/)
  })

  it('success message acknowledges the self-benefit audit flag', () => {
    expect(src).toMatch(/Logged as self-benefit edit/)
  })

  it('the existing Roster Eligibility "Force anyway" CTA is preserved (not displaced)', () => {
    expect(src).toMatch(/data-testid="commish-edit-force-anyway"/)
    expect(src).toMatch(/Force anyway/)
  })
})

describe('G.3 — no forbidden BaaS references in the touched files', () => {
  const FORBIDDEN = 'supa' + 'base'
  for (const rel of [SERVICE, ROUTE, CLIENT, PANEL]) {
    it(`${rel} contains no forbidden BaaS imports`, () => {
      expect(read(rel).toLowerCase()).not.toContain(FORBIDDEN)
    })
  }
})
