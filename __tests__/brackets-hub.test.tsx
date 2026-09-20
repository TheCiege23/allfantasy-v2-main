import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * The /brackets hub, as it actually is.
 *
 * ⚠ THIS REPLACES `bracket-home-p2021.test.tsx`, WHICH TESTED A DIFFERENT PAGE.
 * That file mocked `BracketShell`, `BracketHomeTabs`, `MyPoolsTab`,
 * `CreatePoolTab`, `QuickCreatePlayoffPoolButton` and `playoffHomeRouting` —
 * none of which this page imports. The hub was rebuilt as a static server
 * component and the suite was left behind, so all 19 of its tests failed on
 * main for weeks. It was not stale, it was aimed at a component that no longer
 * exists, which is why it is replaced rather than repaired.
 *
 * 🛑 THE ASSERTIONS HERE ARE INVARIANTS, NOT A SNAPSHOT OF WHICH SPORTS ARE
 * LIVE. Pinning "NBA is coming soon" is exactly how the previous suite rotted:
 * it froze a fact that the product was supposed to outgrow. What must always
 * hold is that a card claiming to be live goes somewhere, and a card claiming
 * to be coming soon does not pretend to.
 */

const resolvePrefs = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))
vi.mock("@/lib/preferences/ServerRenderPreferenceResolver", () => ({
  resolveServerRenderPreferences: resolvePrefs,
}))
vi.mock("@/components/i18n/LanguageToggle", () => ({ default: () => null }))
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (p: Record<string, unknown>) => <img {...(p as never)} />,
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

async function renderHub() {
  const mod = await import("@/app/brackets/page")
  const Page = mod.default as () => Promise<React.ReactElement>
  render(await Page())
}

beforeEach(() => {
  vi.clearAllMocks()
  resolvePrefs.mockResolvedValue({ language: "en" })
})

describe("/brackets hub", () => {
  it("renders for a signed-out visitor", async () => {
    await renderHub()
    expect(screen.getByTestId("brackets-hub-hero")).toBeTruthy()
    expect(screen.getByTestId("brackets-hub-sports-grid")).toBeTruthy()
  })

  /*
   * ⚠ NAMED FOR WHAT IT ASSERTS, WHICH IS THE OPPOSITE OF WHAT THE PAGE'S OWN
   * HEADER CLAIMS. That header says the preference read is "wrapped in
   * try/catch, never throws" — the page does no such thing. The safety is real
   * but it lives one level down, in `ServerRenderPreferenceResolver`, which
   * catches internally and returns defaults.
   *
   * So this is a tripwire on a dependency, not a wish: the hub is a public,
   * signed-out marketing page, and it stays up only while the resolver keeps
   * swallowing its own failures. If someone removes that internal catch, this
   * test is what says the hub now 500s for everyone. If someone instead adds a
   * real guard here, this test SHOULD fail — and the fix is to delete it,
   * because the dependency it documents is gone.
   */
  it("has no guard of its own, so a throwing resolver would take the page down", async () => {
    resolvePrefs.mockRejectedValue(new Error("preferences backend down"))
    await expect(renderHub()).rejects.toThrow("preferences backend down")
  })

  it("renders with whatever language the resolver returns", async () => {
    resolvePrefs.mockResolvedValue({ language: "es" })
    await renderHub()
    expect(screen.getByTestId("brackets-hub-hero")).toBeTruthy()
  })
})

describe("/brackets hub — sport cards", () => {
  /*
   * The invariant the previous grid violated for months: NBA and NHL were
   * marked "coming soon" with a dead href while the playoff engine had been
   * serving them and 26 pools existed in production. This cannot catch a
   * wrongly-labelled sport on its own — "soon + no link" is internally
   * consistent — but it does catch the two ways the grid can actively lie:
   * a live card that goes nowhere, and a "soon" card that is clickable.
   */
  it("every card that claims to be live is a link, and every coming-soon card is not", async () => {
    await renderHub()
    const grid = screen.getByTestId("brackets-hub-sports-grid")
    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-testid^='brackets-hub-sport-']"))
    expect(cards.length).toBeGreaterThan(0)

    let liveSeen = 0
    for (const card of cards) {
      const id = card.getAttribute("data-testid")
      const isLink = card.tagName.toLowerCase() === "a"
      if (isLink) {
        liveSeen += 1
        const href = card.getAttribute("href") ?? ""
        expect(href, `${id} is a link, so it must go somewhere`).not.toBe("")
        expect(href.startsWith("/"), `${id} href should be an in-app route, got "${href}"`).toBe(true)
      } else {
        // A non-link card must not carry an href anywhere inside it either.
        expect(card.querySelector("a"), `${id} is marked coming soon but contains a link`).toBeNull()
      }
    }
    // A grid where nothing is reachable is the failure this hub already had.
    expect(liveSeen, "no sport on the hub is reachable").toBeGreaterThan(0)
  })

  it("routes every reachable sport card into the brackets product", async () => {
    await renderHub()
    const grid = screen.getByTestId("brackets-hub-sports-grid")
    const links = Array.from(grid.querySelectorAll<HTMLAnchorElement>("a[href]"))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^\/brackets(\/|\?|$)/)
    }
  })
})

describe("/brackets hub — copy", () => {
  /*
   * `makeBracketsT` returns the KEY when a dictionary entry is missing, so a
   * dropped translation renders as `brk.hub.something` on the page rather
   * than failing. Deliberately not mocked here: mocking the translator is
   * what would make this test unable to see the bug it exists for.
   */
  it("leaks no untranslated brk.* keys into the rendered page", async () => {
    await renderHub()
    const text = document.body.textContent ?? ""
    const leaked = text.match(/brk\.[a-zA-Z0-9._]+/g) ?? []
    expect([...new Set(leaked)]).toEqual([])
  })

  it("points its primary calls to action at real in-app routes", async () => {
    await renderHub()
    const hero = screen.getByTestId("brackets-hub-hero")
    const hrefs = Array.from(hero.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) =>
      a.getAttribute("href"),
    )
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href).toMatch(/^\/[a-z]/)
    }
  })
})
