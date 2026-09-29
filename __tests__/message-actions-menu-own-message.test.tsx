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
