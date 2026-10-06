import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import TermsOfServiceBody from '@/components/legal/documents/TermsOfServiceBody'
import PrivacyPolicyBody from '@/components/legal/documents/PrivacyPolicyBody'
import SmsTermsBody from '@/components/legal/documents/SmsTermsBody'
import CopyrightPolicyBody from '@/components/legal/documents/CopyrightPolicyBody'
import FantasySportsNoticeBody from '@/components/legal/documents/FantasySportsNoticeBody'
import { SMS_CONSENT_TEXT } from '@/lib/legal/smsProgram'
import { LEGAL_LAST_UPDATED_BY_PAGE } from '@/lib/legal/legalVersions'

afterEach(cleanup)

/*
 * The 2026-10 legal documents were generated from the owner's drafts, which carried 86
 * "[CONFIRM: …]" placeholders. These tests pin what the rest of the product relies on.
 */

const DOCUMENTS = {
  terms: TermsOfServiceBody,
  privacy: PrivacyPolicyBody,
  sms: SmsTermsBody,
  copyright: CopyrightPolicyBody,
  notice: FantasySportsNoticeBody,
} as const

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ')

describe('2026-10 legal documents', () => {
  it.each(Object.entries(DOCUMENTS))('%s ships no drafting placeholder', (_name, Body) => {
    const { container } = render(<Body />)
    expect(text(container)).not.toMatch(/\[CONFIRM|Option A:|Option B:/)
  })

  it.each(Object.entries(DOCUMENTS))('%s: every in-page section link lands on an anchor', (_name, Body) => {
    const { container } = render(<Body />)
    const ids = new Set(Array.from(container.querySelectorAll('[id]')).map((el) => el.id))
    const targets = Array.from(container.querySelectorAll('a[href^="#"]')).map((a) => a.getAttribute('href')!.slice(1))
    // The SMS Terms and the State Notice cross-reference no sections of their own.
    if (_name === 'terms' || _name === 'privacy' || _name === 'copyright') expect(targets.length).toBeGreaterThan(0)
    expect(targets.filter((t) => !ids.has(t))).toEqual([])
  })

  it('the SMS Terms quote the consent wording that is recorded with each opt-in, word for word', () => {
    const { container } = render(<SmsTermsBody />)
    expect(text(container)).toContain(`"${SMS_CONSENT_TEXT}"`)
  })

  /*
   * The consent checkbox links to /terms#sms-terms and /privacy#sms-communications, the
   * A2P 10DLC campaign points carrier reviewers at them, and #sms-opt-in shows the form.
   */
  it('keeps the anchors the SMS consent box and carrier review link to', () => {
    const privacy = render(<PrivacyPolicyBody />).container
    expect(privacy.querySelector('#sms-communications')?.textContent).toMatch(/Text messages/)
    cleanup()
    const sms = render(<SmsTermsBody />).container
    expect(sms.querySelector('#sms-opt-in')?.textContent).toMatch(/How you opt in/)
  })

  it('SMS Terms anchors cannot collide with the Terms they are embedded in', () => {
    const terms = new Set(Array.from(render(<TermsOfServiceBody />).container.querySelectorAll('[id]')).map((e) => e.id))
    cleanup()
    const sms = Array.from(render(<SmsTermsBody />).container.querySelectorAll('[id]')).map((e) => e.id)
    expect(sms.filter((id) => terms.has(id))).toEqual([])
  })

  it('all five documents share one version stamp, which acceptances are recorded against', () => {
    const { terms, privacy, disclaimer, smsTerms, copyright } = LEGAL_LAST_UPDATED_BY_PAGE
    expect(new Set([terms, privacy, disclaimer, smsTerms, copyright]).size).toBe(1)
  })
})
