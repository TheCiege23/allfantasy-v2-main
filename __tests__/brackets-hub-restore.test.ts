/**
 * Coverage for the Phase 7 premium /brackets hub restoration.
 *
 * Verifies:
 *  - The page source contains every major section (the approved bracket workspace,
 *    how-it-works, sports grid, AI features strip, footer), and the World
 *    Cup is switched off as a destination (owner call, 2026-10-01).
 *  - All visible static labels are routed through `t("brk.hub.*")` —
 *    no pre-restoration hardcoded English literals remain.
 *  - Every new `brk.hub.*` key exists in every supported locale, with
 *    representative non-English label spot checks.
 *  - The asset paths used in the hero (AF logo, AF mascot, WC logo,
 *    WC poster, WC video) actually exist in `public/`. This is the
 *    "asset fallback" guarantee from the brief — if a future commit
 *    removes one of these without updating the hub, the test fires.
 *  - The page remains a server preference shell: no `"use client"`, no
 *    `useSession`, no `useState`, no Prisma import. (The emergency
 *    hardening that pre-dated this rebuild was caused exactly by a
 *    client-island `useSession` hydration race; this test keeps that
 *    fence in place.)
 *  - The page reuses `resolveServerRenderPreferences` (the safe
 *    server-only locale resolver already shipping on
 *    /brackets/world-cup pages).
 *  - The workspace owns a scoped dark canvas and readable text in every mode.
 *  - No new app route / page files were added; the existing
 *    `app/brackets/page.tsx` is still the only `page.tsx` under
 *    `app/brackets/` at the root.
 *  - The page does NOT import the dev Google Translate batch script.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  BRACKETS_TRANSLATIONS,
  BRACKETS_SUPPORTED_LOCALES,
  bracketsT,
} from "@/lib/brackets/bracketsI18n"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")

function readSource(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8")
}

const HUB_SRC = readSource("app/brackets/page.tsx")
const WORKSPACE_SRC = readSource("components/brackets/BracketExperienceHub.tsx")
const WORKSPACE_CSS = readSource("components/brackets/bracket-experience.css")

// ── Section presence ──────────────────────────────────────────────────────

describe("brackets hub restore: section coverage", () => {
  it("server shell mounts the approved workspace with localized hero and tournament controls", () => {
    expect(HUB_SRC).toContain("<BracketExperienceHub")
    expect(HUB_SRC).toContain("language={language}")
    // The tab order comes from the calendar, computed once on the server.
    expect(HUB_SRC).toContain("orderHubTournaments(new Date())")
    expect(WORKSPACE_SRC).toContain('data-testid="brackets-hub-hero"')
    expect(WORKSPACE_SRC).toContain("bracketExperienceCopy(language)")
    for (const label of ["eyebrow", "title", "titleEnd", "subtitle", "create", "join"]) {
      expect(WORKSPACE_SRC).toContain(`{copy.${label}}`)
    }
    for (const sport of ["mlb", "nhl"]) {
      expect(WORKSPACE_SRC).toContain(`data-testid="brackets-hub-cta-${sport}"`)
    }
    // The tournament switch builds its test ids per tab.
    for (const sport of ["cfp", "nba-cup", "nfl"]) {
      expect(WORKSPACE_SRC).toContain(`"brackets-hub-cta-${sport}"`)
    }
    expect(HUB_SRC).toContain(`t("brk.hub.logoAlt")`)
    expect(HUB_SRC).toContain(`t("brk.hub.heroDashboard")`)
  })

  it("workspace creation follows the selected tournament and keeps MLB, NHL and join destinations", () => {
    expect(WORKSPACE_SRC).toContain('{ ncaaf: "NCAAF", nba_cup: "NBA_CUP", nfl: "NFL" }')
    expect(WORKSPACE_SRC).toContain("href={createHref(sport)}")
    expect(WORKSPACE_SRC).toContain('href="/brackets/leagues/new?sport=MLB&challengeType=playoff_challenge"')
    expect(WORKSPACE_SRC).toContain('href="/brackets/leagues/new?sport=NHL&challengeType=playoff_challenge"')
    expect(WORKSPACE_SRC).toContain('href="/brackets/join"')
  })

  it("the World Cup is switched off as a destination (owner call, 2026-10-01)", () => {
    // The v2 hero kept "2026 FIFA World Cup · Registration Open" live three
    // months after the final. Nothing on the hub may lead into the World Cup
    // flows now: not the hero, not the quick actions, not the sports grid.
    for (const route of [`"/brackets/world-cup"`, `"/brackets/world-cup/create"`, `"/brackets/world-cup/discover"`]) {
      expect(HUB_SRC, `hub still links ${route}`).not.toContain(`href=${route}`)
      expect(HUB_SRC, `hub still links ${route}`).not.toContain(`href: ${route}`)
    }
    expect(HUB_SRC).not.toContain(`t("brk.hub.v2.regBadge")`)
    expect(HUB_SRC).not.toContain('data-testid="brackets-hub-wc-spotlight"')
    // The grid keeps the card, marked ended and not a link.
    expect(HUB_SRC).toContain(`{ key: "worldCup", href: null, status: "ended"`)
  })

  it("how-it-works 3-step section renders", () => {
    expect(HUB_SRC).toContain('data-testid="brackets-hub-how-it-works"')
    expect(HUB_SRC).toContain(`t("brk.hub.howItWorks.title")`)
    for (const step of [1, 2, 3]) {
      expect(HUB_SRC).toContain(`brk.hub.howItWorks.step${step}Title`)
      expect(HUB_SRC).toContain(`brk.hub.howItWorks.step${step}Body`)
    }
  })

  it("sports grid renders all 9 sport cards", () => {
    expect(HUB_SRC).toContain('data-testid="brackets-hub-sports-grid"')
    expect(HUB_SRC).toContain(`t("brk.hub.sports.title")`)
    expect(HUB_SRC).toContain(`t("brk.hub.sports.subtitle")`)
    const sports = [
      "worldCup",
      "nbaPlayoffs",
      "nhlPlayoffs",
      "nflPlayoffs",
      "mlbPostseason",
      "marchMadness",
      "collegeFootball",
      "nbaCup",
      "soccer",
    ]
    for (const key of sports) {
      // The card lookup uses template literals (titleKey/descKey),
      // so the source contains each sport identifier in the
      // SPORT_CARDS array literal and the template patterns
      // `brk.hub.sports.sport.${key}` / `brk.hub.sports.sport.${key}.desc`.
      expect(HUB_SRC).toContain(`key: "${key}"`)
    }
    // Stable test-id template-literal source construction (one assert,
    // not per-sport, since the data-testid is built at render time).
    expect(HUB_SRC).toContain("brackets-hub-sport-${key}")
    // The template-literal source construction for the title + desc
    // keys is asserted once (not per-sport) so the parity test below
    // confirms the dictionary actually has the resolved keys.
    expect(HUB_SRC).toContain("brk.hub.sports.sport.${key}")
    expect(HUB_SRC).toContain("brk.hub.sports.sport.${key}.desc")
    // Live cards link via the SPORT_CARDS data table, then <Link href={href}>.
    expect(HUB_SRC).toContain(`href: playoffPoolHref("MLB")`)
    expect(HUB_SRC).toContain(`href: playoffPoolHref("NHL")`)
    expect(HUB_SRC).toContain(`href: playoffPoolHref("NCAAF")`)
    expect(HUB_SRC).toContain(`href: playoffPoolHref("NBA_CUP")`)
    // NFL playoff pools are creatable (playoff engine sport "nfl"), no longer "January".
    expect(HUB_SRC).toContain(`href: playoffPoolHref("NFL")`)
    expect(HUB_SRC).toContain(`<Link key={key} href={href}`)
    // Status labels: live / ended / a month for up-next / generic coming soon.
    expect(HUB_SRC).toContain(`t("brk.hub.sports.statusLive")`)
    expect(HUB_SRC).toContain(`t("brk.hub.sports.statusEnded")`)
    expect(HUB_SRC).toContain(`t(soonLabelKey ?? "brk.hub.sports.statusComingSoon")`)
  })

  it("AI features strip renders all 6 features", () => {
    expect(HUB_SRC).toContain('data-testid="brackets-hub-ai-features"')
    expect(HUB_SRC).toContain(`t("brk.hub.features.title")`)
    const features = [
      "aiReport",
      "rooting",
      "danger",
      "commissioner",
      "share",
      "leaderboards",
    ]
    for (const key of features) {
      // Features come from an AI_FEATURES array; each `key` literal
      // must appear in source as `key: "<feature>"`.
      expect(HUB_SRC).toContain(`key: "${key}"`)
    }
    // Template-literal source construction for the label + desc keys.
    expect(HUB_SRC).toContain("brk.hub.features.${key}")
    expect(HUB_SRC).toContain("brk.hub.features.${key}.desc")
  })

  it("footer renders the trust note", () => {
    expect(HUB_SRC).toContain('data-testid="brackets-hub-footer"')
    expect(HUB_SRC).toContain(`t("brk.hub.footer.note")`)
  })
})

// ── Pre-restore literals are gone ────────────────────────────────────────

describe("brackets hub restore: pre-restoration literals removed", () => {
  it("no longer hardcodes the minimal hardened JSX literals", () => {
    const banned = [
      'background: "#0b1020"',
      "Get started",
      ">Create a pool<",
      ">Join with code<",
      "MINIMAL HARDENED",
      ">Sports<",
      // The minimal page had a 32-px padding inline style — should
      // be replaced by Tailwind class usage now.
      'padding: "32px 16px"',
    ]
    for (const phrase of banned) {
      expect(
        HUB_SRC,
        `Restored hub should not contain "${phrase}"`
      ).not.toContain(phrase)
    }
  })

  it("does not hardcode the v2 hero copy in JSX (every visible string flows through t())", () => {
    // Sanity: the literal English copy from the v2 design must NEVER
    // appear in the JSX render path — it has to be looked up via t()
    // so non-English locales work.
    const banned = [
      ">2026 FIFA World Cup<",
      ">AF World Cup<",
      ">Bracket Challenge<",
      ">32 Teams<",
      ">48 Matches<",
      ">Group Stage + Knockouts<",
      ">100% Free<",
      ">World Cup Bracket<",
      ">Create Pool<",
      ">Discover Pools<",
      "Join thousands of fans competing worldwide",
      // v3 hero copy — same rule.
      ">AF Playoff<",
      ">MLB Postseason Bracket<",
      ">NHL Playoff Bracket<",
      ">Up next<",
      "Bracket leagues open now",
    ]
    for (const phrase of banned) {
      expect(
        HUB_SRC,
        `Hero JSX should not hardcode "${phrase}"`
      ).not.toContain(phrase)
    }
  })
})

// ── i18n parity for new hub keys ─────────────────────────────────────────

describe("brackets hub restore: i18n parity", () => {
  const newKeys = [
    // v3 hero (the active design — playoff-led, 2026-10-01)
    "brk.hub.v3.openBadge",
    "brk.hub.v3.titleLine1",
    "brk.hub.v3.titleLine2",
    "brk.hub.v3.subtitle",
    "brk.hub.v3.cta.mlb",
    "brk.hub.v3.cta.nhl",
    "brk.hub.v3.cta.cfp",
    "brk.hub.v3.cta.nbaCup",
    "brk.hub.v3.upNext.title",
    "brk.hub.v3.upNext.ncaaf",
    "brk.hub.v3.upNext.nfl",
    "brk.hub.sports.statusEnded",
    "brk.hub.sports.statusDecember",
    "brk.hub.sports.statusJanuary",
    // v2 hero (World Cup) — no longer rendered; kept in the dictionary
    "brk.hub.v2.regBadge",
    "brk.hub.v2.titleLine1",
    "brk.hub.v2.titleLine2",
    "brk.hub.v2.subtitle",
    "brk.hub.v2.feature.teams",
    "brk.hub.v2.feature.matches",
    "brk.hub.v2.feature.format",
    "brk.hub.v2.feature.free",
    "brk.hub.v2.cta.openBracket",
    "brk.hub.v2.cta.createPool",
    "brk.hub.v2.cta.discoverPools",
    "brk.hub.v2.cta.joinWithCode",
    "brk.hub.v2.fanLine",
    // v1 keys retained in the dictionary (unused by JSX now but kept
    // around so the parity tests below + any future variant can reuse
    // them without needing another i18n round-trip).
    "brk.hub.eyebrow",
    "brk.hub.heroTitle",
    "brk.hub.heroSubtitle",
    "brk.hub.heroBadge",
    "brk.hub.heroCreateWc",
    "brk.hub.heroJoinWithCode",
    "brk.hub.heroDiscover",
    "brk.hub.heroDashboard",
    "brk.hub.spotlight.eyebrow",
    "brk.hub.spotlight.title",
    "brk.hub.spotlight.subtitle",
    "brk.hub.spotlight.feature.groupStage",
    "brk.hub.spotlight.feature.knockoutBracket",
    "brk.hub.spotlight.feature.aiReport",
    "brk.hub.spotlight.feature.dangerZones",
    "brk.hub.spotlight.feature.commissionerTools",
    "brk.hub.spotlight.feature.inviteShare",
    "brk.hub.spotlight.feature.fiveLanguages",
    "brk.hub.howItWorks.title",
    "brk.hub.howItWorks.step1Title",
    "brk.hub.howItWorks.step1Body",
    "brk.hub.howItWorks.step2Title",
    "brk.hub.howItWorks.step2Body",
    "brk.hub.howItWorks.step3Title",
    "brk.hub.howItWorks.step3Body",
    "brk.hub.howItWorks.step4Title",
    "brk.hub.howItWorks.step4Body",
    "brk.hub.quickActions.title",
    "brk.hub.quickActions.create",
    "brk.hub.quickActions.createDesc",
    "brk.hub.quickActions.join",
    "brk.hub.quickActions.joinDesc",
    "brk.hub.quickActions.continue",
    "brk.hub.quickActions.continueDesc",
    "brk.hub.quickActions.browse",
    "brk.hub.quickActions.browseDesc",
    "brk.hub.sports.title",
    "brk.hub.sports.subtitle",
    "brk.hub.sports.statusLive",
    "brk.hub.sports.statusComingSoon",
    "brk.hub.sports.openCta",
    "brk.hub.sports.sport.worldCup",
    "brk.hub.sports.sport.worldCup.desc",
    "brk.hub.sports.sport.nbaPlayoffs",
    "brk.hub.sports.sport.nbaPlayoffs.desc",
    "brk.hub.sports.sport.nhlPlayoffs",
    "brk.hub.sports.sport.nhlPlayoffs.desc",
    "brk.hub.sports.sport.nflPlayoffs",
    "brk.hub.sports.sport.nflPlayoffs.desc",
    "brk.hub.sports.sport.mlbPostseason",
    "brk.hub.sports.sport.mlbPostseason.desc",
    "brk.hub.sports.sport.marchMadness",
    "brk.hub.sports.sport.marchMadness.desc",
    "brk.hub.sports.sport.collegeFootball",
    "brk.hub.sports.sport.collegeFootball.desc",
    "brk.hub.sports.sport.soccer",
    "brk.hub.sports.sport.soccer.desc",
    "brk.hub.features.title",
    "brk.hub.features.aiReport",
    "brk.hub.features.aiReport.desc",
    "brk.hub.features.rooting",
    "brk.hub.features.rooting.desc",
    "brk.hub.features.danger",
    "brk.hub.features.danger.desc",
    "brk.hub.features.commissioner",
    "brk.hub.features.commissioner.desc",
    "brk.hub.features.share",
    "brk.hub.features.share.desc",
    "brk.hub.features.leaderboards",
    "brk.hub.features.leaderboards.desc",
    "brk.hub.footer.note",
    "brk.hub.mascotAlt",
    "brk.hub.logoAlt",
    "brk.hub.wcLogoAlt",
  ]

  for (const locale of BRACKETS_SUPPORTED_LOCALES) {
    it(`every new hub key has a translation in locale "${locale}"`, () => {
      const dict = BRACKETS_TRANSLATIONS[locale]
      const missing: string[] = []
      for (const key of newKeys) {
        if (typeof dict[key] !== "string" || dict[key].length === 0) {
          missing.push(key)
        }
      }
      expect(missing, `Locale "${locale}" is missing keys`).toEqual([])
    })
  }

  it.each([
    // v2 hero spot checks — one representative per locale.
    ["en", "brk.hub.v2.titleLine1", "AF World Cup"],
    ["en", "brk.hub.v2.titleLine2", "Bracket Challenge"],
    ["es", "brk.hub.v2.titleLine1", "AF Copa del Mundo"],
    ["es", "brk.hub.v2.titleLine2", "Desafío de Brackets"],
    ["zh", "brk.hub.v2.titleLine1", "AF 世界盃"],
    ["zh", "brk.hub.v2.titleLine2", "對戰挑戰"],
    ["fil", "brk.hub.v2.cta.createPool", "Gumawa ng pool"],
    ["vi", "brk.hub.v2.cta.openBracket", "Mở Bracket World Cup"],
    ["en", "brk.hub.v2.feature.teams", "48 Teams"],
    ["es", "brk.hub.v2.feature.teams", "48 selecciones"],
    ["zh", "brk.hub.v2.feature.format", "12 個小組 + 淘汰賽"],
    ["vi", "brk.hub.v2.feature.free", "Miễn phí 100%"],
    // v3 hero spot checks — one or two per locale.
    ["en", "brk.hub.v3.openBadge", "Bracket leagues open now"],
    ["en", "brk.hub.v3.upNext.nfl", "NFL Playoffs · January"],
    ["es", "brk.hub.v3.titleLine2", "Desafío de Brackets"],
    ["es", "brk.hub.sports.statusEnded", "Finalizado"],
    ["zh", "brk.hub.v3.titleLine1", "AF 季後賽"],
    ["zh", "brk.hub.sports.statusJanuary", "1 月"],
    ["fil", "brk.hub.v3.upNext.title", "Susunod"],
    ["vi", "brk.hub.sports.statusDecember", "Tháng 12"],
    // Supporting sections still need their existing translations.
    ["en", "brk.hub.sports.statusLive", "Live now"],
    ["es", "brk.hub.sports.statusLive", "En vivo"],
    ["zh", "brk.hub.sports.statusLive", "進行中"],
    ["fil", "brk.hub.sports.statusComingSoon", "Malapit na"],
    ["vi", "brk.hub.sports.statusComingSoon", "Sắp ra mắt"],
  ])("locale %s key %s renders as %s", (locale, key, expected) => {
    expect(bracketsT(locale, key)).toBe(expected)
  })

  it("unsupported locale falls back to English", () => {
    expect(bracketsT("xx", "brk.hub.v3.titleLine1")).toBe("AF Playoff")
    expect(bracketsT("xx", "brk.hub.v3.titleLine2")).toBe("Bracket Challenge")
    expect(bracketsT("xx", "brk.hub.v3.openBadge")).toBe("Bracket leagues open now")
  })
})

// ── Asset fallback ───────────────────────────────────────────────────────

describe("brackets hub restore: asset paths exist in public/", () => {
  // v3 uses one image: the transparent AF wordmark. The trophy lockup is a
  // lucide icon now, not the World Cup logo.
  //
  // ⚠ This used to check `/branding/allfantasy-wordmark-logo.png`, and it
  // PASSED — but only because that path appears in a COMMENT in the page
  // explaining why it was replaced. The image the page actually renders is
  // `/brand/allfantasy-wordmark-transparent.png`, which nothing checked.
  const assets = ["public/brand/allfantasy-wordmark-transparent.png"]

  for (const asset of assets) {
    it(`asset present: ${asset}`, () => {
      expect(
        existsSync(resolve(root, asset)),
        `${asset} must exist (hub hero references it via next/image)`
      ).toBe(true)
    })
  }

  it("hub renders the asset it checks — assigned in code, not merely mentioned", () => {
    expect(HUB_SRC).toContain(`const AF_WORDMARK_SRC = "/brand/allfantasy-wordmark-transparent.png"`)
    expect(HUB_SRC).toContain("src={AF_WORDMARK_SRC}")
  })
})

// ── Server-component / hydration safety fence ────────────────────────────

describe("brackets hub restore: server component safety fence", () => {
  it("page keeps server preference resolution outside the client workspace", () => {
    expect(HUB_SRC).not.toMatch(/^"use client"/m)
    // Match the function call form, not the substring (JSDoc legitimately
    // mentions "useSession" / "useState" when explaining what we DON'T do).
    expect(HUB_SRC).not.toMatch(/\buseSession\(/)
    expect(HUB_SRC).not.toMatch(/\buseState\(/)
    expect(HUB_SRC).not.toMatch(/\buseEffect\(/)
  })

  it("page does NOT import Prisma at render scope", () => {
    expect(HUB_SRC).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
    expect(HUB_SRC).not.toMatch(/from\s+["']\.\/prisma["']/)
    expect(HUB_SRC).not.toMatch(/PrismaClient/)
  })

  it("page uses the safe server-only preference resolver for locale", () => {
    expect(HUB_SRC).toContain(`resolveServerRenderPreferences`)
    expect(HUB_SRC).toContain(`makeBracketsT`)
  })

  it("page owns the approved dark canvas without the global light-mode rescue override", () => {
    expect(HUB_SRC).toContain('className="af-bracket-experience ')
    expect(HUB_SRC).not.toMatch(/className="[^"]*\bmode-readable\b/)
    expect(WORKSPACE_SRC).toContain('import "./bracket-experience.css"')
    const canvas = WORKSPACE_CSS.match(/\.af-bracket-experience\s*\{([^}]+)\}/)?.[1]
    expect(canvas).toContain("#071519")
    expect(canvas).toContain("color: #eafff6")
  })

  it("page does NOT import the dev Google Translate batch script", () => {
    expect(HUB_SRC).not.toMatch(/translate-brackets-i18n/i)
    expect(HUB_SRC).not.toMatch(/googleapis\.com\/translate/i)
    expect(HUB_SRC).not.toMatch(/GOOGLE_TRANSLATE_API_KEY/)
  })
})

// ── Route budget safety ─────────────────────────────────────────────────

describe("brackets hub restore: route budget safety", () => {
  it("only one page.tsx exists at app/brackets/ root (no new pages)", () => {
    const dir = resolve(root, "app", "brackets")
    const entries = readdirSync(dir)
    const pageFiles = entries.filter((entry) =>
      ["page.ts", "page.tsx", "page.js", "page.jsx"].includes(entry)
    )
    expect(pageFiles).toEqual(["page.tsx"])
  })

  it("no new route.ts file lives in app/brackets/ root", () => {
    const dir = resolve(root, "app", "brackets")
    const entries = readdirSync(dir)
    const routeFiles = entries.filter((entry) =>
      ["route.ts", "route.tsx", "route.js"].includes(entry)
    )
    expect(routeFiles).toEqual([])
  })

  it("the live hub destinations resolve to existing pages", () => {
    // Production uses Railway; a retired Vercel-wide route ceiling does not
    // validate this hub. Its navigation must still land on real pages.
    for (const page of [
      "app/brackets/join/page.tsx",
      "app/brackets/leagues/new/page.tsx",
    ]) {
      expect(existsSync(resolve(root, page)), `${page} must exist`).toBe(true)
    }
  })
})
