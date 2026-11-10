import fs from "node:fs"
import path from "node:path"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import WorldCupInviteJoinPanel from "@/components/brackets/world-cup/WorldCupInviteJoinPanel"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

afterEach(() => { cleanup() })

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

/** The rule bodies for a selector list, as written, so an assertion reads the declarations it means. */
function ruleBody(css: string, selectorTail: string): string {
  const at = css.indexOf(selectorTail)
  expect(at, `${selectorTail} not found`).toBeGreaterThan(-1)
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at))
}

describe("bracket hub — visual audit", () => {
  it("lets a stat tile's label and LIVE NOW tag wrap instead of breaking the label mid-word", () => {
    const css = read("components/brackets/bracket-experience.css")
    // The tile keeps overflow-wrap: anywhere, which is what broke "Tournament" once the row was squeezed.
    expect(ruleBody(css, "\n.af-bx-stat { padding: 15px;")).toMatch(/overflow-wrap: anywhere/)
    expect(ruleBody(css, "\n.af-bx-stat > span { display: flex !important;")).toMatch(/flex-wrap: wrap/)
  })
})

describe("World Cup pages — light mode", () => {
  const css = read("app/globals.css")

  it("darkens the pale accents the light clamp leaves near-white, on the World Cup page only", () => {
    const cyan = ruleBody(css, 'html[data-mode="light"] .af-world-cup-page :is(.text-cyan-100, .text-cyan-200)')
    expect(cyan).toMatch(/color: #0e7490/)
    expect(ruleBody(css, 'html[data-mode="light"] .af-world-cup-page .text-violet-200')).toMatch(/color: #6d28d9/)
    // Nothing outside the page: the global table still stops at cyan-300.
    expect(css).not.toMatch(/^html\[data-mode="light"\] \.text-cyan-200/m)
  })

  it("outlines the invite panel's Preview button in light mode", () => {
    expect(ruleBody(css, 'html[data-mode="light"] .af-world-cup-page .af-wc-secondary-btn')).toMatch(/box-shadow: inset 0 0 0 1px/)
    render(<WorldCupInviteJoinPanel title="Join" />)
    const preview = screen.getAllByRole("button").find((b) => /preview/i.test(b.textContent ?? ""))
    expect(preview?.className).toMatch(/\baf-wc-secondary-btn\b/)
  })
})
