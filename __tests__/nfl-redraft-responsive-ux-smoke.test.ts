/**
 * NFL redraft responsive UX smoke + contract lock (Commit V).
 *
 * Pins the Sleeper-style draft-room layout invariants so a future
 * refactor can't silently regress:
 *
 *   1. ONE shell (`<DraftRoomShell>`) and ONE `<DraftBoard>` mount
 *      from `DraftRoomPageClient` (Commit E unified-state lock).
 *   2. Every key surface exposes a stable `data-testid`:
 *        Shell:           draft-room-shell
 *        Desktop branch:  draft-desktop-layout, draft-premium-board-zone,
 *                         draft-premium-team-aside,
 *                         draft-premium-bottom-dock,
 *                         draft-bottom-dock-toggle,
 *                         draft-bottom-dock-restore
 *        Mobile branch:   draft-mobile-layout, draft-mobile-content,
 *                         draft-mobile-board-scroll,
 *                         draft-mobile-players-scroll,
 *                         draft-mobile-tab-{id}
 *        Top bar:         draft-topbar-clock,
 *                         draft-topbar-start-draft (commish-only path)
 *        Board:           draft-board, draft-board-grid,
 *                         draft-board-round-{n}, draft-board-jump-current,
 *                         draft-board-prev-round, draft-board-next-round,
 *                         draft-board-round-selector
 *        Player pool:     draft-player-panel,
 *                         draft-player-search-input,
 *                         draft-position-filter, draft-team-filter,
 *                         draft-clear-filters,
 *                         draft-filter-rookies-only,
 *                         draft-filter-vets-only,
 *                         draft-filter-watchlist-only,
 *                         draft-filter-hide-drafted,
 *                         draft-player-name, draft-player-stats-summary,
 *                         draft-player-injury-status, draft-player-adp,
 *                         draft-player-bye
 *        Queue:           draft-queue-draft-button (existing)
 *        Team panel:      draft-team-panel,
 *                         draft-team-panel-positional-mix,
 *                         draft-team-panel-needs (conditional),
 *                         draft-team-panel-bye-clusters (conditional),
 *                         draft-team-panel-drafted-list
 *        Chat:            draft-chat-panel, draft-chat-pick-event,
 *                         draft-chat-pick-headshot,
 *                         draft-chat-pick-drafter,
 *                         draft-chat-pick-ai-badge
 *        War room (AI):   draft-war-room, draft-war-room-skeleton,
 *                         draft-war-room-pick-unresolved
 *        Commissioner:    draft-commissioner-modal,
 *                         draft-commissioner-close
 *   3. Mobile / desktop branches gate via responsive Tailwind classes
 *      (`md:flex` for desktop, `md:hidden` for mobile) so the same
 *      shell renders cleanly on both form factors.
 *   4. Loading / empty / error states exist for the side panels:
 *        - DraftPlayerCard renders a loading skeleton + error alert
 *        - DraftWarRoom renders a skeleton + role="alert" error
 *        - DraftTeamPanel needs/bye-cluster sections render
 *          conditionally (hidden when empty, never chrome-only)
 *   5. No client-navigation primitives in any draft-room UX file
 *      (Commit J no-redirect rule).
 *   6. None of the polish surfaces import `submitPick` /
 *      `executeDraftPick` directly — pick authority remains gated by
 *      the canonical service.
 *   7. Commits L / M / N / O / P / Q / R / S / T / U locks all still
 *      wired (asserted via probes that match each commit's signature).
 *
 * Static-source assertions only — keeps the smoke pass cheap and
 * deterministic.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Shell mounts one board / one shell (Commit E unified state)', () => {
  const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('exactly one <DraftRoomShell> mount', () => {
    expect((drpc.match(/<DraftRoomShell\b/g) ?? []).length).toBe(1)
  })

  it('exactly one <DraftBoard> mount', () => {
    expect((drpc.match(/<DraftBoard\b/g) ?? []).length).toBe(1)
  })
})

describe('DraftRoomShell — desktop + mobile branches both render with stable test ids', () => {
  const src = read('components/app/draft-room/DraftRoomShell.tsx')

  it('outermost shell carries draft-room-shell', () => {
    expect(src).toMatch(/data-testid="draft-room-shell"/)
  })

  it('desktop layout branch uses md:flex + draft-desktop-layout testid', () => {
    expect(src).toMatch(/className="hidden min-h-0 flex-1 flex-col overflow-hidden md:flex" data-testid="draft-desktop-layout"/)
  })

  it('mobile layout branch uses md:hidden + draft-mobile-layout testid', () => {
    // className + data-testid may sit on separate JSX lines after formatting.
    expect(src).toMatch(/md:hidden"[\s\S]{0,40}data-testid="draft-mobile-layout"/)
  })

  it('desktop board zone, team aside, and bottom dock all carry stable testids', () => {
    expect(src).toMatch(/data-testid="draft-premium-board-zone"/)
    expect(src).toMatch(/data-testid="draft-premium-team-aside"/)
    expect(src).toMatch(/data-testid="draft-premium-bottom-dock"/)
    expect(src).toMatch(/data-testid="draft-bottom-dock-toggle"/)
    expect(src).toMatch(/data-testid="draft-bottom-dock-restore"/)
  })

  it('mobile content + tab-pane scrolls + per-tab buttons all carry stable testids', () => {
    expect(src).toMatch(/data-testid="draft-mobile-content"/)
    expect(src).toMatch(/data-testid="draft-mobile-board-scroll"/)
    expect(src).toMatch(/data-testid="draft-mobile-players-scroll"/)
    expect(src).toMatch(/data-testid=\{`draft-mobile-tab-\$\{id\}`\}/)
  })
})

describe('DraftTopBar exposes stable timer + commissioner testids', () => {
  const src = read('components/app/draft-room/DraftTopBar.tsx')

  it('clock-time + clock controls', () => {
    expect(src).toMatch(/data-testid="draft-topbar-clock-time"/)
    expect(src).toMatch(/data-testid="draft-topbar-clock"/)
  })

  it('start-draft + commissioner primary entry points', () => {
    expect(src).toMatch(/data-testid="draft-topbar-start-draft"/)
    // Commissioner controls were consolidated into the topbar menu in the
    // sleeper-style reorg (commit 5e331bdbb); the menu toggle is now the
    // primary commissioner entry point.
    expect(src).toMatch(/data-testid="draft-topbar-menu-toggle"/)
  })
})

describe('DraftBoard exposes round / grid / navigation testids', () => {
  const src = read('components/app/draft-room/DraftBoard.tsx')

  it('outer board + grid + round-label', () => {
    expect(src).toMatch(/data-testid="draft-board"/)
    expect(src).toMatch(/data-testid="draft-board-grid"/)
    expect(src).toMatch(/data-testid="draft-board-round-label"/)
  })

  it('round navigation: prev / next / selector / jump-current', () => {
    expect(src).toMatch(/data-testid="draft-board-prev-round"/)
    expect(src).toMatch(/data-testid="draft-board-next-round"/)
    expect(src).toMatch(/data-testid="draft-board-round-selector"/)
    expect(src).toMatch(/data-testid="draft-board-jump-current"/)
  })

  it('per-round sections carry round-{n} testids', () => {
    expect(src).toMatch(/data-testid=\{`draft-board-round-\$\{round\}`\}/)
  })
})

describe('PlayerPanel exposes filter + search + sort testids', () => {
  const src = read('components/app/draft-room/PlayerPanel.tsx')

  it('outer panel + search input', () => {
    expect(src).toMatch(/data-testid="draft-player-panel"/)
    expect(src).toMatch(/data-testid="draft-player-search-input"/)
  })

  it('position pills + team filter + pool filter container', () => {
    expect(src).toMatch(/data-testid="draft-position-filter"/)
    expect(src).toMatch(/data-testid="draft-team-filter"/)
  })

  it('rookies-only / vets-only / watchlist / hide-drafted toggles', () => {
    expect(src).toMatch(/data-testid="draft-filter-rookies-only"/)
    expect(src).toMatch(/data-testid="draft-filter-vets-only"/)
    expect(src).toMatch(/data-testid="draft-filter-watchlist-only"/)
    expect(src).toMatch(/data-testid="draft-filter-hide-drafted"/)
    expect(src).toMatch(/data-testid="draft-clear-filters"/)
  })
})

describe('DraftPlayerCard exposes stable per-row data testids (Commit P) and graceful loading / error states', () => {
  const src = read('components/app/draft-room/DraftPlayerCard.tsx')

  it('all five Commit-P data testids are present', () => {
    expect(src).toMatch(/'draft-player-name'/)
    expect(src).toMatch(/'draft-player-injury-status'/)
    expect(src).toMatch(/'draft-player-stats-summary'/)
    expect(src).toMatch(/'draft-player-adp'/)
    expect(src).toMatch(/'draft-player-bye'/)
  })

  it('renders a loading skeleton when loading={true}', () => {
    expect(src).toMatch(/if \(loading\) \{[\s\S]+?animate-pulse/)
    expect(src).toMatch(/aria-busy="true"/)
  })

  it('renders an error pill when error is set (non-throwing UX)', () => {
    expect(src).toMatch(/if \(error\) \{[\s\S]+?text-amber-200/)
  })

  it('formats ADP / Bye with "—" placeholders for missing data', () => {
    expect(src).toMatch(/if \(v == null \|\| !Number\.isFinite\(Number\(v\)\)\) return '—'/)
    expect(src).toMatch(/if \(v == null \|\| !Number\.isFinite\(v\) \|\| v <= 0\) return '—'/)
  })
})

describe('DraftTeamPanel (war room) — empty / conditional sections', () => {
  const src = read('components/app/draft-room/DraftTeamPanel.tsx')

  it('outer panel + positional mix + drafted list testids', () => {
    expect(src).toMatch(/data-testid="draft-team-panel"/)
    expect(src).toMatch(/data-testid="draft-team-panel-positional-mix"/)
    expect(src).toMatch(/data-testid="draft-team-panel-drafted-list"/)
  })

  it('starter-needs section renders ONLY when teamNeeds.length > 0', () => {
    expect(src).toMatch(/\{teamNeeds\.length > 0 \?[\s\S]+?data-testid="draft-team-panel-needs"/)
  })

  it('bye-cluster section renders ONLY when byeClusters.length > 0', () => {
    expect(src).toMatch(/\{byeClusters\.length > 0 \?[\s\S]+?data-testid="draft-team-panel-bye-clusters"/)
  })

  it('positional-mix surfaces "No picks yet" when myPicks is empty', () => {
    expect(src).toMatch(/No picks yet/)
  })
})

describe('DraftChatPanel (Commit T) is read-only + empty/error tolerant', () => {
  const src = read('components/app/draft-room/DraftChatPanel.tsx')

  it('exposes chat-panel + pick-event + composer testids', () => {
    expect(src).toMatch(/data-testid="draft-chat-panel"/)
    expect(src).toMatch(/data-testid="draft-chat-pick-event"/)
    // Headshot now renders via shared <PlayerAvatar testIdBase="…" /> (emits
    // draft-chat-pick-headshot-{root,image,fallback,…} testids at runtime).
    expect(src).toMatch(/testIdBase="draft-chat-pick-headshot"/)
    expect(src).toMatch(/data-testid="draft-chat-pick-drafter"/)
    expect(src).toMatch(/data-testid="draft-chat-pick-ai-badge"/)
  })

  it('does NOT import submitPick / execute-pick (Commit T read-only contract)', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
  })
})

describe('DraftWarRoom (AI assistant) renders skeleton + alert states (Commit U)', () => {
  const src = read('components/draft/ai/DraftWarRoom.tsx')

  it('outer war-room + skeleton + unresolved-pick testids', () => {
    expect(src).toMatch(/data-testid="draft-war-room"/)
    expect(src).toMatch(/data-testid="draft-war-room-skeleton"/)
    expect(src).toMatch(/data-testid="draft-war-room-pick-unresolved"/)
  })

  it('error renders via <p role="alert"> for a11y', () => {
    expect(src).toMatch(/<p[\s\S]+?role="alert"[\s\S]*?>\s*\{error\}/)
  })

  it('does NOT import submitPick / execute-pick — AI is suggestion-only', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
  })
})

describe('CommissionerControlCenterModal exposes modal + close testids', () => {
  const src = read('components/app/draft-room/CommissionerControlCenterModal.tsx')

  it('exposes draft-commissioner-modal + draft-commissioner-close', () => {
    expect(src).toMatch(/data-testid="draft-commissioner-modal"/)
    expect(src).toMatch(/data-testid="draft-commissioner-close"/)
  })
})

describe('No-redirect contract — draft-mechanics surfaces are free of client-navigation primitives (Commit J)', () => {
  // Commit J's "no-redirect" rule scopes to draft mechanics flows (start /
  // pause / resume / session-mismatch / pick / commissioner / chat / AI).
  // PlayerPanel is INTENTIONALLY excluded — it has a documented fallback
  // navigation to `/player-compare` when the comparison-UI provider is
  // not mounted. That's a different UX flow, not a draft-mechanics
  // redirect, and the comparison provider is the primary code path. Any
  // future regression that introduces a router/redirect on the draft
  // mechanics surfaces below will fail here.
  const surfaces = [
    'components/app/draft-room/DraftRoomShell.tsx',
    'components/app/draft-room/DraftTopBar.tsx',
    'components/app/draft-room/DraftBoard.tsx',
    'components/app/draft-room/DraftPlayerCard.tsx',
    'components/app/draft-room/DraftTeamPanel.tsx',
    'components/app/draft-room/DraftChatPanel.tsx',
    'components/app/draft-room/DraftChatDock.tsx',
    'components/app/draft-room/CommissionerControlCenterModal.tsx',
    'components/draft/ai/DraftWarRoom.tsx',
  ]

  for (const path of surfaces) {
    it(`${path} contains no router.push / router.replace / window.location.{href,assign,replace}`, () => {
      const src = read(path)
      expect(src).not.toMatch(/router\.push\(/)
      expect(src).not.toMatch(/router\.replace\(/)
      expect(src).not.toMatch(/window\.location\.(href|assign|replace)\b/)
    })
  }

  it('PlayerPanel: the only client-navigation use is the documented player-compare fallback', () => {
    const src = read('components/app/draft-room/PlayerPanel.tsx')
    // Exactly one `window.location.href = …` line, and it points at
    // `/player-compare`. The comparison-UI provider (`compareUi`) is the
    // primary path; this fallback only fires when it's not mounted.
    const matches = src.match(/window\.location\.href\s*=/g) ?? []
    expect(matches.length).toBe(1)
    expect(src).toMatch(/window\.location\.href = `\/player-compare\?/)
    // No router.push / router.replace anywhere
    expect(src).not.toMatch(/router\.push\(/)
    expect(src).not.toMatch(/router\.replace\(/)
  })
})

describe('Pick authority is not bypassed by any UX file', () => {
  const surfaces = [
    'components/app/draft-room/DraftRoomShell.tsx',
    'components/app/draft-room/DraftTopBar.tsx',
    'components/app/draft-room/DraftBoard.tsx',
    'components/app/draft-room/PlayerPanel.tsx',
    'components/app/draft-room/DraftPlayerCard.tsx',
    'components/app/draft-room/DraftTeamPanel.tsx',
    'components/app/draft-room/DraftChatPanel.tsx',
    'components/app/draft-room/DraftChatDock.tsx',
    'components/draft/ai/DraftWarRoom.tsx',
  ]

  for (const path of surfaces) {
    it(`${path} does not import submitPick / executeDraftPick`, () => {
      const src = read(path)
      expect(src).not.toMatch(/import \{[^}]*submitPick[^}]*\} from '@\/lib\/live-draft-engine\/PickSubmissionService'/)
      expect(src).not.toMatch(/from '@\/lib\/draft\/execute-pick'/)
    })
  }
})

describe('Commit L / M / N / O / P / Q / R / S / T / U locks all still hold after Commit V', () => {
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

  it('Commit M — submitPick still has expectedOverall stale guard + race-retry tagging', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(
      /input\.expectedOverall !== overall[\s\S]+?code: DRAFT_PICK_STALE_OVERALL/,
    )
    expect(sps).toMatch(/code: DRAFT_PICK_RACE_RETRY/)
  })

  it('Commit N — PlayerPanel still imports both rookies/vets predicates', () => {
    const pp = read('components/app/draft-room/PlayerPanel.tsx')
    expect(pp).toMatch(
      /import \{[^}]*isRookieEligibleForFilter[^}]*isVetEligibleForFilter[^}]*\} from '@\/lib\/draft-room\/rookieFilterPredicate'/,
    )
  })

  it('Commit O — pool resolver test still mocks loadPlayerSeasonStatsFallback', () => {
    const t = read('__tests__/getResolvedDraftPoolForLeague.unit.test.ts')
    expect(t).toMatch(/loadPlayerSeasonStatsFallback/)
  })

  it('Commit P — DraftPlayerCard still uses the projection fallback chain', () => {
    const card = read('components/app/draft-room/DraftPlayerCard.tsx')
    expect(card).toMatch(
      /const statLine = meaningfulSummary \?\?[\s\S]+?projectedPoints != null/,
    )
  })

  it('Commit Q — autopick paths still pass expectedOverall to submitPick', () => {
    const sd = read('lib/live-draft-engine/slow-draft/SlowDraftRuntimeService.ts')
    expect(sd).toMatch(/const expectedOverall = draftSession\.picks\.length \+ 1/)
  })

  it('Commit R — commissioner controls still enforce timer bounds + force_autopick race guard', () => {
    const ctrl = read('app/api/leagues/[leagueId]/draft/controls/route.ts')
    expect(ctrl).toMatch(/code: 'COMMISSIONER_TIMER_OUT_OF_RANGE'/)
    expect(ctrl).toMatch(/const expectedOverall = draftSession\.picks\.length \+ 1/)
  })

  it('Commit S — DraftTeamPanel still computes teamNeeds + byeClusters', () => {
    const dtp = read('components/app/draft-room/DraftTeamPanel.tsx')
    expect(dtp).toMatch(/computeTeamNeeds\(\{ picks: myPicks, starterSlots \}\)/)
    expect(dtp).toMatch(/detectByeWeekClusters\(myPicks\)/)
  })

  it('Commit T — submitPick still emits announcement only on success and forwards aiManager + commissionerOverride', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(/aiManager: input\.source === 'auto',/)
    expect(sps).toMatch(/commissionerOverride: input\.source === 'commissioner',/)
  })

  it('Commit U — DraftRoomPageClient still forwards teamNeeds + byeWeekClusters into AI recommend body', () => {
    const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(drpc).toMatch(
      /teamNeeds: computeTeamNeeds\(\{[\s\S]+?starterSlots: rosterConfig\?\.starterSlots \?\? null,/,
    )
    expect(drpc).toMatch(/byeWeekClusters: detectByeWeekClusters\(/)
  })
})
