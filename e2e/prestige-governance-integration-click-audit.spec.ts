import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

async function gotoWithRetry(page: Parameters<typeof test>[0]['page'], url: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      return
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      const canRetry =
        attempt < 2 &&
        (message.includes('net::ERR_ABORTED') || message.includes('interrupted by another navigation'))
      if (!canRetry) throw error
      await page.waitForTimeout(200)
    }
  }
}

test.describe('@prestige Prompt43 integration click audit', () => {
  test('audits commissioner trust/legacy integration links', async ({ page }) => {
    const leagueId = `e2e-prestige-commissioner-${Date.now()}`

    /*
     * ⚠ THE AI COMMISSIONER PANEL IS BEHIND AN ENTITLEMENT GATE, AND UNENTITLED IT
     * RENDERS AN UPSELL CARD INSTEAD OF ITS CONTENTS.
     *
     * CommissionerTab wraps <AICommissionerPanel> in
     * <FeatureGate featureId="commissioner_automation">, which reads
     * GET /api/subscription/entitlements through useEntitlement. Anonymously that
     * resolves to no plan, FeatureGate swaps in the upsell, and every testid inside the
     * panel vanishes — which is why the assertions ABOVE the gate (the trust-score link,
     * the coverage line) pass and the first one INSIDE it fails as "element(s) not found".
     * Granting the plan here is what puts the spec back in front of the panel it audits.
     */
    await page.route('**/api/subscription/entitlements**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entitlement: {
            plans: ['commissioner', 'supreme'],
            status: 'active',
            currentPeriodEnd: null,
            gracePeriodEnd: null,
          },
        }),
      })
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
        body: JSON.stringify({ inviteCode: 'abc', inviteLink: 'https://example.test/join', joinUrl: 'https://example.test/join' }),
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
    await page.route(`**/api/leagues/${leagueId}/prestige-governance?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          snapshot: {
            commissionerContext: {
              lowTrustManagerIds: ['mgr_beta'],
              highCommissionerTrustManagerIds: ['mgr_alpha'],
              reputationCoverageCount: 2,
              legacyCoverageCount: 2,
              hallOfFameEntryCount: 3,
            },
            sampleManagerSummaries: [
              {
                managerId: 'mgr_alpha',
                reputation: { tier: 'Trusted', overallScore: 73 },
                legacy: { overallLegacyScore: 81 },
                topHallOfFameTitle: 'Founding champion',
              },
            ],
          },
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          sport: 'NFL',
          season: 2026,
          config: {
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
          },
          alerts: [
            {
              alertId: 'alert-1',
              leagueId,
              sport: 'NFL',
              alertType: 'COLLUSION_SIGNAL',
              severity: 'high',
              headline: 'Potential collusion signal',
              summary: 'Repeated trade concentration detected.',
              relatedManagerIds: ['mgr_alpha'],
              relatedTradeId: null,
              relatedMatchupId: null,
              status: 'open',
              snoozedUntil: null,
              createdAt: new Date().toISOString(),
              resolvedAt: null,
            },
          ],
          actionLogs: [],
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/ai-commissioner/insights?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          sport: 'NFL',
          season: 2026,
          generatedAt: new Date().toISOString(),
          weeklyRecapPost: {
            title: 'NFL Commissioner Weekly Recap',
            body: 'Weekly recap context for prestige integration test.',
            bullets: [],
            actionHref: `/league/${leagueId}?tab=Commissioner`,
            actionLabel: 'Open Commissioner',
          },
          matchupSummaries: [],
          waiverHighlights: [],
          draftCommentary: [],
          controversialTrades: [],
          suggestedRuleAdjustments: [],
        }),
      })
    })

    /*
     * ⚠ SIGN IN, OR FeatureGate NEVER LEAVES ITS LOADING BRANCH AND THE PANEL NEVER MOUNTS.
     * AICommissionerPanel sits inside <FeatureGate featureId="commissioner_automation">
     * (CommissionerTab.tsx:373). FeatureGate renders `<p>Checking premium access...</p>`
     * while `loading || accessTier.loading`, and useAccessTier.ts:68 computes that as:
     *
     *   status === 'loading' || (isAuthenticated ? entitlements.loading : guestLoading)
     *
     * Unauthenticated, it therefore waits on `guestLoading`, which is cleared by a fetch to
     * /api/guest-mode/status — a route this spec does not mock. So the gate stayed in its
     * loading state forever and rendered NEITHER the panel NOR a locked card: measured on
     * the harness, 43 testids present and not one ai-commissioner-* or locked-feature-*,
     * with body text containing "Checking premium access".
     *
     * That is why this read as a deleted testid. The sibling test lower in this file already
     * signs in (line ~349); this one was simply missed. Authenticating makes `loading` follow
     * entitlements.loading, which the mock above already satisfies.
     */
    await signInAs(page, { id: 'e2e-prestige-commissioner-user' })
    await gotoWithRetry(page, `/e2e/commissioner?leagueId=${leagueId}`)
    await expect(page.getByRole('heading', { name: /e2e commissioner harness/i })).toBeVisible()
    await expect(page.getByText(/coverage: reputation 2, legacy 2, hall of fame 3/i)).toBeVisible()

    const trustScoresLink = page.getByRole('link', { name: /trust scores \(reputation\)/i })
    await expect(trustScoresLink).toHaveAttribute('href', new RegExp(`tab=Settings`))
    await expect(trustScoresLink).toHaveAttribute('href', new RegExp(`settingsTab=Reputation`))

    const trustLink = page.getByTestId('ai-commissioner-alert-manager-trust-alert-1-mgr_alpha')
    const legacyLink = page.getByTestId('ai-commissioner-alert-manager-legacy-alert-1-mgr_alpha')
    await expect(trustLink).toHaveAttribute('href', new RegExp(`reputationManagerId=mgr_alpha`))
    await expect(legacyLink).toHaveAttribute('href', new RegExp(`/legacy/breakdown\\?entityType=MANAGER&entityId=mgr_alpha&sport=NFL`))
  })

  test('audits reputation and hall-of-fame legacy bridges', async ({ page }) => {
    const leagueId = `e2e-prestige-bridge-${Date.now()}`
    const season = 2026

    await page.route(`**/api/leagues/${leagueId}/reputation?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reputations: [
            {
              managerId: 'mgr_alpha',
              sport: 'NFL',
              season,
              tier: 'Trusted',
              overallScore: 72,
              reliabilityScore: 70,
              activityScore: 74,
              tradeFairnessScore: 75,
              sportsmanshipScore: 69,
              commissionerTrustScore: 71,
              toxicityRiskScore: 19,
              participationQualityScore: 70,
              responsivenessScore: 68,
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/reputation/config?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          config: {
            sport: 'NFL',
            season,
            tierThresholds: {
              Legendary: { min: 90 },
              Elite: { min: 75, max: 89 },
              Trusted: { min: 60, max: 74 },
              Reliable: { min: 45, max: 59 },
              Neutral: { min: 25, max: 44 },
              Risky: { min: 0, max: 24 },
            },
            scoreWeights: {
              reliability: 1,
              activity: 1,
              tradeFairness: 1,
              sportsmanship: 1,
              commissionerTrust: 1,
              toxicityRisk: 1,
              participationQuality: 1,
              responsiveness: 1,
            },
          },
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/prestige-context?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          aiContext: {
            combinedHint: 'Governance and prestige context available.',
          },
          commissionerContext: {
            lowTrustManagerIds: [],
            highCommissionerTrustManagerIds: ['mgr_alpha'],
            reputationCoverageCount: 1,
          },
        }),
      })
    })

    await gotoWithRetry(page, `/e2e/reputation?leagueId=${leagueId}`)
    await expect(page.getByRole('heading', { name: /e2e reputation harness/i })).toBeVisible()
    await expect(page.getByText(/unified prestige context for ai/i)).toBeVisible()
    await expect(page.getByTestId('reputation-legacy-breakdown-link')).toHaveAttribute(
      'href',
      new RegExp(`/legacy/breakdown\\?entityType=MANAGER&entityId=mgr_alpha&sport=NFL`)
    )

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/entries/entry-1`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entry: {
            id: 'entry-1',
            entityType: 'MANAGER',
            entityId: 'mgr_alpha',
            sport: 'NFL',
            leagueId,
            season: '2025',
            category: 'CHAMPIONSHIP',
            title: 'Alpha title run',
            summary: 'Dominant title season.',
            inductedAt: new Date().toISOString(),
            score: 88,
            metadata: {},
            legacy: {
              overallLegacyScore: 82,
              championshipScore: 90,
              playoffScore: 84,
              consistencyScore: 78,
              rivalryScore: 66,
              awardsScore: 70,
              dynastyScore: 72,
            },
          },
          whyInductedPrompt: 'prompt',
        }),
      })
    })
    /*
     * `/app/league/*` is session-gated (lib/auth/session-auth-paths.ts). The gate only
     * fires when NEXTAUTH_SECRET is set — unset locally, SET in CI — so anonymously this
     * spec passed on a developer machine and 307'd to /login on every CI run, failing as
     * "element(s) not found" rather than as a redirect. Same fix, same reason, as
     * league-drama / hall-of-fame / legacy-score.
     */
    await signInAs(page, { id: 'e2e-prestige-user' })

    await gotoWithRetry(page, `/app/league/${leagueId}/hall-of-fame/entries/entry-1`)
    await expect(page.getByText(/legacy context/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /view legacy score/i })).toHaveAttribute(
      'href',
      new RegExp(`/legacy/breakdown\\?entityType=MANAGER&entityId=mgr_alpha&sport=NFL`)
    )

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/moments/moment-1`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          moment: {
            id: 'moment-1',
            leagueId,
            sport: 'NFL',
            season: '2025',
            headline: 'Historic upset',
            summary: 'A major rivalry swing.',
            relatedManagerIds: ['mgr_alpha'],
            relatedTeamIds: ['team_beta'],
            relatedMatchupId: null,
            significanceScore: 84,
            createdAt: new Date().toISOString(),
            relatedLegacy: {
              mgr_alpha: {
                overallLegacyScore: 82,
                championshipScore: 90,
                playoffScore: 84,
                consistencyScore: 78,
                rivalryScore: 66,
                awardsScore: 70,
                dynastyScore: 72,
              },
            },
          },
          whyInductedPrompt: 'prompt',
        }),
      })
    })
    await gotoWithRetry(page, `/app/league/${leagueId}/hall-of-fame/moments/moment-1`)
    await expect(page.getByRole('link', { name: /mgr_alpha — legacy/i })).toHaveAttribute(
      'href',
      new RegExp(`/legacy/breakdown\\?entityType=MANAGER&entityId=mgr_alpha&sport=NFL`)
    )
    await expect(page.getByRole('link', { name: /team_beta — legacy/i })).toHaveAttribute(
      'href',
      new RegExp(`/legacy/breakdown\\?entityType=TEAM&entityId=team_beta&sport=NFL`)
    )
  })
})
