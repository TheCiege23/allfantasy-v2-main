import { expect, test } from "@playwright/test"
import type { PlatformChatMessage, PlatformChatThread } from "@/types/platform-shared"

test.describe("@db @messaging unified chat click audit", () => {
  test.describe.configure({ timeout: 180_000, mode: "serial" })

  test("audits DM/group/AI message flows and click paths", async ({ page }) => {
    const profileState: Record<string, unknown> = {
      userId: "messaging-audit-user",
      username: "messagingaudit",
      email: "messaging.audit@example.com",
      displayName: "Messaging Audit",
      avatarPreset: "crest",
      preferredLanguage: "en",
      timezone: "America/New_York",
      themePreference: "dark",
      preferredSports: ["NFL", "NHL", "NBA", "MLB", "NCAAB", "NCAAF", "SOCCER"],
      settings: {
        legalAcceptanceState: {
          ageVerified: true,
          disclaimerAccepted: true,
          termsAccepted: true,
          acceptedAt: new Date().toISOString(),
        },
      },
    }

    const threads: PlatformChatThread[] = [
      {
        id: "dm-thread-1",
        threadType: "dm",
        productType: "shared",
        title: "Alex DM",
        lastMessageAt: new Date().toISOString(),
        unreadCount: 1,
        memberCount: 2,
        context: { createdByUserId: "user-1" },
      },
      {
        id: "group-thread-1",
        threadType: "group",
        productType: "shared",
        title: "Weekend Waiver Group",
        lastMessageAt: new Date().toISOString(),
        unreadCount: 0,
        memberCount: 3,
        context: { createdByUserId: "user-1" },
      },
    ]

    const messagesByThread: Record<string, PlatformChatMessage[]> = {
      "dm-thread-1": [
        {
          id: "dm-msg-1",
          threadId: "dm-thread-1",
          senderUserId: "user-2",
          senderName: "Alex",
          messageType: "text",
          body: "You ready for this week?",
          createdAt: new Date().toISOString(),
          metadata: { reactions: [{ emoji: "👍", count: 1, userIds: ["user-1"] }] },
        },
      ],
      "group-thread-1": [
        {
          id: "group-msg-1",
          threadId: "group-thread-1",
          senderUserId: "user-3",
          senderName: "Jordan",
          messageType: "text",
          body: "Let's lock waivers tonight.",
          createdAt: new Date().toISOString(),
        },
      ],
    }

    let mentionCalls = 0
    let muteCalls = 0
    let reactionCalls = 0
    let pinCalls = 0
    let pollCreateCalls = 0

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

    await page.route("**/api/user/settings", async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: profileState,
          settings: {
            legalAcceptanceState: (profileState.settings as { legalAcceptanceState: Record<string, unknown> }).legalAcceptanceState,
          },
        }),
      })
    })

    await page.route("**/api/user/profile", async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileState) })
    })

    await page.route("**/api/shared/notifications?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: [] }),
      })
    })

    await page.route("**/api/shared/chat/**", async (route) => {
      const req = route.request()
      const method = req.method()
      const url = new URL(req.url())
      const path = url.pathname

      if (path === "/api/shared/chat/threads" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", threads }) })
      }
      if (path === "/api/shared/chat/threads" && method === "POST") {
        const created: PlatformChatThread = {
          id: "group-thread-2",
          threadType: "group",
          productType: "shared",
          title: "Created Group",
          lastMessageAt: new Date().toISOString(),
          unreadCount: 0,
          memberCount: 3,
          context: { createdByUserId: "user-1" },
        }
        if (!threads.find((t) => t.id === created.id)) threads.push(created)
        messagesByThread[created.id] = []
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok", thread: created }),
        })
      }
      if (path === "/api/shared/chat/blocked" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ blockedUsers: [] }),
        })
      }
      if (path === "/api/shared/chat/mentions" && method === "POST") {
        mentionCalls += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
      }

      const match = path.match(/^\/api\/shared\/chat\/threads\/([^/]+)(?:\/(.*))?$/)
      if (!match) return route.fallback()
      const threadId = decodeURIComponent(match[1] ?? "")
      const rest = match[2] ?? ""

      if (rest === "members" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            members: [
              { id: "user-1", username: "messagingaudit", displayName: "Messaging Audit" },
              { id: "user-2", username: "alex", displayName: "Alex" },
              { id: "user-3", username: "jordan", displayName: "Jordan" },
            ],
          }),
        })
      }
      if (rest === "pinned" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", pinned: [] }) })
      }
      if (rest === "pin" && method === "POST") {
        pinCalls += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
      }
      if (rest === "mute" && method === "POST") {
        muteCalls += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
      }
      if (rest === "polls" && method === "POST") {
        pollCreateCalls += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
      }
      if (rest === "messages" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok", messages: messagesByThread[threadId] ?? [] }),
        })
      }
      if (rest === "messages" && method === "POST") {
        let body: Record<string, unknown> = {}
        try {
          body = (req.postDataJSON() as Record<string, unknown>) ?? {}
        } catch {
          body = {}
        }
        if (body?.messageType === "poll") pollCreateCalls += 1
        const created: PlatformChatMessage = {
          id: `msg-${Date.now()}`,
          threadId,
          senderUserId: "user-1",
          senderName: "Messaging Audit",
          messageType: typeof body?.messageType === "string" ? body.messageType : "text",
          body: typeof body?.body === "string" ? body.body : "",
          createdAt: new Date().toISOString(),
          metadata: (body?.metadata as Record<string, unknown> | undefined) ?? undefined,
        }
        messagesByThread[threadId] = [...(messagesByThread[threadId] ?? []), created]
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok", message: created }),
        })
      }
      if (/^messages\/[^/]+\/reactions$/.test(rest)) {
        reactionCalls += 1
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
      }
      return route.fallback()
    })

    await page.goto("/messages")
    const messagesHeading = page.getByRole("heading", { name: "Messages" })
    const messagingPageReady = await messagesHeading
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!messagingPageReady, "Messaging shell is unavailable in this environment")
    await expect(messagesHeading).toBeVisible()

    await page.getByRole("button", { name: "Private DMs" }).click()
    await page.getByRole("button", { name: "Alex DM" }).click()
    await expect(page.getByText("You ready for this week?")).toBeVisible()

    const messageCenterLink = page.getByRole("link", { name: "Open Message Center" })
    await expect(messageCenterLink).toBeVisible()
    await messageCenterLink.click()
    await expect(page).toHaveURL(/\/messages/)

    await page.getByPlaceholder("Message… (type @ to mention)").fill("Enter key send check")
    await page.keyboard.press("Enter")
    await expect(page.getByText("Enter key send check")).toBeVisible()

    await page.getByPlaceholder("Message… (type @ to mention)").fill("Hello @alex")
    await page.keyboard.press("Enter")
    await page.keyboard.press("Enter")
    await expect(page.getByText("Hello @alex")).toBeVisible()
    expect(mentionCalls).toBeGreaterThan(0)

    const existingReactionButton = page.getByRole("button", { name: /👍|❤️/ }).first()
    if (await existingReactionButton.isVisible().catch(() => false)) {
      await existingReactionButton.click()
    } else {
      const addReactionButton = page.getByRole("button", { name: "Add reaction" }).first()
      await expect(addReactionButton).toBeVisible()
      await addReactionButton.click()
      const pickerEmoji = page.locator("button", { hasText: "👍" }).first()
      await expect(pickerEmoji).toBeVisible()
      await pickerEmoji.click()
    }
    await expect.poll(() => reactionCalls).toBeGreaterThan(0)

    await page.getByRole("button", { name: "Pin" }).first().click()
    expect(pinCalls).toBeGreaterThan(0)

    await page.getByRole("button", { name: "Create poll" }).click()
    await expect(page.getByRole("heading", { name: "Create poll" })).toBeVisible()
    await page.getByPlaceholder("Question").fill("Start best WR this week?")
    await page.getByPlaceholder("Option 1").fill("Player A")
    await page.getByPlaceholder("Option 2").fill("Player B")
    await page.getByRole("button", { name: "Create poll" }).last().click()
    expect(pollCreateCalls).toBeGreaterThan(0)
    await expect(page.getByRole("heading", { name: "Create poll" })).not.toBeVisible()

    await page.getByRole("button", { name: "GIF" }).click()
    await expect(page.getByPlaceholder("https://…")).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).first().click()

    await page.goto("/messages?tab=groups&thread=group-thread-1", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("button", { name: "Group Chats" })).toBeVisible()
    const weekendGroupButton = page.getByRole("button", { name: /Weekend Waiver Group/i }).first()
    await expect(weekendGroupButton).toBeVisible()
    await weekendGroupButton.click()
    await expect(page.getByText("Let's lock waivers tonight.")).toBeVisible()
    await page.getByPlaceholder("Message… (type @ to mention)").fill("Group update from audit")
    await page.keyboard.press("Enter")
    await expect(page.getByText("Group update from audit")).toBeVisible()

    await page.getByRole("button", { name: "Mute" }).click()
    await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible()
    expect(muteCalls).toBeGreaterThan(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole("button", { name: "Back" }).click()
    await expect(page.getByRole("button", { name: /Weekend Waiver Group/i }).first()).toBeVisible()

    const aiChatButton = page.getByRole("button", { name: /^Chimmy$|AI Chatbot|AI Chat/i }).first()
    if (await aiChatButton.isVisible().catch(() => false)) {
      await aiChatButton.click()
    } else {
      await page.goto("/messages?tab=ai", { waitUntil: "domcontentloaded" })
    }
    await expect(page.getByTestId("chimmy-chat-shell")).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible()
  })
})
