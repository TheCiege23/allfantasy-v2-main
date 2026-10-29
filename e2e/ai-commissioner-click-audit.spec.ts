import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

test.describe('@commissioner ai commissioner click audit', () => {
  test('wires commissioner settings, alert actions, and AI explain end-to-end', async ({ page }) => {
    const leagueId = `e2e-ai-commissioner-${Date.now()}`
    const season = 2026
    page.on('dialog', (dialog) => dialog.accept())

    interface MockAlert {
      alertId: string
      leagueId: string
      sport: string
      alertType: string
      severity: string
      headline: string
      summary: string
      relatedManagerIds: string[]
      relatedTradeId: string | null
      relatedMatchupId: string | null
      status: string
      snoozedUntil: string | null
      createdAt: string
      resolvedAt: string | null
    }

    const configState: {
      configId: string
      leagueId: string
      sport: string
      remindersEnabled: boolean
      disputeAnalysisEnabled: boolean
      collusionMonitoringEnabled: boolean
      voteSuggestionEnabled: boolean
      inactivityMonitoringEnabled: boolean
      commissionerNotificationMode: string
      updatedAt: string
    } = {
      configId: 'cfg-1',
      leagueId,
      sport: 'NFL',
      remindersEnabled: true,
      disputeAnalysisEnabled: true,
      collusionMonitoringEnabled: true,
      voteSuggestionEnabled: true,
      inactivityMonitoringEnabled: true,
      commissionerNotificationMode: 'in_app',
      updatedAt: new Date().toISOString(),
    }
    let alertsState: MockAlert[] = [
      {
        alertId: 'alert-1',
        leagueId,
        sport: 'NFL',
        alertType: 'COLLUSION_SIGNAL',
        severity: 'high',
        headline: 'Potential collusion signal detected',
        summary: 'Repeated trade concentration detected between two managers.',
        relatedManagerIds: ['m-a', 'm-b'],
        relatedTradeId: 'trade-1',
        relatedMatchupId: null,
        status: 'open',
        snoozedUntil: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      },
    ]
    const actionLogs: Array<{
      actionId: string
      actionType: string
      source: string
      summary: string
      createdAt: string
    }> = []

    const configPatches: Array<Record<string, unknown>> = []
    const runPosts: Array<Record<string, unknown>> = []
    const alertPosts: Array<Record<string, unknown>> = []
    const explainPosts: Array<Record<string, unknown>> = []
    const chatPosts: Array<Record<string, unknown>> = []

    const insightsState = {
      leagueId,
      sport: 'NFL',
      season,
      generatedAt: new Date().toISOString(),
      weeklyRecapPost: {
        title: 'NFL Commissioner Weekly Recap',
        body: 'Week-in-review for season 2026 with matchup momentum and waiver outcomes.',
        bullets: [
          '2 matchup storyline(s) summarized for NFL.',
          '2 waiver result highlight(s) reviewed by AI Commissioner.',
          '1 recent trade scanned for fairness.',
          '2 draft commentary note(s) generated from recent picks.',
        ],
        actionHref: `/league/${leagueId}?tab=Commissioner`,
        actionLabel: 'Open Commissioner',
      },
      matchupSummaries: [
        {
          matchupId: 'match-1',
          weekOrPeriod: 8,
          summary: 'Week 8: Alpha 121.2 - Beta 119.8 (winner: Alpha, margin 1.4).',
        },
      ],
      waiverHighlights: [
        {
          claimId: 'claim-1',
          summary: 'Roster r1 added player-a and dropped player-b for $17 FAAB.',
          processedAt: new Date().toISOString(),
        },
      ],
      draftCommentary: [
        {
          pickId: 'pick-1',
          createdAt: new Date().toISOString(),
          summary: 'Round 4, pick 42: Team Alpha selected RB Example (RB) via user pick.',
        },
      ],
      controversialTrades: [
        {
          tradeId: 'trade-1',
          transactionId: 'tx-1',
          createdAt: new Date().toISOString(),
          sport: 'NFL',
          fairnessScore: 44,
          imbalancePct: 56,
          controversyLevel: 'high',
          summary: 'Trade tx-1 shows an estimated 56% value imbalance and needs review.',
          relatedManagerIds: ['m-a', 'm-b'],
        },
      ],
      suggestedRuleAdjustments: [
        'Increase waiver processing cadence to reduce queue backlog.',
        'Require commissioner review for high-imbalance trades before league vote.',
      ],
    }

    const buildOverview = () => ({
      leagueId,
      sport: configState.sport,
      season,
      config: { ...configState },
      alerts: [...alertsState],
      actionLogs: [...actionLogs],
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/waivers?type=pending**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ claims: [] }) })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/waivers?type=settings**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ waiver_type: 'faab' }) })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/invite`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          inviteCode: 'abc123',
          inviteLink: `https://example.test/join?code=abc123`,
          joinUrl: `https://example.test/join?code=abc123`,
        }),
      })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/managers`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ teams: [], rosters: [], managers: [] }),
      })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/lineup`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ lineupLockRule: 'first_game', invalidRosters: [] }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: leagueId, settings: { lineupLockRule: 'first_game' } }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/draft/session`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: null }) })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/settings`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: { leagueChatThreadId: 'thread-e2e-1' } }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/ai-commissioner/config`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON() as Record<string, unknown>
        configPatches.push(payload)
        Object.assign(configState, payload, { updatedAt: new Date().toISOString() })
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(configState),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner/run`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      runPosts.push(payload)
      alertsState = [
        {
          alertId: `alert-run-${alertsState.length + 1}`,
          leagueId,
          sport: String(payload.sport ?? configState.sport),
          alertType: 'LINEUP_REMINDER',
          severity: 'medium',
          headline: 'Lineup lock reminders are active',
          summary: 'Commissioner reminders scheduled before lineup lock.',
          relatedManagerIds: [],
          relatedTradeId: null,
          relatedMatchupId: null,
          status: 'open',
          snoozedUntil: null,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
        },
        ...alertsState,
      ]
      actionLogs.unshift({
        actionId: `act-${Date.now()}`,
        actionType: 'RUN_CYCLE',
        source: 'commissioner_ui',
        summary: 'Cycle run completed.',
        createdAt: new Date().toISOString(),
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: configState,
          analysis: {},
          createdAlerts: [alertsState[0]],
          touchedAlerts: alertsState.length,
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner/explain`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      explainPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          narrative:
            'This alert is high priority because repeated manager concentration and trade imbalance exceed your configured governance thresholds.',
          source: 'template',
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner/insights?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(insightsState),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner/chat`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      chatPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer:
            'Commissioner guidance: tighten waiver windows this week and review any trade under a 50 fairness score before approval.',
          source: 'template',
          insights: insightsState,
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner/alerts/**`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      alertPosts.push(payload)
      const url = new URL(route.request().url())
      const alertId = url.pathname.split('/').pop() || ''
      const action = String(payload.action ?? '')
      alertsState = alertsState.map((alert): MockAlert => {
        if (alert.alertId !== alertId) return alert
        if (action === 'approve') return { ...alert, status: 'approved', resolvedAt: null, snoozedUntil: null }
        if (action === 'dismiss') return { ...alert, status: 'dismissed', resolvedAt: new Date().toISOString(), snoozedUntil: null }
        if (action === 'resolve') return { ...alert, status: 'resolved', resolvedAt: new Date().toISOString(), snoozedUntil: null }
        if (action === 'reopen') return { ...alert, status: 'open', resolvedAt: null, snoozedUntil: null }
        if (action === 'snooze') {
          return {
            ...alert,
            status: 'snoozed',
            snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            resolvedAt: null,
          }
        }
        return alert
      })
      actionLogs.unshift({
        actionId: `act-${Date.now()}`,
        actionType: `ALERT_${action.toUpperCase()}`,
        source: 'commissioner_ui',
        summary: `${action} action applied.`,
        createdAt: new Date().toISOString(),
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildOverview()),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildOverview()),
      })
    })
    /*
     * ⚠ FeatureGate shows "Checking premium access..." until useAccessTier settles. When
     * signed out, useAccessTier waits on GET /api/guest-mode/status. Unmocked, that request
     * goes to the dev server and waits behind cold route compiles, so it can outlast the 20s
     * heading wait below and the panel never mounts. A retry usually passes because the
     * route is warm by then.
     */
    await page.route('**/api/guest-mode/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isGuest: false, sleeperUsername: null, displayName: null }),
      })
    })
    await page.route('**/api/subscription/entitlements**', async (route) => {
      const url = new URL(route.request().url())
      const feature = String(url.searchParams.get('feature') ?? '')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entitlement: {
            plans: ['commissioner'],
            status: 'active',
            currentPeriodEnd: null,
            gracePeriodEnd: null,
          },
          hasAccess: true,
          message: 'Access granted.',
          requiredPlan: feature ? 'AF Commissioner' : null,
          upgradePath: feature
            ? `/upgrade?plan=commissioner&feature=${encodeURIComponent(feature)}`
            : '/commissioner-upgrade',
        }),
      })
    })
    await page.route('**/api/monetization/context**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entitlement: {
            plans: ['commissioner'],
            status: 'active',
            currentPeriodEnd: null,
            gracePeriodEnd: null,
          },
          entitlementMessage: 'Access granted.',
          feature: {
            featureId: 'commissioner_automation',
            hasAccess: true,
            requiredPlan: 'AF Commissioner',
            upgradePath: '/upgrade?plan=commissioner&feature=commissioner_automation',
            message: 'Access granted.',
          },
          tokenBalance: {
            balance: 25,
            lifetimePurchased: 0,
            lifetimeSpent: 0,
            lifetimeRefunded: 0,
            updatedAt: new Date().toISOString(),
          },
          tokenPreviews: [
            {
              ruleCode: 'commissioner_ai_cycle_run',
              preview: {
                ruleCode: 'commissioner_ai_cycle_run',
                featureLabel: 'AI Commissioner cycle run',
                tokenCost: 3,
                currentBalance: 25,
                canSpend: true,
                requiresConfirmation: true,
              },
              error: null,
            },
            {
              ruleCode: 'commissioner_ai_chat_question',
              preview: {
                ruleCode: 'commissioner_ai_chat_question',
                featureLabel: 'AI Commissioner question',
                tokenCost: 1,
                currentBalance: 25,
                canSpend: true,
                requiresConfirmation: true,
              },
              error: null,
            },
          ],
        }),
      })
    })
    await page.route('**/api/tokens/spend/preview?**', async (route) => {
      const url = new URL(route.request().url())
      const ruleCode = String(url.searchParams.get('ruleCode') ?? '')
      const tokenCost = ruleCode === 'commissioner_ai_cycle_run' ? 3 : 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preview: {
            ruleCode,
            featureLabel: ruleCode,
            tokenCost,
            currentBalance: 25,
            canSpend: true,
            requiresConfirmation: true,
          },
        }),
      })
    })

    await page.goto(`/e2e/commissioner?leagueId=${leagueId}`)
    await expect(page.getByRole('heading', { name: /e2e commissioner harness/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /ai commissioner/i })).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('ai-commissioner-sport').selectOption('NBA')
    await page.getByTestId('ai-commissioner-season').fill('2026')
    await page.getByTestId('ai-commissioner-refresh').click()

    const remindersToggle = page.getByRole('checkbox', { name: /lineup reminders/i }).first()
    await remindersToggle.uncheck()
    await page.getByTestId('ai-commissioner-save-config').click()
    await expect.poll(() => configPatches.length).toBeGreaterThan(0)
    expect(configPatches.some((p) => p.remindersEnabled === false)).toBe(true)

    await page.getByTestId('ai-commissioner-run').click()
    await expect(page.getByTestId('commissioner-token-preflight-modal')).toBeVisible()
    await page.getByTestId('commissioner-token-preflight-confirm').click()
    await expect.poll(() => runPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/lineup lock reminders are active/i)).toBeVisible()

    await expect(page.getByTestId('ai-commissioner-recap-panel')).toBeVisible()
    await expect(page.getByText(/commissioner weekly recap/i)).toBeVisible()

    await page.getByTestId('ai-commissioner-alert-explain-alert-run-2').click()
    await expect.poll(() => explainPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/high priority because repeated manager concentration/i)).toBeVisible()

    await page.getByTestId('ai-commissioner-trade-explain-trade-1').click()
    await expect.poll(() => explainPosts.some((p) => p.tradeId === 'trade-1')).toBeTruthy()

    await page.getByTestId('ai-commissioner-chat-input').fill(
      'Summarize waiver results and controversial trades.'
    )
    await page.getByTestId('ai-commissioner-chat-button').click()
    await expect(page.getByTestId('commissioner-token-preflight-modal')).toBeVisible()
    await page.getByTestId('commissioner-token-preflight-confirm').click()
    await expect.poll(() => chatPosts.length).toBeGreaterThan(0)
    expect(String(chatPosts[0]?.question ?? '')).toMatch(/waiver results and controversial trades/i)
    expect(typeof chatPosts[0]?.sport).toBe('string')
    await expect(page.getByTestId('ai-commissioner-chat-response')).toContainText(
      /tighten waiver windows this week/i
    )

    await page.getByRole('button', { name: 'Snooze 24h' }).first().click()
    await expect.poll(() => alertPosts.some((p) => p.action === 'snooze')).toBeTruthy()
    await expect(page.getByText(/status snoozed/i).first()).toBeVisible()

    await page.getByRole('button', { name: 'Send notice' }).first().click()
    await expect.poll(() => alertPosts.some((p) => p.action === 'send_notice')).toBeTruthy()

    await page.getByRole('button', { name: 'Resolve' }).first().click()
    await expect.poll(() => alertPosts.some((p) => p.action === 'resolve')).toBeTruthy()
    await expect(page.getByText(/status resolved/i).first()).toBeVisible()
  })
})
