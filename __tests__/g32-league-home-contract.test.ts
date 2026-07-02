import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('G32 NFL redraft league home contracts', () => {
  it('uses the updated redraft tab model without an AI tab', () => {
    const tabs = read('app/league/[leagueId]/LeagueTabs.tsx')
    const shell = read('app/league/[leagueId]/LeagueShell.tsx')

    for (const tabId of [
      'home',
      'draft',
      'roster',
      'matchups',
      'waivers',
      'trades',
      'standings',
      'league_chat',
      'commissioner',
    ]) {
      expect(tabs).toContain(`'${tabId}'`)
    }

    expect(shell).toContain("core.push({ id: 'commissioner', label: 'Commissioner' })")
    expect(shell).toContain("case 'league_chat':")
    expect(shell).toContain("case 'commissioner':")
    expect(tabs).not.toContain("label: 'AI Coaching'")
  })

  it('labels settings surfaces with Decision OS and Intelligence language', () => {
    const settingsHub = read('components/league-settings/LeagueSettingsControlCenter.tsx')
    const settingsNav = read('app/league/[leagueId]/components/settings/SettingsNav.tsx')
    const modalPanel = read('app/league/[leagueId]/components/settings/AiLeagueSettingsPanel.tsx')
    const compactTab = read('components/league-settings/tabs/AISettingsTab.tsx')

    expect(settingsHub).toContain("label: 'Commissioner Intelligence'")
    expect(settingsHub).toContain("label: 'Decision OS'")
    expect(settingsNav).toContain("label: 'Decision OS'")
    expect(settingsNav).toContain("label: '🤖 League Guide'")
    expect(modalPanel).toContain('title="Decision OS"')
    expect(compactTab).toContain('Control Commissioner Intelligence and Decision OS settings')

    const visibleCopySources = [settingsHub, settingsNav, modalPanel, compactTab].join('\n')
    expect(visibleCopySources).not.toMatch(/AI Settings|AI Host|AI waiver|AI trade|AI draft|AI commissioner|AI assistant/)
  })

  it('enforces premium Commissioner Intelligence settings server-side', () => {
    const executePatch = read('lib/league/execute-league-settings-patch.ts')
    const settingsRoute = read('app/api/league/settings/route.ts')

    expect(executePatch).toContain('PREMIUM_COMMISSIONER_LEAGUE_PATCH_KEYS')
    expect(executePatch).toContain('PREMIUM_COMMISSIONER_DRAFT_SETTINGS_KEYS')
    expect(executePatch).toContain('requestedPremiumCommissionerKeys')
    expect(executePatch).toContain("'aiWaiverSuggestions'")
    expect(executePatch).toContain("'aiQueueSuggestions'")
    expect(executePatch).toContain('commissioner_ai_tools')
    expect(executePatch).toContain('AF Commissioner or AF Supreme is required')
    expect(settingsRoute).toContain('EntitlementResolver')
    expect(settingsRoute).toContain('Boolean(profile?.afCommissionerSub) || Boolean(commissionerEntitlement.hasAccess)')
  })

  it('keeps the redraft intro one-time by default while allowing replay and reduced-motion fallback', () => {
    const gate = read('components/league/LeagueConceptIntroGate.tsx')
    const overlay = read('components/league/ConceptIntroVideoOverlay.tsx')
    const dashboard = read('components/league-home/NflRedraftLeagueHomeDashboard.tsx')

    expect(gate).toContain('intro-status')
    expect(gate).toContain('intro-seen')
    expect(gate).toContain('af:replay-league-intro')
    expect(overlay).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(overlay).toContain('concept-intro-reduced-motion')
    expect(dashboard).toContain('data-testid="g32-replay-intro"')
  })
})
