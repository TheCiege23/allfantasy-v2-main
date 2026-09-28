import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ChatPhotoMigrationClient from '@/app/admin/chat-photo-migration/ChatPhotoMigrationClient'

/**
 * The screen's one safety property: deleting public copies is never ONE click. The API is the
 * security boundary; what the UI owns is not making an irreversible delete easy to hit by accident,
 * and saying plainly — before it happens — that links shared outside the app will stop working.
 */

function mockFetch(body: unknown = { ok: true, mode: 'dry-run', references: { total: 3, rows: 3, wouldMove: 3, byTableField: { 'league_chat_messages.metadata': 3 } }, hasMore: false, nextCursor: null }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentModes(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).mode)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChatPhotoMigrationClient', () => {
  it('Delete asks first, names the consequence, and sends nothing until confirmed', async () => {
    const fetchMock = mockFetch({ ok: true, mode: 'delete-public', counts: { deleted: 1 }, hasMore: false, nextCursor: null })
    render(<ChatPhotoMigrationClient />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete public copies' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog').textContent).toMatch(/outside AllFantasy will stop working/)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete public copies' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete public copies' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentModes(fetchMock)).toEqual(['delete-public'])
  })

  it('Dry run and Apply send their own mode and render the counts readably', async () => {
    const fetchMock = mockFetch()
    render(<ChatPhotoMigrationClient />)

    fireEvent.click(screen.getByRole('button', { name: 'Dry run' }))
    await waitFor(() => expect(screen.getByText('league_chat_messages.metadata')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(sentModes(fetchMock)).toEqual(['dry-run', 'apply'])
  })
})
