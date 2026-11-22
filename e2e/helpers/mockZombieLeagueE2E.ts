import type { Page } from '@playwright/test'

const E2E_USER = {
  id: 'e2e-zombie-user',
  name: 'E2E Zombie',
  email: 'e2e-zombie@example.com',
}

/**
 * Minimal GET /api/zombie/league payload for Playwright (matches Zombie shell + home client shapes).
 */
export function buildZombieLeagueGetPayload(leagueId: string) {
  const teams = [
    {
      id: 'team-status-1',
      rosterId: 'r-e2e-1',
      status: 'survivor',
      wins: 2,
      losses: 1,
      pointsFor: 312.4,
      pointsAgainst: 298.1,
      fantasyTeamName: 'E2E Survivors',
      displayName: 'E2E Zombie',
      riskScore: 22,
      weeklyWinnings: 10,
      totalWinnings: 40,
    },
    {
      id: 'team-status-2',
      rosterId: 'r-e2e-2',
      status: 'zombie',
      wins: 1,
      losses: 2,
      pointsFor: 280,
      pointsAgainst: 305,
      fantasyTeamName: 'Horde Beta',
      displayName: 'Beta',
      riskScore: 55,
      weeklyWinnings: 0,
      totalWinnings: 12,
    },
  ]

  return {
    league: {
      id: 'zombie-row-1',
      leagueId,
      name: 'E2E Zombie League',
      sport: 'NFL',
      logoUrl: null,
      currentWeek: 3,
      isPaid: false,
      potTotal: 0,
      whispererIsPublic: true,
      universeId: 'e2e-universe-1',
      status: 'active',
      backgroundTheme: null,
      teams,
      announcements: [
        {
          id: 'ann-1',
          type: 'weekly_update',
          title: 'Week 3 recap',
          content: 'Infection pressure is rising — watch the Whisperer.',
          week: 3,
          createdAt: new Date().toISOString(),
        },
      ],
      latestResolution: { status: 'final', resolvedAt: new Date().toISOString() },
      whispererRecord: {
        displayName: 'Whisperer E2E',
        ambushesRemaining: 2,
        isPubliclyRevealed: true,
      },
      counts: {
        survivor: 1,
        zombie: 1,
        whisperer: 0,
        revived: 0,
        eliminated: 0,
        horde: 1,
        alive: 1,
        total: 2,
      },
      topPerformers: teams,
      dangerZone: teams,
      recentInfections: [],
      recentBashings: [],
      recentMaulings: [],
      level: {
        id: 'lvl-1',
        name: 'Outbreak',
        rankOrder: 1,
        colorHex: '#22d3ee',
        difficultyLabel: 'Standard',
        tierTheme: 'cyan',
        tierLabel: 'Tier A',
      },
    },
    hordeSize: 1,
    survivorCount: 1,
    myTeam: teams[0],
    myActiveItemCount: 2,
    myPendingItemCount: 0,
    myResources: { serums: 1, weapons: 1, activeItems: 2, pendingItems: 0 },
    viewerIsCommissioner: true,
    latestWeek: 3,
    commissionerNotifications: {
      unread: 0,
      actionRequired: 0,
      recent: [],
    },
  }
}

export function buildZombieInventoryPayload() {
  return {
    items: [
      {
        id: 'item-serum-1',
        itemType: 'serum_antidote',
        itemLabel: 'Serum',
        isUsed: false,
        isExpired: false,
        acquiredAt: new Date().toISOString(),
        acquiredReason: 'weekly_top',
        activationState: 'ready',
      },
      {
        id: 'item-knife-1',
        itemType: 'weapon_knife',
        itemLabel: 'Knife',
        isUsed: false,
        isExpired: false,
        acquiredAt: new Date().toISOString(),
        acquiredReason: 'threshold',
        activationState: 'ready',
      },
    ],
    teamStatus: 'survivor',
    rules: {
      reviveThreshold: 3,
      serumMaxHold: 5,
      weaponShieldThreshold: 90,
      weaponAmbushThreshold: 110,
    },
    history: [
      {
        id: 'hist-1',
        actionType: 'serum_award',
        week: 2,
        createdAt: new Date().toISOString(),
        isValid: true,
      },
    ],
    resolution: { status: 'complete' },
    isWhisperer: false,
    ambushesRemaining: 0,
    experienceMode: 'enhanced',
    week: 3,
    isCommissionerView: false,
  }
}

export function buildZombieLeagueSettingsGetPayload(leagueId: string) {
  return {
    userRole: 'commissioner',
    leagueOwnerUserId: E2E_USER.id,
    hasAfCommissionerSub: true,
    canEdit: true,
    settingsSnapshot: {},
    settings: {
      draftType: 'snake',
      rounds: 15,
    },
    scoringConfig: null,
    league: {
      id: leagueId,
      name: 'E2E Zombie League',
      sport: 'NFL',
      season: 2026,
      timezone: 'America/New_York',
      teamCount: 12,
      isDynasty: false,
      leagueType: 'zombie',
      leagueVariant: 'zombie',
      bestBallMode: false,
      autoCoachEnabled: true,
      rosterSize: 15,
      totalRosterSlots: 15,
      teams: [
        {
          id: 'team-1',
          teamName: 'E2E Survivors',
          ownerName: 'E2E Zombie',
          isCommissioner: true,
        },
      ],
    },
  }
}

export type ZombieChimmyDmCapture = {
  bodies: Array<Record<string, unknown>>
}

/**
 * Mocks auth + zombie league APIs so `/zombie/[leagueId]` flows run without a seeded DB.
 */
export async function installZombieLeagueE2EMocks(
  page: Page,
  leagueId: string,
  options?: {
    chimmyDm?: ZombieChimmyDmCapture
  },
) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: E2E_USER }),
    })
  })

  await page.route('**/api/auth/config-check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  const pack = buildZombieLeagueGetPayload(leagueId)
  const inventory = buildZombieInventoryPayload()

  await page.route('**/api/zombie/league**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/zombie/league') {
      await route.fallback()
      return
    }
    if (url.searchParams.get('leagueId') !== leagueId) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pack),
    })
  })

  await page.route('**/api/zombie/event-feed**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/zombie/event-feed') {
      await route.fallback()
      return
    }
    if (url.searchParams.get('leagueId') !== leagueId) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ animations: [] }),
    })
  })

  await page.route('**/api/zombie/inventory**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/zombie/inventory') {
      await route.fallback()
      return
    }
    if (url.searchParams.get('leagueId') !== leagueId) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(inventory),
    })
  })

  await page.route('**/api/survivor/season**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('leagueId') !== leagueId) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: false }),
    })
  })

  await page.route('**/api/subscription/entitlements**', async (route) => {
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
      }),
    })
  })

  await page.route('**/api/league/settings**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/league/settings') {
      await route.fallback()
      return
    }
    if (url.searchParams.get('leagueId') !== leagueId) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildZombieLeagueSettingsGetPayload(leagueId)),
    })
  })

  await page.route('**/api/zombie/chimmy/dm', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    let body: Record<string, unknown> = {}
    try {
      body = route.request().postDataJSON() as Record<string, unknown>
    } catch {
      body = {}
    }
    if (options?.chimmyDm) {
      options.chimmyDm.bodies.push(body)
    }
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        privateMessage: 'E2E: Chimmy received your zombie command.',
      },
    })
  })
}
