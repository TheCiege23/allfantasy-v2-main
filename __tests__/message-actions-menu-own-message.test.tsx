// @vitest-environment jsdom
/**
 * MessageActionsMenu (Messages, and the home chat dock) rendered on EVERY message — including
 * your own, where it offered "Report <you>" and "Block <you>". Found walking the App Review
 * account: its own "hey" carried "Report Reviewer" / "Block Reviewer". It now renders nothing
 * on the viewer's own message, the same rule MessageModerationMenu already follows.
 *
 * The control matters as much as the fix: App Review REQUIRES report and block on other
 * people's messages, so a menu that vanished everywhere would fail the same review this fixes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const useSession = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: () => useSession() }))

import MessageActionsMenu from '@/components/chat/MessageActionsMenu'

afterEach(() => {
  cleanup()
  useSession.mockReset()
})

const noop = () => {}
function menu(senderUserId: string | null, senderName = 'Pat') {
  return render(
    <MessageActionsMenu
      messageId="m1"
      threadId="t1"
      senderUserId={senderUserId}
      senderName={senderName}
      isBlocked={false}
      onReportMessage={noop}
      onReportUser={noop}
      onBlockUser={noop}
      onUnblockUser={noop}
    />,
  )
}
const trigger = () => screen.queryByLabelText('Message actions')

describe('MessageActionsMenu', () => {
  it('renders nothing on your own message', () => {
    useSession.mockReturnValue({ data: { user: { id: 'me' } } })
    menu('me', 'Reviewer')
    expect(trigger()).toBeNull()
    expect(screen.queryByText(/Block Reviewer|Report Reviewer/)).toBeNull()
  })

  it("control: on someone else's message it offers report and block", () => {
    useSession.mockReturnValue({ data: { user: { id: 'me' } } })
    menu('pat', 'Pat')
    fireEvent.click(trigger()!)
    expect(screen.getByText('Report message')).not.toBeNull()
    expect(screen.getByText('Report Pat')).not.toBeNull()
    expect(screen.getByText('Block Pat')).not.toBeNull()
  })

  it('is a 44×44 tap target whose negative margin keeps the header row at its old size', () => {
    // jsdom has no Tailwind, so this pins the classes; the geometry itself was measured on the
    // live Messages page with the same values inline: 22×22 → 44×44, same centre, row unchanged.
    useSession.mockReturnValue({ data: { user: { id: 'me' } } })
    menu('pat')
    const cls = trigger()!.className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['h-11', 'w-11', '-m-[11px]']))
    fireEvent.click(trigger()!)
    for (const label of ['Report message', 'Report Pat', 'Block Pat']) {
      expect(screen.getByText(label).closest('button')!.className.split(/\s+/)).toContain('min-h-11')
    }
  })

  it('stays when the viewer is not known yet — hiding it would drop report/block for everyone', () => {
    useSession.mockReturnValue({ data: null })
    menu('pat')
    expect(trigger()).not.toBeNull()
  })

  it('does not crash outside a SessionProvider (useSession returns undefined)', () => {
    useSession.mockReturnValue(undefined)
    menu('pat')
    expect(trigger()).not.toBeNull()
  })
})
