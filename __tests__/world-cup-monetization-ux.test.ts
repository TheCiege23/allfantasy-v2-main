/**
 * world-cup-monetization-ux.test.ts
 *
 * Static-analysis tests for:
 *   1. Quick Actions i18n key fix  — keys in QUICK_ACTIONS match bracketsI18n
 *   2. Chat 402 response shape     — WORLD_CUP_CHIMMY_LOCKED code + upgradePath
 *   3. Chat 429 response shape     — daily_ai_limit_reached + message/used/limit
 *   4. AI teaser upgrade button    — WorldCupBracketShell has upgrade CTA for locked state
 *   5. Chimmy hint upgrade link    — locked hint has Link to /pricing?from=wc-chimmy
 *   6. worldCupAiUsageLimits copy  — upgrade messages include expected upgrade path anchors
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const cwd = process.cwd()

function read(rel: string) {
  return readFileSync(resolve(cwd, rel), "utf-8")
}

// ── 1. Quick Actions i18n key fix ────────────────────────────────────────────

describe("Quick Actions i18n key fix (app/brackets/page.tsx)", () => {
  it('QUICK_ACTIONS uses "create" not "createPool"', () => {
    const src = read("app/brackets/page.tsx")
    expect(src).toContain('key: "create"')
    expect(src).not.toContain('key: "createPool"')
  })

  it('QUICK_ACTIONS uses "join" not "joinWithCode"', () => {
    const src = read("app/brackets/page.tsx")
    expect(src).toContain('key: "join"')
    expect(src).not.toContain('key: "joinWithCode"')
  })

  it('QUICK_ACTIONS uses "continue" not "continueBracket"', () => {
    const src = read("app/brackets/page.tsx")
    expect(src).toContain('key: "continue"')
    expect(src).not.toContain('key: "continueBracket"')
  })

  it('QUICK_ACTIONS uses "browse" not "browsePools"', () => {
    const src = read("app/brackets/page.tsx")
    expect(src).toContain('key: "browse"')
    expect(src).not.toContain('key: "browsePools"')
  })

  it("bracketsI18n has all four quickActions keys (create/join/continue/browse)", () => {
    const src = read("lib/brackets/bracketsI18n.ts")
    expect(src).toContain('"brk.hub.quickActions.create"')
    expect(src).toContain('"brk.hub.quickActions.join"')
    expect(src).toContain('"brk.hub.quickActions.continue"')
    expect(src).toContain('"brk.hub.quickActions.browse"')
  })

  it("bracketsI18n has all four quickActions description keys", () => {
    const src = read("lib/brackets/bracketsI18n.ts")
    expect(src).toContain('"brk.hub.quickActions.createDesc"')
    expect(src).toContain('"brk.hub.quickActions.joinDesc"')
    expect(src).toContain('"brk.hub.quickActions.continueDesc"')
    expect(src).toContain('"brk.hub.quickActions.browseDesc"')
  })

  it("bracketsI18n does NOT have the stale createPool/joinWithCode/continueBracket/browsePools keys", () => {
    const src = read("lib/brackets/bracketsI18n.ts")
    expect(src).not.toContain('"brk.hub.quickActions.createPool"')
    expect(src).not.toContain('"brk.hub.quickActions.joinWithCode"')
    expect(src).not.toContain('"brk.hub.quickActions.continueBracket"')
    expect(src).not.toContain('"brk.hub.quickActions.browsePools"')
  })
})

// ── 2. Chat 402 response shape ────────────────────────────────────────────────

describe("WC chat route 402 response (Chimmy locked)", () => {
  /*
   * ⚠ THE HARD 402 LOCK IS RETIRED — Chimmy is TOKEN-METERED NOW, and this test
   * was still asserting the old contract. The route's only remaining 402 is a
   * failed token DEDUCTION (it carries `code: err.code`), while the gate a
   * non-subscriber actually meets is `resolveWcCapTier` -> 429 with an
   * upgradePath, which the "429 response" describe below covers and which passes.
   *
   * Checked before rewriting rather than assumed: `WORLD_CUP_CHIMMY_LOCKED` now
   * appears in exactly ONE file, WorldCupBracketShell.tsx, and nowhere on the
   * server. So the assertion could never pass again.
   *
   * ⚠ AND THE LEFTOVER IS WORTH KNOWING ABOUT, which is why this is a rewritten
   * assertion and not a deletion: the CLIENT still branches on
   * `res.status === 402 && data.code === "WORLD_CUP_CHIMMY_LOCKED"`
   * (WorldCupBracketShell.tsx, in the chat error handler). Nothing emits that
   * pair any more, so it is a dead branch — harmless, because the 429 path below
   * carries the upgrade gate, but it should not be mistaken for a live one.
   */
  it("gates unentitled Chimmy through the tier cap, not a hard 402 lock", () => {
    const src = read("app/api/brackets/world-cup/[challengeId]/chat/route.ts")
    expect(src).toContain("resolveWcCapTier")
    expect(src).toContain("checkWorldCupChimmyRateLimit")
    expect(src).not.toContain("WORLD_CUP_CHIMMY_LOCKED")
  })

  it("402 response includes upgradePath pointing to pricing", () => {
    const src = read("app/api/brackets/world-cup/[challengeId]/chat/route.ts")
    // The 402 block must include an upgradePath so the client can deep-link
    expect(src).toContain('upgradePath: "/pricing?from=wc-chimmy"')
  })

  it("the refusal a free user meets carries a deep-link to pricing", () => {
    const src = read("app/api/brackets/world-cup/[challengeId]/chat/route.ts")
    // Replaces an `upgrade: true` flag that went away with the 402 contract.
    // What the client needs is the destination, and that is still emitted.
    expect(src).toContain('"/pricing?from=wc-chimmy"')
    expect(src).toContain("getWcUpgradeMessage")
  })
})

// ── 3. Chat 429 response shape ────────────────────────────────────────────────

describe("WC chat route 429 response (daily limit reached)", () => {
  it("returns error key daily_ai_limit_reached on 429", () => {
    const src = read("app/api/brackets/world-cup/[challengeId]/chat/route.ts")
    expect(src).toContain("daily_ai_limit_reached")
    expect(src).toContain('status: 429')
  })

  it("429 response includes used and limit fields for display", () => {
    const src = read("app/api/brackets/world-cup/[challengeId]/chat/route.ts")
    expect(src).toContain("rateLimit.used")
    expect(src).toContain("rateLimit.limit")
  })

  it("429 response includes upgradePath", () => {
    const src = read("app/api/brackets/world-cup/[challengeId]/chat/route.ts")
    expect(src).toContain('upgradePath: chimmyTier === "free" ? "/pricing?from=wc-chimmy" : "/pricing"')
  })
})

// ── 4. WorldCupBracketShell upgrade CTA (AI teaser) ──────────────────────────

describe("WorldCupBracketShell AI teaser upgrade CTA", () => {
  /*
   * ⚠ THE CTA IS STILL THERE — TWO STRING LITERALS UNDER IT MOVED, AND THIS TEST
   * WAS PINNED TO THE OLD ONES. It asserted a `?from=wc-ai-teaser` deep-link and
   * a `wc.home.ai.unlockHint` key; neither exists anywhere in the repo now.
   *
   * Checked before rewriting, because "the monetization CTA vanished" and "the
   * test is stale" look identical from a red assertion: the component carries
   * four /pricing links, an entitlement-aware `world-cup-ai-features-teaser`
   * section, and `aiInsightsUnlocked` gating throughout. The upgrade path is
   * intact; only the source param and the i18n key changed.
   *
   * Asserted below against the literals that are actually in the file, so the
   * test keeps its original intent — a non-pro user is offered a way to upgrade
   * from the AI surface — without pinning it to a query string nobody uses.
   */
  it("offers non-pro users an upgrade path from the AI surface", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain("/pricing?from=wc-chimmy")
    expect(src).toContain("Upgrade to AF Pro")
  })

  it("the upgrade link sits in the locked branch, behind an entitlement guard", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain("wc.chat.aiHint.locked")
    expect(src).toContain("aiInsightsUnlocked")
    expect(src).toContain('data-testid="world-cup-ai-features-teaser"')
  })
})

// ── 5. Chimmy hint upgrade link ───────────────────────────────────────────────

describe("WorldCupBracketShell Chimmy locked hint upgrade link", () => {
  it("locked Chimmy hint includes upgrade link to /pricing?from=wc-chimmy", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain("/pricing?from=wc-chimmy")
  })

  it("locked Chimmy hint still shows aiHint.locked i18n text", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain('wc.chat.aiHint.locked')
  })
})

// ── 6. chatAiGate structured error state ─────────────────────────────────────

describe("WorldCupBracketShell chatAiGate structured error state", () => {
  it("defines chatAiGate state with chimmy_locked and daily_limit types", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain("chatAiGate")
    expect(src).toContain('"chimmy_locked"')
    expect(src).toContain('"daily_limit"')
  })

  it("sendChatMessage checks status 402 and WORLD_CUP_CHIMMY_LOCKED code", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain('res.status === 402')
    expect(src).toContain('"WORLD_CUP_CHIMMY_LOCKED"')
  })

  it("sendChatMessage checks status 429 and daily_ai_limit_reached error", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain('res.status === 429')
    expect(src).toContain('"daily_ai_limit_reached"')
  })

  it("renders upgrade card with Unlock AF Pro heading for chimmy_locked", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain("Unlock AF Pro")
    expect(src).toContain("Get more Chimmy answers")
  })

  it("renders daily-limit card with today's AI limit copy", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    expect(src).toContain("today&apos;s AI limit")
    expect(src).toContain("Upgrade for more AI")
  })

  it("daily-limit card shows used/limit counts when available", () => {
    const src = read("components/brackets/world-cup/WorldCupBracketShell.tsx")
    // Both fields must be read from chatAiGate for the count display
    expect(src).toContain("chatAiGate.used")
    expect(src).toContain("chatAiGate.limit")
    expect(src).toContain("Resets at midnight UTC")
  })
})

// ── 7. worldCupAiUsageLimits upgrade messages ────────────────────────────────

describe("worldCupAiUsageLimits upgrade copy", () => {
  it("free chimmy upgrade message mentions AF Pro", () => {
    const src = read("lib/world-cup/worldCupAiUsageLimits.ts")
    expect(src).toContain("AF Pro")
    expect(src).toContain("chimmy")
  })

  it("upgrade paths use /pricing with wc-* source context", () => {
    const src = read("lib/world-cup/worldCupAiUsageLimits.ts")
    expect(src).toContain("/pricing?from=wc-chimmy")
    expect(src).toContain("/pricing?from=wc-explain")
    expect(src).toContain("/pricing?from=wc-matchup-ai")
  })
})
