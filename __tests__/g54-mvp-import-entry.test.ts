import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getImportProviderSupportedSports,
  isImportProviderAvailable,
} from '@/lib/league-import/provider-ui-config'

describe('G54 MVP import entry and sport truth', () => {
  it('exposes the canonical Sleeper league preview/commit flow on the import page', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components/unified-import-ui/LeagueImportFlow.tsx'),
      'utf8',
    )

    expect(source).toMatch(/PREVIEW_PROVIDERS[^\n]+\['sleeper',\s*'espn'/)
    expect(source).toContain('Import one Sleeper league into AllFantasy with a preview and confirmation.')
    expect(source).toMatch(/<UnifiedImportPanel[\s\S]*providers=\{panelProviders\}/)
  })

  it('keeps every advertised provider backed by an available canonical adapter path', () => {
    for (const provider of ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'] as const) {
      expect(isImportProviderAvailable(provider)).toBe(true)
      expect(getImportProviderSupportedSports(provider)).toContain('NFL')
    }
  })

  it('advertises NCAAF import only for the source path that resolves NCAAF', () => {
    expect(getImportProviderSupportedSports('fantrax')).toEqual(['NFL', 'NCAAF'])
    for (const provider of ['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker'] as const) {
      expect(getImportProviderSupportedSports(provider)).not.toContain('NCAAF')
    }
  })
})
