import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe('@ai ai system final integration click audit', () => {
  test.describe.configure({ mode: 'serial', timeout: 210_000 })

  function mockAiAssistantFeature(page: Page, state: { enabled: boolean }) {
    page.route('**/api/config/features', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          features: {
            feature_ai_assistant: state.enabled,
          },
        }),
      })
    })
  }

  async function mockWaiverApis(page: Page, leagueId: string) {
    await page.route(`**/api/waiver-wire/leagues/${leagueId}/settings`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          sport: 'NFL',
          formatType: 'REDRAFT',
          waiverType: 'faab',
          processingTimeUtc: '03:00:00',
          claimLimitPerPeriod: 3,
          faabBudget: 100,
          tiebreakRule: 'waiver_priority',
          instantFaAfterClear: false,
        }),
      })
    })

    await page.route(`**/api/waiver-wire/leagues/${leagueId}/claims**`, async (route) => {
      const url = route.request().url()
      if (url.includes('type=history')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            claims: [],
            transactions: [
              {
                id: 'tx-1',
                addPlayerId: 'player-2',
                dropPlayerId: 'roster-2',
                faabSpent: 8,
                processedAt: new Date().toISOString(),
              },
            ],
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          claims: [
            {
              id: 'claim-1',
              addPlayerId: 'player-1',
              dropPlayerId: 'roster-1',
              faabBid: 12,
              priorityOrder: 1,
              status: 'pending',
            },
          ],
        }),
      })
    })

    await page.route(`**/api/waiver-wire/leagues/${leagueId}/players**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          players: [
            { id: 'player-1', name: 'Atlas Runner', position: 'RB', team: 'NYJ' },
            { id: 'player-2', name: 'Blaze Catcher', position: 'WR', team: 'DAL' },
            { id: 'player-3', name: 'Core Signal', position: 'QB', team: 'KC' },
          ],
        }),
      })
    })

    await page.route(`**/api/league/roster?leagueId=${leagueId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          roster: [
            { id: 'roster-1', name: 'Keeper One', position: 'RB', team: 'BUF', slot: 'starter' },
            { id: 'roster-2', name: 'Keeper Two', position: 'WR', team: 'MIA', slot: 'bench' },
          ],
          faabRemaining: 76,
          waiverPriority: 4,
          slotLimits: { starters: 9, bench: 7, ir: 1, taxi: 0, devy: 0 },
          starterAllowedPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX'],
        }),
      })
    })

    await page.route('**/api/waiver-ai/engine', async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { includeAIExplanation?: boolean }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          analysis: {
            sport: 'NFL',
            deterministic: {
              basedOn: ['value', 'need', 'trend'],
              suggestions: [
                {
                  playerId: 'player-1',
                  playerName: 'Atlas Runner',
                  position: 'RB',
                  team: 'NYJ',
                  compositeScore: 92,
                  recommendation: 'Must Add',
                  faabBid: 16,
                  topDrivers: [{ label: 'Need fit', detail: 'RB need is high.' }],
                },
              ],
            },
            explanation: {
              source: body.includeAIExplanation ? 'ai' : 'deterministic',
              text: body.includeAIExplanation
                ? 'AI explanation: target Atlas Runner for immediate workload upside.'
                : 'Deterministic explanation: target Atlas Runner by need/value score.',
            },
          },
        }),
      })
    })
  }

  async function mockTradeEvaluatorApi(page: Page) {
    await page.route('**/api/trade-evaluator', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          trade_id: 'e2e-trade-1',
          evaluation: {
            fairness_score_0_to_100: 54,
            winner: 'even',
            summary: 'Balanced trade with small value edge.',
          },
          end_of_season_projection: {
            sender: 'Slightly improved weekly floor.',
            receiver: 'Higher upside variance.',
          },
          dynasty_idp_outlook: {
            sender: 'Neutral long-term impact.',
            receiver: 'Slight long-term upside.',
          },
        }),
      })
    })
  }

  async function mockLeagueChatApis(page: Page, leagueId: string) {
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'user-1', name: 'E2E User', email: 'e2e@example.com' },
          expires: '2099-01-01T00:00:00.000Z',
        }),
      })
    })

    await page.route('**/api/user/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { timezone: 'America/New_York', preferredLanguage: 'en' },
          settings: {},
        }),
      })
    })

    await page.route('**/api/user/profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'user-1', username: 'e2euser', displayName: 'E2E User' }),
      })
    })

    await page.route('**/api/shared/chat/threads', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          threads: [
            {
              id: `league:${leagueId}`,
              threadType: 'group',
              productType: 'shared',
              title: 'E2E League Chat',
              unreadCount: 0,
              memberCount: 12,
              context: { leagueId, sport: 'NFL' },
            },
            {
              id: 'dm-e2e-1',
              threadType: 'dm',
              productType: 'shared',
              title: 'Alex DM',
              unreadCount: 0,
              memberCount: 2,
              context: { otherUsername: 'alex' },
            },
          ],
        }),
      })
    })

    await page.route('**/api/shared/chat/threads/*/messages**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [
            {
              id: 'msg-1',
              threadId: `league:${leagueId}`,
              senderUserId: 'user-2',
              senderName: 'Alex',
              messageType: 'text',
              body: 'League chat is live.',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      })
    })

    await page.route('**/api/shared/chat/threads/*/pinned', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pinned: [] }),
      })
    })

    await page.route('**/api/ai/providers/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ openai: true, deepseek: true, grok: true }),
      })
    })
  }

  async function fillAndEvaluateTrade(page: Page) {
    await page.getByLabel('sender player 1 name').fill('Atlas Runner')
    await page.getByLabel('receiver player 1 name').fill('Blaze Catcher')
    await clickHydrated(page.getByTestId('trade-evaluate-button'))
    await expect(page.getByTestId('trade-ai-explanation-link')).toBeVisible()
  }

  test('draft helper toggles AI link and deterministic refresh fallback', async ({ page }) => {
    const ai = { enabled: true }
    mockAiAssistantFeature(page, ai)

    await page.goto('/e2e/draft-helper-ai')
    await expect(page.getByTestId('draft-helper-ai-explanation-toggle')).toBeEnabled()
    await expect(page.getByTestId('draft-ai-suggestion-button')).toHaveAttribute('href', /insightType=draft/)

    ai.enabled = false
    await page.reload()
    await expect(page.getByTestId('draft-helper-ai-explanation-toggle')).toBeDisabled()
    const fallbackButton = page.getByTestId('draft-ai-suggestion-fallback-button')
    await expect(fallbackButton).toBeVisible()
    await clickHydrated(fallbackButton)
    await expect(page.getByTestId('draft-helper-harness-refresh-count')).toContainText('Refresh count: 1')
  })

  test('waiver wire AI actions stay wired with assistant enabled and disabled', async ({ page }) => {
    const ai = { enabled: true }
    const leagueId = 'e2e-waiver-live'
    mockAiAssistantFeature(page, ai)
    await mockWaiverApis(page, leagueId)

    await page.goto('/e2e/waiver-wire-live')
    await expect(page.getByTestId('waiver-ai-help-link')).toContainText('Get AI waiver help')
    await expect(page.getByTestId('waiver-ai-help-link')).toHaveAttribute('href', /\/messages\?tab=ai/)
    await expect(page.getByTestId('waiver-ai-engine-explanation-toggle')).toBeEnabled()

    ai.enabled = false
    await page.reload()
    await expect(page.getByTestId('waiver-ai-help-link')).toContainText('Open deterministic waiver guidance')
    await expect(page.getByTestId('waiver-ai-help-link')).toHaveAttribute('href', '#waiver-ai-engine-panel')
    await expect(page.getByTestId('waiver-ai-engine-explanation-toggle')).toBeDisabled()
  })

  test('trade evaluator AI discussion link falls back to deterministic route', async ({ page }) => {
    const ai = { enabled: true }
    mockAiAssistantFeature(page, ai)
    await mockTradeEvaluatorApi(page)

    await page.goto('/trade-evaluator')
    await fillAndEvaluateTrade(page)
    await expect(page.getByTestId('trade-ai-explanation-link')).toContainText('Discuss in AI Chat')
    await expect(page.getByTestId('trade-ai-explanation-link')).toHaveAttribute('href', /\/messages\?tab=ai/)
    await expect(page.getByTestId('trade-ai-explanation-link')).toHaveAttribute('href', /insightType=trade/)

    ai.enabled = false
    await page.reload()
    await fillAndEvaluateTrade(page)
    await expect(page.getByTestId('trade-ai-explanation-link')).toContainText('Open deterministic trade finder')
    await expect(page.getByTestId('trade-ai-explanation-link')).toHaveAttribute('href', /\/trade-finder\?/)
  })

  test('league chat AI tab switches to offline fallback when assistant is disabled', async ({ page }) => {
    const ai = { enabled: true }
    const leagueId = 'e2e-league-chat-ai'
    mockAiAssistantFeature(page, ai)
    await mockLeagueChatApis(page, leagueId)

    await page.goto('/e2e/league-chat-ai')
    await clickHydrated(page.getByRole('button', { name: /AI Chat/i }))
    await expect(page.getByTestId('chimmy-chat-shell')).toBeVisible()

    ai.enabled = false
    await page.reload()
    await clickHydrated(page.getByRole('button', { name: /AI Chat/i }))
    await expect(page.getByTestId('league-chat-ai-fallback')).toBeVisible()
    await expect(page.getByRole('link', { name: /Open waiver planner/i })).toHaveAttribute(
      'href',
      `/waiver-ai?leagueId=${leagueId}`
    )
    await expect(page.getByRole('link', { name: /Open trade finder/i })).toHaveAttribute(
      'href',
      `/trade-finder?leagueId=${leagueId}`
    )
  })
})
