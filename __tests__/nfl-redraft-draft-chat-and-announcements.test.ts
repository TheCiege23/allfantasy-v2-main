/**
 * NFL redraft live draft chat + pick announcements — source-level
 * contract lock (Commit T).
 *
 * Pins the chat / announcement invariants so a future refactor can't
 * silently regress:
 *
 *   1. The pick announcement is emitted from a SINGLE site at the end
 *      of `submitPick`, after the success path has set `pick = ...` and
 *      before the `return { success: true }`. Failed picks return early
 *      with `{ success: false }` and never reach the announcement code.
 *   2. The announcement is fire-and-forget:
 *        `void import('…postDraftPickChatEvent').then(...).catch(() => {})`
 *      so a chat-write failure cannot break pick execution.
 *   3. Announcement badges flip on input.source:
 *        - aiManager: input.source === 'auto'
 *        - commissionerOverride: input.source === 'commissioner'
 *      Mutually exclusive — the source enum guarantees only one matches.
 *   4. `postDraftPickChatEvent` writes via `createLeagueChatMessage`
 *      with `source: 'draft'` + `type: 'draft_pick'` so draft pick
 *      rows are excluded from the league chat stream (per the route
 *      contract documented at `app/api/leagues/.../draft/chat/route.ts`).
 *      Fire-and-forget by design: failures never affect draft mechanics.
 *   5. Idempotency comes from the Commit-M race guard inside the
 *      `submitPick` transaction. Two concurrent successful picks at the
 *      same overall are impossible — the second loses to the in-tx
 *      `picks.length !== picksCount` check (or the P2002 unique-constraint
 *      catch). Either way, only one announcement fires per overall.
 *   6. The announcement source surface
 *      (`lib/draft-room/postDraftPickChatEvent.ts`) does NOT import
 *      `submitPick` or `executeDraftPick` — chat write only depends on
 *      the league chat service. Authority flow is one-way.
 *   7. The chat client surface
 *      (`components/app/draft-room/DraftChatPanel.tsx` +
 *       `components/app/draft-room/DraftChatDock.tsx`) is read-only
 *      with respect to pick authority: no submitPick / execute-pick
 *      imports, no client-navigation primitives.
 *   8. DraftChatPanel exposes the canonical Commit-T test ids:
 *        - draft-chat-panel
 *        - draft-chat-pick-event       (each pick chat row)
 *        - draft-chat-pick-headshot
 *        - draft-chat-pick-drafter
 *        - draft-chat-pick-ai-badge    (when aiManager metadata is set)
 *   9. The chat API route lives at
 *      `app/api/leagues/[leagueId]/draft/chat/route.ts` and uses
 *      `createLeagueChatMessage` (not submitPick) for every user-
 *      authored post.
 *  10. Commits J / L / M / N / O / P / Q / R / S locks all still wired.
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

describe('Pick announcement is emitted only on the submitPick success path', () => {
  const src = read('lib/live-draft-engine/PickSubmissionService.ts')

  it('imports postDraftPickChatEvent dynamically (lazy boundary, prevents cyclic imports)', () => {
    expect(src).toMatch(
      /void import\('@\/lib\/draft-room\/postDraftPickChatEvent'\)/,
    )
  })

  it('passes the resolved pick fields into the announcement payload', () => {
    expect(src).toMatch(
      /postDraftPickChatEvent\(\{[\s\S]+?leagueId: input\.leagueId,[\s\S]+?rosterId: effectiveRosterId,[\s\S]+?playerName: input\.playerName\.trim\(\),[\s\S]+?position: input\.position\.trim\(\),[\s\S]+?overall: pick\.overall,[\s\S]+?pickLabel,/,
    )
  })

  it('flips aiManager when source === "auto"', () => {
    expect(src).toMatch(/aiManager: input\.source === 'auto',/)
  })

  it('flips commissionerOverride when source === "commissioner" (Commit T)', () => {
    expect(src).toMatch(/commissionerOverride: input\.source === 'commissioner',/)
  })

  it('is fire-and-forget — chat write failure cannot break pick execution', () => {
    // The void prefix detaches the promise; .catch(() => {}) swallows.
    expect(src).toMatch(
      /void import\('@\/lib\/draft-room\/postDraftPickChatEvent'\)[\s\S]+?\.catch\(\(\) => \{\}\)/,
    )
  })

  it('is reached after `pick` is set and before `return { success: true }` (success-only path)', () => {
    const announceIdx = src.indexOf('postDraftPickChatEvent({')
    // Match the success return via regex so CRLF / LF line endings both work
    const successReturnMatch = src.match(/return \{\s+success: true,/)
    expect(announceIdx).toBeGreaterThan(0)
    expect(successReturnMatch).not.toBeNull()
    expect(successReturnMatch!.index!).toBeGreaterThan(announceIdx)
  })

  it('every early failure return runs BEFORE the announcement site (no failure path leaks)', () => {
    // Sanity check: every `success: false` return appears earlier in the
    // file than the announcement's `void import('@/lib/draft-room/postDraftPickChatEvent')`.
    const announceIdx = src.indexOf("void import('@/lib/draft-room/postDraftPickChatEvent')")
    expect(announceIdx).toBeGreaterThan(0)
    const core = src.slice(src.indexOf('async function _submitPickCore('), src.indexOf('export async function submitPick('))
    const coreAnnounceIdx = core.indexOf("void import('@/lib/draft-room/postDraftPickChatEvent')")
    expect(coreAnnounceIdx).toBeGreaterThan(0)
    const failureReturnRegex = /return \{ success: false[\s\S]*?\}/g
    let m: RegExpExecArray | null
    while ((m = failureReturnRegex.exec(core)) !== null) {
      expect(m.index).toBeLessThan(coreAnnounceIdx)
    }
  })
})

describe('postDraftPickChatEvent — write contract', () => {
  const src = read('lib/draft-room/postDraftPickChatEvent.ts')

  it('writes via createLeagueChatMessage (NOT submitPick)', () => {
    expect(src).toMatch(
      /import \{ createLeagueChatMessage \} from '@\/lib\/league-chat\/LeagueChatMessageService'/,
    )
    expect(src).toMatch(/await createLeagueChatMessage\(/)
  })

  it('does NOT import submitPick or execute-pick (one-way authority flow)', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
    expect(src).not.toMatch(/submitPick/)
  })

  it('persists the message with source="draft" + type="draft_pick"', () => {
    expect(src).toMatch(/type: 'draft_pick'/)
    expect(src).toMatch(/source: 'draft'/)
  })

  it('explicitly excludes the row from league chat sync', () => {
    expect(src).toMatch(/leagueChatSyncExcluded: true/)
  })

  it('stamps aiManager metadata only when input.aiManager === true', () => {
    expect(src).toMatch(
      /\.\.\.\(input\.aiManager === true \? \{ aiManager: true \} : \{\}\)/,
    )
  })

  it('stamps commissionerOverride metadata only when input.commissionerOverride === true (Commit T)', () => {
    expect(src).toMatch(
      /\.\.\.\(input\.commissionerOverride === true \? \{ commissionerOverride: true \} : \{\}\)/,
    )
  })

  it('input shape declares the new commissionerOverride field', () => {
    expect(src).toMatch(/commissionerOverride\?: boolean/)
  })

  it('header comment marks the helper as fire-and-forget', () => {
    expect(src).toMatch(/Fire-and-forget from pick submission/i)
  })
})

describe('Idempotency — Commit-M race guard prevents double announcements', () => {
  const sps = read('lib/live-draft-engine/PickSubmissionService.ts')

  it('the in-tx picks.length race guard still throws "Draft state changed; please retry"', () => {
    expect(sps).toMatch(
      /locked\.picks\.length !== picksCount[\s\S]+?throw new Error\('Draft state changed; please retry'\)/,
    )
  })

  it('P2002 unique-constraint loss returns success: false (no announcement)', () => {
    expect(sps).toMatch(
      /error\.code === 'P2002'[\s\S]+?success: false,[\s\S]+?code: DRAFT_PICK_RACE_RETRY/,
    )
  })

  it('the application-level race ("Draft state changed") returns success: false (no announcement)', () => {
    expect(sps).toMatch(
      /\/Draft state changed\/[\s\S]+?success: false,[\s\S]+?code: DRAFT_PICK_RACE_RETRY/,
    )
  })
})

describe('DraftChatPanel — read-only client surface with stable test ids', () => {
  const src = read('components/app/draft-room/DraftChatPanel.tsx')

  it('does NOT import submitPick / execute-pick (chat is read-only re: pick authority)', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
    expect(src).not.toMatch(/from '@\/lib\/live-draft-engine\/PickSubmissionService'/)
  })

  it('does NOT introduce client-navigation primitives (Commit J no-redirect)', () => {
    expect(src).not.toMatch(/router\.push/)
    expect(src).not.toMatch(/router\.replace/)
    expect(src).not.toMatch(/window\.location\.(href|assign|replace)/)
  })

  it('exposes the canonical chat panel test id', () => {
    expect(src).toMatch(/data-testid="draft-chat-panel"/)
  })

  it('exposes pick-event test ids for chat pick cards', () => {
    expect(src).toMatch(/data-testid="draft-chat-pick-event"/)
    // Headshot now renders via the shared <PlayerAvatar testIdBase="…" />, which
    // emits draft-chat-pick-headshot-{root,image,fallback,…} testids at runtime.
    expect(src).toMatch(/testIdBase="draft-chat-pick-headshot"/)
    expect(src).toMatch(/data-testid="draft-chat-pick-drafter"/)
    expect(src).toMatch(/data-testid="draft-chat-pick-ai-badge"/)
  })
})

describe('DraftChatDock — read-only sibling surface', () => {
  const src = read('components/app/draft-room/DraftChatDock.tsx')

  it('does NOT import submitPick / execute-pick', () => {
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
    expect(src).not.toMatch(/from '@\/lib\/live-draft-engine\/PickSubmissionService'/)
  })

  it('does NOT introduce client-navigation primitives', () => {
    expect(src).not.toMatch(/router\.push/)
    expect(src).not.toMatch(/router\.replace/)
    expect(src).not.toMatch(/window\.location\.(href|assign|replace)/)
  })
})

describe('Chat API route writes via the canonical league chat service', () => {
  const src = read('app/api/leagues/[leagueId]/draft/chat/route.ts')

  it('imports createLeagueChatMessage (NOT submitPick)', () => {
    expect(src).toMatch(
      /import \{ createLeagueChatMessage \} from '@\/lib\/league-chat\/LeagueChatMessageService'/,
    )
    expect(src).not.toMatch(/PickSubmissionService/)
    expect(src).not.toMatch(/execute-pick/)
  })

  it('header docstring documents the source/type contract for draft pick rows', () => {
    expect(src).toMatch(/Draft pick notifications are always persisted as `source='draft', type='draft_pick'`/)
  })
})

describe('Commit J / L / M / N / O / P / Q / R / S locks still hold after Commit T', () => {
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
})
