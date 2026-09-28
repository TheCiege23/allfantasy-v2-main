import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

/*
 * AF Chat (Chimmy · Direct · Huddle).
 *
 * This suite used to drive the component through a `messages` prop and assert the TEST STUB's
 * behaviour — `LeagueMessageRow`'s "Replying to: …" preview, its `replies-indicator`, a thread
 * view keyed off `window.__leagueChatMessages` — behind Direct/Huddle tabs that were disabled
 * as "soon". All seven cases were red on main. The component now hands Direct and Huddle to the
 * drawer's real ThreadPanel, so these assert what a person would actually see there, with
 * fetch answered by URL.
 */

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me" } }, status: "authenticated" }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import AFChatDMPanel from "../components/chat/AFChatDMPanel"

const T = (min: number) => new Date(Date.UTC(2026, 8, 25, 14, min)).toISOString()
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u === "/api/shared/chat/threads") {
        return json({
          threads: [
            { id: "dm1", threadType: "dm", title: "Jordan", lastMessageAt: T(3), unreadCount: 0, memberCount: 2 },
            { id: "hu1", threadType: "group", title: "Rivals huddle", lastMessageAt: T(2), unreadCount: 1, memberCount: 4 },
          ],
        })
      }
      if (u.startsWith("/api/shared/chat/threads/dm1/messages")) {
        return json({
          messages: [
            { id: "1", senderUserId: "jordan", senderName: "Jordan", body: "Hello DM", createdAt: T(0) },
            { id: "2", senderUserId: "me", senderName: "Me", body: "Reply to DM", createdAt: T(1), parentMessageId: "1" },
          ],
        })
      }
      return json({})
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe("AFChatDMPanel", () => {
  it("opens on Chimmy, with a way into Chimmy", () => {
    render(<AFChatDMPanel userId="me" />)
    expect(screen.getByRole("link", { name: "Open Chimmy" }).getAttribute("href")).toBe("/chimmy/chat")
  })

  it("Direct lists your DMs and shows each message's text, a reply quoting what it answers", async () => {
    render(<AFChatDMPanel userId="me" />)
    fireEvent.click(screen.getByTitle("Direct messages"))
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }))
    await screen.findByText("Reply to DM")
    const reply = document.querySelector('[data-message-id="2"]') as HTMLElement
    expect(reply.getAttribute("data-mine")).toBe("true")
    expect(within(reply).getByText("Hello DM")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Rivals huddle/ })).toBeNull()
  })

  it("Huddle lists group conversations only", async () => {
    render(<AFChatDMPanel userId="me" />)
    fireEvent.click(screen.getByTitle("AF Huddle"))
    expect(await screen.findByRole("button", { name: /Rivals huddle/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Jordan/ })).toBeNull()
  })
})
