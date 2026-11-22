/**
 * Commit W — DraftShell tab labels never leak raw i18n keys.
 *
 * Pins the bug-fix that surfaced after PR #12 / Commit V went live: the
 * legacy `app/draft/components/DraftShell.tsx` right-side tab strip
 * called `t('draftRoom.legacy.queueTab') ?? 'Queue'`, but the codebase's
 * `t()` returns the raw key string when a translation is missing. The
 * `??` only falls back on `null` / `undefined`, so the raw key string
 * leaked into the visible tab label.
 *
 * Three layers of defense are now in place:
 *
 *   1. **Translation source** — both EN (`lib/i18n/translations.ts`)
 *      and ES parity (`lib/i18n/translations-es-parity.ts`) define
 *      `draftRoom.legacy.{queueTab,rosterTab,aiTab}`. So the primary
 *      lookup resolves correctly.
 *   2. **Resilient call site** — `DraftShell.tsx` now treats a `t()`
 *      return that equals the lookup key as a miss and falls through
 *      to a literal label (`'Queue'` / `'Roster'` / `'Draft Chat'` /
 *      `'AI'`). Belt-and-suspenders if a future translation key is
 *      ever removed.
 *   3. **No-leak invariant** — this test scans the source for the
 *      original `t('…') ?? 'literal'` shape that caused the bug. Any
 *      reintroduction will fail here.
 *
 * Static-source assertions only — does not exercise React render.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Translation source defines the missing legacy tab keys', () => {
  it('EN translations.ts has draftRoom.legacy.queueTab / rosterTab / aiTab', () => {
    const src = read('lib/i18n/translations.ts')
    expect(src).toMatch(/"draftRoom\.legacy\.queueTab":\s*"Queue"/)
    expect(src).toMatch(/"draftRoom\.legacy\.rosterTab":\s*"Roster"/)
    expect(src).toMatch(/"draftRoom\.legacy\.aiTab":\s*"Chimmy"/)
  })

  it('ES parity translations-es-parity.ts has the same three keys (with ES values)', () => {
    const src = read('lib/i18n/translations-es-parity.ts')
    expect(src).toMatch(/"draftRoom\.legacy\.queueTab":\s*"Cola"/)
    expect(src).toMatch(/"draftRoom\.legacy\.rosterTab":\s*"Plantilla"/)
    expect(src).toMatch(/"draftRoom\.legacy\.aiTab":\s*"Chimmy"/)
  })
})

describe('DraftShell resilient label resolver', () => {
  const src = read('app/draft/components/DraftShell.tsx')

  it('does NOT use the broken `t(...) ?? literal` shape that leaked raw keys', () => {
    // Specifically: any `t('draftRoom.legacy.…') ?? '…'` in the tab
    // strip would re-introduce the bug. The fixed code uses a separate
    // i18nKey + label pair and a key-comparison fallback instead.
    expect(src).not.toMatch(/t\('draftRoom\.legacy\.queueTab'\)\s*\?\?/)
    expect(src).not.toMatch(/t\('draftRoom\.legacy\.rosterTab'\)\s*\?\?/)
  })

  it('declares the four right-tab entries with both i18nKey AND literal label', () => {
    expect(src).toMatch(
      /\{\s*key:\s*'queue',\s*i18nKey:\s*'draftRoom\.legacy\.queueTab',\s*label:\s*'Queue'\s*\}/,
    )
    expect(src).toMatch(
      /\{\s*key:\s*'roster',\s*i18nKey:\s*'draftRoom\.legacy\.rosterTab',\s*label:\s*'Roster'\s*\}/,
    )
    expect(src).toMatch(
      /\{\s*key:\s*'chat',\s*i18nKey:\s*'draftRoom\.legacy\.draftChat',\s*label:\s*'Draft Chat'\s*\}/,
    )
    expect(src).toMatch(
      /\{\s*key:\s*'ai',\s*i18nKey:\s*'draftRoom\.legacy\.aiTab',\s*label:\s*'Chimmy'\s*\}/,
    )
  })

  it('falls back to the literal label when t() returns the key string itself', () => {
    expect(src).toMatch(
      /typeof translated === 'string' && translated && translated !== tab\.i18nKey[\s\S]+?\? translated[\s\S]+?: tab\.label/,
    )
  })

  it('preserves the existing test ids on each rendered tab button', () => {
    expect(src).toMatch(/data-testid=\{`draft-right-tab-\$\{tab\.key\}`\}/)
    expect(src).toMatch(/data-testid=\{`draft-right-tab-content-\$\{rightTab\}`\}/)
  })

  it('does not contain any visible literal `draftRoom.legacy.` strings outside translation lookups', () => {
    // No JSX child or attribute that hardcodes a raw key string.
    // (i18nKey property values are allowed since they go to t(); we look
    // for the bug shape: the string appearing as text content.)
    expect(src).not.toMatch(/>\s*draftRoom\.legacy\.[a-zA-Z]+\s*</)
  })
})

describe('Commit L–V locks still hold after Commit W', () => {
  it('Commit P — DraftPlayerCard still has stable data testids (no UI regression)', () => {
    const card = read('components/app/draft-room/DraftPlayerCard.tsx')
    expect(card).toMatch(/'draft-player-name'/)
    expect(card).toMatch(/'draft-player-stats-summary'/)
    expect(card).toMatch(/'draft-player-injury-status'/)
  })

  it('Commit S — DraftTeamPanel still computes teamNeeds + byeClusters', () => {
    const dtp = read('components/app/draft-room/DraftTeamPanel.tsx')
    expect(dtp).toMatch(/computeStarterNeedsForDisplay\(\{ picks: myPicks, starterSlots \}\)/)
    expect(dtp).toMatch(/detectByeWeekClusters\(myPicks\)/)
  })

  it('Commit M — submitPick still has the expectedOverall stale guard', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(
      /input\.expectedOverall !== overall[\s\S]+?code: DRAFT_PICK_STALE_OVERALL/,
    )
  })

  it('Commit T — submitPick still emits announcement with aiManager + commissionerOverride', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(/aiManager: input\.source === 'auto',/)
    expect(sps).toMatch(/commissionerOverride: input\.source === 'commissioner',/)
  })
})

describe('No mechanics changes (Commit W is visual-only)', () => {
  // Sanity: the Commit-W diff should not touch any pick-authority,
  // queue, autopick, commissioner, AI mutation, or chat-write file.
  it('lib/live-draft-engine/PickSubmissionService.ts is unchanged shape (still exports submitPick + emits announcement)', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(/export async function submitPick/)
    expect(sps).toMatch(/postDraftPickChatEvent/)
  })

  it('app/api/leagues/[leagueId]/draft/pick/route.ts still imports the canonical submitPick', () => {
    const route = read('app/api/leagues/[leagueId]/draft/pick/route.ts')
    expect(route).toMatch(
      /import \{[^}]*submitPick[^}]*\} from '@\/lib\/live-draft-engine\/PickSubmissionService'/,
    )
  })

  it('DraftRoomShell still mounts DraftRoomPageClient unchanged (Commit V responsive contract intact)', () => {
    const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')
    // Shell + Board mount counts (Commit E) preserved
    expect((drpc.match(/<DraftRoomShell\b/g) ?? []).length).toBe(1)
    expect((drpc.match(/<DraftBoard\b/g) ?? []).length).toBe(1)
  })
})
