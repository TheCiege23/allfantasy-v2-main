import { describe, expect, it, vi } from 'vitest'
import {
  buildDashboardDraftOverlayUrl,
  DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE,
  fetchLiveDraftSessionIdForLeague,
  isOpenDraftOverlayMessage,
  openDraftOverlayInParent,
  parseLeagueDraftNavigationIntent,
  postOpenDraftOverlayMessage,
} from '@/lib/dashboard/dashboard-draft-overlay-bridge'

describe('dashboard draft overlay bridge', () => {
  it('builds overlay URL with draftId or dispersalDraftId', () => {
    expect(buildDashboardDraftOverlayUrl({ leagueId: 'L1', draftId: 'D1' })).toBe(
      '/dashboard?leagueId=L1&draftOverlay=1&draftId=D1',
    )
    expect(buildDashboardDraftOverlayUrl({ leagueId: 'L1', dispersalDraftId: 'disp1' })).toBe(
      '/dashboard?leagueId=L1&draftOverlay=1&dispersalDraftId=disp1',
    )
    expect(buildDashboardDraftOverlayUrl({ leagueId: 'L1' })).toBe('/dashboard?leagueId=L1&draftOverlay=1')
  })

  it('validates postMessage payload with optional draft ids', () => {
    expect(
      isOpenDraftOverlayMessage({
        type: DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE,
        leagueId: 'x',
      }),
    ).toBe(true)
    expect(
      isOpenDraftOverlayMessage({
        type: DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE,
        leagueId: 'x',
        draftId: 'd',
      }),
    ).toBe(true)
    expect(isOpenDraftOverlayMessage({ type: 'other', leagueId: 'x' })).toBe(false)
    expect(isOpenDraftOverlayMessage(null)).toBe(false)
  })

  it('parseLeagueDraftNavigationIntent detects live and dispersal paths', () => {
    expect(parseLeagueDraftNavigationIntent('/league/L1/draft')).toEqual({
      kind: 'live',
      leagueId: 'L1',
    })
    expect(parseLeagueDraftNavigationIntent('/league/L1/dispersal-draft/dd')).toEqual({
      kind: 'dispersal',
      leagueId: 'L1',
      dispersalDraftId: 'dd',
    })
    expect(parseLeagueDraftNavigationIntent('/trade-finder')).toBe(null)
  })

  it('postOpenDraftOverlayMessage posts to parent when cross-origin safe', () => {
    const postMessage = vi.fn()
    vi.stubGlobal('window', {
      parent: { postMessage },
      location: { origin: 'https://app.test' },
    })
    postOpenDraftOverlayMessage({ leagueId: 'L', draftId: 'd', source: 't' })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE,
        leagueId: 'L',
        draftId: 'd',
        source: 't',
      }),
      'https://app.test',
    )
    vi.unstubAllGlobals()
  })

  it('openDraftOverlayInParent calls router.replace', () => {
    const replace = vi.fn()
    openDraftOverlayInParent({
      router: { replace },
      leagueId: 'L',
      draftId: 'D',
    })
    expect(replace).toHaveBeenCalledWith('/dashboard?leagueId=L&draftOverlay=1&draftId=D', { scroll: false })
  })

  it('fetchLiveDraftSessionIdForLeague returns id from session snapshot', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ session: { id: 'sess-1' } }),
    }) as unknown as typeof fetch
    await expect(fetchLiveDraftSessionIdForLeague('league-x')).resolves.toBe('sess-1')
  })
})
