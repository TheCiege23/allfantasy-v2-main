import { expect, test } from "@playwright/test"

async function submitSearchWithRetry(page: any, placeholder: string, value: string): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const input = page.getByPlaceholder(placeholder).first()
      await input.waitFor({ state: "visible", timeout: 5000 })
      await input.fill(value)
      await input.press("Enter", { timeout: 3000 })
      return
    } catch (error) {
      lastError = error
      const message = String((error as Error)?.message ?? error)
      if (!/detached|not attached|stale/i.test(message)) {
        throw error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to submit search after retries")
}

test.describe("@db @messaging league chat feature flows", () => {
  test("covers search, typing, read receipts, and edit/delete actions", async ({ page }) => {
    const now = new Date().toISOString()

    const threads: Array<Record<string, unknown>> = [
      {
        id: "league:e2e-league-chat-ai",
        threadType: "league",
        productType: "shared",
        title: "E2E League Chat",
        lastMessageAt: now,
        unreadCount: 0,
        memberCount: 4,
        context: { leagueId: "e2e-league-chat-ai", sport: "NFL" },
      },
      {
        id: "dm-thread-e2e",
        threadType: "dm",
        productType: "shared",
        title: "Alex DM",
        lastMessageAt: now,
        unreadCount: 0,
        memberCount: 2,
        context: { otherUsername: "alex" },
      },
    ]

    const leagueMessages: Array<Record<string, any>> = [
      {
        id: "league-msg-own",
        threadId: "league:e2e-league-chat-ai",
        senderUserId: "user-1",
        senderName: "Messaging Audit",
        senderUsername: "messagingaudit",
        messageType: "text",
        body: "League message from me",
        createdAt: now,
      },
      {
        id: "league-msg-other",
        threadId: "league:e2e-league-chat-ai",
        senderUserId: "user-2",
        senderName: "Alex",
        senderUsername: "alex",
        messageType: "text",
        body: "Trade angle from Alex",
        createdAt: now,
      },
    ]

    const dmMessages: Array<Record<string, any>> = [
      {
        id: "dm-msg-own",
        threadId: "dm-thread-e2e",
        senderUserId: "user-1",
        senderName: "Messaging Audit",
        senderUsername: "messagingaudit",
        messageType: "text",
        body: "DM from me",
        createdAt: now,
      },
      {
        id: "dm-msg-other",
        threadId: "dm-thread-e2e",
        senderUserId: "user-2",
        senderName: "Alex",
        senderUsername: "alex",
        messageType: "text",
        body: "Alex says hello",
        createdAt: now,
      },
    ]

    let typingReads = 0
    let readReceiptCalls = 0
    let messagePatchCalls = 0
    let messageDeleteCalls = 0

    page.on("dialog", (dialog) => {
      if (dialog.type() === "prompt") {
        dialog.accept("Edited message body")
      } else {
        dialog.accept()
      }
    })

    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "user-1",
            name: "Messaging Audit",
            email: "messaging.audit@example.com",
          },
          expires: "2099-01-01T00:00:00.000Z",
        }),
      })
    })

    await page.route("**/api/ai/providers/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ openai: true, deepseek: true, grok: true }),
      })
    })

    await page.route("**/api/app/leagues/e2e-league-chat-ai/chat**", async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          viewerUserId: "user-1",
          messages: leagueMessages.map((message) => ({
            id: message.id,
            authorId: message.senderUserId,
            authorName: message.senderName,
            text: message.body,
            messageType: message.messageType,
            createdAt: message.createdAt,
          })),
        }),
      })
    })

    await page.route("**/api/shared/chat/**", async (route) => {
      const req = route.request()
      const method = req.method()
      const url = new URL(req.url())
      const path = url.pathname

      if (path === "/api/shared/chat/threads" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok", threads }),
        })
      }

      const match = path.match(/^\/api\/shared\/chat\/threads\/([^/]+)(?:\/(.*))?$/)
      if (!match) return route.fallback()
      const threadId = decodeURIComponent(match[1] ?? "")
      const rest = match[2] ?? ""

      if (rest === "messages" && method === "GET") {
        const list = threadId === "dm-thread-e2e" ? dmMessages : leagueMessages
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok", messages: list }),
        })
      }

      if (rest === "pinned" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", pinned: [] }) })
      }

      if (rest === "typing" && method === "GET") {
        typingReads += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", typing: [{ userId: "user-2", name: "Alex" }] }) })
      }

      if (rest === "typing" && method === "POST") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", typing: [] }) })
      }

      if (rest === "read-receipts" && (method === "GET" || method === "POST")) {
        readReceiptCalls += 1
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok", receipts: [{ userId: "user-2", displayName: "Alex", lastReadAt: now }] }),
        })
      }

      if (rest.startsWith("search") && method === "GET") {
        const q = (url.searchParams.get("q") || "").toLowerCase()
        const pool = threadId === "dm-thread-e2e" ? dmMessages : leagueMessages
        const results = pool.filter((m) => m.body.toLowerCase().includes(q))
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok", query: q, messages: results }),
        })
      }

      const messageMatch = rest.match(/^messages\/([^/]+)$/)
      if (messageMatch && method === "PATCH") {
        messagePatchCalls += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", message: { id: messageMatch[1], body: "Edited message body" } }) })
      }
      if (messageMatch && method === "DELETE") {
        messageDeleteCalls += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
      }

      if (rest === "messages" && method === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            message: {
              id: `created-${Date.now()}`,
              threadId,
              senderUserId: "user-1",
              senderName: "Messaging Audit",
              body: "created",
              messageType: "text",
              createdAt: new Date().toISOString(),
            },
          }),
        })
      }

      if (/^messages\/[^/]+\/reactions$/.test(rest)) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
      }

      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
    })

    await page.goto("/e2e/league-chat-ai")
    await expect(page.getByRole("heading", { name: "League Chat AI Harness" })).toBeVisible()

    await page.getByRole("button", { name: "Search chat" }).click()
    await submitSearchWithRetry(page, "Search this chat", "alex")
    await expect(page.getByRole("button", { name: /Trade angle from Alex/i })).toBeVisible()
    await expect(page.getByText(/is typing/i)).toBeVisible()

    const ownLeagueMessage = page.getByRole("article", { name: /You,.*Press Enter for actions/i }).first()
    await ownLeagueMessage.press("Enter")
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await page.getByRole("textbox", { name: "Edit your message" }).fill("Edited message body")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect.poll(() => messagePatchCalls).toBeGreaterThan(0)
    await ownLeagueMessage.press("Enter")
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await page.getByRole("button", { name: "Delete", exact: true }).click()

    await page.getByRole("button", { name: "Messages" }).click()
    await page.getByRole("button", { name: /Alex DM/i }).click()
    await page.getByRole("button", { name: "Search this conversation" }).click()
    await submitSearchWithRetry(page, "Search this chat", "alex")
    await expect(page.getByRole("button", { name: /Alex says hello/i })).toBeVisible()
    await expect(page.getByText(/Seen by Alex/i)).toBeVisible()

    expect(typingReads).toBeGreaterThan(0)
    expect(readReceiptCalls).toBeGreaterThan(0)
    expect(messagePatchCalls).toBeGreaterThan(0)
    expect(messageDeleteCalls).toBeGreaterThan(0)
  })
})
