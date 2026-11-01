import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
vi.mock('next/navigation', () => ({ useParams: () => ({ leagueId: 'league-1' }) }))
vi.mock('@/components/chat/LeagueChatDock', () => ({ default: (props: { dynastyBackground?: boolean }) => <div data-testid="dock" data-dynasty={props.dynastyBackground ? 'true' : 'false'} /> }))
import LeagueChatDockClient from '@/components/chat/LeagueChatDockClient'

afterEach(() => vi.unstubAllGlobals())
describe('dynasty chat dock', () => {
  it('loads the league type for its background while retaining the commissioner check', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/check') ? { isCommissioner: true } : { isDynasty: true, leagueType: 'dynasty' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LeagueChatDockClient />)
    await waitFor(() => expect(screen.getByTestId('dock').getAttribute('data-dynasty')).toBe('true'))
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/league-1', { cache: 'no-store' })
  })
})
