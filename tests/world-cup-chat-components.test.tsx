/**
 * World Cup chat component tests
 *
 * Covers the extracted chat/  components:
 *
 *  1.  WorldCupChatMessageBubble: chimmy variant renders Bot icon + AI chip + freshness chip
 *  2.  WorldCupChatMessageBubble: chimmy variant has copy button
 *  3.  WorldCupChatMessageBubble: chimmy variant shows Private badge when isPrivate=true
 *  4.  WorldCupChatMessageBubble: chimmy private message shows "Post to pool" button
 *  5.  WorldCupChatMessageBubble: chimmy without dataSourceDisplay renders no freshness chip
 *  6.  WorldCupChatMessageBubble: pool-other variant shows author name
 *  7.  WorldCupChatMessageBubble: pool-self variant does NOT show author name field
 *  8.  WorldCupChatMessageBubble: commissioner variant shows Commissioner badge
 *  9.  WorldCupChatMessageBubble: system variant renders centered text
 * 10.  WorldCupChatMessageBubble: old messages without metadata do not crash
 * 11.  WorldCupChatMessageBubble: "Post to pool" hidden when message is NOT private
 * 12.  WorldCupChatModeTabs: renders all three mode buttons
 * 13.  WorldCupChatModeTabs: active tab has aria-selected=true
 * 14.  WorldCupChatModeTabs: clicking a tab calls onModeChange
 * 15.  WorldCupChatModeTabs: pool unread count shows badge
 * 16.  WorldCupChatModeTabs: AI available dot shown on inactive AI tab
 * 17.  WorldCupChatEmptyState: loading AI mode shows "Chimmy is thinking"
 * 18.  WorldCupChatEmptyState: loading pool/DM mode shows spinner
 * 19.  WorldCupChatEmptyState: error renders rose error box
 * 20.  WorldCupChatEmptyState: AI empty state renders Ask Chimmy copy + prompt chips
 * 21.  WorldCupChatEmptyState: pool empty state renders trash talk copy
 * 22.  WorldCupChatEmptyState: DM empty state renders private chat copy
 * 23.  WorldCupAiPromptChips: renders action chips
 * 24.  WorldCupAiPromptChips: clicking chip calls onSelect with prompt
 * 25.  WorldCupAiPromptChips: returns null when actions is empty
 * 26.  Pool messages and AI messages share NO visible overlap in variants
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { WorldCupPoolChatMessage } from "@/components/brackets/world-cup/chat/worldCupChatTypes"
import { WorldCupChatMessageBubble } from "@/components/brackets/world-cup/chat/WorldCupChatMessageBubble"
import { WorldCupChatModeTabs } from "@/components/brackets/world-cup/chat/WorldCupChatModeTabs"
import { WorldCupChatEmptyState } from "@/components/brackets/world-cup/chat/WorldCupChatEmptyState"
import { WorldCupAiPromptChips } from "@/components/brackets/world-cup/chat/WorldCupAiPromptChips"

// ─── Message factory ──────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<WorldCupPoolChatMessage> = {}): WorldCupPoolChatMessage {
  return {
    id: "msg-1",
    userId: "user-1",
    authorName: "Alice",
    authorAvatarUrl: null,
    body: "Hello pool!",
    messageType: "pool_message",
    visibility: "public",
    targetUserId: null,
    mentions: [],
    createdAt: new Date().toISOString(),
    isOwnMessage: false,
    isPrivate: false,
    ...overrides,
  }
}

const chimmy = makeMsg({
  messageType: "chimmy_private_response",
  body: "France is your best bet based on pool data.",
  isPrivate: true,
  dataSourceTier: "pool_only",
  dataSourceDisplay: "Pool data",
})

// ─── WorldCupChatMessageBubble ────────────────────────────────────────────────

describe("WorldCupChatMessageBubble: chimmy variant", () => {
  it("1. renders Bot icon and AI chip and freshness chip", () => {
    render(<WorldCupChatMessageBubble message={chimmy} />)
    expect(screen.getByText("Chimmy")).toBeTruthy()
    expect(screen.getByText("AI")).toBeTruthy()
    expect(screen.getByTestId("chimmy-freshness-chip")).toBeTruthy()
  })

  it("2. has copy button", () => {
    render(<WorldCupChatMessageBubble message={chimmy} />)
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy()
  })

  it("3. shows Private badge when isPrivate=true", () => {
    render(<WorldCupChatMessageBubble message={chimmy} />)
    expect(screen.getByText(/private/i)).toBeTruthy()
  })

  it("4. shows 'Post to pool' button for private chimmy message when onPostToPool provided", () => {
    const onPostToPool = vi.fn()
    render(<WorldCupChatMessageBubble message={chimmy} onPostToPool={onPostToPool} />)
    const btn = screen.getByRole("button", { name: /post to pool/i })
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onPostToPool).toHaveBeenCalledWith(chimmy)
  })

  it("5. no freshness chip when dataSourceDisplay is absent", () => {
    const msg = makeMsg({ messageType: "chimmy_private_response", body: "AI answer." })
    render(<WorldCupChatMessageBubble message={msg} />)
    expect(screen.queryByTestId("chimmy-freshness-chip")).toBeNull()
  })
})

describe("WorldCupChatMessageBubble: pool variants", () => {
  it("6. pool-other shows author name", () => {
    render(<WorldCupChatMessageBubble message={makeMsg({ authorName: "Bob" })} />)
    expect(screen.getByText("Bob")).toBeTruthy()
  })

  it("7. pool-self shows 'You' label instead of author name", () => {
    render(<WorldCupChatMessageBubble message={makeMsg({ isOwnMessage: true, authorName: "Alice" })} />)
    expect(screen.getByText("You")).toBeTruthy()
    // "Alice" should NOT appear as a byline for own messages
    expect(screen.queryByText("Alice")).toBeNull()
  })

  it("11. Post to pool hidden when message is not private", () => {
    const onPostToPool = vi.fn()
    const publicPool = makeMsg({ isPrivate: false })
    render(<WorldCupChatMessageBubble message={publicPool} onPostToPool={onPostToPool} />)
    expect(screen.queryByRole("button", { name: /post to pool/i })).toBeNull()
  })
})

describe("WorldCupChatMessageBubble: other variants", () => {
  it("8. commissioner variant shows Commissioner badge", () => {
    const msg = makeMsg({ messageType: "commissioner_announcement", body: "Deadline extended." })
    render(<WorldCupChatMessageBubble message={msg} />)
    expect(screen.getByText("Commissioner")).toBeTruthy()
  })

  it("9. system variant renders centered text without author name", () => {
    const msg = makeMsg({ messageType: "system", body: "League locked." })
    render(<WorldCupChatMessageBubble message={msg} />)
    expect(screen.getByText("League locked.")).toBeTruthy()
    // No author name byline for system messages
    expect(screen.queryByText("Alice")).toBeNull()
  })

  it("10. message without metadata (old format) renders without crashing", () => {
    // Older messages may lack dataSourceTier/dataSourceDisplay
    const oldMsg = makeMsg({ messageType: "chimmy_private_response" })
    // No error thrown
    expect(() => render(<WorldCupChatMessageBubble message={oldMsg} />)).not.toThrow()
  })
})

describe("WorldCupChatMessageBubble: pool send never enters AI flow", () => {
  it("26. pool-other data-msg-type is 'pool-other', not 'chimmy'", () => {
    const { container } = render(<WorldCupChatMessageBubble message={makeMsg()} />)
    const bubble = container.querySelector("[data-msg-type]")
    expect(bubble?.getAttribute("data-msg-type")).toBe("pool-other")
  })

  it("chimmy data-msg-type is 'chimmy'", () => {
    const { container } = render(<WorldCupChatMessageBubble message={chimmy} />)
    const bubble = container.querySelector("[data-msg-type]")
    expect(bubble?.getAttribute("data-msg-type")).toBe("chimmy")
  })
})

// ─── WorldCupChatModeTabs ─────────────────────────────────────────────────────

describe("WorldCupChatModeTabs", () => {
  it("12. renders all three mode tabs", () => {
    render(
      <WorldCupChatModeTabs mode="pool" onModeChange={vi.fn()} />
    )
    expect(screen.getByTestId("wc-chat-tab-pool")).toBeTruthy()
    expect(screen.getByTestId("wc-chat-tab-ai")).toBeTruthy()
    expect(screen.getByTestId("wc-chat-tab-dm")).toBeTruthy()
  })

  it("13. active tab has aria-selected=true", () => {
    render(
      <WorldCupChatModeTabs mode="ai" onModeChange={vi.fn()} />
    )
    const aiTab = screen.getByTestId("wc-chat-tab-ai")
    expect(aiTab.getAttribute("aria-selected")).toBe("true")
    const poolTab = screen.getByTestId("wc-chat-tab-pool")
    expect(poolTab.getAttribute("aria-selected")).toBe("false")
  })

  it("14. clicking a tab calls onModeChange with correct mode", () => {
    const onModeChange = vi.fn()
    render(<WorldCupChatModeTabs mode="pool" onModeChange={onModeChange} />)
    fireEvent.click(screen.getByTestId("wc-chat-tab-ai"))
    expect(onModeChange).toHaveBeenCalledWith("ai")
  })

  it("15. pool unread badge shows when poolUnread > 0", () => {
    render(<WorldCupChatModeTabs mode="ai" onModeChange={vi.fn()} poolUnread={3} />)
    expect(screen.getByLabelText("3 unread")).toBeTruthy()
  })

  it("16. AI available dot shown on inactive AI tab when aiAvailable=true", () => {
    render(<WorldCupChatModeTabs mode="pool" onModeChange={vi.fn()} aiAvailable />)
    // The dot sits inside the "Ask Chimmy" tab, so its own label is just "available" (brand voice —
    // was "AI available").
    expect(screen.getByLabelText("available")).toBeTruthy()
  })
})

// ─── WorldCupChatEmptyState ───────────────────────────────────────────────────

describe("WorldCupChatEmptyState", () => {
  it("17. AI loading mode shows Chimmy thinking copy", () => {
    render(<WorldCupChatEmptyState mode="ai" isLoading />)
    expect(screen.getByTestId("wc-chat-loading-ai")).toBeTruthy()
    expect(screen.getByText(/chimmy is thinking/i)).toBeTruthy()
  })

  it("18. pool loading shows generic loading element", () => {
    render(<WorldCupChatEmptyState mode="pool" isLoading />)
    expect(screen.getByTestId("wc-chat-loading")).toBeTruthy()
  })

  it("19. error renders error box", () => {
    render(<WorldCupChatEmptyState mode="pool" isLoading={false} error="Network failed" />)
    expect(screen.getByTestId("wc-chat-error")).toBeTruthy()
    expect(screen.getByText("Network failed")).toBeTruthy()
  })

  it("20. AI empty shows Ask Chimmy copy and prompt chips", () => {
    const onSuggestPrompt = vi.fn()
    render(
      <WorldCupChatEmptyState
        mode="ai"
        isLoading={false}
        onSuggestPrompt={onSuggestPrompt}
        suggestedPrompts={[{ key: "p1", label: "My path", prompt: "Explain my path to first" }]}
      />
    )
    expect(screen.getByTestId("wc-chat-empty-ai")).toBeTruthy()
    expect(screen.getByText("My path")).toBeTruthy()
    fireEvent.click(screen.getByText("My path"))
    expect(onSuggestPrompt).toHaveBeenCalledWith("Explain my path to first")
  })

  it("21. pool empty state shows trash talk copy", () => {
    render(<WorldCupChatEmptyState mode="pool" isLoading={false} />)
    expect(screen.getByTestId("wc-chat-empty-state")).toBeTruthy()
    expect(screen.getByText(/trash talk/i)).toBeTruthy()
  })

  it("22. DM empty state shows private conversation copy", () => {
    render(<WorldCupChatEmptyState mode="dm" isLoading={false} />)
    expect(screen.getByTestId("wc-chat-empty-dm")).toBeTruthy()
    // "private conversation" appears in the first paragraph
    expect(screen.getByText("Start the private conversation.")).toBeTruthy()
  })
})

// ─── WorldCupAiPromptChips ────────────────────────────────────────────────────

describe("WorldCupAiPromptChips", () => {
  const actions = [
    { key: "path", label: "My path to first", prompt: "Explain my path" },
    { key: "swing", label: "Biggest swing", prompt: "What match changes my rank?" },
  ]

  it("23. renders all action chips", () => {
    render(<WorldCupAiPromptChips actions={actions} onSelect={vi.fn()} />)
    expect(screen.getByTestId("wc-prompt-chip-path")).toBeTruthy()
    expect(screen.getByTestId("wc-prompt-chip-swing")).toBeTruthy()
    expect(screen.getByText("My path to first")).toBeTruthy()
  })

  it("24. clicking chip fires onSelect with the prompt (not the label)", () => {
    const onSelect = vi.fn()
    render(<WorldCupAiPromptChips actions={actions} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId("wc-prompt-chip-path"))
    expect(onSelect).toHaveBeenCalledWith("Explain my path")
  })

  it("25. renders null when actions is empty", () => {
    const { container } = render(<WorldCupAiPromptChips actions={[]} onSelect={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
