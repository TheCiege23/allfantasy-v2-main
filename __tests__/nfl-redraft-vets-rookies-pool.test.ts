/**
 * NFL redraft vets / rookies / player pool — source-level contract lock
 * (Commit N).
 *
 * Pins the pool-integrity invariants at the file level so a future
 * refactor can't silently regress:
 *
 *   1. The pool resolver derives `isRookie` from `yearsExp` via
 *      `normalizeDraftPlayer` (yearsExp === 0 → isRookie = true), and
 *      every NFL pool row receives a `yearsExp` value (or null) so the
 *      client predicate has stable input.
 *   2. `DraftPlayerCard` renders the rookie chip from `isRookie`.
 *   3. PlayerPanel imports BOTH `isRookieEligibleForFilter` AND
 *      `isVetEligibleForFilter`, exposes the two toggles
 *      (`draft-filter-rookies-only` / `draft-filter-vets-only`), and
 *      passes the selected player's `yearsExp` into PlayerDetailModal
 *      (the pre-Commit-N hardcoded `null` would otherwise drop rookie
 *      metadata in the detail panel).
 *   4. The two toggles are mutually exclusive — the toggle handlers
 *      (`toggleRookiesOnly` / `toggleVetsOnly`) turn the other off when
 *      activating one, preventing an empty intersection.
 *   5. `clearAllFilters` resets BOTH toggles.
 *   6. `applyDraftFilters` excludes drafted players by default and the
 *      pool resolver dedupes via `dedupeEnrichedRawRows` (no duplicate
 *      players in the served pool).
 *   7. The Commit E / J / L / M locks (one shell + board, in-place
 *      session-mismatch handler, legacy-runtime guard, pick-authority
 *      codes) are still wired.
 *
 * Static-source assertions only — keeps the lock cheap and avoids the
 * full pool-resolver harness for what is fundamentally a code-shape
 * contract.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Pool resolver derives isRookie from yearsExp via normalizeDraftPlayer', () => {
  const norm = read('lib/draft-sports-models/normalize-draft-player.ts')

  it('normalizeDraftPlayer sets isRookie: true when yearsExp === 0', () => {
    expect(norm).toMatch(
      /isRookie:[\s\S]+?raw\.isRookie === true \|\|[\s\S]+?Number\(raw\.yearsExp\) === 0/,
    )
  })

  it('normalizeDraftPlayer always emits a numeric yearsExp or null (not undefined)', () => {
    expect(norm).toMatch(
      /yearsExp:[\s\S]+?raw\.yearsExp != null && Number\.isFinite\(Number\(raw\.yearsExp\)\) \? Number\(raw\.yearsExp\) : null/,
    )
  })
})

describe('Resolved draft pool feeds isRookie + yearsExp through to entries', () => {
  const src = read('lib/draft-room/getResolvedDraftPoolForLeague.ts')

  it('runs enriched rows through normalizePlayerList (NormalizedDraftEntry shape)', () => {
    expect(src).toMatch(/normalizePlayerList\(dedupedEnrichedList, sport\)/)
  })

  it('explicitly stamps yearsExp on NFL rows (Sleeper years_exp lookup chain)', () => {
    expect(src).toMatch(/lookupYearsExp\(/)
    // The conservative veteran fallback only ever increases yearsExp; never
    // infers rookie status from analytics-only signals. Tolerate trailing
    // telemetry fields after the value (e.g. `rookieYearsExpSource`).
    expect(src).toMatch(/return \{ yearsExp: 1[,\s}]/)
    expect(src).toMatch(/Never infer rookie from this path/)
  })

  it('marks non-graduated devy rows as rookie regardless of yearsExp', () => {
    // Multi-line tolerant: the resolver wraps the ternary across lines.
    expect(src).toMatch(/row\.isDevy && !row\.graduatedToNFL[\s\S]*?\?\s*\{ isRookie: true \}/)
  })

  it('dedupes the enriched pool before normalization (no duplicate served entries)', () => {
    expect(src).toMatch(/dedupedEnrichedList = dedupeEnrichedRawRows\(/)
  })
})

describe('DraftPlayerCard renders the rookie chip from isRookie', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('isRookie is part of the card props', () => {
    expect(src).toMatch(/isRookie\?: boolean/)
  })

  it('the rookie chip is gated on Boolean(isRookie)', () => {
    expect(src).toMatch(/showRookieBadge = Boolean\(isRookie\)/)
  })
})

describe('PlayerPanel exposes both Rookies-Only and Vets-Only filters', () => {
  const src = read('components/app/draft-room/PlayerPanel.tsx')

  it('imports both predicates from rookieFilterPredicate', () => {
    expect(src).toMatch(
      /import \{[^}]*isRookieEligibleForFilter[^}]*isVetEligibleForFilter[^}]*\} from '@\/lib\/draft-room\/rookieFilterPredicate'/,
    )
  })

  it('declares state for both toggles', () => {
    expect(src).toMatch(/const \[rookiesOnly, setRookiesOnly\] = useState\(false\)/)
    expect(src).toMatch(/const \[vetsOnly, setVetsOnly\] = useState\(false\)/)
  })

  it('applies the rookies predicate when rookiesOnly is on', () => {
    expect(src).toMatch(/if \(rookiesOnly\)[\s\S]+?isRookieEligibleForFilter\(p,/)
  })

  it('applies the vets predicate when vetsOnly is on', () => {
    expect(src).toMatch(/if \(vetsOnly\)[\s\S]+?isVetEligibleForFilter\(p\)/)
  })

  it('toggleRookiesOnly turns vets-only off (mutual exclusion)', () => {
    expect(src).toMatch(/toggleRookiesOnly[\s\S]+?if \(next\) setVetsOnly\(false\)/)
  })

  it('toggleVetsOnly turns rookies-only off (mutual exclusion)', () => {
    expect(src).toMatch(/toggleVetsOnly[\s\S]+?if \(next\) setRookiesOnly\(false\)/)
  })

  it('renders both toggle buttons with the canonical test ids', () => {
    expect(src).toMatch(/data-testid="draft-filter-rookies-only"/)
    expect(src).toMatch(/data-testid="draft-filter-vets-only"/)
    // Both buttons report aria-pressed for accessibility / e2e parity.
    expect(src).toMatch(/aria-pressed=\{rookiesOnly\}/)
    expect(src).toMatch(/aria-pressed=\{vetsOnly\}/)
  })

  it('clearAllFilters resets both toggles', () => {
    expect(src).toMatch(/clearAllFilters[\s\S]+?setRookiesOnly\(false\)[\s\S]+?setVetsOnly\(false\)/)
  })

  it('still uses isPlayerDraftedEntry for canonical no-duplicate-display', () => {
    // Hide-drafted + per-row drafted check both go through the same helper;
    // the `draftedPlayerIds` set short-circuits ambiguity for canonical
    // sport ids (matches the pick API guards).
    expect(src).toMatch(/isPlayerDraftedEntry\(p, draftedNames, draftedIdsForRows\)/)
  })

  it('PlayerDetailModal receives the resolved yearsExp from the selected player (no longer hardcoded null)', () => {
    expect(src).toMatch(
      /yearsExp:[\s\S]+?typeof selectedPlayer\.yearsExp === 'number' && Number\.isFinite\(selectedPlayer\.yearsExp\)[\s\S]+?\? selectedPlayer\.yearsExp[\s\S]+?: null/,
    )
    // Ensure the literal-null hardcode that existed pre-Commit-N is gone.
    expect(src).not.toMatch(/yearsExp: null,\s*jersey: null,/)
  })
})

describe('applyDraftFilters excludes drafted by default (no duplicate-display invariant)', () => {
  const src = read('lib/draft-room/DraftPlayerSearchResolver.ts')

  it('excludeDrafted runs first in applyDraftFilters when showDrafted is falsy', () => {
    expect(src).toMatch(
      /function applyDraftFilters[\s\S]+?if \(!options\.showDrafted\) \{[\s\S]+?excludeDrafted\(/,
    )
  })

  it('excludeDrafted filters by drafted-name set', () => {
    expect(src).toMatch(/draftedNames\.has\(p\.name\)/)
  })
})

describe('Commit E / Commit J / Commit L / Commit M locks still hold after Commit N', () => {
  it('Commit E — DraftRoomPageClient still mounts exactly one <DraftRoomShell> and <DraftBoard>', () => {
    const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect((drpc.match(/<DraftRoomShell\b/g) ?? []).length).toBe(1)
    expect((drpc.match(/<DraftBoard\b/g) ?? []).length).toBe(1)
  })

  it('Commit J — DraftRoomPageClient still has the 409 / DRAFT_SESSION_MISMATCH in-place handler', () => {
    const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(drpc).toMatch(
      /res\.status === 409 && \(data as \{ code\?: unknown \}\)\?\.code === 'DRAFT_SESSION_MISMATCH'/,
    )
    expect(drpc).toMatch(/setSessionMismatchRecovering\(true\)/)
  })

  it('Commit L — executeDraftPick still calls assertLegacyDraftRuntimeWriteAllowed before any prisma write', () => {
    const exec = read('lib/draft/execute-pick.ts')
    const guardIdx = exec.indexOf('assertLegacyDraftRuntimeWriteAllowed({')
    expect(guardIdx).toBeGreaterThan(0)
    const writeIdx = exec.indexOf('prisma.draftRoomPickRecord')
    expect(writeIdx).toBeGreaterThan(guardIdx)
  })

  it('Commit M — submitPick still has the expectedOverall stale guard and race-retry tagging', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(
      /input\.expectedOverall !== overall[\s\S]+?code: DRAFT_PICK_STALE_OVERALL/,
    )
    expect(sps).toMatch(/code: DRAFT_PICK_RACE_RETRY/)
  })
})
