// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { SurvivorTribePicker } from '@/components/league/survivor/SurvivorTribePicker'
import { TribeCard } from '@/app/survivor/components/TribeCard'
import type { SurvivorTribeSlot } from '@/lib/survivor/survivorTribeIdentity'

afterEach(cleanup)

function Harness({ onSlots }: { onSlots: (s: SurvivorTribeSlot[]) => void }) {
  const [slots, setSlots] = useState<SurvivorTribeSlot[]>([{ catalogId: 'crab', managerCount: 6 }, { catalogId: 'shark', managerCount: 6 }])
  return <SurvivorTribePicker sport="NHL" managers={12} tribeCount={2} value={slots} onChange={next => { setSlots(next); onSlots(next) }} />
}

describe('tribe emblem placements', () => {
  it('picker: selected-tribe panel previews any sport and records colour overrides', () => {
    const onSlots = vi.fn()
    render(<Harness onSlots={onSlots} />)
    // Slot crests are composed by the route in the league sport, with accessible names.
    const slotCrest = screen.getByAltText('Kaniva tribe crest, Crab') as HTMLImageElement
    expect(slotCrest.src).toContain('/api/survivor/tribe-emblem/crest?tribe=crab&sport=nhl')
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose tribe' })[0])
    const panel = screen.getByTestId('survivor-selected-tribe')
    const preview = within(panel).getByAltText('Kaniva tribe crest, Crab') as HTMLImageElement
    expect(preview.src).toContain('sport=nhl')
    expect(within(panel).getByRole('button', { name: /NHL/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(panel).getByRole('button', { name: 'NCAAF' }))
    expect((within(panel).getByAltText('Kaniva tribe crest, Crab') as HTMLImageElement).src).toContain('sport=ncaaf')
    fireEvent.change(within(panel).getByLabelText('Primary colour'), { target: { value: '#123456' } })
    expect(onSlots).toHaveBeenLastCalledWith([{ catalogId: 'crab', managerCount: 6, primaryColor: '#123456' }, { catalogId: 'shark', managerCount: 6 }])
    expect((within(panel).getByAltText('Kaniva tribe crest, Crab') as HTMLImageElement).src).toContain('p=123456')
    fireEvent.click(within(panel).getByRole('button', { name: 'Use tribe colours' }))
    expect(onSlots).toHaveBeenLastCalledWith([{ catalogId: 'crab', managerCount: 6 }, { catalogId: 'shark', managerCount: 6 }])
  })

  it('tribe card: catalogue crest gets "<Name> tribe crest, <mascot>"; custom logos stay decorative', () => {
    render(<TribeCard tribe={{ id: 't1', name: 'Reefborn', logoUrl: '/api/survivor/tribe-emblem/crest?tribe=crab&sport=nfl&name=Reefborn&v=1', mascot: 'Crab' }} status="neutral" memberCount={4} />)
    expect(screen.getByAltText('Reefborn tribe crest, Crab')).toBeTruthy()
    cleanup()
    const { container } = render(<TribeCard tribe={{ id: 't2', name: 'Custom', logoUrl: 'https://cdn.example/x.png' }} status="neutral" memberCount={4} />)
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('')
  })
})
