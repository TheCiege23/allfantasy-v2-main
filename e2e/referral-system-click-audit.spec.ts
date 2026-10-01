import { expect, test } from "@playwright/test"
import { signInAs } from "./helpers/session-cookie"

test.describe("referral system click audit", () => {
  test("copy, share, reload, leaderboard, and claim flows all work", async ({ page }) => {
    const sharedChannels: string[] = []
    let dashboardState = {
      code: "AF-REF-143",
      link: "http://localhost:3000/?ref=AF-REF-143",
      audience: "user",
      stats: {
        clicks: 4,
        shares: 2,
        signups: 0,
        onboarded: 0,
        creatorReferrals: 0,
        claimableRewards: 0,
        pendingRewards: 0,
        redeemedRewards: 0,
        totalRewardValue: 0,
        conversionRate: 0,
      },
      progress: {
        audience: "user",
        tier: { id: "starter", label: "Starter" },
        nextMilestone: { signups: 3, label: "Bronze Ambassador" },
        milestones: [
          { signups: 0, label: "Starter", achieved: true },
          { signups: 3, label: "Bronze Ambassador", achieved: false },
        ],
        signups: 0,
        clicks: 4,
        shares: 2,
        onboarded: 0,
        claimableRewards: 0,
        pendingRewards: 0,
        redeemedRewards: 0,
        progressPct: 0,
        onboardingCompletionRate: 0,
      },
      rewards: [] as Array<{
        id: string
        type: string
        rewardKind: string
        label: string
        description: string | null
        value: number
        status: string
        grantedAt: string
        redeemedAt: string | null
        claimLabel: string
        helperText: string | null
        badgeType?: string | null
      }>,
      leaderboard: [
        {
          rank: 1,
          userId: "leader-1",
          displayName: "Top Recruiter",
          username: "toprecruiter",
          avatarUrl: null,
          isCreator: true,
          signups: 18,
          clicks: 42,
          shares: 21,
          onboarded: 10,
          redeemedRewards: 7,
          tier: "Silver Ambassador",
        },
      ],
      referred: [] as Array<{
        referredUserId: string
        displayName: string | null
        createdAt: string
        status: string
        kind: string
        onboardingStep: string | null
      }>,
      funnel: {
        clicked: 4,
        signedUp: 0,
        engaged: 0,
        onboarded: 0,
        rewarded: 0,
      },
      ctaCards: [
        {
          id: "share",
          title: "Share your referral link",
          description: "Invite friends into AllFantasy and turn signups into XP, badges, and rank.",
          href: "/referral",
          label: "Share now",
          variant: "default",
        },
        {
          id: "leaderboard",
          title: "Climb the referral leaderboard",
          description: "See where you rank against the platform’s most effective recruiters.",
          href: "/referral?tab=leaderboard",
          label: "Open leaderboard",
          variant: "leaderboard",
        },
        {
          id: "rewards",
          title: "Claim referral rewards",
          description: "Turn successful referrals into progression rewards and creator credibility.",
          href: "/referral?tab=rewards",
          label: "View rewards",
          variant: "rewards",
        },
      ],
      updatedAt: new Date("2026-03-27T12:00:00.000Z").toISOString(),
    }

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async () => {},
        },
        configurable: true,
      })

      window.open = () => null
    })

    /*
     * /referral is gated on `useSession()`. The root layout preloads the server session into
     * next-auth's SessionProvider, so with no cookie the client starts `unauthenticated` and never
     * requests /api/auth/session — a route mock of it is never consulted. This spec used to pass
     * only because the pre-Next-15.5 dev server ran the provider's mount effect twice and the
     * second pass refetched the session. A real signed cookie is what the other gated specs use.
     */
    await signInAs(page, { id: "qa-referral-user", name: "QA Referral", email: "qa-referral@example.com" })

    await page.route("**/api/referral/dashboard", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, dashboard: dashboardState }),
      })
    })

    await page.route("**/api/referral/share", async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { channel?: string }
      if (typeof body.channel === "string") sharedChannels.push(body.channel)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/referral/rewards/redeem", async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { rewardId?: string }
      if (body.rewardId === "reward-143") {
        dashboardState = {
          ...dashboardState,
          stats: {
            ...dashboardState.stats,
            claimableRewards: 0,
            redeemedRewards: 1,
            totalRewardValue: 50,
          },
          progress: {
            ...dashboardState.progress,
            claimableRewards: 0,
            redeemedRewards: 1,
          },
          rewards: dashboardState.rewards.map((reward) =>
            reward.id === "reward-143"
              ? {
                  ...reward,
                  status: "redeemed",
                  redeemedAt: new Date("2026-03-27T12:15:00.000Z").toISOString(),
                }
              : reward
          ),
        }
      }

      const reward = dashboardState.rewards.find((entry) => entry.id === "reward-143")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, reward, stats: dashboardState.stats }),
      })
    })

    await page.goto("/referral", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("heading", { name: "Grow the league, earn the upside" })).toBeVisible()

    await page.getByTestId("referral-copy-code").click()
    await expect(page.getByTestId("referral-copy-code")).toContainText("Copied")

    await page.getByTestId("referral-share-twitter").click()
    await expect.poll(() => sharedChannels.includes("twitter")).toBeTruthy()

    dashboardState = {
      ...dashboardState,
      stats: {
        ...dashboardState.stats,
        signups: 1,
        claimableRewards: 1,
        conversionRate: 25,
      },
      progress: {
        ...dashboardState.progress,
        signups: 1,
        claimableRewards: 1,
        progressPct: 33,
      },
      rewards: [
        {
          id: "reward-143",
          type: "referral_signup",
          rewardKind: "xp",
          label: "Referral XP",
          description: "Earn XP when a friend signs up with your referral code.",
          value: 50,
          status: "claimable",
          grantedAt: new Date("2026-03-27T12:10:00.000Z").toISOString(),
          redeemedAt: null,
          claimLabel: "Claim XP",
          helperText: "Adds referral XP to your progression profile.",
          badgeType: null,
        },
      ],
      referred: [
        {
          referredUserId: "friend-143",
          displayName: "New Friend",
          createdAt: new Date("2026-03-27T12:08:00.000Z").toISOString(),
          status: "signed_up",
          kind: "user",
          onboardingStep: null,
        },
      ],
      funnel: {
        clicked: 4,
        signedUp: 1,
        engaged: 0,
        onboarded: 0,
        rewarded: 1,
      },
      updatedAt: new Date("2026-03-27T12:10:00.000Z").toISOString(),
    }

    await page.getByTestId("referral-dashboard-reload").click()
    await expect(page.getByTestId("referral-stat-signups")).toContainText("1")
    await expect(page.getByTestId("referral-stat-claimable-rewards")).toContainText("1")

    await page.getByTestId("referral-open-leaderboard").click()
    await expect(page.getByRole("heading", { name: "Referral leaderboard", exact: true })).toBeVisible()
    await expect(page.getByText("Top Recruiter")).toBeVisible()

    await page.getByTestId("referral-tab-rewards").click()
    const claimButton = page.getByTestId("referral-claim-reward-143")
    await expect(claimButton).toBeEnabled()
    await claimButton.click()
    await expect(page.getByText("Claimed").first()).toBeVisible()
  })
})
