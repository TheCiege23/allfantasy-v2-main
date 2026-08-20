import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

type MockImportPick = {
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string
  playerName: string
  position: string
  team: string | null
}

function formatPickLabel(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${String(pickInRound).padStart(2, '0')}`
}

async function openDraftRoomHarness(page: Page) {
  const button = page.getByTestId('draft-enter-room-button')
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const visible = await button.isVisible().catch(() => false)
    if (!visible) {
      await page.waitForTimeout(150)
      continue
    }
    await button.click({ force: true })
    const shellVisible = await page.getByTestId('draft-room-shell').isVisible().catch(() => false)
    if (shellVisible) return
    await page.waitForTimeout(200)
  }
  await expect(page.getByTestId('draft-room-shell')).toBeVisible()
}

async function mockDraftImportApis(page: Page, leagueId: string) {
  const slotOrder = [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
  ]
  const teamCount = slotOrder.length
  const rounds = 4

  let backupSnapshot: { picks: MockImportPick[]; slotOrder: typeof slotOrder } | null = null
  const sessionState: {
    picks: MockImportPick[]
    version: number
    updatedAt: string
  } = {
    picks: [],
    version: 1,
    updatedAt: new Date().toISOString(),
  }

  const touch = () => {
    sessionState.version += 1
    sessionState.updatedAt = new Date().toISOString()
  }

  const buildSession = () => {
    const overall = sessionState.picks.length + 1
    const round = Math.ceil(overall / teamCount)
    const slot = ((overall - 1) % teamCount) + 1
    const owner = slotOrder[sessionState.picks.length % teamCount]
    return {
      id: 'session-import-e2e',
      leagueId,
      status: sessionState.picks.length > 0 ? 'in_progress' : 'pre_draft',
      draftType: 'snake',
      rounds,
      teamCount,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAt: new Date(Date.now() + 90_000).toISOString(),
      pausedRemainingSeconds: null,
      slotOrder,
      tradedPicks: [],
      version: sessionState.version,
      picks: sessionState.picks.map((pick) => ({
        id: `pick-${pick.overall}`,
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        rosterId: pick.rosterId,
        displayName: pick.displayName,
        playerName: pick.playerName,
        position: pick.position,
        team: pick.team,
        byeWeek: null,
        playerId: null,
        source: 'import',
        pickLabel: formatPickLabel(pick.overall, teamCount),
        createdAt: new Date().toISOString(),
      })),
      currentPick: {
        overall,
        round,
        slot,
        rosterId: owner.rosterId,
        displayName: owner.displayName,
        pickLabel: formatPickLabel(overall, teamCount),
      },
      timer: { status: 'running', remainingSeconds: 90, timerEndAt: new Date(Date.now() + 90_000).toISOString() },
      updatedAt: sessionState.updatedAt,
      currentUserRosterId: 'roster-1',
      orphanRosterIds: [],
      aiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
    }
  }

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
  })
  await page.route('**/api/auth/config-check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route('**/api/user/profile', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/session`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagueId, session: buildSession() }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updated: true, updatedAt: sessionState.updatedAt, session: buildSession() }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/settings`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        config: { queue_size_limit: 50, autopick_behavior: 'queue-first' },
        draftUISettings: {
          tradedPickColorModeEnabled: true,
          tradedPickOwnerNameRedEnabled: true,
          aiAdpEnabled: false,
          aiQueueReorderEnabled: true,
          orphanTeamAiManagerEnabled: false,
          orphanDrafterMode: 'cpu',
          liveDraftChatSyncEnabled: true,
          autoPickEnabled: true,
          timerMode: 'per_pick',
          commissionerForceAutoPickEnabled: true,
          draftOrderRandomizationEnabled: true,
          pickTradeEnabled: true,
        },
        orphanStatus: { orphanRosterIds: [], recentActions: [] },
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/pool`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          { playerId: 'p-1', name: 'Import QB', position: 'QB', team: 'BUF', adp: 9.2 },
          { playerId: 'p-2', name: 'Import WR', position: 'WR', team: 'DAL', adp: 17.3 },
        ],
        sport: 'NFL',
        count: 2,
      }),
    })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/queue`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queue: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/chat`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [], syncActive: true }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/trade-proposals`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposals: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/replay`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) })
  })
  await page.route(`**/api/leagues/${leagueId}/draft/recap`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, recap: 'Import recap.' }) })
  })
  await page.route(`**/api/leagues/${leagueId}/ai-adp`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, entries: [] }) })
  })
  await page.route('**/api/draft/recommend', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        recommendation: { player: { name: 'Import QB', position: 'QB', team: 'BUF' }, reason: 'Deterministic import state', confidence: 80 },
        alternatives: [],
        explanation: 'Optional draft advice',
        evidence: [],
        caveats: [],
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/import/backup-status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hasBackup: Boolean(backupSnapshot) }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/import/validate`, async (route) => {
    const body = route.request().postDataJSON() as { payload?: Record<string, unknown> }
    const payload = body?.payload ?? {}
    const picks = Array.isArray(payload.picks) ? payload.picks : []
    const draftOrder = Array.isArray(payload.draftOrder) ? payload.draftOrder : slotOrder
    const seen = new Set<number>()
    const errors: Array<{ code: string; message: string; field?: string }> = []

    for (let i = 0; i < picks.length; i += 1) {
      const pick = picks[i] as Record<string, unknown>
      const overall = Number(pick.overall)
      if (seen.has(overall)) {
        errors.push({ code: 'DUPLICATE_OVERALL', message: `Duplicate overall pick number ${overall}`, field: `picks[${i}].overall` })
      }
      seen.add(overall)
    }

    const canProceed = errors.length === 0
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        valid: canProceed,
        report: { errors, warnings: [], canProceed },
        preview: {
          summary: {
            pickCount: picks.length,
            tradedPickCount: 0,
            keeperCount: 0,
            slotOrderLength: draftOrder.length,
          },
          metadata: { rounds, teamCount, draftType: 'snake', thirdRoundReversal: false },
          picks,
          slotOrder: draftOrder,
        },
      }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/import/commit`, async (route) => {
    const body = route.request().postDataJSON() as {
      preview?: {
        picks?: Array<Record<string, unknown>>
        slotOrder?: Array<{ slot: number; rosterId: string; displayName: string }>
      }
    }
    const preview = body?.preview
    if (!preview?.slotOrder || !preview?.picks) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'preview required' }) })
      return
    }
    backupSnapshot = { picks: [...sessionState.picks], slotOrder: [...slotOrder] }
    sessionState.picks = preview.picks.map((pick, index) => ({
      overall: Number(pick.overall ?? index + 1),
      round: Number(pick.round ?? Math.ceil((index + 1) / teamCount)),
      slot: Number(pick.slot ?? ((index % teamCount) + 1)),
      rosterId: String(pick.rosterId ?? slotOrder[index % teamCount].rosterId),
      displayName: String(pick.displayName ?? slotOrder[index % teamCount].displayName),
      playerName: String(pick.playerName ?? `Imported Player ${index + 1}`),
      position: String(pick.position ?? 'FLEX'),
      team: pick.team == null ? null : String(pick.team),
    }))
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, backupId: 'backup-e2e', session: buildSession() }),
    })
  })

  await page.route(`**/api/leagues/${leagueId}/draft/import/rollback`, async (route) => {
    if (!backupSnapshot) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'No backup' }) })
      return
    }
    sessionState.picks = [...backupSnapshot.picks]
    backupSnapshot = null
    touch()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: buildSession() }),
    })
  })

  await page.route('**/api/commissioner/leagues', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leagues: [{ id: leagueId, name: 'Import E2E' }] }) })
  })
  await page.route('**/api/commissioner/broadcast', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    const known = [
      '/api/auth/session',
      '/api/auth/config-check',
      '/api/user/profile',
      '/api/draft/recommend',
      '/api/commissioner/leagues',
      '/api/commissioner/broadcast',
      `/api/leagues/${leagueId}/`,
    ].some((path) => url.includes(path))
    if (known) {
      await route.fallback()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
}

test.describe('@draft-import click audit', () => {
  test('upload/preview/validation/commit/rollback flow is fully wired', async ({ page }) => {
    const leagueId = `e2e-draft-import-${Date.now()}`
    await mockDraftImportApis(page, leagueId)

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)
    const desktop = page.getByTestId('draft-desktop-layout')

    await clickHydrated(page.getByTestId('draft-open-commissioner-controls'))
    const modal = page.getByTestId('draft-commissioner-modal')
    await expect(modal).toBeVisible()
    await clickHydrated(modal.getByTestId('draft-commissioner-open-import'))
    const importFlow = modal.getByTestId('draft-import-flow-root')
    await expect(importFlow).toBeVisible()

    await importFlow.getByTestId('draft-import-json-input').fill('{"draftOrder": [')
    await clickHydrated(importFlow.getByTestId('draft-import-validate'))
    await expect(importFlow.getByTestId('draft-import-parse-error')).toBeVisible()

    const duplicatePayload = JSON.stringify({
      draftOrder: [
        { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
        { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
      ],
      picks: [
        { overall: 1, round: 1, slot: 1, rosterId: 'roster-1', displayName: 'Alpha', playerName: 'Import QB', position: 'QB', team: 'BUF' },
        { overall: 1, round: 1, slot: 2, rosterId: 'roster-2', displayName: 'Beta', playerName: 'Import WR', position: 'WR', team: 'DAL' },
      ],
    })
    await importFlow.getByTestId('draft-import-json-input').fill(duplicatePayload)
    await clickHydrated(importFlow.getByTestId('draft-import-validate'))
    await expect(importFlow.getByTestId('draft-import-report')).toContainText(/DUPLICATE_OVERALL/i)

    const validPayload = JSON.stringify({
      draftOrder: [
        { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
        { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
      ],
      picks: [
        { overall: 1, round: 1, slot: 1, rosterId: 'roster-1', displayName: 'Alpha', playerName: 'Import QB', position: 'QB', team: 'BUF' },
        { overall: 2, round: 1, slot: 2, rosterId: 'roster-2', displayName: 'Beta', playerName: 'Import WR', position: 'WR', team: 'DAL' },
      ],
      metadata: { rounds: 4, teamCount: 2, draftType: 'snake', thirdRoundReversal: false },
    })
    await importFlow.getByTestId('draft-import-file-input').setInputFiles({
      name: 'draft-import.json',
      mimeType: 'application/json',
      buffer: Buffer.from(validPayload, 'utf8'),
    })
    await clickHydrated(importFlow.getByTestId('draft-import-validate'))
    await expect(importFlow.getByTestId('draft-import-preview-summary')).toContainText(/2 picks/i)
    await expect(importFlow.getByTestId('draft-import-preview-slot-order')).toBeVisible()
    await expect(importFlow.getByTestId('draft-import-preview-picks')).toBeVisible()

    await clickHydrated(importFlow.getByTestId('draft-import-commit'))
    await expect(modal.getByTestId('draft-commissioner-open-import')).toBeVisible()
    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Import QB')

    await clickHydrated(modal.getByTestId('draft-commissioner-open-import'))
    const importFlowAfterCommit = modal.getByTestId('draft-import-flow-root')
    await expect(importFlowAfterCommit.getByTestId('draft-import-rollback')).toBeVisible()
    await clickHydrated(importFlowAfterCommit.getByTestId('draft-import-rollback'))
    await expect(modal.getByTestId('draft-commissioner-open-import')).toBeVisible()
    await expect(desktop.getByTestId('draft-board-cell-1')).not.toContainText('Import QB')
  })

  test('cancel closes import panel cleanly', async ({ page }) => {
    const leagueId = `e2e-draft-import-cancel-${Date.now()}`
    await mockDraftImportApis(page, leagueId)

    await page.goto(`/e2e/draft-room?leagueId=${leagueId}&sport=NFL`)
    await openDraftRoomHarness(page)

    await clickHydrated(page.getByTestId('draft-open-commissioner-controls'))
    const modal = page.getByTestId('draft-commissioner-modal')
    await clickHydrated(modal.getByTestId('draft-commissioner-open-import'))
    await expect(modal.getByTestId('draft-import-flow-root')).toBeVisible()
    await clickHydrated(modal.getByTestId('draft-import-cancel'))
    await expect(modal.getByTestId('draft-import-flow-root')).toHaveCount(0)
    await expect(modal.getByTestId('draft-commissioner-open-import')).toBeVisible()
  })
})
