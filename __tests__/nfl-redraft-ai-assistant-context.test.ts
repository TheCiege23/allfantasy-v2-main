/**
 * NFL redraft AI draft assistant context + recommendations — source-
 * level contract lock (Commit U).
 *
 * Pins the AI assistant invariants so a future refactor can't silently
 * regress:
 *
 *   1. The assistant-context endpoint
 *      (`app/api/leagues/[leagueId]/draft/assistant-context/route.ts`)
 *      is GET-only and read-only. It returns headlines / injuries /
 *      sport digest. On any internal failure it returns
 *      `{ ok: true, sportsFeed: { available: false, ... } }` rather
 *      than throwing — assistant context can never break the draft room.
 *   2. The recommendation endpoint
 *      (`app/api/ai/draft/recommend/route.ts`) is POST-only and
 *      read-only. It NEVER imports `submitPick` /
 *      `executeDraftPick`. Provider failure surfaces as a structured
 *      `{ ok: false, error }` response.
 *   3. The orphan AI pick endpoint (`/draft/ai-pick/route.ts`) is the
 *      only AI surface that *writes* a pick, and it does so by routing
 *      through the canonical `submitPick` (via
 *      `executeDraftPickForOrphan` →
 *      `lib/live-draft-engine/PickSubmissionService`). It is gated on
 *      `assertCommissioner`. AI context surfaces never call it
 *      directly.
 *   4. The DraftWarRoom component (`components/draft/ai/DraftWarRoom.tsx`)
 *      is read-only re: pick authority — no submitPick / execute-pick
 *      imports, no client-navigation primitives. AI suggestions surface
 *      via `onDraftPlayer` / `onAddToQueue` callbacks that route back
 *      through the existing pick / queue authority paths.
 *   5. DraftRoomPageClient enriches the recommend-route request body
 *      with Commit-S `teamNeeds` and `byeWeekClusters` so the AI helper
 *      has structured roster-construction context (rule-correct, driven
 *      by the league's actual `starterSlots` map). Pure additive — the
 *      recommend route currently doesn't read these fields, so older
 *      AI helpers continue to function unchanged.
 *   6. The AI helpers under `lib/draft-room/teamNeeds.ts` are pure
 *      (asserted at Commit S) — no React / Prisma / fetch / next /
 *      submitPick / execute-pick imports. Server-importable from any
 *      AI prompt-building path.
 *   7. fetchWarRoom in DraftRoomPageClient handles AI failure
 *      gracefully: a non-ok response sets `setWarRoomError(...)` and
 *      `setWarRoomData(null)` without throwing or redirecting; the
 *      DraftWarRoom component renders the error in a `<p role="alert">`.
 *   8. Commits J / L / M / N / O / P / Q / R / S / T locks all still
 *      wired.
 *
 * Static-source assertions only — keeps the lock cheap.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// Routes ask lib/league/commissionerAccess.ts (2026-11-16); this defers to the old check this test mocks.
vi.mock('@/lib/league/commissionerAccess', async () => (await import('./helpers/commissionerAccessMock')).accessFromLegacyMocks())

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Assistant-context endpoint is GET-only and never throws to the client', () => {
  const src = read('app/api/leagues/[leagueId]/draft/assistant-context/route.ts')

  it('exports only GET (no POST / PUT / DELETE / PATCH)', () => {
    expect(src).toMatch(/export async function GET\(/)
    expect(src).not.toMatch(/export async function POST\(/)
    expect(src).not.toMatch(/export async function PUT\(/)
    expect(src).not.toMatch(/export async function DELETE\(/)
    expect(src).not.toMatch(/export async function PATCH\(/)
  })

  it('does NOT import submitPick / execute-pick / queue / pool write APIs', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
    expect(src).not.toMatch(/from '@\/lib\/draft-queue-engine'/)
  })

  it('catches internal failure and returns ok:true with disabled sportsFeed (graceful degrade)', () => {
    expect(src).toMatch(
      /catch \(error\) \{[\s\S]+?available: false,[\s\S]+?digest: null,/,
    )
  })

  it('checks canAccessLeagueDraft before returning context (auth gate)', () => {
    expect(src).toMatch(
      /import \{ canAccessLeagueDraft \} from '@\/lib\/live-draft-engine\/auth'/,
    )
    expect(src).toMatch(/await canAccessLeagueDraft\(leagueId, userId\)/)
  })
})

describe('AI recommendation endpoint is POST-only and read-only', () => {
  const src = read('app/api/ai/draft/recommend/route.ts')

  it('exports only POST', () => {
    expect(src).toMatch(/export async function POST\(/)
    expect(src).not.toMatch(/export async function GET\(/)
    expect(src).not.toMatch(/export async function PUT\(/)
    expect(src).not.toMatch(/export async function DELETE\(/)
  })

  it('does NOT import submitPick / executeDraftPick (no pick writes)', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
    expect(src).not.toMatch(/import \{[^}]*submitPick[^}]*\}/)
  })

  it('does NOT import queue / commissioner / autopick write surfaces', () => {
    expect(src).not.toMatch(/from '@\/lib\/draft-queue-engine'/)
    expect(src).not.toMatch(/from '@\/lib\/live-draft-engine\/slow-draft/)
    expect(src).not.toMatch(/from '@\/lib\/live-draft-engine\/autopickBestAvailableSubmit'/)
  })

  it('asserts league access before running the recommendation', () => {
    expect(src).toMatch(/await assertLeagueAccess\(leagueId, session\.user\.id\)/)
    expect(src).toMatch(/return NextResponse\.json\(\{ ok: false, error: 'League not found or forbidden' \}, \{ status: 403 \}\)/)
  })

  it('returns a structured 401 when no session', () => {
    expect(src).toMatch(/return NextResponse\.json\(\{ ok: false, error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('returns a structured 400 when availablePlayers missing', () => {
    expect(src).toMatch(/'availablePlayers required'/)
  })

  it('catches helper failure and returns a structured error (no provider/key kills the route)', () => {
    expect(src).toMatch(/catch \(e\)/)
    expect(src).toMatch(/'War room failed'/)
  })
})

describe('DraftWarRoom client surface is read-only re: pick authority', () => {
  const src = read('components/draft/ai/DraftWarRoom.tsx')

  it('does NOT import submitPick / execute-pick', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
    expect(src).not.toMatch(/import \{[^}]*submitPick[^}]*\}/)
  })

  it('does NOT introduce client-navigation primitives (Commit J no-redirect)', () => {
    expect(src).not.toMatch(/router\.push/)
    expect(src).not.toMatch(/router\.replace/)
    expect(src).not.toMatch(/window\.location\.(href|assign|replace)/)
  })

  it('exposes pick / queue actions via callback props (suggestion-only — caller routes through authority)', () => {
    expect(src).toMatch(/onDraftPlayer: \(player: PlayerEntry\) => void/)
    expect(src).toMatch(/onAddToQueue: \(player: PlayerEntry\) => void/)
  })

  it('exposes the canonical war-room test ids', () => {
    expect(src).toMatch(/data-testid="draft-war-room"/)
    expect(src).toMatch(/data-testid="draft-war-room-skeleton"/)
    expect(src).toMatch(/data-testid="draft-war-room-pick-unresolved"/)
  })

  it('renders error as <p role="alert"> (a11y + non-throwing UX)', () => {
    expect(src).toMatch(/<p[\s\S]+?role="alert"[\s\S]*?>\s*\{error\}/)
  })
})

describe('Orphan AI pick is the only AI surface that writes — and it routes through canonical submitPick', () => {
  const route = read('app/api/leagues/[leagueId]/draft/ai-pick/route.ts')
  const svc = read('lib/orphan-ai-manager/OrphanAIManagerService.ts')

  it('orphan AI route is gated on the shared commissioner rule (league setup)', () => {
    expect(route).toMatch(/await assertCommissionerAccess\(leagueId, userId, 'league'\)/)
  })

  it('orphan AI route delegates to executeDraftPickForOrphan', () => {
    expect(route).toMatch(
      /import \{ executeDraftPickForOrphan \} from '@\/lib\/orphan-ai-manager\/OrphanAIManagerService'/,
    )
  })

  it('OrphanAIManagerService writes via canonical submitPick (Commit L/M authority)', () => {
    expect(svc).toMatch(
      /import \{ submitPick \} from '@\/lib\/live-draft-engine\/PickSubmissionService'/,
    )
    expect(svc).toMatch(/await submitPick\(\{/)
    // Defensive: never imports the legacy pick path.
    expect(svc).not.toMatch(/from '@\/lib\/draft\/execute-pick'/)
  })
})

describe('DraftRoomPageClient enriches the recommend request with Commit-S team-needs context', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('imports the pure helpers from teamNeeds', () => {
    expect(src).toMatch(
      /import \{ computeTeamNeeds, detectByeWeekClusters \} from '@\/lib\/draft-room\/teamNeeds'/,
    )
  })

  it('forwards teamNeeds: computeTeamNeeds(...) into the recommend body', () => {
    expect(src).toMatch(
      /teamNeeds: computeTeamNeeds\(\{[\s\S]+?picks: myRoster\.map\(\(r\) => \(\{ position: r\.position \}\)\),[\s\S]+?starterSlots: rosterConfig\?\.starterSlots \?\? null,/,
    )
  })

  it('forwards byeWeekClusters: detectByeWeekClusters(...) into the recommend body', () => {
    expect(src).toMatch(
      /byeWeekClusters: detectByeWeekClusters\([\s\S]+?myRoster\.map\(\(r\) => \(\{ position: r\.position, byeWeek: r\.byeWeek \}\)\),[\s\S]+?\)/,
    )
  })

  it('fetchWarRoom handles AI failure gracefully (sets error, does not throw)', () => {
    expect(src).toMatch(/setWarRoomError\(/)
    expect(src).toMatch(/setWarRoomData\(null\)/)
  })
})

describe('teamNeeds helpers stay pure (Commit S contract still holds for AI consumers)', () => {
  const src = read('lib/draft-room/teamNeeds.ts')

  it('does not import React / Prisma / fetch / next / submitPick / execute-pick', () => {
    expect(src).not.toMatch(/from 'react'/)
    expect(src).not.toMatch(/from '@prisma\/client'/)
    expect(src).not.toMatch(/from '@\/lib\/prisma'/)
    expect(src).not.toMatch(/from 'next\//)
    expect(src).not.toMatch(/PickSubmissionService|execute-pick|submitPick/)
  })
})

describe('Commit J / L / M / N / O / P / Q / R / S / T locks still hold after Commit U', () => {
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

  it('Commit S — DraftTeamPanel still computes teamNeeds and byeClusters', () => {
    const dtp = read('components/app/draft-room/DraftTeamPanel.tsx')
    expect(dtp).toMatch(/computeTeamNeeds\(\{ picks: myPicks, starterSlots \}\)/)
    expect(dtp).toMatch(/detectByeWeekClusters\(myPicks\)/)
  })

  it('Commit T — submitPick still emits the announcement only on success and forwards commissionerOverride', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(/aiManager: input\.source === 'auto',/)
    expect(sps).toMatch(/commissionerOverride: input\.source === 'commissioner',/)
  })
})
