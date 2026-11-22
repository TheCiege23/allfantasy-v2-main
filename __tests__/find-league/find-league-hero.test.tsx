// @vitest-environment jsdom
/**
 * Find a League header (2026-11-05): the board's eyebrow, title and intro, from an en/es catalog —
 * the header the page used to hard-code in English.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

import { FindLeagueHero } from "@/components/find-league/FindLeagueHero"
import { findLeagueHeroMessages } from "@/lib/core-app/messages/findLeagueHero"

describe("FindLeagueHero", () => {
  it("draws the eyebrow over a single h1 and links home", () => {
    render(<FindLeagueHero />)
    const hero = screen.getByTestId("find-league-hero")
    expect(hero.querySelector(".fl-hero-eyebrow")?.textContent).toBe("Public leagues · every sport")
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Find a league to join"])
    expect(screen.getByRole("link", { name: "← Home" }).getAttribute("href")).toBe("/")
  })

  it("has a Spanish string for every English one", () => {
    expect(Object.keys(findLeagueHeroMessages.es).sort()).toEqual(Object.keys(findLeagueHeroMessages.en).sort())
  })
})
