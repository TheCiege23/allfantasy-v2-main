// @vitest-environment jsdom
/**
 * "Coming soon" placeholders are not shown inside the iOS app (App Store 2.1 — incomplete or
 * placeholder features). A census of every visible "coming soon" string, traced by what a
 * signed-in reviewer can reach from /core, found them on the app's own first screen (the landing
 * page's Yahoo chip and note), the importer, Settings, the create-league import modal, the War
 * Room page, the waiver wire, /af-legacy, /af-rankings, /legacy-import, and league pages.
 *
 * Each is marked `data-hide-in-ios-app`, which globals.css hides under `html[data-ios-app]`. The
 * WEBSITE is unchanged, except two strings that were only ever noise: the TeamTab FAAB line's
 * "· Trade hub (Coming Soon)" and /af-legacy Chimmy's "Save conversation" button, whose only
 * action was a "coming soon" toast — both removed everywhere.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
// The real English copy (not an identity t()), so these assertions read what a user sees.
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/lib/connected-accounts', () => ({
  getConnectedAccounts: vi.fn(async () => ({ providers: [], hasPassword: true })),
  disconnectConnectedAccount: vi.fn(),
  getProviderConnectAction: vi.fn(),
  canDisconnectProvider: vi.fn(() => false),
}))
vi.mock('@/components/connected-accounts/ConnectedIdentityRenderer', () => ({ ConnectedIdentityRenderer: () => null }))
vi.mock('@/components/settings/EspnCookieConnection', () => ({ EspnCookieConnection: () => null }))
vi.mock('@/components/settings/MflApiKeyConnection', () => ({ MflApiKeyConnection: () => null }))
vi.mock('@/components/core-app/import/ConnectedPlatforms', () => ({ ConnectedPlatforms: () => null }))

import { ConnectedAccountsSettingsSection } from '@/app/settings/components/sections/ConnectedAccountsSettingsSection'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'

afterEach(() => cleanup())

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const hidden = (el: Element | null | undefined) => Boolean(el?.closest('[data-hide-in-ios-app]'))

describe('the landing page — the app opens here signed out', () => {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(<LandingV4 lang="en" launch={null} />), 'text/html')
  const chip = (name: string) =>
    [...doc.querySelectorAll('.af-lp-connect')].find((el) => el.firstChild?.textContent === name)

  it('hides the Yahoo "soon" chip and its note in the app', () => {
    expect(chip('Yahoo')?.getAttribute('data-state')).toBe('soon')
    expect(hidden(chip('Yahoo'))).toBe(true)
    expect(hidden(doc.querySelector('.af-lp-soon-note[data-provider="yahoo"]'))).toBe(true)
  })

  it('keeps every live platform (control)', () => {
    for (const name of ['Sleeper', 'ESPN', 'Fantrax', 'MFL', 'Fleaflicker']) {
      expect(chip(name)?.getAttribute('data-state')).toBe('live')
      expect(hidden(chip(name))).toBe(false)
    }
  })
})

describe('Settings › Connected — the Spotify card', () => {
  const spotifyCard = (container: HTMLElement) =>
    [...container.querySelectorAll('p')].find((e) => e.textContent?.trim() === 'Spotify')?.closest('.rounded-xl')

  it('is hidden in the app while it only says "coming soon"', () => {
    const { container } = render(<ConnectedAccountsSettingsSection profile={{} as never} onRefetchProfile={() => {}} />)
    const card = spotifyCard(container)
    expect(card?.textContent).toMatch(/coming soon/)
    expect(hidden(card)).toBe(true)
  })

  it('stays for an account that has Spotify connected (control)', () => {
    const { container } = render(
      <ConnectedAccountsSettingsSection profile={{ spotifyConnectedAt: '2026-09-01T00:00:00Z' } as never} onRefetchProfile={() => {}} />,
    )
    expect(hidden(spotifyCard(container))).toBe(false)
  })
})

/*
 * The rest are pinned at the source: each marker is on the element that carries the placeholder,
 * and conditional ones only on the placeholder branch.
 */
describe('every other reachable placeholder carries the marker', () => {
  it.each([
    ['components/core-app/screens/ImportV4.tsx', /data-hide-in-ios-app=\{available \? undefined : ''\}/],
    ['components/core-app/import/ConnectedPlatforms.tsx', /data-hide-in-ios-app=\{status === 'coming-soon' \? '' : undefined\}/],
    ['app/settings/components/sections/LegacyImportSettingsSection.tsx', /data-hide-in-ios-app=\{legacyStatus && !available \? "" : undefined\}/],
    ['components/unified-import-ui/LeagueImportFlow.tsx', /data-hide-in-ios-app=\{isImportProviderAvailable\(tabToImportProvider\(id\)\) \? undefined : ''\}/],
    ['components/unified-import-ui/LeagueImportFlow.tsx', /data-testid="import-provider-coming-soon"\s+data-hide-in-ios-app=""/],
    ['components/unified-import-ui/LeagueImportFlow.tsx', /<details[^>]*data-hide-in-ios-app=""/],
    ['components/league-creation/ImportSourceInputPanel.tsx', /data-hide-in-ios-app="">\s*<Info/],
    ['components/create-league-v2/CreateLeagueWizard.tsx', /data-hide-in-ios-app=\{available && provider\.route \? undefined : ''\}/],
    ['app/war-room/page.tsx', /data-hide-in-ios-app=\{href \? undefined : ''\}/],
    ['app/waiver-wire/WaiverWireClient.tsx', /data-hide-in-ios-app=\{tab\.id === "recommendations" \? "" : undefined\}/],
    ['app/af-legacy/page.tsx', /data-hide-in-ios-app=""[\s\S]{0,400}Save to Notes/],
    ['components/PlayoffBracketPreview.tsx', /data-hide-in-ios-app="">Live bracket updates coming soon/],
    ['components/rankings/AfRankingsPageSections.tsx', /data-hide-in-ios-app="">\s*<div[^>]*>\s*<div>\s*<p[^>]*>Leaderboard/],
    ['app/league/[leagueId]/tabs/LeagueTabPlaceholder.tsx', /data-hide-in-ios-app="">\s*\{league\.sport\} \{tabLabel\.toLowerCase\(\)\} coming soon/],
    ['app/dashboard/components/LeftChatPanel.tsx', /data-hide-in-ios-app=""\s+title="Mute — coming soon"/],
    ['components/core-app/draft-music/DraftMusicWidget.tsx', /<div className="af-dm-connect" data-hide-in-ios-app="">/],
    ['components/brackets/world-cup/WorldCupBracketShell.tsx', /label="Voice" onClick=\{\(\) => setComposerPanel\("voice"\)\} hideInIosApp/],
    ['components/brackets/world-cup/WorldCupBracketShell.tsx', /data-hide-in-ios-app=\{hideInIosApp \? "" : undefined\}/],
    ['app/legacy/page.tsx', /data-hide-in-ios-app=\{tab\.id === 'transfer' \? '' : undefined\}/],
    ['app/components/WaiverAI.tsx', /data-hide-in-ios-app="">\s*Only Sleeper is fully supported/],
  ])('%s', (rel, marker) => {
    expect(read(rel)).toMatch(marker)
  })

  it('two noise strings are gone everywhere', () => {
    expect(read('app/league/[leagueId]/tabs/TeamTab.tsx')).not.toMatch(/Trade hub \(Coming Soon\)/)
    expect(read('app/af-legacy/components/ChimmyChatTab.tsx')).not.toMatch(/Save conversation coming soon|onSaveConversation/)
  })

  it('the marker is real CSS, not a convention nobody implemented', () => {
    expect(read('app/globals.css')).toMatch(/html\[data-ios-app\] \[data-hide-in-ios-app\]/)
  })
})
