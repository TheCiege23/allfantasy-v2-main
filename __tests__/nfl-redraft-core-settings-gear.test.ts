/**
 * NFL redraft core dashboard — settings gear consolidation lock (Commit B).
 *
 * Phase 1 makes the league settings gear the single entry point for:
 *   1. League settings
 *   2. Commissioner controls (was a separate CommissionerSettingsModal)
 *   3. History (already in GENERAL_CARDS as `league-history`)
 *   4. Audit log (NEW placeholder — backend logging wired in a later phase)
 *
 * Static-source assertions only. Rendering the modal pulls in the full
 * settings sub-panel tree (~1900 lines + the commissioner control center)
 * which is impractical under JSDOM for a regression lock.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { translations } from '@/lib/i18n/translations'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('NFL redraft core — settings modal cards', () => {
  const src = read('app/league/[leagueId]/components/LeagueSettingsModal.tsx')

  // Card titles and descriptions are dictionary keys since 2026-10-04 (the frame reads Spanish too),
  // so these pin the card's id → key → icon in source and the English the key resolves to.
  it('GENERAL_CARDS includes the History card (read-only league history reachable from gear)', () => {
    // Phase 1: History is not a primary tab — it lives inside the settings
    // modal under the General card grid as `league-history`.
    expect(src).toMatch(
      /\{\s*id:\s*'league-history',\s*titleKey:\s*'lsModal\.card\.leagueHistory'/,
    )
    expect(translations.en['lsModal.card.leagueHistory']).toBe('League History')
  })

  it('GENERAL_CARDS includes the new Audit Log card', () => {
    // Audit log is a placeholder card in Phase 1 — backend wiring lands later.
    expect(src).toMatch(
      /\{\s*id:\s*'audit-log',\s*titleKey:\s*'lsModal\.card\.auditLog',\s*descKey:\s*'lsModal\.card\.auditLogDesc',\s*icon:\s*History\s*\}/,
    )
    expect(translations.en['lsModal.card.auditLog']).toBe('Audit Log')
    expect(translations.en['lsModal.card.auditLogDesc']).toBe('Commissioner & league change history')
  })

  it('the COMMISH card grid still surfaces Commish Controls (commissioner tools)', () => {
    // The full Sleeper-style commissioner control center is rendered via
    // CommissionerLeagueSettingsShell when `isCommissioner && mainTab === 'general'`.
    // Belt-and-suspenders: the COMMISH_CARDS list still names commish-controls
    // so the card-grid fallback works for any future code path that needs it.
    expect(src).toMatch(
      /\{\s*id:\s*'commish-controls',\s*titleKey:\s*'lsModal\.card\.commishControls'/,
    )
    expect(translations.en['lsModal.card.commishControls']).toBe('Commish Controls')
  })

  it('CommissionerLeagueSettingsShell only renders when isCommissioner is true', () => {
    // Non-commissioners must NEVER see the commissioner control center,
    // even if they navigate to the General tab. This gate is the single
    // source of truth for that visibility rule.
    expect(src).toMatch(
      /isCommissioner\s*&&\s*mainTab\s*===\s*'general'\s*\?\s*\(\s*<CommissionerLeagueSettingsShell/,
    )
  })
})

describe('NFL redraft core — audit log placeholder panel', () => {
  const src = read('app/league/[leagueId]/components/LeagueSettingsSubPanels.tsx')

  it("SettingsSubPanelBody handles `case 'audit-log'`", () => {
    expect(src).toMatch(/case 'audit-log':/)
  })

  it('audit log panel exposes data-testid="settings-audit-log-panel" for QA + e2e', () => {
    expect(src).toMatch(/data-testid="settings-audit-log-panel"/)
  })

  it('audit log placeholder copy matches the Phase 1 canonical text', () => {
    // The exact text matters — UX wants the same wording surfaced in the QA
    // tooling and any future content-translation pass. Locking it here.
    expect(src).toMatch(/Audit logging is ready to be wired/)
    expect(src).toMatch(/Commissioner actions will appear\s+here once backend logging is enabled/)
  })

  it('audit log panel does NOT fabricate fake events', () => {
    // The panel must be a placeholder only — no hardcoded mock entries.
    // If a future commit wires real events, the placeholder should be
    // replaced wholesale, not augmented with mock data.
    const panelStart = src.indexOf("case 'audit-log':")
    const panelEnd = src.indexOf('case ', panelStart + 1)
    const panelBody = panelStart >= 0 && panelEnd > panelStart ? src.slice(panelStart, panelEnd) : ''
    expect(panelBody).not.toMatch(/setActions\(|mockEvents|sampleAuditEvents|fakeAuditLog/)
  })
})

describe('NFL redraft core — commissioner trigger routes to gear modal', () => {
  const src = read('app/league/[leagueId]/LeagueShell.tsx')

  it('onOpenCommissionerSettings handler branches on nflRedraftCore', () => {
    // For NFL redraft, the trigger opens the gear modal at the
    // `commish-controls` panel instead of the standalone modal.
    // For other variants, the standalone CommissionerSettingsModal still fires.
    expect(src).toMatch(
      /onOpenCommissionerSettings=\{\(\) =>\s*nflRedraftCore\s*\?\s*openLeagueSettingsModal\('commish-controls'\)\s*:\s*setCommissionerSettingsOpen\(true\)\s*\}/,
    )
  })

  it('standalone CommissionerSettingsModal mount gate excludes nflRedraftCore', () => {
    // The portal mount must NOT render for NFL redraft — the gear modal owns
    // commissioner controls there. Other variants (devy / c2c / survivor)
    // keep the standalone modal until Phase 2.
    expect(src).toMatch(/isCommissioner\s*&&\s*!nflRedraftCore\s*&&/)
  })

  it('CommissionerSettingsModal is NOT deleted (Phase 1 keeps the import + portal)', () => {
    // We deprecate the standalone modal for NFL redraft only — other variants
    // still need it. The import and portal mount must remain in place.
    expect(src).toMatch(/import \{ CommissionerSettingsModal \} from '\.\/components\/CommissionerSettingsModal'/)
    expect(src).toMatch(/<CommissionerSettingsModal/)
  })
})

describe('NFL redraft core — settings gear stays available (Commit A regression)', () => {
  const src = read('app/league/[leagueId]/LeagueShell.tsx')

  it('header settings gear renders unconditionally with the canonical testid', () => {
    expect(src).toMatch(/data-testid="league-header-settings"/)
  })
})
