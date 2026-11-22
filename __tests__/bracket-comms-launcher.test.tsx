import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import CommsDock from "@/components/core-app/comms/CommsDock"

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "qa" } } }) }))
vi.mock("next/dynamic", () => ({ default: () => (props: any) => props.open ? <div role="dialog"><button onClick={props.onClose}>Close chat</button></div> : null }))
vi.mock("@/components/core-app/comms/useChatBadge", () => ({ useChatBadge: () => ({ unread: 0, mentions: 0 }) }))
vi.mock("@/components/core-app/comms/useCommsTabCounts", () => ({ useCommsTabCounts: () => ({}) }))

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("existing communications launcher on brackets", () => {
  it("opens and closes the drawer", () => {
    render(<div className="af-core"><CommsDock leagues={[]} pageLeagueId={null} chimmyTokenCost={10} /></div>)
    fireEvent.click(screen.getByRole("button", { name: "Open communications" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open communications" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }))
    expect(screen.getByRole("button", { name: "Open communications" })).toBeInTheDocument()
  })
})

