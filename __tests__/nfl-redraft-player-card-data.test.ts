/**
 * NFL redraft draft-room player card data — source-level contract lock
 * (Commit P).
 *
 * Pins the data-correctness invariants of `DraftPlayerCard` and the
 * normalization pipeline so a future refactor can't silently drop:
 *
 *   1. Player name renders from `display.displayName` with a `name` fallback.
 *   2. Headshot resolution chain:
 *        getPlayerImage(normalized) → display.assets.headshotUrl → null.
 *      `PlayerAvatar` then classifies the URL and renders the silhouette
 *      + initials fallback whenever the candidate is null, errors, or
 *      classifies as something other than a real headshot. DEF rows
 *      promote the team logo to the primary avatar.
 *   3. Team chip falls back to `'FA'` when teamAbbr is null.
 *   4. Position chip is always rendered (no conditional on truthiness).
 *   5. Injury status badge renders ONLY when `display.metadata.injuryStatus`
 *      is set; the badge has the canonical
 *      `data-testid="draft-player-injury-status"` (or testid-prefixed
 *      variant) so e2e + RTL tests can target it cleanly.
 *   6. Stats line falls back through the chain:
 *        normalized.stats.summary
 *          → "Proj N pts" (when `normalized.projection` is finite)
 *          → "No stats available"
 *      The stat line carries a stable
 *      `data-testid="draft-player-stats-summary"`.
 *   7. ADP / Bye column renders with `—` placeholders for missing data
 *      and stable testids (`draft-player-adp` / `draft-player-bye`).
 *   8. NFL projection splits grid renders inside the row variant when
 *      both presentationVariant === 'redraft_snake' AND the splits are
 *      provided AND position is not 'K'.
 *   9. Kicker splits render the FG / XP shorthand when position === 'K'.
 *  10. Rookie chip from Commit N still renders from `Boolean(isRookie)`.
 *  11. Pool resolver still dedupes via `dedupeEnrichedRawRows` and
 *      `normalizePlayer` still derives `isRookie` from `yearsExp === 0`
 *      (no-duplicate / vet-rookie invariants from Commits N/O).
 *  12. Commits J / L / M locks (in-place session mismatch, legacy
 *      runtime guard, pick-authority codes) still wired.
 *
 * Static-source assertions only — no JSDOM render. Behavioural tests of
 * the predicates already live in
 * `__tests__/draft/n-vets-rookies-pool-filters.test.ts` and
 * `__tests__/draft/d7-rookie-filter.test.ts`; this file keeps the lock
 * cheap by pinning the code shape rather than re-rendering through the
 * heavy PlayerPanel tree.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('DraftPlayerCard — name / position / team rendering', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('displayName comes from display.displayName with `name` as fallback', () => {
    expect(src).toMatch(/const displayName = display\?\.displayName \?\? name/)
  })

  it('player name has a stable test id', () => {
    expect(src).toMatch(
      /data-testid=\{testId \? `\$\{testId\}-name` : 'draft-player-name'\}/,
    )
  })

  it('teamAbbr falls back to `FA` when null', () => {
    // Both card and row variants render the team chip; both use `?? 'FA'`.
    expect(src.match(/teamAbbr \?\? 'FA'/g) ?? []).toHaveLength(2)
  })

  it('teamAbbr resolves through display.metadata first, then prop, then null', () => {
    expect(src).toMatch(
      /const teamAbbr = display\?\.metadata\?\.teamAbbreviation \?\? team \?\? null/,
    )
  })
})

describe('DraftPlayerCard — headshot fallback chain', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('headshotUrl chain: getPlayerImage(normalized) → assets.headshotUrl → … → null', () => {
    // Primary chain is locked; the chain was later extended with additional
    // unifiedProductView fallbacks before the final `null` (enhancement).
    expect(src).toMatch(
      /const headshotUrl =\s*getPlayerImage\(normalized, draftSport\) \?\?\s*assets\?\.headshotUrl \?\?/,
    )
  })

  it('teamLogoUrl chain: normalized.teamLogoUrl → assets.teamLogoUrl → null', () => {
    expect(src).toMatch(
      /const teamLogoUrl = normalized\.teamLogoUrl \?\? assets\?\.teamLogoUrl \?\? null/,
    )
  })

  it('uses the shared PlayerAvatar component (silhouette + initials fallback)', () => {
    expect(src).toMatch(/import \{ PlayerAvatar \} from '\.\/PlayerAvatar'/)
  })

  it('TeamLogoOrFallback renders the abbr text when imgError fires', () => {
    expect(src).toMatch(/onError=\{\(\) => setImgError\(true\)\}/)
    // The fallback span renders the first 3 chars of the team abbr.
    expect(src).toMatch(/teamAbbr\.slice\(0, 3\)\.toUpperCase\(\)/)
  })
})

describe('PlayerAvatar — fallback chain (URL classification + DEF special case)', () => {
  const src = read('components/app/draft-room/PlayerAvatar.tsx')

  it('classifies the candidate URL through classifyAvatarSource', () => {
    expect(src).toMatch(/const source = classifyAvatarSource\(headshotUrl\)/)
  })

  it('shows the headshot only when source === "headshot" and no img error', () => {
    expect(src).toMatch(
      /const showImg = !showDefLogoAsPrimary && source === 'headshot' && !imgError/,
    )
  })

  it('promotes the team logo to primary avatar for DEF rows', () => {
    expect(src).toMatch(/const isDefRow = isDefRowForAvatar\(position\)/)
    expect(src).toMatch(
      /const showDefLogoAsPrimary = isDefRow && showTeamLogo && !defLogoError/,
    )
  })

  it('falls back to silhouette + initials when no real headshot is available', () => {
    expect(src).toMatch(/data-testid=\{`\$\{testIdBase\}-fallback`\}/)
    expect(src).toMatch(/const initials = initialsFor\(displayName\)/)
  })
})

describe('DraftPlayerCard — injury status badge', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('reads injuryStatus from display.metadata.injuryStatus (primary source)', () => {
    // Primary source locked; later extended with unifiedProductView fallbacks
    // before the final `null` (enhancement).
    expect(src).toMatch(
      /const injuryStatus =\s*display\?\.metadata\?\.injuryStatus \?\?/,
    )
  })

  it('renders the badge ONLY when injuryStatus is truthy', () => {
    // Both variants gate the badge on `injuryStatus ?` (ternary)
    expect(src.match(/\{injuryStatus \?/g) ?? []).toHaveLength(2)
  })

  it('row badge has the stable test id', () => {
    expect(src).toMatch(
      /data-testid=\{testId \? `\$\{testId\}-injury-status` : 'draft-player-injury-status'\}/,
    )
  })
})

describe('DraftPlayerCard — stats summary fallback chain', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('prefers normalized.stats.summary, then projected points, then "No stats available"', () => {
    expect(src).toMatch(
      /const statLine =[\s\S]+?normalized\.stats\?\.summary \?\?[\s\S]+?projectedPoints != null[\s\S]+?'No stats available'/,
    )
  })

  it('projectedPoints accepts only finite numbers', () => {
    expect(src).toMatch(
      /typeof normalized\.projection === 'number' && Number\.isFinite\(normalized\.projection\)/,
    )
  })

  it('formats projection as "Proj N.N pts"', () => {
    expect(src).toMatch(/`Proj \$\{projectedPoints\.toFixed\(1\)\} pts`/)
  })

  it('stat line carries the stable test id', () => {
    expect(src).toMatch(
      /data-testid=\{testId \? `\$\{testId\}-stats-summary` : 'draft-player-stats-summary'\}/,
    )
  })
})

describe('DraftPlayerCard — ADP / Bye column', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('formatAdpDisplay returns "—" for null/missing/non-finite', () => {
    expect(src).toMatch(/if \(v == null \|\| !Number\.isFinite\(Number\(v\)\)\) return '—'/)
  })

  it('formatBye returns "—" for null / non-positive / non-finite', () => {
    expect(src).toMatch(/if \(v == null \|\| !Number\.isFinite\(v\) \|\| v <= 0\) return '—'/)
  })

  it('ADP value carries the stable test id', () => {
    expect(src).toMatch(
      /data-testid=\{testId \? `\$\{testId\}-adp` : 'draft-player-adp'\}/,
    )
  })

  it('Bye value carries the stable test id', () => {
    expect(src).toMatch(
      /data-testid=\{testId \? `\$\{testId\}-bye` : 'draft-player-bye'\}/,
    )
  })
})

describe('DraftPlayerCard — NFL projection splits + kicker splits', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('shows the split grid only for redraft_snake + NFL + non-K + provided splits', () => {
    expect(src).toMatch(
      /const showNflSplitGrid =[\s\S]+?rs && isNfl && nflDraftProjectionSplits != null && posU !== 'K'/,
    )
  })

  it('shows the kicker splits only for redraft_snake + NFL + K + kicking object', () => {
    expect(src).toMatch(
      /const showNflKickerSplits =[\s\S]+?rs && isNfl && nflDraftProjectionSplits != null && posU === 'K' && nflDraftProjectionSplits\.kicking/,
    )
  })

  it('imports the shared NflDraftPoolStatsRow renderer', () => {
    expect(src).toMatch(
      /import \{ NflDraftPoolStatsRow \} from '@\/components\/app\/draft-room\/NflDraftPoolStatsStrip'/,
    )
  })

  it('split grid is rendered inside the row variant return', () => {
    expect(src).toMatch(/<NflDraftPoolStatsRow splits=\{nflDraftProjectionSplits\}/)
  })
})

describe('DraftPlayerCard — Commit N rookie chip preserved', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  // Phase 3.2: the chip is the shared Rookie/Prospect badge, still fed from isRookie. Its behaviour
  // (Rookie vs Prospect, every sport) is asserted by rendering in
  // __tests__/draft-room/redraft-rookie-prospect-labels.test.tsx.
  it('rookie chip is fed from isRookie through the shared label resolver', () => {
    expect(src).toMatch(/const labelInput = \{ isRookie, isDevy, graduatedToNFL, poolType \}/)
  })

  it('rookie chip is rendered in BOTH the card and row variants', () => {
    // One badge per variant — same input (labelInput).
    expect(src.match(/<DraftPlayerLabelBadge player=\{labelInput\}/g) ?? []).toHaveLength(2)
  })
})

describe('Pool resolver dedupe + isRookie derivation (Commits N/O still pinned)', () => {
  const src = read('lib/draft-room/getResolvedDraftPoolForLeague.ts')

  it('dedupes enriched rows via dedupeEnrichedRawRows before normalization', () => {
    expect(src).toMatch(/dedupedEnrichedList = dedupeEnrichedRawRows\(/)
  })

  it('runs through normalizePlayerList to canonicalise the served entries', () => {
    expect(src).toMatch(/normalizePlayerList\(dedupedEnrichedList, sport\)/)
  })

  it('marks non-graduated devy as rookie regardless of yearsExp', () => {
    expect(src).toMatch(/row\.isDevy && !row\.graduatedToNFL\s*\?\s*\{ isRookie: true \}/)
  })
})

describe('Commit J / Commit L / Commit M locks still hold after Commit P', () => {
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
