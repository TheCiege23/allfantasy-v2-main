/**
 * Commissioner Import Attestation UI phase — Part 2 shared component tests.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommissionerAttestationPanel } from '@/components/unified-import-ui/CommissionerAttestationPanel'

function renderPanel(overrides: Partial<Parameters<typeof CommissionerAttestationPanel>[0]> = {}) {
  const onAcceptedChange = vi.fn()
  const onStatementChange = vi.fn()
  render(
    <CommissionerAttestationPanel
      provider="mfl"
      leagueName="Dynasty Warriors"
      externalLeagueId="2026:12345"
      accepted={false}
      onAcceptedChange={onAcceptedChange}
      statement=""
      onStatementChange={onStatementChange}
      {...overrides}
    />
  )
  return { onAcceptedChange, onStatementChange }
}

describe('CommissionerAttestationPanel', () => {
  it('renders unchecked by default', () => {
    renderPanel()
    const checkbox = screen.getByTestId('commissioner-attestation-checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('renders checked when accepted=true', () => {
    renderPanel({ accepted: true })
    const checkbox = screen.getByTestId('commissioner-attestation-checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('calls onAcceptedChange(true) when the checkbox is checked', () => {
    const { onAcceptedChange } = renderPanel()
    const checkbox = screen.getByTestId('commissioner-attestation-checkbox')
    fireEvent.click(checkbox)
    expect(onAcceptedChange).toHaveBeenCalledWith(true)
  })

  it('displays the provider label, league name, and external league id', () => {
    renderPanel({ provider: 'espn', leagueName: 'The League', externalLeagueId: '899513' })
    expect(screen.getByText('ESPN')).toBeInTheDocument()
    expect(screen.getByText('The League')).toBeInTheDocument()
    expect(screen.getByText('899513')).toBeInTheDocument()
  })

  it('contains the required substantially-equivalent confirmation language', () => {
    renderPanel()
    expect(
      screen.getByText(/I confirm that I am the commissioner or have explicit authorization/i)
    ).toBeInTheDocument()
  })

  it('discloses that the provider did not independently verify commissioner authority', () => {
    renderPanel({ provider: 'yahoo' })
    expect(screen.getByText(/did not independently verify commissioner authority/i)).toBeInTheDocument()
  })

  it('discloses the attestation applies only to this specific league and provider', () => {
    renderPanel()
    expect(screen.getByText(/applies only to this specific league and provider/i)).toBeInTheDocument()
  })

  it('discloses that false or unauthorized imports may be removed or restricted', () => {
    renderPanel()
    expect(screen.getByText(/may be removed or restricted/i)).toBeInTheDocument()
  })

  it('never claims the provider verified commissioner status', () => {
    renderPanel({ provider: 'mfl' })
    expect(screen.queryByText(/commissioner verified by mfl/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^MFL verified/i)).not.toBeInTheDocument()
  })

  it('the checkbox has an accessible label via htmlFor/id association', () => {
    renderPanel()
    // getByLabelText only succeeds if the <label htmlFor> correctly targets the checkbox's id.
    const checkbox = screen.getByLabelText(/I confirm that I am the commissioner/i)
    expect(checkbox).toHaveAttribute('data-testid', 'commissioner-attestation-checkbox')
  })

  it('the checkbox is aria-describedby the disclosure copy', () => {
    renderPanel()
    const checkbox = screen.getByTestId('commissioner-attestation-checkbox')
    const describedBy = checkbox.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).not.toBeNull()
  })

  it('disables the checkbox when disabled=true', () => {
    renderPanel({ disabled: true })
    const checkbox = screen.getByTestId('commissioner-attestation-checkbox') as HTMLInputElement
    expect(checkbox.disabled).toBe(true)
  })

  it('calls onStatementChange when the optional note is edited', () => {
    const { onStatementChange } = renderPanel()
    const textarea = screen.getByPlaceholderText(/co-commissioner/i)
    fireEvent.change(textarea, { target: { value: 'I manage this league for my brother.' } })
    expect(onStatementChange).toHaveBeenCalledWith('I manage this league for my brother.')
  })

  it('omits the AllFantasy-verified-membership line when membershipVerified=false', () => {
    renderPanel({ membershipVerified: false })
    expect(screen.queryByText(/AllFantasy has verified your account is a member/i)).not.toBeInTheDocument()
  })
})
