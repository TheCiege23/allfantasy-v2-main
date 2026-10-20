import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
import { DraftRoomShell, type MobileDraftTab } from '@/components/app/draft-room/DraftRoomShell'
afterEach(cleanup)
function shell(onChange: (tab: MobileDraftTab) => void) {
  return render(<DraftRoomShell topBar={null} managerStrip={null} draftBoard={<div>Wide board</div>} playerPanel={<div>Players</div>} queuePanel={<div>Queue</div>} chatPanel={<div>Chat</div>} mobileTab="board" onMobileTabChange={onChange} />)
}
describe('mobile draft navigation regression', () => {
  it('keeps the board selected during horizontal board scrolling', () => {
    const onChange = vi.fn()
    const view = shell(onChange)
    const scroll = view.getByTestId('draft-mobile-board-scroll')
    fireEvent.touchStart(scroll, { touches: [{ clientX: 290, clientY: 300 }] })
    fireEvent.touchEnd(scroll, { changedTouches: [{ clientX: 110, clientY: 308 }] })
    expect(onChange).not.toHaveBeenCalled()
  })
  it('keeps explicit tab buttons working', () => {
    const onChange = vi.fn()
    const view = shell(onChange)
    fireEvent.click(view.getByTestId('draft-mobile-tab-queue'))
    expect(onChange).toHaveBeenCalledWith('queue')
  })
  it('does not change tabs for a vertical content scroll', () => {
    const onChange = vi.fn()
    const view = shell(onChange)
    const scroll = view.getByTestId('draft-mobile-board-scroll')
    fireEvent.touchStart(scroll, { touches: [{ clientX: 170, clientY: 450 }] })
    fireEvent.touchEnd(scroll, { changedTouches: [{ clientX: 175, clientY: 200 }] })
    expect(onChange).not.toHaveBeenCalled()
  })
})
