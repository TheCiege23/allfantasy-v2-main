import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ConnectSleeperForm from '@/app/settings/connect/sleeper/ConnectSleeperForm'

/*
 * 🛑 The form used to say "Linked as X … the link is saved either way" on ANY 200 from discovery.
 * Discovery only writes the link when the profile has none, and cannot write one another login
 * owns — so the import step right after refused with "Link your Sleeper account". The outcome is
 * now read back from the profile; these pin each branch.
 */

type Json = Record<string, unknown>

function mockFetch(discover: { status?: number; body: Json }, profile: Json) {
  const fn = vi.fn(async (url: string) => {
    if (url.includes('/api/leagues/import/discover')) {
      return new Response(JSON.stringify(discover.body), { status: discover.status ?? 200 })
    }
    if (url.includes('/api/user/profile')) return new Response(JSON.stringify(profile), { status: 200 })
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const FOUND = {
  account: { providerUserId: 'sl_123', accountIdentifier: 'guap', displayName: 'Guap' },
  leagues: [{}, {}],
}

async function submit(handle = 'guap') {
  fireEvent.change(screen.getByPlaceholderText('your_sleeper_username'), { target: { value: handle } })
  fireEvent.click(screen.getByRole('button', { name: /link sleeper account/i }))
}

afterEach(() => vi.unstubAllGlobals())

describe('ConnectSleeperForm', () => {
  it('says linked only when the profile now holds the Sleeper id it found', async () => {
    mockFetch({ body: FOUND }, { sleeperUserId: 'sl_123', sleeperUsername: 'guap' })
    render(<ConnectSleeperForm />)
    await submit()
    expect(await screen.findByText('Linked as Guap')).toBeTruthy()
    expect(screen.getByText(/Found 2 leagues/)).toBeTruthy()
  })

  it('reports a handle owned by another AllFantasy login instead of claiming a link', async () => {
    mockFetch({ body: { ...FOUND, handleLinkedElsewhere: true } }, { sleeperUserId: null })
    render(<ConnectSleeperForm />)
    await submit()
    expect(await screen.findByTestId('sleeper-handle-elsewhere')).toBeTruthy()
    expect(screen.queryByText(/Linked as/)).toBeNull()
  })

  it('reports that this account is already linked to a DIFFERENT Sleeper user (first-write-wins)', async () => {
    mockFetch({ body: FOUND }, { sleeperUserId: 'sl_999', sleeperUsername: 'oldhandle' })
    render(<ConnectSleeperForm />)
    await submit()
    const msg = await screen.findByTestId('sleeper-linked-to-other')
    expect(msg.textContent).toContain('oldhandle')
    expect(screen.queryByText(/Linked as/)).toBeNull()
  })

  it('says the link was not saved when the profile has none after a 200', async () => {
    mockFetch({ body: FOUND }, { sleeperUserId: null })
    render(<ConnectSleeperForm />)
    await submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't save the link/i)
  })

  it('shows an existing link on load instead of a form that cannot change it', () => {
    render(<ConnectSleeperForm currentLink={{ sleeperUserId: 'sl_1', sleeperUsername: 'guap' }} />)
    expect(screen.getByTestId('sleeper-current-link').textContent).toContain('guap')
    expect(screen.queryByPlaceholderText('your_sleeper_username')).toBeNull()
  })
})
