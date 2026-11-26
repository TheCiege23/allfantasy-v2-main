// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImportLeagueTypePicker, IMPORT_LEAGUE_TYPE_OPTIONS } from '@/components/import/ImportLeagueTypePicker'

afterEach(cleanup)

describe('ImportLeagueTypePicker', () => {
  it('starts on the detected type and sends nothing until the commissioner picks', () => {
    const onChange = vi.fn()
    render(<ImportLeagueTypePicker detectedId="dynasty" detectedLabel="Dynasty" value={null} onChange={onChange} />)
    const select = screen.getByLabelText('League type') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(select.options[0]!.textContent).toBe('Detected: Dynasty')
    // The detected type is not listed twice.
    expect([...select.options].filter((o) => o.textContent === 'Dynasty')).toHaveLength(0)

    fireEvent.change(select, { target: { value: 'c2c' } })
    expect(onChange).toHaveBeenLastCalledWith('c2c')
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('offers devy and Campus to Canton, and not Pirate (it needs a second answer)', () => {
    const ids = IMPORT_LEAGUE_TYPE_OPTIONS.map((o) => o.id)
    expect(ids).toContain('devy')
    expect(ids).toContain('c2c')
    expect(ids).not.toContain('pirate')
  })
})
