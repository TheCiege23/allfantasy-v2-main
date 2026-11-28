/**
 * Survivor settings tabs are for a league whose island runs on AllFantasy. Two Sleeper imports in
 * production carry `survivorMode` with no island here; their commissioner was offered tabs that change
 * nothing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('CommissionerSettingsModal survivor tabs', () => {
  const src = readFileSync(join(process.cwd(), 'app/league/[leagueId]/components/CommissionerSettingsModal.tsx'), 'utf8')
  it('needs the survivor flag AND a league hosted here', () => {
    expect(src).toMatch(/^\s*const survivorMode = survivorFlag && isNativePlatform\(/m)
  })
  it('the tabs and the tab guard both read that combined value', () => {
    expect(src).toMatch(/^\s*showSurvivorTabs=\{survivorMode\}$/m)
    expect(src).toMatch(/^\s*if \(!survivorMode && isSurvivorSettingsTab\(activeTab\)\) \{$/m)
    expect(src).not.toMatch(/showSurvivorTabs=\{survivorFlag\}/)
  })
})
