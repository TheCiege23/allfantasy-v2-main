// @vitest-environment jsdom
/**
 * A private league's Find a League card in Spanish (2026-11-07). Only the "Ask to join" button was
 * translated; the "Private league" badge, the chips, the detail lines ("League type", "Draft type",
 * "Draft status", "Teams filled", "AI features"), "Draft not scheduled" and the commissioner-approval
 * line were English literals. They are `findLeague.card.*` keys now, English in translations.ts and
 * Spanish in translations-es-parity.ts — the pattern the Ask to join keys follow.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { translations } from "@/lib/i18n/translations"
import type { DiscoveryCard, DiscoveryLeagueStyle } from "@/lib/public-discovery/types"

const lang = vi.hoisted(() => ({ code: "es" as "en" | "es" }))

vi.mock("@/hooks/useUserTimezone", () => ({ useUserTimezone: () => ({ timezone: "America/New_York" }) }))
vi.mock("@/components/i18n/LanguageProviderClient", async () => {
  const { translations: dict } = await import("@/lib/i18n/translations")
  const { interpolateTemplate } = await import("@/lib/i18n/interpolate")
  const t = (key: string) => dict[lang.code]?.[key] ?? dict.en[key] ?? key
  return {
    useOptionalLanguage: () => ({
      language: lang.code,
      setLanguage: () => {},
      t,
      tInterpolate: (key: string, vars: Record<string, string | number> = {}) => interpolateTemplate(t(key), vars),
    }),
  }
})

import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"

afterEach(() => {
  cleanup()
  lang.code = "es"
})

function privateCard(o: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: "fantasy",
    id: "P1",
    name: "Friends & Family",
    description: null,
    sport: "NFL",
    memberCount: 4,
    maxMembers: 12,
    joinUrl: "",
    joinMode: "approval",
    detailUrl: "",
    ownerName: "Commissioner",
    ownerAvatar: null,
    creatorSlug: null,
    creatorName: null,
    tournamentName: null,
    season: 2026,
    scoringMode: "ppr",
    isPaid: false,
    isPrivate: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    fillPct: 33,
    leagueType: "fantasy",
    leagueStyle: "best_ball",
    draftType: "snake",
    draftStatus: "pre_draft",
    teamCount: 12,
    draftDate: null,
    commissionerName: "Commissioner",
    aiFeatures: [],
    leagueTier: 1,
    ...o,
  } as DiscoveryCard
}

const ENGLISH_ON_THE_PRIVATE_CARD = [
  "Private league",
  "League type",
  "Draft type",
  "Draft status",
  "Teams filled",
  "AI features",
  "Draft not scheduled",
  "The commissioner approves every new manager",
  "members-only",
  "Free",
  "pre draft",
  "snake",
  "None",
]

describe("the private card in Spanish", () => {
  it("🛑 shows no English copy — every label, chip and line is translated", () => {
    render(<FindLeagueCard league={privateCard()} />)
    const text = document.body.textContent ?? ""
    expect(screen.getByText("Liga privada")).toBeTruthy()
    expect(text).toContain("Tipo de liga: best ball")
    expect(text).toContain("Tipo de draft: serpiente")
    expect(text).toContain("Estado del draft: antes del draft")
    expect(text).toContain("Equipos ocupados: 4 / 12")
    expect(text).toContain("Funciones de IA: Ninguna")
    expect(text).toContain("Draft sin programar")
    expect(screen.getByTestId("find-league-private-note-P1").textContent).toContain("El comisionado aprueba")
    expect(screen.getByTestId("find-league-ask-P1").textContent).toContain(translations.es["findLeague.ask.button"])
    expect(ENGLISH_ON_THE_PRIVATE_CARD.filter((s) => text.includes(s))).toEqual([])
    expect(text).not.toMatch(/findLeague\./)
  })

  it("a Guilly card says Guilly", () => {
    render(<FindLeagueCard league={privateCard({ leagueStyle: "guillotine" })} />)
    expect(document.body.textContent).toContain("Tipo de liga: guilly")
  })

  it("[control] in English the card reads exactly as it always did", () => {
    lang.code = "en"
    render(<FindLeagueCard league={privateCard()} />)
    const text = document.body.textContent ?? ""
    expect(screen.getByText("Private league")).toBeTruthy()
    for (const line of [
      "League type: best ball",
      "Draft type: snake",
      "Draft status: pre draft",
      "Teams filled: 4 / 12",
      "AI features: None",
      "Draft not scheduled",
      "The commissioner approves every new manager. Rosters and chat stay members-only.",
    ]) {
      expect(text).toContain(line)
    }
  })
})

/* The key-scan pattern of join-requests-card.test.tsx, for the card's own keys. */
const SOURCE = readFileSync(resolve(__dirname, "../../components/discovery/FindLeagueCard.tsx"), "utf8")
const literalKeys = [...new Set([...SOURCE.matchAll(/['"](findLeague\.card\.[A-Za-z0-9_.]+[A-Za-z0-9_])['"]/g)].map((m) => m[1]!))]
const prefixes = literalKeys.filter((k) => ["findLeague.card.style", "findLeague.card.source", "findLeague.card.draftType", "findLeague.card.draftStatus"].includes(k))
const STYLES: DiscoveryLeagueStyle[] = ["redraft", "dynasty", "best_ball", "keeper", "survivor", "guillotine", "bracket", "community"]
const codeKeys = [
  ...STYLES.map((s) => `findLeague.card.style.${s}`),
  ...["fantasy", "creator", "bracket"].map((s) => `findLeague.card.source.${s}`),
  ...["snake", "linear", "auction"].map((s) => `findLeague.card.draftType.${s}`),
  ...["pre_draft", "in_progress", "paused", "completed"].map((s) => `findLeague.card.draftStatus.${s}`),
  ...["step_up", "your_level", "chill"].flatMap((s) => [`findLeague.card.rankBand.${s}`, `findLeague.card.rankBandHint.${s}`]),
]
const keysUsed = [...literalKeys.filter((k) => !prefixes.includes(k)), ...codeKeys]

describe("find-league card copy is translated", () => {
  it("🛑 every key the card uses exists in English AND Spanish", () => {
    expect(prefixes).toHaveLength(4) // the scan sees the code-label prefixes
    expect(keysUsed.length).toBeGreaterThanOrEqual(45)
    expect(keysUsed.filter((k) => !translations.en[k])).toEqual([])
    expect(keysUsed.filter((k) => !translations.es[k])).toEqual([])
    expect(translations.es["findLeague.card.privateLeague"]).not.toBe(translations.en["findLeague.card.privateLeague"])
  })
})
