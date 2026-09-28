import React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RichMessage, readSafeGif, hasRichContent } from '@/components/core-app/comms/RichMessage'
import { RichMessageRenderer } from '@/lib/rich-message/RichMessageRenderer'
import type { PlatformChatMessage } from '@/types/platform-shared'

/*
 * 🛑 A GIF SENT FROM ONE CHAT SHOWED AS "🎬 GIF" OR A BARE LINK IN THE OTHER.
 * The shared composer (drawer, dashboard) writes the GIF into metadata with "🎬 GIF"
 * as the body; the full league panel and /messages write `messageType: 'gif'` with
 * the URL as the body. Each renderer read one shape. Both read both now — and only
 * from GIF services we can name (https, Klipy / GIPHY / Tenor hosts).
 */

const KLIPY = 'https://static.klipy.com/ii/abc/a.gif'
const GIPHY = 'https://media2.giphy.com/media/x/giphy.gif'
const EVIL = 'https://evil.test/pixel.gif'

const metaShape = { gif: { url: KLIPY, previewUrl: KLIPY, title: 'td' } }

function platformMessage(over: Partial<PlatformChatMessage>): PlatformChatMessage {
  return {
    id: 'm1',
    threadId: 't1',
    senderUserId: 'u1',
    senderName: 'Sam',
    messageType: 'text',
    body: '',
    createdAt: '2026-09-25T12:00:00.000Z',
    ...over,
  }
}

describe('readSafeGif', () => {
  it('reads the shared composer’s metadata shape', () => {
    expect(readSafeGif(metaShape)).toMatchObject({ url: KLIPY, provider: 'klipy' })
  })

  it('reads the type-gif shape, URL as the body', () => {
    expect(readSafeGif({}, 'gif', GIPHY)).toMatchObject({ url: GIPHY, provider: 'giphy' })
  })

  it('refuses a host it cannot name, in either shape', () => {
    expect(readSafeGif({ gifUrl: EVIL })).toBeNull()
    expect(readSafeGif({}, 'gif', EVIL)).toBeNull()
    expect(readSafeGif({}, 'gif', 'http://static.klipy.com/a.gif')).toBeNull()
    expect(readSafeGif({}, 'gif', 'javascript:alert(1)')).toBeNull()
  })

  it('does not treat a text row’s URL as a GIF', () => {
    expect(readSafeGif({}, 'text', KLIPY)).toBeNull()
  })
})

describe('the drawer renders both shapes, with the right credit', () => {
  it('renders a metadata GIF and credits Klipy — not GIPHY', () => {
    render(<RichMessage metadata={metaShape} />)
    expect(screen.getByAltText('td').getAttribute('src')).toBe(KLIPY)
    expect(screen.getByText('via KLIPY')).toBeTruthy()
    expect(screen.queryByText(/GIPHY/)).toBeNull()
  })

  it('renders a type-gif row from /messages', () => {
    render(<RichMessage metadata={null} messageType="gif" body={GIPHY} />)
    expect(screen.getByAltText('GIF').getAttribute('src')).toBe(GIPHY)
    expect(screen.getByText('via GIPHY')).toBeTruthy()
  })

  it('draws nothing for a GIF on an unknown host', () => {
    const { container } = render(<RichMessage metadata={{ gifUrl: EVIL }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(hasRichContent({ gifUrl: EVIL })).toBe(false)
  })

  it('opens a photo full size in the viewer, fitted rather than cropped', () => {
    render(<RichMessage metadata={{ attachments: [{ type: 'image', url: 'https://cdn.test/p.png' }] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open image full size' }))
    expect(screen.getByRole('dialog', { name: 'Image' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open original' }).getAttribute('href')).toBe('https://cdn.test/p.png')
  })

  it('never puts a javascript: attachment in a src', () => {
    const { container } = render(
      <RichMessage metadata={{ attachments: [{ type: 'image', url: 'javascript:alert(1)' }] }} />,
    )
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('/messages renders both shapes', () => {
  it('renders the shared composer’s metadata GIF and drops the "🎬 GIF" stand-in', () => {
    render(<RichMessageRenderer message={platformMessage({ body: '🎬 GIF', metadata: metaShape })} />)
    expect(screen.getByAltText('td')).toBeTruthy()
    expect(screen.getByText('via KLIPY')).toBeTruthy()
    expect(screen.queryByText('🎬 GIF')).toBeNull()
  })

  it('keeps a caption the sender actually typed', () => {
    render(<RichMessageRenderer message={platformMessage({ body: 'this is us', metadata: metaShape })} />)
    expect(screen.getByText('this is us')).toBeTruthy()
    expect(screen.getByAltText('td')).toBeTruthy()
  })

  it('renders a type-gif row and credits its service', () => {
    render(<RichMessageRenderer message={platformMessage({ messageType: 'gif', body: GIPHY })} />)
    expect(screen.getByAltText('GIF')).toBeTruthy()
    expect(screen.getByText('via GIPHY')).toBeTruthy()
  })

  it('refuses a type-gif row from an unknown host rather than loading it', () => {
    const { container } = render(<RichMessageRenderer message={platformMessage({ messageType: 'gif', body: EVIL })} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/can.t show/)).toBeTruthy()
  })

  it('renders shared-composer photos from metadata', () => {
    render(
      <RichMessageRenderer
        message={platformMessage({ body: '📎 Media', metadata: { attachments: [{ type: 'image', url: '/api/chat/files/a.png' }] } })}
      />,
    )
    expect(screen.getByAltText('Image')).toBeTruthy()
    expect(screen.queryByText('📎 Media')).toBeNull()
  })

  it('leaves an ordinary text message exactly as it was', () => {
    render(<RichMessageRenderer message={platformMessage({ body: 'plain words' })} />)
    expect(screen.getByText('plain words')).toBeTruthy()
  })
})
