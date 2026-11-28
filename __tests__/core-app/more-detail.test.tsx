import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { MoreDetail } from '@/components/core-app/MoreDetail'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

describe('<MoreDetail />', () => {
  it('always says "More detail", with the note beside it, closed by default', () => {
    render(<MoreDetail note="Record book" testId="x"><p>inside</p></MoreDetail>)
    const fold = screen.getByTestId('x')
    expect(fold.tagName).toBe('DETAILS')
    expect(fold).not.toHaveAttribute('open')
    expect(screen.getByText('More detail')).toBeInTheDocument()
    expect(screen.getByText('Record book')).toBeInTheDocument()
    expect(screen.getByText('inside')).toBeInTheDocument()
  })
  it('keeps the page’s own class and honours open', () => {
    render(<MoreDetail className="af-old-fold" testId="y" open><p>x</p></MoreDetail>)
    expect(screen.getByTestId('y')).toHaveClass('af-more-detail', 'af-old-fold')
    expect(screen.getByTestId('y')).toHaveAttribute('open')
  })
  it('speaks Spanish', () => {
    lang.language = 'es'
    render(<MoreDetail><p>x</p></MoreDetail>)
    expect(screen.getByText('Más detalle')).toBeInTheDocument()
  })
})
