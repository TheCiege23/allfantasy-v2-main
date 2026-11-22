// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartnerInquiryForm } from '@/components/partners/PartnerInquiryForm'

/** The /partners contact form's client half: "Sent." only on a server ok, and nothing typed is lost on failure. */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => {
  cleanup()
  fetchMock.mockReset()
})

function fill() {
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Pat Lee' } })
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'pat@acme.io' } })
  fireEvent.change(screen.getByLabelText('Company or platform'), { target: { value: 'Acme Fantasy' } })
  fireEvent.change(screen.getByLabelText(/What would you like to see/), { target: { value: 'Our 4,000 leagues' } })
}

describe('PartnerInquiryForm', () => {
  it('posts JSON (honeypot included, empty) and shows "Sent." on success', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, message: "Thanks — we've got it." }), { status: 200 }))
    render(<PartnerInquiryForm />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sent.'))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/partners/inquiry')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Pat Lee', email: 'pat@acme.io', company: 'Acme Fantasy', message: 'Our 4,000 leagues', fax: '' })
  })

  it('🛑 a failed send shows the fallback address and keeps every field', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, message: "We couldn't send that just now. Email support@allfantasy.ai instead." }), { status: 503 }))
    render(<PartnerInquiryForm />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('support@allfantasy.ai'))
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByLabelText(/What would you like to see/) as HTMLTextAreaElement).value).toBe('Our 4,000 leagues')
  })

  it('field errors are tied to their inputs', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, message: 'Check the highlighted fields.', errors: { email: 'Check the email address.' } }), { status: 400 }))
    render(<PartnerInquiryForm />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const email = screen.getByLabelText('Work email')
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'))
    expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent).toBe('Check the email address.')
  })

  it('a network failure is a failure, not a silent nothing', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<PartnerInquiryForm />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('your message is still here to copy'))
  })
})
