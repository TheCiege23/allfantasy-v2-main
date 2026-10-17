import { test } from '@playwright/test'
import { auditTournamentAssignment, auditTournamentCommissioner, auditTournamentInvite } from './tournament-invite-audit'

test.describe('NBA tournament invite readiness on desktop', () => {
  test.setTimeout(120_000)
  test('entrant accepts rules and joins', async ({ page }) => auditTournamentInvite(page))
  test('assigned manager opens the audited draft link', async ({ page }) => auditTournamentAssignment(page))
  test('commissioner releases a draft and gets its room link', async ({ page }) => auditTournamentCommissioner(page))
})
