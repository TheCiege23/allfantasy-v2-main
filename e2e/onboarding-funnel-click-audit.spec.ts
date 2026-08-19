import { expect, test, type Page, type Request } from "@playwright/test"

test.describe.configure({ timeout: 180_000 })

function parseBody(request: Request): Record<string, unknown> {
  try {
    const json = request.postDataJSON()
    if (json && typeof json === "object") {
      return json as Record<string, unknown>
    }
  } catch {}

  const raw = request.postData() ?? "{}"
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function gotoWithRetry(page: Page, url: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" })
      return
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      const canRetry =
        attempt < 2 &&
        (message.includes("net::ERR_ABORTED") || message.includes("interrupted by another navigation"))
      if (!canRetry) throw error
      await page.waitForTimeout(200)
    }
  }
}

test.describe("@activation onboarding funnel click audit", () => {
  test("next/skip flow works and sports preferences are persisted", async ({ page }) => {
    const funnelCalls: Array<{ step?: string; completeFunnel?: boolean; preferredSports?: string[] }> = []

    await page.route("**/api/onboarding/funnel", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            currentStep: "welcome",
            completedAt: null,
            isComplete: false,
          }),
        })
        return
      }

      const body = parseBody(route.request()) as {
        step?: string
        completeFunnel?: boolean
        preferredSports?: string[]
      }
      funnelCalls.push(body)
      const step = String(body.step ?? "")
      const completeFunnel = Boolean(body.completeFunnel)

      if (completeFunnel) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, nextStep: "completed" }),
        })
        return
      }

      const nextByStep: Record<string, string> = {
        welcome: "app_walkthrough",
        app_walkthrough: "sport_selection",
        sport_selection: "tool_suggestions",
        tool_suggestions: "league_prompt",
        league_prompt: "completed",
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          nextStep: nextByStep[step] ?? "completed",
        }),
      })
    })

    await gotoWithRetry(page, "/e2e/onboarding-funnel?step=welcome")

    await expect(page.getByTestId("onboarding-step-welcome")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId("onboarding-next-welcome")).toBeVisible()
    await expect(page.getByTestId("onboarding-skip-welcome")).toBeVisible()
    await page.getByTestId("onboarding-next-welcome").click()

    await gotoWithRetry(page, "/e2e/onboarding-funnel?step=sport_selection")
    await expect(page.getByTestId("onboarding-step-sport-selection")).toBeVisible({ timeout: 20_000 })
    const soccerOption = page.getByTestId("onboarding-sport-option-SOCCER")
    await soccerOption.evaluate((button) => (button as HTMLButtonElement).click())
    await page.getByTestId("onboarding-next-sport-selection").click()

    await gotoWithRetry(page, "/e2e/onboarding-funnel?step=league_prompt")
    await expect(page.getByTestId("onboarding-step-league-prompt")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId("onboarding-league-create-link")).toBeVisible()
    await expect(page.getByTestId("onboarding-league-discover-link")).toBeVisible()
    await expect(page.getByTestId("onboarding-league-create-bracket-link")).toBeVisible()
    await page.getByTestId("onboarding-skip-league-prompt").click()
  })

  test("checklist routes correctly and completed tasks persist after refresh", async ({ page }) => {
    const seenChecklistHrefs: string[] = []
    const completedTaskIds = new Set<string>(["select_sports"])
    const milestoneToTask: Record<string, string> = {
      onboarding_tool_visit: "choose_tools",
      onboarding_first_ai: "first_ai_action",
      onboarding_referral_share: "referral_share",
    }

    await page.addInitScript(() => {
      ;(window as typeof window & { __onboardingChecklistClicks?: string[] }).__onboardingChecklistClicks = []
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target as Element | null
          const link = target?.closest('[data-testid^="onboarding-checklist-task-"]') as
            | HTMLAnchorElement
            | null
          if (!link) return
          event.preventDefault()
          const href = link.getAttribute("href") || ""
          const store = (window as typeof window & { __onboardingChecklistClicks?: string[] })
          store.__onboardingChecklistClicks = [...(store.__onboardingChecklistClicks ?? []), href]
        },
        true
      )
    })

    await page.route("**/api/onboarding/checklist", async (route) => {
      const request = route.request()
      if (request.method() === "POST") {
        const body = parseBody(request)
        const milestone = String(body.milestone ?? "")
        const taskId = milestoneToTask[milestone]
        if (taskId) completedTaskIds.add(taskId)
      }

      const tasks = [
        {
          id: "select_sports",
          label: "Select favorite sports",
          description: "Choose your sports.",
          href: "/onboarding/funnel",
          ctaLabel: "Set sports",
          completed: completedTaskIds.has("select_sports"),
        },
        {
          id: "choose_tools",
          label: "Choose preferred tools",
          description: "Try a tool.",
          href: "/legacy?tab=trade",
          ctaLabel: "Explore tools",
          completed: completedTaskIds.has("choose_tools"),
        },
        {
          id: "join_or_create_league",
          label: "Join or create first league",
          description: "Create or join.",
          href: "/leagues",
          ctaLabel: "Leagues",
          completed: completedTaskIds.has("join_or_create_league"),
        },
        {
          id: "first_ai_action",
          label: "Try your first AI action",
          description: "Use Chimmy once.",
          href: "/chimmy",
          ctaLabel: "Open Chimmy",
          completed: completedTaskIds.has("first_ai_action"),
        },
        {
          id: "referral_share",
          label: "Refer a friend or share",
          description: "Share AllFantasy.",
          href: "/referral",
          ctaLabel: "Share",
          completed: completedTaskIds.has("referral_share"),
        },
      ]

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tasks,
          completedCount: tasks.filter((task) => task.completed).length,
          totalCount: 5,
          isFullyComplete: tasks.every((task) => task.completed),
        }),
      })
    })

    await page.route("**/api/retention/nudges", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ nudges: [] }),
      })
    })

    await page.route("**/api/retention/nudges/dismiss", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/onboarding/funnel", async (route) => {
      const body = parseBody(route.request())
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          nextStep: body.completeFunnel ? "completed" : "league_prompt",
        }),
      })
    })

    await gotoWithRetry(page, "/e2e/onboarding-funnel?step=welcome")
    await expect(page.getByTestId("onboarding-checklist")).toBeVisible({ timeout: 20_000 })

    const expectedChecklistRoutes: Array<[string, string]> = [
      ["select_sports", "/onboarding/funnel"],
      ["choose_tools", "/legacy?tab=trade"],
      ["join_or_create_league", "/leagues"],
      ["first_ai_action", "/chimmy"],
      ["referral_share", "/referral"],
    ]

    for (const [taskId, route] of expectedChecklistRoutes) {
      const taskLink = page.getByTestId(`onboarding-checklist-task-${taskId}`)
      await expect(taskLink).toHaveAttribute("href", route)
      await taskLink.click()
    }

    const captured = await page.evaluate(() => {
      const win = window as typeof window & { __onboardingChecklistClicks?: string[] }
      return win.__onboardingChecklistClicks ?? []
    })
    seenChecklistHrefs.push(...captured)

    expect(seenChecklistHrefs).toEqual(
      expect.arrayContaining(expectedChecklistRoutes.map(([, route]) => route))
    )

    await expect
      .poll(async () => {
        const text = await page.getByTestId("onboarding-checklist-progress").textContent()
        return (text ?? "").trim()
      })
      .toContain("4 of 5 complete")

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("onboarding-checklist")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId("onboarding-checklist-progress")).toContainText("4 of 5 complete")
    await expect(page.getByTestId("onboarding-checklist-task-choose_tools")).toHaveAttribute(
      "data-onboarding-task-completed",
      "true"
    )
  })

  test("retention reminder cards link correctly, dismiss persists, and no dead links", async ({ page }) => {
    let nudges = [
      {
        id: "recap_weekly",
        type: "recap",
        title: "Your weekly recap",
        body: "See your week.",
        href: "/dashboard",
        ctaLabel: "Open recap",
      },
      {
        id: "reminder_onboarding",
        type: "unfinished_reminder",
        title: "Finish setup",
        body: "Complete onboarding.",
        href: "/onboarding/funnel",
        ctaLabel: "Continue setup",
      },
      {
        id: "creator_rec_1",
        type: "creator_recommendation",
        title: "Join Alpha League",
        body: "Creator recommendation.",
        href: "/creators/alpha",
        ctaLabel: "View creator",
      },
      {
        id: "nudge_weekly_ai_summary",
        type: "weekly_summary",
        title: "Weekly AI summary",
        body: "Ask Chimmy for updates.",
        href: "/chimmy",
        ctaLabel: "Get summary",
      },
    ]

    await page.addInitScript(() => {
      ;(window as typeof window & { __retentionNudgeClicks?: string[] }).__retentionNudgeClicks = []
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target as Element | null
          const link = target?.closest('[data-testid^="retention-nudge-link-"]') as HTMLAnchorElement | null
          if (!link) return
          event.preventDefault()
          const href = link.getAttribute("href") || ""
          const store = window as typeof window & { __retentionNudgeClicks?: string[] }
          store.__retentionNudgeClicks = [...(store.__retentionNudgeClicks ?? []), href]
        },
        true
      )
    })

    await page.route("**/api/onboarding/checklist", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tasks: [],
          completedCount: 5,
          totalCount: 5,
          isFullyComplete: true,
        }),
      })
    })

    await page.route("**/api/retention/nudges", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ nudges }),
      })
    })

    await page.route("**/api/retention/nudges/dismiss", async (route) => {
      const body = parseBody(route.request())
      const id = String(body.nudgeId ?? "")
      nudges = nudges.filter((nudge) => nudge.id !== id)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/onboarding/funnel", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ currentStep: "welcome", completedAt: null, isComplete: false }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, nextStep: "completed" }),
      })
    })

    await gotoWithRetry(page, "/e2e/onboarding-funnel?step=welcome")
    await expect(page.getByTestId("retention-prompt-cards")).toBeVisible({ timeout: 20_000 })

    const links = page.locator('[data-testid^="retention-nudge-link-"]')
    const hrefs = await links.evaluateAll((elements) =>
      elements.map((el) => (el as HTMLAnchorElement).getAttribute("href") || "")
    )
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href).toMatch(/^\/(dashboard|feed|onboarding\/funnel|leagues|chimmy|creators|app)(\/.*)?$/)
      expect(href).not.toContain("undefined")
      expect(href).not.toContain("null")
      expect(href).not.toBe("#")
    }

    await page.getByTestId("retention-nudge-link-recap_weekly").click()
    await page.getByTestId("retention-nudge-link-reminder_onboarding").click()
    await page.getByTestId("retention-nudge-link-creator_rec_1").click()

    const clickedNudgeHrefs = await page.evaluate(() => {
      const win = window as typeof window & { __retentionNudgeClicks?: string[] }
      return win.__retentionNudgeClicks ?? []
    })
    expect(clickedNudgeHrefs).toEqual(
      expect.arrayContaining(["/dashboard", "/onboarding/funnel", "/creators/alpha"])
    )

    await page.getByTestId("retention-nudge-dismiss-recap_weekly").click()
    await expect(page.getByTestId("retention-nudge-card-recap_weekly")).toBeHidden()

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("retention-prompt-cards")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId("retention-nudge-card-recap_weekly")).toHaveCount(0)
  })

  test("mobile onboarding layout stays clean without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    await page.route("**/api/onboarding/checklist", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tasks: [
            {
              id: "select_sports",
              label: "Select favorite sports",
              description: "Choose your sports.",
              href: "/onboarding/funnel",
              ctaLabel: "Set sports",
              completed: false,
            },
          ],
          completedCount: 0,
          totalCount: 1,
          isFullyComplete: false,
        }),
      })
    })

    await page.route("**/api/retention/nudges", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ nudges: [] }),
      })
    })

    await page.route("**/api/retention/nudges/dismiss", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/onboarding/funnel", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ currentStep: "welcome", completedAt: null, isComplete: false }),
        })
        return
      }
      const body = parseBody(route.request())
      const step = String(body.step ?? "")
      const nextByStep: Record<string, string> = {
        welcome: "app_walkthrough",
        app_walkthrough: "sport_selection",
        sport_selection: "tool_suggestions",
        tool_suggestions: "league_prompt",
        league_prompt: "completed",
      }
      const next = nextByStep[step] ?? "league_prompt"
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, nextStep: next }),
      })
    })

    await gotoWithRetry(page, "/e2e/onboarding-funnel?step=welcome")
    await expect(page.getByTestId("onboarding-step-welcome")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId("onboarding-next-welcome")).toBeVisible({ timeout: 8_000 })

    const welcomeButtonHeight = await page
      .getByTestId("onboarding-next-welcome")
      .evaluate((el) => Math.round(el.getBoundingClientRect().height))
    expect(welcomeButtonHeight).toBeGreaterThanOrEqual(40)

    const hasOverflowOnWelcome = await page.evaluate(() => {
      const root = document.documentElement
      return root.scrollWidth > root.clientWidth + 1
    })
    expect(hasOverflowOnWelcome).toBeFalsy()

    await gotoWithRetry(page, "/e2e/onboarding-funnel?step=sport_selection")
    await expect(page.getByTestId("onboarding-step-sport-selection")).toBeVisible({ timeout: 10_000 })

    const hasOverflowOnSports = await page.evaluate(() => {
      const root = document.documentElement
      return root.scrollWidth > root.clientWidth + 1
    })
    expect(hasOverflowOnSports).toBeFalsy()

    await expect(page.getByTestId("onboarding-next-sport-selection")).toBeVisible()
  })
})
