/**
 * The commissioner settings tabs that used to render "Extended controls will ship in follow-up patches"
 * (app/league/[leagueId]/components/CommissionerSettingsModal.tsx → settings/CommissionerExtraTabs.tsx):
 *
 *   - no tab id still reaches PlaceholderPanel
 *   - Import / Sync: a native league says there is nothing to sync; an import names its platform and dates
 *   - Draft Pick Settings: the horizon select saves through the dynasty settings PUT; a non-dynasty league
 *     is told where pick trading lives instead
 *   - Appearance: the logo uploads, replaces and removes through /api/commissioner/leagues/[id]/logo
 *   - the league logo route: commissioners only, image types only, and it writes League.logoUrl
 *   - their Spanish
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  language: 'en' as 'en' | 'es',
  role: vi.fn(async () => undefined as void),
  update: vi.fn(async () => ({})),
  persist: vi.fn(async () => ({ url: 'https://blob.example/league-logos/x.png' })),
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ language: m.language, t: (k: string) => k }),
  useOptionalLanguage: () => ({ language: m.language, t: (k: string) => k }),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'owner' } } }) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { update: m.update } } }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: m.role }))
vi.mock('@/lib/blob/readWriteToken', () => ({ getBlobReadWriteToken: () => 'token' }))
vi.mock('@/lib/avatar/ProfileImageUploadStorageService', () => ({
  isAllowedProfileImageType: (t: string) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(t),
  MAX_PROFILE_IMAGE_BYTES: 1024,
  persistProfileImageBytes: m.persist,
}))
// The reused cards fetch their own APIs; they are tested where they live.
vi.mock('@/components/league-settings/PickTermsPanel', () => ({ PickTermsPanel: () => <div data-testid="pick-terms" /> }))
vi.mock('@/app/league/[leagueId]/components/DiscordLeagueSyncPanel', () => ({
  DiscordLeagueSyncPanel: ({ isLeagueOwner }: { isLeagueOwner: boolean }) => <div data-testid="discord" data-owner={String(isLeagueOwner)} />,
}))

import { AppearanceTab, DraftPicksTab, ImportSyncTab, IntegrationsTab } from '@/app/league/[leagueId]/components/settings/CommissionerExtraTabs'
import { DELETE, POST } from '@/app/api/commissioner/leagues/[leagueId]/logo/route'
import { TABS_COPY } from '@/lib/i18n/commish-settings-tabs-copy'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  m.language = 'en'
  m.role.mockResolvedValue(undefined)
  vi.unstubAllGlobals()
})

describe('the commissioner settings modal', () => {
  it('routes none of the seven tabs to the placeholder any more', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/components/CommissionerSettingsModal.tsx'), 'utf8')
    for (const id of ['dues', 'import_sync', 'advanced', 'appearance', 'security', 'draft_picks', 'integrations']) {
      const branch = src.slice(src.indexOf(`activeTab === '${id}' ?`))
      const next = branch.slice(0, branch.indexOf(') : activeTab ==='))
      expect(next, id).not.toContain('PlaceholderPanel')
    }
  })
})

describe('Import / Sync', () => {
  it('a native league has nothing to sync', () => {
    render(<ImportSyncTab platform="manual" importedAt={null} lastSyncedAt={null} syncStatus={null} />)
    expect(screen.getByTestId('import-sync-native').textContent).toBe(TABS_COPY.nativeLeague.en)
  })

  it('an import names its platform, its dates and the Sync screen', () => {
    render(<ImportSyncTab platform="sleeper" importedAt="2026-09-01T12:00:00.000Z" lastSyncedAt="2026-10-30T12:00:00.000Z" syncStatus="error" />)
    const box = screen.getByTestId('import-sync-imported').textContent!
    expect(box).toContain('Imported from Sleeper')
    expect(box).toContain('Last synced Oct 30, 2026')
    expect(box).toContain(TABS_COPY.statusError.en)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/core/sync')
  })

  it('in Spanish', () => {
    m.language = 'es'
    render(<ImportSyncTab platform="espn" importedAt={null} lastSyncedAt={null} syncStatus={null} />)
    const box = screen.getByTestId('import-sync-imported').textContent!
    expect(box).toContain('Importada de ESPN')
    expect(box).toContain(TABS_COPY.neverSynced.es)
  })
})

describe('Draft Pick Settings', () => {
  it('loads the horizon, saves a new one through the dynasty settings PUT', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? json({ ok: true }) : json({ effective: { futurePicksYearsOut: 3 } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<DraftPicksTab leagueId="L1" nativeDynasty canEdit />)
    const select = (await screen.findByTestId('pick-years-select')) as HTMLSelectElement
    await waitFor(() => expect(select.disabled).toBe(false))
    expect(select.value).toBe('3')
    expect([...select.options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5'])
    const save = screen.getByTestId('pick-years-save') as HTMLButtonElement
    expect(save.disabled).toBe(true) // nothing changed yet
    fireEvent.change(select, { target: { value: '5' } })
    fireEvent.click(save)
    await screen.findByText(TABS_COPY.pickYearsSaved.en)
    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(url).toBe('/api/leagues/L1/dynasty-settings')
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify({ futurePicksYearsOut: 5 }) })
    expect(screen.getByTestId('pick-terms')).toBeTruthy()
  })

  it('shows the server refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'PUT' ? json({ error: 'nope' }, 400) : json({ effective: { futurePicksYearsOut: 2 } }))))
    render(<DraftPicksTab leagueId="L1" nativeDynasty canEdit />)
    const select = (await screen.findByTestId('pick-years-select')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('2'))
    fireEvent.change(select, { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('pick-years-save'))
    await screen.findByText('nope')
  })

  it('a member sees it read-only; a non-dynasty league is pointed to the Trades tab', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ effective: { futurePicksYearsOut: 4 } })))
    const { unmount } = render(<DraftPicksTab leagueId="L1" nativeDynasty canEdit={false} />)
    const select = (await screen.findByTestId('pick-years-select')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('4'))
    expect(select.disabled).toBe(true)
    expect(screen.queryByTestId('pick-years-save')).toBeNull()
    unmount()
    m.language = 'es'
    render(<DraftPicksTab leagueId="L1" nativeDynasty={false} canEdit />)
    expect(screen.getByTestId('draft-picks-not-dynasty').textContent).toBe(TABS_COPY.picksNotDynasty.es)
  })
})

describe('Appearance', () => {
  it('uploads, then removes, the logo', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => json({ logoUrl: init?.method === 'DELETE' ? null : 'https://blob.example/new.png' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AppearanceTab leagueId="L1" logoUrl={null} canEdit />)
    expect(screen.getByTestId('league-logo-none')).toBeTruthy()
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('league-logo-input'), { target: { files: [file] } })
    await screen.findByText(TABS_COPY.logoSaved.en)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/commissioner/leagues/L1/logo')
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBeInstanceOf(FormData)
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://blob.example/new.png')
    fireEvent.click(screen.getByText(TABS_COPY.logoRemove.en))
    await screen.findByText(TABS_COPY.logoRemoved.en)
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe('DELETE')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('a member cannot change it', () => {
    render(<AppearanceTab leagueId="L1" logoUrl="https://blob.example/a.png" canEdit={false} />)
    expect(screen.queryByTestId('league-logo-input')).toBeNull()
    expect(screen.getByText(TABS_COPY.readOnly.en)).toBeTruthy()
  })
})

describe('Integrations', () => {
  it('passes whether the viewer owns the league', () => {
    const { unmount } = render(<IntegrationsTab leagueId="L1" leagueOwnerUserId="owner" />)
    expect(screen.getByTestId('discord').getAttribute('data-owner')).toBe('true')
    unmount()
    render(<IntegrationsTab leagueId="L1" leagueOwnerUserId="someone-else" />)
    expect(screen.getByTestId('discord').getAttribute('data-owner')).toBe('false')
  })
})

describe('the league logo route', () => {
  const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
  const upload = (file: File | null) => {
    const form = new FormData()
    if (file) form.append('file', file)
    // jsdom's File does not survive undici's multipart encoding, so the route reads the form as built.
    return POST({ formData: async () => form } as any, ctx)
  }

  it('stores an image under league-logos and sets League.logoUrl', async () => {
    const res = await upload(new File(['abc'], 'logo.png', { type: 'image/png' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ logoUrl: 'https://blob.example/league-logos/x.png' })
    expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png', keyPrefix: 'league-logos' }))
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { logoUrl: 'https://blob.example/league-logos/x.png' } })
  })

  it('refuses a non-commissioner, a non-image, a too-large file and no file, writing nothing', async () => {
    m.role.mockRejectedValueOnce(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    expect((await upload(new File(['abc'], 'logo.png', { type: 'image/png' }))).status).toBe(403)
    expect((await upload(new File(['abc'], 'x.svg', { type: 'image/svg+xml' }))).status).toBe(400)
    expect((await upload(new File([new Uint8Array(2048)], 'big.png', { type: 'image/png' }))).status).toBe(400)
    expect((await upload(null)).status).toBe(400)
    expect(m.persist).not.toHaveBeenCalled()
    expect(m.update).not.toHaveBeenCalled()
  })

  it('DELETE clears it, commissioners only', async () => {
    const del = () => DELETE(new Request('http://x', { method: 'DELETE' }) as any, ctx)
    expect((await del()).status).toBe(200)
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { logoUrl: null } })
    m.update.mockClear()
    m.role.mockRejectedValueOnce(new Response('{}', { status: 403 }))
    expect((await del()).status).toBe(403)
    expect(m.update).not.toHaveBeenCalled()
  })
})

describe('copy', () => {
  it('every string has English and Spanish, and the Spanish never says «waiver»', () => {
    for (const [k, v] of Object.entries(TABS_COPY)) {
      expect(v.en, k).toBeTruthy()
      expect(v.es, k).toBeTruthy()
      expect(v.es.toLowerCase(), k).not.toContain('waiver')
    }
  })
})
