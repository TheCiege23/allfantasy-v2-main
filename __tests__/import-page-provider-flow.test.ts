import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    'components',
    'unified-import-ui',
    'LeagueImportFlow.tsx',
  ),
  'utf8',
)

describe('import page provider flow', () => {
  it('treats import as a league-import experience instead of the old sleeper legacy flow', () => {
    expect(source).toContain('Connect your league')
    expect(source).toContain('Connect your Sleeper, ESPN, Yahoo, Fantrax, or MFL league to')
    expect(source).not.toContain('useLegacySleeperImport')
    expect(source).not.toContain('Build My Legacy Profile')
  })

  it('keeps the main commissioner demo providers available as tabs', () => {
    expect(source).toContain("{ id: 'sleeper', label: 'Sleeper' }")
    expect(source).toContain("{ id: 'espn', label: 'ESPN' }")
    expect(source).toContain("{ id: 'yahoo', label: 'Yahoo' }")
    expect(source).toContain("{ id: 'fantrax', label: 'Fantrax' }")
    expect(source).toContain("{ id: 'mfl', label: 'MFL' }")
    // Fleaflicker is an intended provider — visible as a tab even though it is
    // currently unavailable (its input stays disabled via provider-ui-config).
    expect(source).toContain("{ id: 'fleaflicker', label: 'Fleaflicker' }")
    // Unavailable providers render an honest blocked/coming-soon state.
    expect(source).toContain('import-provider-coming-soon')
  })

  it('drives sleeper through the same preview-first provider pipeline', () => {
    expect(source).toContain('function tabToImportProvider(tab: LegacyPlatformTab): ImportProvider')
    expect(source).toContain('const panelProviders = useMemo<ImportProvider[]>')
    expect(source).toContain('onImport={runPreview}')
    expect(source).toContain('Preview league settings, rosters, draft structure, and scoring')
  })

  it('offers provider account discovery without falling back to the old legacy messaging', () => {
    expect(source).toContain('Discover leagues from account')
    expect(source).not.toContain('This page now imports Sleeper leagues by league ID.')
  })
})

describe('import page discovery UX feedback', () => {
  it('tracks which discovered league is being previewed', () => {
    expect(source).toContain('previewingSourceId')
    expect(source).toContain('leaguePreviewError')
  })

  it('disables the button and shows a spinner while preview is loading', () => {
    expect(source).toContain('isThisLoading')
    expect(source).toContain('isAnyLoading')
    expect(source).toContain('Loading preview...')
    expect(source).toContain('Loader2')
  })

  it('renders errors adjacent to the triggering league card', () => {
    expect(source).toContain('thisError')
    expect(source).toContain('leaguePreviewError?.sourceId === league.sourceId')
  })

  it('shows a success indicator on the card when preview is loaded', () => {
    expect(source).toContain('Preview loaded — see below')
    expect(source).toContain('thisPreviewed')
  })

  it('passes discoverySourceId to runPreview from the league card button', () => {
    expect(source).toContain('discoverySourceId')
    // runPreview is called with sourceId as both sourceInput and discoverySourceId
    expect(source).toMatch(/runPreview\(\s*activeImportProvider,\s*league\.sourceId,\s*league\.sourceId,/)
  })

  it('scrolls the preview section into view on success', () => {
    expect(source).toContain('previewSectionRef')
    expect(source).toContain('scrollIntoView')
    expect(source).toContain('ref={previewSectionRef}')
  })
})
