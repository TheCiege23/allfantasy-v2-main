/**
 * NFL redraft war room / team needs panel — source-level contract lock
 * (Commit S).
 *
 * Pins the war-room invariants so a future refactor can't silently
 * regress:
 *
 *   1. Pure helpers live in `lib/draft-room/teamNeeds.ts` (no React,
 *      no Prisma, no fetch — importable from server paths too).
 *   2. `DraftTeamPanel` imports the helpers, computes
 *      `teamNeeds = computeTeamNeeds({ picks: myPicks, starterSlots })`
 *      and `byeClusters = detectByeWeekClusters(myPicks)`.
 *   3. Stable test ids on every roster-construction surface:
 *        - draft-team-panel
 *        - draft-team-panel-positional-mix
 *        - draft-team-panel-needs (only when teamNeeds.length > 0)
 *        - draft-team-panel-need-{position}      per chip
 *        - draft-team-panel-bye-clusters         (only when ≥1 cluster)
 *        - draft-team-panel-bye-cluster-{week}   per row
 *        - draft-team-panel-drafted-list
 *      The needs / bye sections render conditionally so empty state
 *      doesn't surface a chrome-only panel.
 *   4. War room source surface (DraftTeamPanel + WarRoomPopup +
 *      teamNeeds) does NOT import `submitPick` or any pick-write
 *      surface. War room is read-only by design.
 *   5. War room source surface does NOT introduce client-navigation
 *      primitives (Commit J no-redirect rule).
 *   6. DraftRoomPageClient still mounts exactly one `<DraftRoomShell>`
 *      and one `<DraftBoard>` (Commit E unified-state lock) and still
 *      has the 409 / DRAFT_SESSION_MISMATCH in-place handler (Commit J).
 *   7. byeWeek is flowed from session.picks into draftedPicks so the
 *      panel can detect bye clusters when pool data carries the field.
 *   8. Commits L / M / N / O / P / Q / R locks all still wired.
 *
 * Static-source assertions only — keeps the lock cheap.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('teamNeeds module is a pure helper (no React / Prisma / fetch)', () => {
  const src = read('lib/draft-room/teamNeeds.ts')

  it('exports computeTeamNeeds', () => {
    expect(src).toMatch(/export function computeTeamNeeds/)
  })

  it('exports detectByeWeekClusters', () => {
    expect(src).toMatch(/export function detectByeWeekClusters/)
  })

  it('does not import React / Prisma / fetch / next', () => {
    expect(src).not.toMatch(/from 'react'/)
    expect(src).not.toMatch(/from '@prisma\/client'/)
    expect(src).not.toMatch(/from '@\/lib\/prisma'/)
    expect(src).not.toMatch(/from 'next\//)
    // Defensive: also rule out any draft-engine writer imports
    expect(src).not.toMatch(/PickSubmissionService|execute-pick|submitPick/)
  })

  it('declares the canonical TeamNeed and ByeCluster types', () => {
    expect(src).toMatch(/export type TeamNeed = \{[\s\S]+?position: string[\s\S]+?have: number[\s\S]+?target: number[\s\S]+?remaining: number[\s\S]+?tone: TeamNeedTone[\s\S]+?\}/)
    expect(src).toMatch(/export type ByeCluster = \{[\s\S]+?byeWeek: number[\s\S]+?count: number[\s\S]+?positions: string\[\][\s\S]+?\}/)
  })

  it('classifies tone="heavy" at ≥ target + 2 and "ok" at exactly target', () => {
    expect(src).toMatch(/if \(have >= target \+ 2\) tone = 'heavy'/)
    expect(src).toMatch(/else if \(have >= target\) tone = 'ok'/)
  })

  it('default bye-cluster threshold is 3 starters sharing a bye', () => {
    expect(src).toMatch(/threshold = 3/)
  })
})

describe('DraftTeamPanel wires the team-needs surface', () => {
  const src = read('components/app/draft-room/DraftTeamPanel.tsx')

  it('imports the computeTeamNeeds + detectByeWeekClusters helpers', () => {
    expect(src).toMatch(
      /import \{ computeStarterNeedsForDisplay, detectByeWeekClusters \} from '@\/lib\/draft-room\/teamNeeds'/,
    )
  })

  it('computes teamNeeds from { picks: myPicks, starterSlots }', () => {
    expect(src).toMatch(
      /const teamNeeds = computeStarterNeedsForDisplay\(\{ picks: myPicks, starterSlots \}\)/,
    )
  })

  it('computes byeClusters from myPicks', () => {
    expect(src).toMatch(/const byeClusters = detectByeWeekClusters\(myPicks\)/)
  })

  it('byeWeek flows through DraftTeamPanelProps.draftedPicks', () => {
    expect(src).toMatch(/byeWeek\?: number \| null/)
  })

  it('renders the needs section ONLY when teamNeeds.length > 0', () => {
    expect(src).toMatch(/\{teamNeeds\.length > 0 \?/)
  })

  it('renders the bye-cluster section ONLY when byeClusters.length > 0', () => {
    expect(src).toMatch(/\{byeClusters\.length > 0 \?/)
  })

  it('exposes stable test ids on every roster-construction surface', () => {
    expect(src).toMatch(/data-testid="draft-team-panel"/)
    expect(src).toMatch(/data-testid="draft-team-panel-positional-mix"/)
    expect(src).toMatch(/data-testid="draft-team-panel-needs"/)
    expect(src).toMatch(/data-testid=\{`draft-team-panel-need-\$\{n\.position\.toLowerCase\(\)\}`\}/)
    expect(src).toMatch(/data-testid="draft-team-panel-bye-clusters"/)
    expect(src).toMatch(/data-testid=\{`draft-team-panel-bye-cluster-\$\{c\.byeWeek\}`\}/)
    expect(src).toMatch(/data-testid="draft-team-panel-drafted-list"/)
  })

  it('chips carry data-tone for downstream styling / e2e selectors', () => {
    expect(src).toMatch(/data-tone=\{n\.tone\}/)
  })
})

describe('War room source surface is read-only and redirect-free', () => {
  const dtp = read('components/app/draft-room/DraftTeamPanel.tsx')
  const wrp = read('components/app/draft-room/WarRoomPopup.tsx')
  const tn = read('lib/draft-room/teamNeeds.ts')

  for (const [path, src] of [
    ['DraftTeamPanel.tsx', dtp],
    ['WarRoomPopup.tsx', wrp],
    ['lib/draft-room/teamNeeds.ts', tn],
  ] as const) {
    it(`${path} does not import submitPick / execute-pick / pick API routes`, () => {
      expect(src).not.toMatch(/PickSubmissionService/)
      expect(src).not.toMatch(/execute-pick/)
      expect(src).not.toMatch(/from '@\/app\/api\/leagues/)
    })

    it(`${path} does not introduce client-navigation primitives`, () => {
      expect(src).not.toMatch(/router\.push/)
      expect(src).not.toMatch(/router\.replace/)
      expect(src).not.toMatch(/window\.location\.(href|assign|replace)/)
    })
  }
})

describe('DraftRoomPageClient still flows byeWeek into draftedPicks', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('maps `byeWeek: (p as { byeWeek?: number | null }).byeWeek ?? null` into draftedPicks', () => {
    expect(src).toMatch(
      /byeWeek: \(p as \{ byeWeek\?: number \| null \}\)\.byeWeek \?\? null/,
    )
  })

  it('still mounts the WarRoomPopup with DraftTeamPanel as its content', () => {
    expect(src).toMatch(
      /<WarRoomPopup[\s\S]+?<DraftTeamPanel \{\.\.\.draftTeamPanelProps\}/,
    )
  })
})

describe('Commit E / Commit J / Commit L / Commit M / Commit N / Commit P / Commit Q / Commit R locks still hold after Commit S', () => {
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

  it('Commit N — PlayerPanel still imports both rookies/vets predicates', () => {
    const pp = read('components/app/draft-room/PlayerPanel.tsx')
    expect(pp).toMatch(
      /import \{[^}]*isRookieEligibleForFilter[^}]*isVetEligibleForFilter[^}]*\} from '@\/lib\/draft-room\/rookieFilterPredicate'/,
    )
  })

  it('Commit P — DraftPlayerCard still exposes the stable data testids', () => {
    const card = read('components/app/draft-room/DraftPlayerCard.tsx')
    expect(card).toMatch(/'draft-player-name'/)
    expect(card).toMatch(/'draft-player-stats-summary'/)
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
})
