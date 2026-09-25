import React, { useRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ChatComposer, imageRejection } from '@/app/dashboard/components/chat/ChatComposer'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

/*
 * Photos by button, drag-and-drop onto the conversation, or paste — one path,
 * one set of checks, a preview with ✕ before anything is sent. And `@` in a DM
 * offers the people in it.
 */

function png(name = 'shot.png', size = 1000): File {
  const f = new File([new Uint8Array(8)], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function Harness(props: Partial<React.ComponentProps<typeof ChatComposer>>) {
  const zone = useRef<HTMLDivElement | null>(null)
  return (
    <div ref={zone} data-testid="zone">
      <p>conversation</p>
      <ChatComposer leagueId="" threadId="t1" chatType="dm" onSend={async () => {}} dropZoneRef={zone} {...props} />
    </div>
  )
}

function dropEvent(files: File[]) {
  return { dataTransfer: { types: ['Files'], files, dropEffect: 'none' } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/chat/upload')) {
      return { ok: true, json: async () => ({ url: 'https://files.test/p.png', mimeType: 'image/png' }) } as Response
    }
    return { ok: true, json: async () => [] } as Response
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('imageRejection — the upload route’s own limits, checked first', () => {
  it('accepts the four image types under 25 MB', () => {
    expect(imageRejection({ type: 'image/webp', size: 5_000_000 })).toBeNull()
  })
  it('refuses other types and oversize files with a reason', () => {
    expect(imageRejection({ type: 'image/heic', size: 10 })).toMatch(/JPG, PNG, GIF or WebP/)
    expect(imageRejection({ type: 'image/png', size: 26 * 1024 * 1024 })).toMatch(/over 25 MB/)
  })
})

describe('drag and drop onto the conversation', () => {
  it('lights the drop hint only for FILE drags', () => {
    render(<Harness />)
    const zone = screen.getByTestId('zone')
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(zone.getAttribute('data-af-drop')).toBeNull()
    fireEvent.dragEnter(zone, dropEvent([png()]))
    expect(zone.getAttribute('data-af-drop')).toBe('active')
    fireEvent.dragLeave(zone, dropEvent([png()]))
    expect(zone.getAttribute('data-af-drop')).toBeNull()
  })

  it('uploads a dropped photo against the THREAD and shows it in the preview with a remove button', async () => {
    render(<Harness />)
    const zone = screen.getByTestId('zone')
    fireEvent.dragEnter(zone, dropEvent([png()]))
    fireEvent.drop(zone, dropEvent([png()]))
    await waitFor(() => expect(screen.getByLabelText('Remove attachment')).toBeTruthy())
    const call = vi.mocked(fetch).mock.calls.find(([u]) => String(u) === '/api/chat/upload')!
    const body = call[1]!.body as FormData
    expect(body.get('threadId')).toBe('t1')
    expect(body.get('leagueId')).toBeNull()
    expect(zone.getAttribute('data-af-drop')).toBeNull()

    fireEvent.click(screen.getByLabelText('Remove attachment'))
    expect(screen.queryByLabelText('Remove attachment')).toBeNull()
  })

  it('refuses a wrong file with a reason and never uploads it', async () => {
    render(<Harness />)
    const zone = screen.getByTestId('zone')
    const heic = new File([new Uint8Array(4)], 'a.heic', { type: 'image/heic' })
    fireEvent.drop(zone, dropEvent([heic]))
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringMatching(/JPG, PNG/)))
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === '/api/chat/upload')).toBe(false)
  })

  it('caps a dropped camera roll at four photos', async () => {
    render(<Harness />)
    fireEvent.drop(screen.getByTestId('zone'), dropEvent([1, 2, 3, 4, 5, 6].map((i) => png(`${i}.png`))))
    await waitFor(() => expect(screen.getAllByLabelText('Remove attachment')).toHaveLength(4))
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringMatching(/Up to 4 photos/))
  })
})

describe('paste', () => {
  it('turns a pasted screenshot into an attachment through the same path', async () => {
    render(<Harness />)
    fireEvent.paste(screen.getByTestId('league-chat-textarea'), { clipboardData: { files: [png()] } })
    await waitFor(() => expect(screen.getByLabelText('Remove attachment')).toBeTruthy())
  })
})

describe('typing signal', () => {
  it('reports typing as you type and stops when the box is sent', async () => {
    const onTypingChange = vi.fn()
    render(<Harness onTypingChange={onTypingChange} />)
    const box = screen.getByTestId('league-chat-textarea')
    fireEvent.change(box, { target: { value: 'hey' } })
    expect(onTypingChange).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(onTypingChange).toHaveBeenLastCalledWith(false))
  })
})

describe('@ in a DM or huddle offers its members', () => {
  it('lists the people in the thread, matched on username or display name', async () => {
    render(
      <Harness
        mentionMembers={[
          { username: 'jordan', displayName: 'Jordan Love' },
          { username: 'sam_d', displayName: 'Sam Darnold' },
        ]}
      />,
    )
    const box = screen.getByTestId('league-chat-textarea') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '@sa', selectionStart: 3 } })
    fireEvent.keyUp(box, { key: 'a', target: { selectionStart: 3 } })
    expect(await screen.findByRole('button', { name: /@sam_d/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /@jordan/ })).toBeNull()
  })
})
