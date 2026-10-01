import { expect, test } from '@playwright/test'
import { mockLeagueSettingsGetForScoring } from './helpers/mockLeagueSettingsForScoring'

test.describe.configure({ timeout: 240_000 })

test.describe('@commissioner commissioner control panel click audit', () => {
  test('commissioner settings, actions, and reset flows are wired end-to-end', async ({ page }) => {
    const leagueId = `e2e-commissioner-control-${Date.now()}`

    page.on('dialog', async (dialog) => {
      await dialog.accept()
    })

    const settingsPatches: Array<Record<string, unknown>> = []
    const waiverPuts: Array<Record<string, unknown>> = []
    const draftPatches: Array<Record<string, unknown>> = []
    const draftExecutionModePatches: Array<Record<string, unknown>> = []
    const aiPatches: Array<Record<string, unknown>> = []
    const privacyPatches: Array<Record<string, unknown>> = []
    const inviteRegenerations: Array<Record<string, unknown>> = []
    const inviteSendPosts: Array<Record<string, unknown>> = []
    const draftControlPosts: Array<Record<string, unknown>> = []
    const managerReplacePatches: Array<Record<string, unknown>> = []
    const assignAiPosts: Array<Record<string, unknown>> = []
    const templateSavePosts: Array<Record<string, unknown>> = []
    const templateDeleteIds: string[] = []
    const importPreviewPosts: Array<Record<string, unknown>> = []
    const importCommitPosts: Array<Record<string, unknown>> = []
    const transferPosts: Array<Record<string, unknown>> = []
    const removedRosterIds: string[] = []
    const resetModes: string[] = []
    const broadcasts: string[] = []

    const settingsState: {
      id: string
      name: string
      description: string
      sport: string
      season: number
      leagueSize: number
      rosterSize: number
      starters: Record<string, number>
      settings: Record<string, unknown>
    } = {
      id: leagueId,
      name: 'Commissioner Audit League',
      description: 'Initial commissioner league',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      rosterSize: 20,
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
      settings: {
        leagueChatThreadId: 'thread-e2e-commissioner',
        benchSize: 6,
        rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
        tradeReviewType: 'commissioner',
        vetoThreshold: 4,
      },
    }

    let waiverState: Record<string, unknown> = {
      waiver_type: 'faab',
      processing_days: [2],
      processing_time_utc: '08:00',
      claim_limit_per_period: 5,
      game_lock_behavior: 'game_time',
      free_agent_unlock_behavior: 'after_waivers',
      continuous_waivers: false,
      faab_enabled: true,
      faab_budget: 100,
      faab_reset_rules: null,
      claim_priority_behavior: 'faab_highest',
      tiebreak_rule: 'faab_highest',
      instant_fa_after_clear: false,
      sport: 'NFL',
      variant: 'DYNASTY',
    }

    let scoringState: {
      leagueId: string
      sport: string
      leagueVariant: string | null
      formatType: string
      templateId: string
      rules: Array<{
        statKey: string
        pointsValue: number
        multiplier: number
        enabled: boolean
        defaultPointsValue: number
        defaultEnabled: boolean
        isOverridden: boolean
      }>
    } = {
      leagueId,
      sport: 'NFL',
      leagueVariant: 'DYNASTY',
      formatType: 'standard',
      templateId: 'NFL-standard',
      rules: [
        {
          statKey: 'passing_td',
          pointsValue: 4,
          multiplier: 1,
          enabled: true,
          defaultPointsValue: 4,
          defaultEnabled: true,
          isOverridden: false,
        },
        {
          statKey: 'rushing_td',
          pointsValue: 6,
          multiplier: 1,
          enabled: true,
          defaultPointsValue: 6,
          defaultEnabled: true,
          isOverridden: false,
        },
      ],
    }

    let draftState: {
      config: Record<string, unknown>
      draftUISettings: Record<string, unknown>
      isCommissioner: boolean
      draftOrderMode: string
      lotteryConfig: null
      sessionPreDraft: boolean
      sessionVariant: null | Record<string, unknown>
    } = {
      config: {
        draft_type: 'snake',
        rounds: 15,
        timer_seconds: 60,
        slow_timer_seconds: 3600,
        snake_or_linear: 'snake',
        pick_order_rules: 'snake',
        third_round_reversal: false,
        autopick_behavior: 'queue-first',
        queue_size_limit: 50,
        pre_draft_ranking_source: 'adp',
        roster_fill_order: 'starter_first',
        position_filter_behavior: 'by_eligibility',
        sport: 'NFL',
        variant: 'DYNASTY',
        leagueSize: 12,
      },
      draftUISettings: {
        tradedPickColorModeEnabled: true,
        tradedPickOwnerNameRedEnabled: true,
        aiAdpEnabled: true,
        aiQueueReorderEnabled: true,
        orphanTeamAiManagerEnabled: false,
        orphanDrafterMode: 'cpu',
        liveDraftChatSyncEnabled: false,
        autoPickEnabled: false,
        timerMode: 'per_pick',
        commissionerForceAutoPickEnabled: true,
        commissionerPauseControlsEnabled: true,
        draftOrderRandomizationEnabled: true,
        pickTradeEnabled: true,
        auctionAutoNominationEnabled: false,
        importEnabled: true,
      },
      isCommissioner: true,
      draftOrderMode: 'randomize',
      lotteryConfig: null,
      sessionPreDraft: true,
      sessionVariant: null,
    }

    let aiSettingsState: Record<string, boolean> = {
      tradeAnalyzerEnabled: true,
      waiverAiEnabled: true,
      draftAssistantEnabled: true,
      playerComparisonEnabled: true,
      matchupSimulatorEnabled: true,
      fantasyCoachEnabled: true,
      aiChatChimmyEnabled: true,
      aiDraftManagerOrphanEnabled: false,
    }

    let privacyState: Record<string, unknown> = {
      visibility: 'private',
      allowInviteLink: true,
      allowEmailInvite: false,
      allowUsernameInvite: false,
      inviteCode: 'INVITE123',
      inviteLink: 'https://allfantasy.ai/join?code=INVITE123',
      inviteExpiresAt: null,
      isCommissioner: true,
    }
    const importPreviewState = {
      dataQuality: {
        fetchedAt: Date.now(),
        sources: { users: true, rosters: true, matchups: true, trades: true, draftPicks: true, playerMap: true, history: false },
        rosterCoverage: 100,
        matchupWeeksCovered: 0,
        completenessScore: 86,
        tier: 'FULL',
        signals: [],
        coverageSummary: [],
      },
      league: {
        id: 'import-src-123',
        name: 'Imported Legacy League',
        sport: 'NFL',
        season: 2026,
        type: 'Dynasty',
        teamCount: 12,
        playoffTeams: 6,
        avatar: null,
        settings: {
          ppr: true,
          superflex: false,
          tep: false,
          rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
        },
      },
      managers: [
        {
          rosterId: '1',
          ownerId: 'mgr-1',
          username: 'manager1',
          displayName: 'Manager One',
          teamName: 'Manager One Team',
          teamAbbreviation: 'KC',
          teamLogo: null,
          managerAvatar: null,
          avatar: null,
          wins: 10,
          losses: 4,
          ties: 0,
          pointsFor: '1500.10',
          rosterSize: 20,
          starters: [],
          players: [],
          reserve: [],
          taxi: [],
        },
      ],
      rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
      playerMap: {
        p1: { name: 'Player One', position: 'QB', team: 'KC' },
      },
      draftPickCount: 84,
      transactionCount: 24,
      matchupWeeks: 14,
      source: {
        source_provider: 'sleeper',
        source_league_id: 'import-src-123',
        source_season_id: '2026',
        imported_at: new Date().toISOString(),
      },
    }
    let templatesState: Array<{
      id: string
      name: string
      description: string | null
      payload: Record<string, unknown>
    }> = [
      {
        id: 'tmpl-existing-1',
        name: 'Dynasty Superflex',
        description: 'Saved template',
        payload: {
          sport: 'NFL',
          leagueType: 'dynasty',
          draftType: 'snake',
          name: 'Dynasty Superflex',
          teamCount: 12,
          rosterSize: 24,
          scoringPreset: 'DYNASTY',
          leagueVariant: 'DYNASTY',
          draftSettings: {},
          waiverSettings: {},
          playoffSettings: {},
          scheduleSettings: {},
          aiSettings: {},
          automationSettings: {},
          privacySettings: {},
        },
      },
    ]

    let managersState: Array<{ rosterId: string; userId: string; username: string; displayName: string }> = [
      { rosterId: 'roster-1', userId: 'user-1', username: 'user1', displayName: 'Manager One' },
      { rosterId: 'roster-2', userId: 'user-2', username: 'user2', displayName: 'Manager Two' },
    ]
    let draftSessionState: {
      status: 'pre_draft' | 'in_progress' | 'paused' | 'completed'
      slotOrder: Array<{ slot: number; rosterId: string; displayName: string }>
      picks: Array<{ overall: number; rosterId: string; playerName: string; position: string }>
    } = {
      status: 'in_progress',
      slotOrder: [
        { slot: 1, rosterId: 'roster-1', displayName: 'Manager One' },
        { slot: 2, rosterId: 'roster-2', displayName: 'Manager Two' },
      ],
      picks: [
        { overall: 1, rosterId: 'roster-2', playerName: 'Player Alpha', position: 'RB' },
      ],
    }

    await page.route('**/api/subscription/entitlements**', async (route) => {
      const url = new URL(route.request().url())
      const feature = String(url.searchParams.get('feature') ?? '')
      const response = {
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
          ? `/commissioner-upgrade?feature=${encodeURIComponent(feature)}`
          : '/commissioner-upgrade',
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      })
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/settings`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON() as Record<string, unknown>
        settingsPatches.push(payload)
        if (typeof payload.name === 'string') settingsState.name = payload.name
        if (typeof payload.description === 'string') settingsState.description = payload.description
        if (typeof payload.sport === 'string') settingsState.sport = payload.sport
        if (typeof payload.season === 'number') settingsState.season = payload.season
        if (typeof payload.leagueSize === 'number') settingsState.leagueSize = payload.leagueSize
        if (typeof payload.rosterSize === 'number') settingsState.rosterSize = payload.rosterSize
        if (payload.starters && typeof payload.starters === 'object') {
          settingsState.starters = payload.starters as Record<string, number>
        }
        const settingsKeys = [
          'benchSize',
          'rosterPositions',
          'tradeReviewType',
          'vetoThreshold',
          'leagueChatThreadId',
        ] as const
        for (const key of settingsKeys) {
          if (payload[key] !== undefined) settingsState.settings[key] = payload[key]
        }
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settingsState),
      })
    })

    await page.route(`**/api/app/league/${leagueId}/waiver/config`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(waiverState),
      })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/waivers?type=settings**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(waiverState),
      })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/waivers`, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.fallback()
        return
      }
      const patch = route.request().postDataJSON() as Record<string, unknown>
      waiverPuts.push(patch)
      waiverState = {
        ...waiverState,
        waiver_type: patch.waiverType ?? waiverState.waiver_type,
        processing_days:
          patch.processingDayOfWeek == null
            ? []
            : [Number(patch.processingDayOfWeek)],
        processing_time_utc: patch.processingTimeUtc ?? null,
        claim_limit_per_period: patch.claimLimitPerPeriod ?? null,
        faab_budget: patch.faabBudget ?? null,
        tiebreak_rule: patch.tiebreakRule ?? null,
        game_lock_behavior: patch.lockType ?? null,
        instant_fa_after_clear: patch.instantFaAfterClear === true,
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(waiverState),
      })
    })

    await page.route(`**/api/app/league/${leagueId}/scoring/config`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(scoringState),
      })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/scoring?type=settings**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(scoringState),
      })
    })
    await page.route(`**/api/commissioner/leagues/${leagueId}/scoring`, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.fallback()
        return
      }
      const patch = route.request().postDataJSON() as { rules?: Array<{ statKey: string; pointsValue: number; enabled: boolean }> }
      const nextRules = patch.rules ?? []
      scoringState = {
        ...scoringState,
        rules: scoringState.rules.map((rule) => {
          const next = nextRules.find((entry) => entry.statKey === rule.statKey)
          if (!next) return rule
          return {
            ...rule,
            pointsValue: Number(next.pointsValue),
            enabled: next.enabled !== false,
            isOverridden:
              Math.abs(Number(next.pointsValue) - rule.defaultPointsValue) > 0.0001 ||
              (next.enabled !== false) !== rule.defaultEnabled,
          }
        }),
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(scoringState),
      })
    })

    await mockLeagueSettingsGetForScoring(page, leagueId, () => scoringState)

    await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON() as Record<string, unknown>
        draftPatches.push(patch)
        const uiKeys = [
          'tradedPickColorModeEnabled',
          'tradedPickOwnerNameRedEnabled',
          'aiAdpEnabled',
          'aiQueueReorderEnabled',
          'orphanTeamAiManagerEnabled',
          'orphanDrafterMode',
          'liveDraftChatSyncEnabled',
          'autoPickEnabled',
          'timerMode',
          'commissionerForceAutoPickEnabled',
          'commissionerPauseControlsEnabled',
          'slowDraftPauseWindow',
          'draftOrderRandomizationEnabled',
          'pickTradeEnabled',
          'auctionAutoNominationEnabled',
          'importEnabled',
        ] as const
        const uiPatch: Record<string, unknown> = {}
        for (const key of uiKeys) {
          if (Object.prototype.hasOwnProperty.call(patch, key)) uiPatch[key] = patch[key]
        }
        draftState = {
          ...draftState,
          config: {
            ...draftState.config,
            draft_type: patch.draft_type ?? draftState.config.draft_type,
            timer_seconds: patch.timer_seconds ?? draftState.config.timer_seconds,
            slow_timer_seconds: patch.slow_timer_seconds ?? draftState.config.slow_timer_seconds,
            rounds: patch.rounds ?? draftState.config.rounds,
          },
          draftUISettings: {
            ...draftState.draftUISettings,
            ...uiPatch,
          },
          draftOrderMode: (patch.draft_order_mode as string) ?? draftState.draftOrderMode,
          sessionVariant: (patch.sessionVariant as null | Record<string, unknown>) ?? draftState.sessionVariant,
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(draftState),
      })
    })

    // DraftSettingsPanel.handleSave awaits this PATCH before the draft/settings
    // PATCH. Unmocked, it goes to the real dev server and can outlast the poll.
    let draftExecutionMode: 'live' | 'auto' | 'offline' = 'live'
    await page.route(`**/api/leagues/${leagueId}/settings/draft`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON() as Record<string, unknown>
        draftExecutionModePatches.push(patch)
        const mode = patch.executionMode
        if (mode === 'live' || mode === 'auto' || mode === 'offline') draftExecutionMode = mode
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagueId,
          isCommissioner: true,
          current: { draftType: draftState.config.draft_type, executionMode: draftExecutionMode },
          options: { draftTypes: ['snake', 'linear', 'auction'] },
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/ai-settings`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON() as Record<string, unknown>
        aiPatches.push(patch)
        aiSettingsState = {
          ...aiSettingsState,
          ...Object.fromEntries(
            Object.entries(patch).filter(([, value]) => typeof value === 'boolean')
          ) as Record<string, boolean>,
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: aiSettingsState, isCommissioner: true }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/privacy`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON() as Record<string, unknown>
        privacyPatches.push(patch)
        const next = { ...privacyState, ...patch }
        if (Object.prototype.hasOwnProperty.call(patch, 'password')) {
          delete (next as Record<string, unknown>).password
        }
        privacyState = next
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(privacyState),
      })
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/invite`, async (route) => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON() as Record<string, unknown>
        inviteRegenerations.push(payload)
        const inviteCode = `INV-${Date.now().toString().slice(-6)}`
        const inviteLink = `https://allfantasy.ai/join?code=${inviteCode}`
        privacyState = {
          ...privacyState,
          inviteCode,
          inviteLink,
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            inviteCode,
            inviteLink,
            joinUrl: inviteLink,
            inviteExpiresAt: null,
            inviteExpired: false,
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/invite/send`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      inviteSendPosts.push(payload)
      const inviteUrl = String(privacyState.inviteLink ?? 'https://allfantasy.ai/join?code=INVITE123')
      if (payload.type === 'email') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, sent: true, sentTo: payload.email, inviteUrl }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          sentTo: payload.username ?? null,
          message: 'Share the link below with this user.',
          inviteUrl,
        }),
      })
    })

    await page.route('**/api/leagues/templates', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ templates: templatesState }),
        })
        return
      }
      await route.fallback()
    })

    await page.route('**/api/leagues/templates/from-league', async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      templateSavePosts.push(payload)
      const id = `tmpl-${Date.now().toString().slice(-6)}`
      const created = {
        id,
        name: String(payload.name ?? 'League template'),
        description: payload.description == null ? null : String(payload.description),
        payload: {
          sport: 'NFL',
          leagueType: 'redraft',
          draftType: 'snake',
          name: String(payload.name ?? 'League template'),
          teamCount: 12,
          rosterSize: 20,
          scoringPreset: 'STANDARD',
          leagueVariant: null,
          draftSettings: {},
          waiverSettings: {},
          playoffSettings: {},
          scheduleSettings: {},
          aiSettings: {},
          automationSettings: {},
          privacySettings: {},
        } as Record<string, unknown>,
      }
      templatesState = [created, ...templatesState]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(created),
      })
    })

    await page.route('**/api/leagues/templates/*', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback()
        return
      }
      const url = new URL(route.request().url())
      const templateId = url.pathname.split('/').pop() ?? ''
      templateDeleteIds.push(templateId)
      templatesState = templatesState.filter((item) => item.id !== templateId)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/import/preview`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      importPreviewPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preview: importPreviewState,
          apply: {
            leagueStructure: true,
            rosters: true,
            draftPicks: true,
            scoringRules: true,
            leagueName: true,
          },
          importData: {
            leagueStructure: true,
            rosters: 12,
            draftPicks: 84,
            scoringRules: 1,
            leagueName: 'Imported Legacy League',
          },
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/import/commit`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      importCommitPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          leagueId,
          leagueName: 'Imported Legacy League',
          applied: payload.apply ?? {},
          summary: {
            rostersUpserted: 12,
            draftPicksImported: 84,
            draftPicksSkipped: 0,
          },
        }),
      })
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/managers`, async (route) => {
      if (route.request().method() === 'DELETE') {
        const body = route.request().postDataJSON() as { rosterId?: string }
        const rosterId = String(body?.rosterId ?? '')
        if (rosterId) {
          removedRosterIds.push(rosterId)
          managersState = managersState.map((manager) =>
            manager.rosterId === rosterId
              ? { ...manager, userId: `orphan-${rosterId}`, username: '', displayName: `${manager.displayName} (orphan)` }
              : manager
          )
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', rosterId }),
        })
        return
      }
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { rosterId?: string; userId?: string }
        managerReplacePatches.push(body as Record<string, unknown>)
        const rosterId = String(body?.rosterId ?? '')
        const userId = String(body?.userId ?? '')
        if (rosterId && userId) {
          managersState = managersState.map((manager) =>
            manager.rosterId === rosterId
              ? {
                  ...manager,
                  userId,
                  username: userId,
                  displayName: manager.displayName.includes('(orphan)')
                    ? manager.displayName.replace(' (orphan)', '')
                    : manager.displayName,
                }
              : manager
          )
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', rosterId, userId }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ teams: [], rosters: [], managers: managersState }),
      })
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/managers/assign-ai`, async (route) => {
      const body = route.request().postDataJSON() as { rosterId?: string }
      assignAiPosts.push(body as Record<string, unknown>)
      const rosterId = String(body?.rosterId ?? '')
      if (rosterId) {
        managersState = managersState.map((manager) =>
          manager.rosterId === rosterId
            ? { ...manager, userId: `orphan-${rosterId}`, username: '', displayName: `${manager.displayName} (orphan)` }
            : manager
        )
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          rosterId,
          orphanPlatformUserId: rosterId ? `orphan-${rosterId}` : null,
          aiManagerEnabled: true,
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/draft/session`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: draftSessionState }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/draft/controls`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      draftControlPosts.push(payload)
      const action = String(payload.action ?? '').toLowerCase()
      if (action === 'pause') draftSessionState = { ...draftSessionState, status: 'paused' }
      if (action === 'resume') draftSessionState = { ...draftSessionState, status: 'in_progress' }
      if (action === 'force_autopick') {
        draftSessionState = {
          ...draftSessionState,
          picks: [
            ...draftSessionState.picks,
            {
              overall: draftSessionState.picks.length + 1,
              rosterId: String(payload.rosterId ?? 'roster-1'),
              playerName: String(payload.playerName ?? 'Override Player'),
              position: String(payload.position ?? 'WR'),
            },
          ],
        }
      }
      if (action === 'reset_draft') {
        draftSessionState = {
          ...draftSessionState,
          status: 'pre_draft',
          picks: [],
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          action,
          session: draftSessionState,
        }),
      })
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/transfer`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      transferPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
    })

    await page.route('**/api/shared/chat/threads/**/broadcast', async (route) => {
      const payload = route.request().postDataJSON() as { announcement?: string }
      broadcasts.push(String(payload.announcement ?? ''))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
    })

    await page.route(`**/api/commissioner/leagues/${leagueId}/reset`, async (route) => {
      const payload = route.request().postDataJSON() as { mode?: string }
      resetModes.push(String(payload?.mode ?? 'soft'))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          mode: payload?.mode ?? 'soft',
          waiverClaimsRemoved: 3,
          waiverTransactionsRemoved: 2,
          waiverPickupsRemoved: 1,
          standingsRowsReset: 12,
          chatMessagesRemoved: payload?.mode === 'full' ? 9 : 0,
          aiAlertsRemoved: payload?.mode === 'full' ? 2 : 0,
          aiActionLogsRemoved: payload?.mode === 'full' ? 5 : 0,
          draftSessionReset: true,
        }),
      })
    })

    await page.goto(`/e2e/commissioner-control-panel?leagueId=${leagueId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /commissioner control panel harness/i })).toBeVisible()
    await page.addStyleTag({
      content: '[data-sonner-toaster], section[aria-label^="Notifications"] { pointer-events: none !important; }',
    })

    const openPanelButton = page.getByTestId('commissioner-panel-open')
    const generalEditButton = page.getByTestId('commissioner-general-edit')
    for (let i = 0; i < 16; i += 1) {
      if (await generalEditButton.isVisible().catch(() => false)) break
      if (await openPanelButton.isVisible().catch(() => false)) {
        await openPanelButton.click().catch(() => {})
      }
      await page.waitForTimeout(250)
    }
    await expect(generalEditButton).toBeVisible({ timeout: 20_000 })

    // General settings
    await generalEditButton.click()
    await page.getByTestId('commissioner-general-name-input').fill('Commissioner Audit League Updated')
    await page.getByTestId('commissioner-general-sport-select').selectOption('SOCCER')
    await page.getByTestId('commissioner-general-season-input').fill('2027')
    await page.getByTestId('commissioner-general-save').click()
    await expect.poll(() => settingsPatches.some((patch) => patch.name === 'Commissioner Audit League Updated')).toBe(true)

    // Roster settings
    await page.getByTestId('commissioner-section-roster').click({ force: true })
    await page.getByTestId('commissioner-roster-edit').click()
    await page.getByTestId('commissioner-roster-size-input').fill('24')
    await page.getByTestId('commissioner-bench-size-input').fill('8')
    await page.getByTestId('commissioner-roster-positions-input').fill('GK, DEF, DEF, MID, MID, FWD, FLEX')
    await page.getByTestId('commissioner-roster-save').click()
    await expect.poll(() => settingsPatches.some((patch) => Number(patch.benchSize) === 8)).toBe(true)

    // Scoring settings
    await page.getByTestId('commissioner-section-scoring').click({ force: true })
    await page.getByTestId('scoring-settings-edit-toggle').click()
    await page.getByLabel('passing_td points').fill('5')
    await page.getByTestId('scoring-settings-save').click()
    await expect(page.getByTestId('scoring-settings-override-count')).toBeVisible()

    // Waiver settings
    await page.getByTestId('commissioner-section-waiver').click({ force: true })
    await page.getByTestId('commissioner-waiver-edit-toggle').click()
    await page.getByTestId('commissioner-waiver-type-select').selectOption('faab')
    await page.getByTestId('commissioner-waiver-faab-budget-input').fill('175')
    await page.getByTestId('commissioner-waiver-instant-fa-toggle').check()
    await page.getByTestId('commissioner-waiver-save').click()
    await expect.poll(() => waiverPuts.length).toBeGreaterThan(0)

    // Trade settings (cancel + save)
    await page.getByTestId('commissioner-section-trade').click({ force: true })
    await page.getByTestId('commissioner-trade-edit').click()
    await page.getByTestId('commissioner-trade-review-type-select').selectOption('league_vote')
    await page.getByTestId('commissioner-trade-cancel').click()
    await page.getByTestId('commissioner-trade-edit').click()
    await page.getByTestId('commissioner-trade-review-type-select').selectOption('league_vote')
    await page.getByTestId('commissioner-veto-threshold-input').fill('5')
    await page.getByTestId('commissioner-trade-save').click()
    await expect.poll(() => settingsPatches.some((patch) => patch.tradeReviewType === 'league_vote')).toBe(true)

    // Draft settings
    await page.getByTestId('commissioner-section-draft').click({ force: true })
    await page.getByTestId('commissioner-draft-type-select').selectOption('linear')
    await page.getByTestId('commissioner-draft-timer-input').fill('45')
    await page.getByTestId('commissioner-draft-slow-timer-input').fill('240')
    await page.getByTestId('commissioner-draft-order-randomization-toggle').uncheck()
    await page.getByTestId('commissioner-draft-pick-trade-toggle').check()
    await page.getByTestId('commissioner-draft-traded-pick-color-toggle').check()
    await page.getByTestId('commissioner-draft-ai-adp-toggle').check()
    await page.getByTestId('commissioner-draft-ai-queue-reorder-toggle').check()
    await page.getByTestId('commissioner-draft-cpu-manager-toggle').check()
    await page.getByTestId('commissioner-draft-import-enabled-toggle').uncheck()
    await page.getByTestId('commissioner-draft-keeper-max-input').fill('3')
    await page.getByTestId('commissioner-draft-devy-enabled-toggle').check()
    await page.getByTestId('commissioner-draft-devy-rounds-input').fill('14, 15')
    await page.getByTestId('commissioner-draft-c2c-enabled-toggle').check()
    await page.getByTestId('commissioner-draft-c2c-rounds-input').fill('1, 2')
    await page.getByTestId('commissioner-draft-save').click()
    await expect.poll(() => draftPatches.length).toBeGreaterThan(0)
    expect(draftExecutionModePatches[draftExecutionModePatches.length - 1]?.executionMode).toBe('live')
    const latestDraftPatch = draftPatches[draftPatches.length - 1] ?? {}
    expect(latestDraftPatch.importEnabled).toBe(false)
    expect(latestDraftPatch.slow_timer_seconds).toBe(240 * 60)
    expect(latestDraftPatch.orphanTeamAiManagerEnabled).toBe(true)
    expect(latestDraftPatch.orphanDrafterMode).toBe('cpu')
    expect((latestDraftPatch.sessionVariant as { keeperConfig?: { maxKeepers?: number } })?.keeperConfig?.maxKeepers).toBe(3)
    expect((latestDraftPatch.sessionVariant as { devyConfig?: { devyRounds?: number[] } })?.devyConfig?.devyRounds ?? []).toEqual([14, 15])
    expect((latestDraftPatch.sessionVariant as { c2cConfig?: { collegeRounds?: number[] } })?.c2cConfig?.collegeRounds ?? []).toEqual([1, 2])

    // AI settings
    await page.getByTestId('commissioner-section-ai').click({ force: true })
    await page.getByTestId('commissioner-ai-toggle-tradeAnalyzerEnabled').uncheck()
    await page.getByTestId('commissioner-ai-toggle-waiverAiEnabled').uncheck()
    await page.getByTestId('commissioner-ai-toggle-draftAssistantEnabled').uncheck()
    await page.getByTestId('commissioner-ai-toggle-playerComparisonEnabled').uncheck()
    await page.getByTestId('commissioner-ai-toggle-matchupSimulatorEnabled').uncheck()
    await page.getByTestId('commissioner-ai-toggle-fantasyCoachEnabled').uncheck()
    await page.getByTestId('commissioner-ai-toggle-aiChatChimmyEnabled').uncheck()
    await page.getByTestId('commissioner-ai-toggle-aiDraftManagerOrphanEnabled').check()
    await page.getByTestId('commissioner-ai-save').click()
    await expect.poll(() => aiPatches.length).toBeGreaterThan(0)
    const latestAiPatch = aiPatches[aiPatches.length - 1] ?? {}
    expect(latestAiPatch.tradeAnalyzerEnabled).toBe(false)
    expect(latestAiPatch.waiverAiEnabled).toBe(false)
    expect(latestAiPatch.draftAssistantEnabled).toBe(false)
    expect(latestAiPatch.playerComparisonEnabled).toBe(false)
    expect(latestAiPatch.matchupSimulatorEnabled).toBe(false)
    expect(latestAiPatch.fantasyCoachEnabled).toBe(false)
    expect(latestAiPatch.aiChatChimmyEnabled).toBe(false)
    expect(latestAiPatch.aiDraftManagerOrphanEnabled).toBe(true)

    // Automation settings
    await page.getByTestId('commissioner-section-automation').click({ force: true })
    await page.getByTestId('commissioner-automation-autopick-timer-input').fill('75')
    await page.getByTestId('commissioner-automation-queue-autopick-toggle').check()
    await page.getByTestId('commissioner-automation-cpu-empty-team-toggle').check()
    await page.getByTestId('commissioner-automation-timer-mode-select').selectOption('overnight_pause')
    await page.getByTestId('commissioner-automation-overnight-start-input').fill('23:00')
    await page.getByTestId('commissioner-automation-overnight-end-input').fill('07:00')
    await page.getByTestId('commissioner-automation-overnight-timezone-input').fill('America/Chicago')
    await page.getByTestId('commissioner-automation-pause-controls-toggle').uncheck()
    await page.getByTestId('commissioner-automation-force-autopick-toggle').check()
    await page.getByTestId('commissioner-automation-auction-auto-nomination-toggle').check()
    await page.getByTestId('commissioner-automation-save').click()
    await expect.poll(() => draftPatches.length).toBeGreaterThan(1)
    const latestAutomationPatch = draftPatches[draftPatches.length - 1] ?? {}
    expect(latestAutomationPatch.timer_seconds).toBe(75)
    expect(latestAutomationPatch.autoPickEnabled).toBe(true)
    expect(latestAutomationPatch.orphanTeamAiManagerEnabled).toBe(true)
    expect(latestAutomationPatch.orphanDrafterMode).toBe('cpu')
    expect(latestAutomationPatch.timerMode).toBe('overnight_pause')
    expect(latestAutomationPatch.slowDraftPauseWindow).toEqual({
      start: '23:00',
      end: '07:00',
      timezone: 'America/Chicago',
    })
    expect(latestAutomationPatch.commissionerPauseControlsEnabled).toBe(false)
    expect(latestAutomationPatch.commissionerForceAutoPickEnabled).toBe(true)
    expect(latestAutomationPatch.auctionAutoNominationEnabled).toBe(true)

    // Privacy & invites
    await page.getByTestId('commissioner-section-privacy').click({ force: true })
    await page.getByTestId('commissioner-privacy-visibility-select').selectOption('password_protected')
    await page.getByTestId('commissioner-privacy-password-input').fill('secure-join-pass')
    await page.getByTestId('commissioner-privacy-allow-link-toggle').check()
    await page.getByTestId('commissioner-privacy-allow-email-toggle').check()
    await page.getByTestId('commissioner-privacy-allow-username-toggle').check()
    await page.getByTestId('commissioner-privacy-save').click()
    await expect.poll(() => privacyPatches.length).toBeGreaterThan(0)
    const latestPrivacyPatch = privacyPatches[privacyPatches.length - 1] ?? {}
    expect(latestPrivacyPatch.visibility).toBe('password_protected')
    expect(latestPrivacyPatch.allowInviteLink).toBe(true)
    expect(latestPrivacyPatch.allowEmailInvite).toBe(true)
    expect(latestPrivacyPatch.allowUsernameInvite).toBe(true)
    expect(latestPrivacyPatch.password).toBe('secure-join-pass')

    await page.getByTestId('commissioner-privacy-email-input').fill('new.manager@allfantasy.dev')
    await page.getByTestId('commissioner-privacy-send-email-invite').click()
    await expect.poll(() => inviteSendPosts.length).toBeGreaterThan(0)
    const latestInviteSend = inviteSendPosts[inviteSendPosts.length - 1] ?? {}
    expect(latestInviteSend.type).toBe('email')
    expect(latestInviteSend.email).toBe('new.manager@allfantasy.dev')

    await page.getByTestId('commissioner-privacy-username-input').fill('legacy_manager')
    await page.getByTestId('commissioner-privacy-send-username-invite').click()
    await expect.poll(() => inviteSendPosts.some((p) => p.type === 'username')).toBe(true)

    await page.getByTestId('commissioner-privacy-regenerate-link').click()
    await expect.poll(() => inviteRegenerations.length).toBeGreaterThan(0)

    // Templates
    await page.getByTestId('commissioner-section-templates').click({ force: true })
    await page.getByTestId('commissioner-template-name-input').fill('Auction Salary Cap')
    await page.getByTestId('commissioner-template-description-input').fill('Saved from commissioner panel')
    await page.getByTestId('commissioner-template-save').click()
    await expect.poll(() => templateSavePosts.length).toBeGreaterThan(0)
    const latestTemplateSave = templateSavePosts[templateSavePosts.length - 1] ?? {}
    expect(latestTemplateSave.leagueId).toBe(leagueId)
    expect(latestTemplateSave.name).toBe('Auction Salary Cap')
    const savedTemplateId = templatesState[0]?.id
    expect(savedTemplateId).toBeTruthy()
    await page.getByTestId(`commissioner-template-delete-${savedTemplateId}`).click()
    await expect.poll(() => templateDeleteIds.includes(String(savedTemplateId))).toBe(true)

    // League import
    await page.getByTestId('commissioner-section-import').click({ force: true })
    await page.getByTestId('commissioner-import-provider-select').selectOption('sleeper')
    await page.getByTestId('commissioner-import-source-input').fill('123456789')
    await page.getByTestId('commissioner-import-preview-button').click()
    await expect.poll(() => importPreviewPosts.length).toBeGreaterThan(0)
    await expect(page.getByTestId('commissioner-import-preview-name')).toHaveText('Imported Legacy League')
    await page.getByTestId('commissioner-import-toggle-draft-picks').uncheck()
    await page.getByTestId('commissioner-import-toggle-league-name').check()
    await page.getByTestId('commissioner-import-commit-button').click()
    await expect.poll(() => importCommitPosts.length).toBeGreaterThan(0)
    const latestImportCommit = importCommitPosts[importCommitPosts.length - 1] ?? {}
    expect((latestImportCommit.apply as Record<string, unknown>).draftPicks).toBe(false)
    expect((latestImportCommit.apply as Record<string, unknown>).leagueName).toBe(true)
    await expect(page.getByTestId('commissioner-import-result')).toBeVisible()

    // Member settings
    await page.getByTestId('commissioner-section-members').click({ force: true })
    await expect(page.getByTestId('commissioner-member-remove-roster-1')).toBeVisible()
    await page.getByTestId('commissioner-member-remove-roster-1').click()
    await expect.poll(() => removedRosterIds.includes('roster-1')).toBe(true)
    await page.getByTestId('commissioner-transfer-select').selectOption('user-2')
    await page.getByTestId('commissioner-transfer-confirm').check()
    await page.getByTestId('commissioner-transfer-submit').click()
    await expect.poll(() => transferPosts.length).toBeGreaterThan(0)

    // Commissioner controls / announcements
    await page.getByTestId('commissioner-section-controls').click({ force: true })
    await expect(page.getByTestId('league-recruitment-tools')).toBeVisible()
    const inviteRegenerationCountBeforeRecruitment = inviteRegenerations.length
    await page.getByTestId('league-regenerate-invite-link').click()
    await expect.poll(() => inviteRegenerations.length).toBeGreaterThan(inviteRegenerationCountBeforeRecruitment)
    const inviteSendCountBeforeRecruitment = inviteSendPosts.length
    await page.getByTestId('league-recruitment-username-input').fill('commissioner_recruit_target')
    await page.getByTestId('league-recruitment-username-send').click()
    await expect.poll(() => inviteSendPosts.length).toBeGreaterThan(inviteSendCountBeforeRecruitment)
    await page.getByTestId('league-recruitment-email-input').fill('recruit-target@allfantasy.dev')
    await page.getByTestId('league-recruitment-email-send').click()
    await expect.poll(() => inviteSendPosts.length).toBeGreaterThan(inviteSendCountBeforeRecruitment + 1)
    const privacyPatchCountBeforeRecruitmentToggle = privacyPatches.length
    await page.getByTestId('league-recruitment-public-listing-toggle').click()
    await expect.poll(() => privacyPatches.length).toBeGreaterThan(privacyPatchCountBeforeRecruitmentToggle)
    await expect.poll(() => (privacyPatches[privacyPatches.length - 1] ?? {}).visibility).toBe('public')
    const privacyPatchCountAfterPublic = privacyPatches.length
    await page.getByTestId('league-recruitment-public-listing-toggle').click()
    await expect.poll(() => privacyPatches.length).toBeGreaterThan(privacyPatchCountAfterPublic)
    await expect.poll(() => (privacyPatches[privacyPatches.length - 1] ?? {}).visibility).toBe('password_protected')
    await page.getByTestId('commissioner-controls-draft-pause').click()
    await expect.poll(() => draftControlPosts.some((post) => post.action === 'pause')).toBe(true)
    await page.getByTestId('commissioner-controls-draft-resume').click()
    await expect.poll(() => draftControlPosts.some((post) => post.action === 'resume')).toBe(true)
    await page.getByTestId('commissioner-controls-override-open').click()
    await page.getByTestId('commissioner-controls-override-player-name').fill('Commissioner Override Player')
    await page.getByTestId('commissioner-controls-override-position').fill('WR')
    await page.getByTestId('commissioner-controls-override-submit').click()
    await expect.poll(() => draftControlPosts.some((post) => post.action === 'force_autopick')).toBe(true)
    await page.getByTestId('commissioner-controls-manager-roster-select').selectOption('roster-2')
    await page.getByTestId('commissioner-controls-manager-user-id-input').fill('replacement-user')
    await page.getByTestId('commissioner-controls-manager-replace').click()
    await expect.poll(() => managerReplacePatches.length).toBeGreaterThan(0)
    await page.getByTestId('commissioner-controls-manager-assign-ai').click()
    await expect.poll(() => assignAiPosts.length).toBeGreaterThan(0)
    await page.getByTestId('commissioner-controls-reset-draft-open').click()
    await page.getByTestId('commissioner-controls-reset-draft-confirm').click()
    await expect.poll(() => draftControlPosts.some((post) => post.action === 'reset_draft')).toBe(true)
    await page.getByTestId('commissioner-announcement-input').fill('Commissioner notice: waivers process tonight.')
    await page.getByTestId('commissioner-announcement-send').click()
    await expect.poll(() => broadcasts.length).toBeGreaterThan(0)

    // Reset league
    await page.getByTestId('commissioner-section-reset').click({ force: true })
    await page.getByTestId('commissioner-reset-mode').selectOption('full')
    await page.getByTestId('commissioner-reset-league-button').click()
    await expect(page.getByTestId('commissioner-reset-result')).toBeVisible()
    await expect.poll(() => resetModes.includes('full')).toBe(true)

    // Reload persistence check for saved setting values
    await page.reload({ waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 60; i += 1) {
      if (await page.getByTestId('commissioner-general-edit').isVisible().catch(() => false)) break
      if (await page.getByTestId('commissioner-panel-open').isVisible().catch(() => false)) {
        await page.getByTestId('commissioner-panel-open').click({ force: true }).catch(() => {})
      }
      if (await page.getByTestId('commissioner-section-general').isVisible().catch(() => false)) {
        await page.getByTestId('commissioner-section-general').click({ force: true }).catch(() => {})
      }
      await page.waitForTimeout(250)
    }
    await expect(page.getByTestId('commissioner-general-edit')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('commissioner-general-edit').click()
    await expect(page.getByTestId('commissioner-general-name-input')).toHaveValue('Commissioner Audit League Updated')
  })
})
