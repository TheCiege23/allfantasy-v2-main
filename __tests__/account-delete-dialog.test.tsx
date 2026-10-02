import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

/*
 * The Account tab's delete dialog is modal and behaves like it: focus enters on the confirm
 * input, Tab / Shift+Tab stay inside, Escape closes (never mid-deletion), the page does not
 * scroll behind it, and closing returns focus to "Start deletion".
 */

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ loading: false, error: null, hasAnyPaid: false, isAdminBypassAccount: false }),
}))
vi.mock('@/lib/pwa/signOutAndPurge', () => ({ signOutAndPurge: vi.fn() }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { AccountSettingsSection } from '@/app/settings/components/sections/AccountSettingsSection'

const opener = () => screen.getByTestId('settings-account-delete-open')
const input = () => screen.getByTestId('settings-account-delete-confirm-input')
const cancel = () => screen.getByTestId('settings-account-delete-cancel')
const submit = () => screen.getByTestId('settings-account-delete-submit')

function open() {
  render(<AccountSettingsSection accountCreatedAt={null} planLabel={null} />)
  opener().focus()
  fireEvent.click(opener())
}

beforeEach(() => {
  document.body.style.overflow = ''
})
afterEach(() => vi.unstubAllGlobals())

describe('Account delete dialog', () => {
  it('moves focus into the dialog and locks page scroll', () => {
    open()
    expect(document.activeElement).toBe(input())
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('keeps Tab inside the dialog in both directions', () => {
    open()
    // "Delete" is disabled until DELETE is typed, so the cycle is input <-> Cancel.
    cancel().focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(input())
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel())
  })

  it('pulls focus back in if it has escaped the dialog', () => {
    open()
    opener().focus() // behind the dialog
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(input())
  })

  it('closes on Escape, returns focus to "Start deletion" and restores scroll', () => {
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener())
    expect(document.body.style.overflow).toBe('')
  })

  it('ignores Escape and disables Cancel while the deletion is running', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never settles: stays busy
    open()
    fireEvent.change(input(), { target: { value: 'DELETE' } })
    await act(async () => {
      fireEvent.click(submit())
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((cancel() as HTMLButtonElement).disabled).toBe(true)
  })
})
