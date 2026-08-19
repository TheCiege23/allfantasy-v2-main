/**
 * Pre-draft fix-action dashboard listener lock (Commit H).
 *
 * The full fix-flow loop:
 *   1. Commissioner clicks "Start Draft" in the draft room.
 *   2. PreDraftWizard runs validation; one or more checks fail.
 *   3. Commissioner clicks a "Fix" button in the wizard.
 *   4. PreDraftWizard fires `onFixAction(action)` (Commit G).
 *   5. DraftRoomPageClient maps action → settings panel id, dispatches
 *      `af-pre-draft-fix-action` CustomEvent (detail: { leagueId, action,
 *      panel }), and closes the wizard. NO navigation. (Commit G).
 *   6. ↓ THIS COMMIT: when the user lands on `/league/[id]`, LeagueShell's
 *      listener picks up the event and opens LeagueSettingsModal at the
 *      mapped panel.
 *
 * The listener:
 *   - Is scoped to this league only (`detail.leagueId === league.id`).
 *   - Reads `detail.panel`, normalizes to non-empty string or null.
 *   - Calls `openLeagueSettingsModal(panel)` — the same in-place opener
 *     used by the existing `?settingsPanel=...` deep-link useEffect.
 *   - Does NOT call `router.push`, `router.replace`, or `window.location`.
 *   - Removes the event listener on unmount.
 *
 * Static-source assertions only.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('LeagueShell — af-pre-draft-fix-action listener', () => {
  const src = read('app/league/[leagueId]/LeagueShell.tsx')

  /**
   * Slice the Slice-H useEffect block precisely so unrelated `useEffect(`
   * hooks elsewhere in the file don't pollute the regex window. The block
   * starts at the documenting comment "Slice H - listen for" and ends at
   * the next `useEffect` / function boundary.
   */
  const sliceStart = src.indexOf('Slice H - listen for')
  const sliceEndNeedle = '}, [league.id, openLeagueSettingsModal])'
  const sliceEnd = sliceStart >= 0 ? src.indexOf(sliceEndNeedle, sliceStart) : -1
  const sliceBody =
    sliceStart >= 0 && sliceEnd > sliceStart
      ? src.slice(sliceStart, sliceEnd + sliceEndNeedle.length)
      : ''

  it('Slice H useEffect block exists and is bounded', () => {
    expect(sliceStart).toBeGreaterThan(0)
    expect(sliceEnd).toBeGreaterThan(sliceStart)
    expect(sliceBody.length).toBeGreaterThan(100)
  })

  it('attaches a window listener for af-pre-draft-fix-action', () => {
    expect(sliceBody).toMatch(
      /window\.addEventListener\('af-pre-draft-fix-action',\s*handler\)/,
    )
  })

  it('removes the listener on unmount (cleanup return)', () => {
    expect(sliceBody).toMatch(
      /return\s*\(\)\s*=>\s*window\.removeEventListener\('af-pre-draft-fix-action',\s*handler\)/,
    )
  })

  it('is scoped to this league — events from other leagues are ignored', () => {
    // The handler must guard on `detail.leagueId !== league.id` so a
    // commissioner who has multiple league dashboards open doesn't end up
    // with the wrong league's settings modal popped.
    expect(sliceBody).toMatch(/detail\.leagueId !== league\.id/)
  })

  it('reads the panel id from the event detail and normalizes empty/whitespace to null', () => {
    expect(sliceBody).toMatch(/detail\.panel/)
    // Normalization guards against panel being an empty string — without
    // this, `openLeagueSettingsModal('')` would still satisfy the
    // truthy check and could deep-link the modal at an invalid panel.
    expect(sliceBody).toMatch(
      /typeof detail\.panel === 'string' && detail\.panel\.trim\(\)\.length > 0[\s\S]+?:\s*null/,
    )
  })

  it('opens the settings modal in place via openLeagueSettingsModal(panel)', () => {
    expect(sliceBody).toMatch(/openLeagueSettingsModal\(panel\)/)
  })

  it('does NOT introduce navigation — no router.push / router.replace / window.location.{href,assign,replace}', () => {
    expect(sliceBody).not.toMatch(/router\.push\(/)
    expect(sliceBody).not.toMatch(/router\.replace\(/)
    expect(sliceBody).not.toMatch(/window\.location\.(href|assign|replace)\s*[=(]/)
  })

  it('declares the complete useEffect dep array used by the listener', () => {
    expect(sliceBody.endsWith(sliceEndNeedle)).toBe(true)
  })
})

describe('DraftRoomPageClient — Commit G dispatch contract still holds', () => {
  // Belt-and-suspenders: the listener only matters if the dispatcher still
  // emits the same event shape. Lock the pairing here so a future refactor
  // on either side breaks loudly in this file.
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('still dispatches af-pre-draft-fix-action with the canonical detail shape', () => {
    expect(src).toMatch(/new CustomEvent\(\s*'af-pre-draft-fix-action'/)
    expect(src).toMatch(/detail:\s*\{\s*leagueId,\s*action,\s*panel\s*\}/)
  })

  it('still closes the wizard inline — no navigation on dispatch', () => {
    const wizardRenderIdx = src.indexOf('data-testid="pre-draft-validation-wizard"')
    const window = src.slice(wizardRenderIdx, wizardRenderIdx + 2200)
    expect(window).toMatch(/setShowPreDraftValidationWizard\(false\)/)
    expect(window).not.toMatch(/router\.push\(/)
    expect(window).not.toMatch(/router\.replace\(/)
    expect(window).not.toMatch(/window\.location\.(href|assign|replace)\s*[=(]/)
  })
})
