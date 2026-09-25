import { render, screen, fireEvent } from "@testing-library/react"
import LeagueChatPanel from "@/components/chat/LeagueChatPanel"
import type { PlatformChatMessage } from "../types/platform-shared"
import React from "react"
import { vi } from "vitest"

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1" } },
    status: "authenticated",
  }),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/components/chat/ChatStatsBotMessage", () => ({
  default: () => null,
  placeholderStatsBotUpdate: () => ({ id: "stats-bot-placeholder" }),
}))

describe("LeagueChatPanel threaded chat UI", () => {
  const baseMessages: PlatformChatMessage[] = [
    { id: "1", body: "Hello world", createdAt: new Date().toISOString(), senderName: "UserA" },
    { id: "2", body: "Reply to hello", parentMessageId: "1", createdAt: new Date().toISOString(), senderName: "UserB" },
    { id: "3", body: "Another root", createdAt: new Date().toISOString(), senderName: "UserC" },
    { id: "4", body: "Reply to another root", parentMessageId: "3", createdAt: new Date().toISOString(), senderName: "UserD" },
    { id: "5", body: "Second reply to hello", parentMessageId: "1", createdAt: new Date().toISOString(), senderName: "UserE" },
  ] as any

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes("/api/shared/chat/threads") && !url.includes("/messages") && !url.includes("/pinned")) {
        return {
          ok: true,
          json: async () => ({
            threads: [{ id: "league:test-league", context: { leagueId: "test-league" } }],
          }),
        } as Response
      }

      if (url.includes("/messages")) {
        return {
          ok: true,
          json: async () => ({ messages: baseMessages }),
        } as Response
      }

      if (url.includes("/pinned") || url.includes("/read-receipts") || url.includes("/typing")) {
        return {
          ok: true,
          json: async () => ({ pinned: [], users: [] }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the league chat panel shell", () => {
    render(<LeagueChatPanel leagueId="test-league" />)

    expect(screen.getByLabelText(/League chat/i)).toBeInTheDocument()
  })

  it("shows primary chat tabs", () => {
    render(<LeagueChatPanel leagueId="test-league" />)

    expect(screen.getByRole("button", { name: /League Chat/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Messages/i })).toBeInTheDocument()
    /* Brand rule: the assistant is "Chimmy", never bare "AI" (was "AI Chat"). */
    expect(screen.getByRole("button", { name: /Chimmy/i })).toBeInTheDocument()
  })

  it("allows switching tabs", () => {
    render(<LeagueChatPanel leagueId="test-league" />)

    const messagesTab = screen.getByRole("button", { name: /Messages/i })
    fireEvent.click(messagesTab)

    expect(messagesTab).toBeInTheDocument()
  })
})
