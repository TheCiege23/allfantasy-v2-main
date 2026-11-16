/**
 * Manager Intelligence, live mode: the directory is retired, and the screen says so (2026-11-16,
 * re-score item 10).
 *
 * ⚠ THIS SUITE HAS FLIPPED TWICE, AND EACH TIME THE OLD ASSERTIONS WERE RIGHT FOR THEIR DAY. First it
 * asserted an honest "backend does not classify archetypes" error. Then it asserted a real directory
 * from `/api/v1/intelligence/league/manager-dna`. The Milestone 32 privacy pass (`dcaaa6946`) then
 * retired that route to a constant 410. This suite kept passing because it mocked the transport, so
 * it described a call the server would refuse. Meanwhile the real screen showed paying commissioners
 * "No manager history yet."
 *
 * What it asserts now: the live client never calls the retired route, never reads the session, the
 * database or the transport, and returns the one recognisable retired error. The view turns that
 * error into the truth instead of an empty state that says wait.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const callDecisionOSMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/adapter/transport", () => ({ callDecisionOS: callDecisionOSMock }))
const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))
const prismaMock = vi.hoisted(() => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { liveManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/live"
import { MANAGER_PROFILES_RETIRED_MESSAGE } from "@/lib/commissioner-ui/managers/decision-os-client/retired"
import { ManagerIntelligenceView } from "@/components/commissioner-os/managers/ManagerIntelligenceView"
import { cardsCopy } from "@/lib/commissioner-os/i18n/cardsCopy"
import { cosErrorText } from "@/lib/commissioner-os/i18n/analyticsCopy"

describe("Manager Intelligence live client — retired", () => {
  it("returns the retired error: no data, not retryable, attributed to managers", async () => {
    const response = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(response.data).toBeNull()
    expect(response.source).toBe("live")
    expect(response.error).toMatchObject({ message: MANAGER_PROFILES_RETIRED_MESSAGE, moduleId: "managers", retryable: false })
    expect(Number.isNaN(Date.parse(response.timestamp))).toBe(false)
  })

  it("never calls the transport or the readiness flag — the retired route answers 410 to everyone", async () => {
    await liveManagerIntelligenceClient.getManagerDirectory()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
    expect(isLiveReadyMock).not.toHaveBeenCalled()
  })

  it("the route it used to read really is retired (the premise of this whole change)", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/v1/intelligence/league/manager-dna/route.ts"), "utf8")
    expect(route).toMatch(/^export const GET = retiredProfileRoute$/m)
    const live = readFileSync(resolve(process.cwd(), "lib/commissioner-ui/managers/decision-os-client/live.ts"), "utf8")
    expect(live).not.toMatch(/^\s*[^*\s/].*manager-dna/m)
  })
})

describe("Manager Intelligence view — the error is never an empty league", () => {
  it("🛑 the retired error says retired, NOT 'No manager history yet.'", () => {
    render(<ManagerIntelligenceView managers={[]} dataMode="live" errorMessage={MANAGER_PROFILES_RETIRED_MESSAGE} />)
    expect(screen.getByText("Manager profiles are retired.")).toBeInTheDocument()
    expect(screen.getByText(/no longer builds behavior profiles/)).toBeInTheDocument()
    expect(screen.queryByText("No manager history yet.")).not.toBeInTheDocument()
  })

  it("any other error is an error, not an empty state", () => {
    render(<ManagerIntelligenceView managers={[]} dataMode="live" errorMessage="Decision OS response failed contract validation." />)
    expect(screen.getByRole("alert")).toHaveTextContent("Decision OS response failed contract validation.")
    expect(screen.queryByText("No manager history yet.")).not.toBeInTheDocument()
  })

  it("positive control: with no error, an empty directory is still the empty state", () => {
    render(<ManagerIntelligenceView managers={[]} dataMode="demo" />)
    expect(screen.getByText("No manager history yet.")).toBeInTheDocument()
  })

  it("the page hands the adapter's error to the view (it used to drop it)", () => {
    const page = readFileSync(resolve(process.cwd(), "app/commissioner-os/managers/page.tsx"), "utf8")
    expect(page).toContain("errorMessage={response.error?.message}")
  })

  it("Spanish: the retired notice and the error both translate", () => {
    expect(cardsCopy("Manager profiles are retired.", "es")).toBe("Los perfiles de mánagers se retiraron.")
    expect(
      cardsCopy(
        "AllFantasy no longer builds behavior profiles of the managers in your league. League Health still shows the risks in your league.",
        "es",
      ),
    ).toContain("Salud de la liga")
    expect(cosErrorText(MANAGER_PROFILES_RETIRED_MESSAGE, "es")).toContain("ya no crea perfiles")
  })
})
