import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { copyText } from '@/lib/clipboard/copyText'

/*
 * The referral copy buttons used only navigator.clipboard, which is missing outside a secure
 * context and refused by in-app browsers — exactly where invite links get opened — and on failure
 * they did nothing. copyText now falls back to the legacy copy command, and the UIs show a manual
 * route when both mechanisms fail.
 */

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { ReferralShareBar } from '@/components/referral/ReferralShareBar'
import { ReferralSection } from '@/components/settings/ReferralSection'

let execCommand: ReturnType<typeof vi.fn>

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

beforeEach(() => {
  execCommand = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
})

afterEach(() => {
  setClipboard(undefined)
  vi.unstubAllGlobals()
})

describe('copyText', () => {
  it('uses the async clipboard when it works, without touching the legacy path', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText })
    expect(await copyText('GUAP42')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('GUAP42')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('falls back to the copy command when the clipboard API is missing (insecure context)', async () => {
    setClipboard(undefined)
    expect(await copyText('GUAP42')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelectorAll('textarea').length).toBe(0) // temporary node removed
  })

  it('falls back when the clipboard API refuses (in-app browser) and restores focus', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) })
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    expect(await copyText('GUAP42')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.activeElement).toBe(button)
    button.remove()
  })

  it('reports false only when both mechanisms fail', async () => {
    setClipboard(undefined)
    execCommand.mockReturnValue(false)
    expect(await copyText('GUAP42')).toBe(false)
  })
})

describe('when copying fails completely', () => {
  beforeEach(() => {
    setClipboard(undefined)
    execCommand.mockReturnValue(false)
  })

  it('the share bar shows the link to copy by hand instead of doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    render(<ReferralShareBar referralLink="https://allfantasy.ai/r/GUAP42" />)
    fireEvent.click(screen.getByTestId('referral-share-copy_link'))
    const fallback = await screen.findByTestId('referral-share-copy-fallback')
    expect(fallback.textContent).toContain('https://allfantasy.ai/r/GUAP42')
  })

  it('the referral code field is selected with a message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new Response(JSON.stringify(url.includes('/link') ? { code: 'GUAP42', link: 'https://allfantasy.ai/r/GUAP42' } : {})),
      ),
    )
    render(<ReferralSection />)
    fireEvent.click(await screen.findByTestId('referral-copy-code'))
    const field = (await screen.findByLabelText('Your referral code')) as HTMLInputElement
    await screen.findByText(/couldn't copy automatically/i)
    expect(document.activeElement).toBe(field)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'GUAP42'.length])
  })
})
