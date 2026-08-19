'use client'

/**
 * Commissioner Import Attestation UI phase — the single shared attestation
 * component for every provider that requires it (MFL, ESPN, Yahoo today —
 * driven by `providerRequiresCommissionerAttestation`, never hard-coded
 * here). Renders identically regardless of provider; only the displayed
 * provider label and league identifiers change.
 *
 * This component owns no submission logic and persists nothing itself —
 * `accepted`/`statement` are fully controlled by the parent (`LeagueImportFlow`),
 * which is what makes "refreshing must not silently preserve an unsubmitted
 * attestation" true: the parent's state is plain `useState`, never written to
 * `localStorage`/`sessionStorage`, so a reload always starts unchecked.
 */
import { useId } from 'react'
import type { ImportProvider } from '@/lib/league-import/types'

const PROVIDER_DISPLAY_LABEL: Record<string, string> = {
  mfl: 'MFL',
  espn: 'ESPN',
  yahoo: 'Yahoo',
}

export interface CommissionerAttestationPanelProps {
  provider: ImportProvider
  leagueName: string
  /** The raw source league id/key as typed by the user — never a secret (API keys/tokens are never displayed here). */
  externalLeagueId: string
  accepted: boolean
  onAcceptedChange: (accepted: boolean) => void
  statement: string
  onStatementChange: (statement: string) => void
  disabled?: boolean
  /** Real, server-verified fact: this account's membership in the league was already confirmed before this panel renders. */
  membershipVerified?: boolean
}

export function CommissionerAttestationPanel({
  provider,
  leagueName,
  externalLeagueId,
  accepted,
  onAcceptedChange,
  statement,
  onStatementChange,
  disabled = false,
  membershipVerified = true,
}: CommissionerAttestationPanelProps) {
  const checkboxId = useId()
  const statementId = useId()
  const descriptionId = useId()

  const providerLabel = PROVIDER_DISPLAY_LABEL[provider] ?? provider

  return (
    <div
      className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4"
      data-testid="commissioner-attestation-panel"
    >
      <p className="text-sm font-semibold text-amber-200">Confirm commissioner authorization</p>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] text-white/60 sm:grid-cols-3">
        <div>
          <dt className="text-white/40">Provider</dt>
          <dd className="text-white/85">{providerLabel}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-white/40">League</dt>
          <dd className="truncate text-white/85" title={leagueName}>
            {leagueName}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-white/40">External league ID</dt>
          <dd className="truncate text-white/85" title={externalLeagueId}>
            {externalLeagueId}
          </dd>
        </div>
      </dl>

      <div id={descriptionId} className="mt-3 space-y-1.5 text-[12px] leading-5 text-white/60">
        {membershipVerified ? (
          <p>AllFantasy has verified your account is a member of this {providerLabel} league.</p>
        ) : null}
        <p>{providerLabel} did not independently verify commissioner authority — only membership.</p>
        <p>This confirmation applies only to this specific league and provider, not to any other league.</p>
        <p>False or unauthorized imports may be removed or restricted.</p>
        <p>Only import leagues you are authorized to manage.</p>
      </div>

      {/* Part 10 — min 44px tap target: the label wraps the checkbox and its
          own padding, so the whole row (not just the 18px box) is tappable,
          without visually enlarging the checkbox itself. */}
      <label
        htmlFor={checkboxId}
        className="mt-4 flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg py-2.5"
      >
        <input
          id={checkboxId}
          type="checkbox"
          checked={accepted}
          disabled={disabled}
          onChange={(e) => onAcceptedChange(e.target.checked)}
          aria-describedby={descriptionId}
          className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-white/30 bg-black/30 text-amber-400 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-50"
          data-testid="commissioner-attestation-checkbox"
        />
        <span className="text-[13px] leading-5 text-white/85">
          I confirm that I am the commissioner or have explicit authorization from the commissioner to
          import and manage this full league in AllFantasy.
        </span>
      </label>

      <div className="mt-3">
        <label htmlFor={statementId} className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
          Authorization note (optional)
        </label>
        <textarea
          id={statementId}
          value={statement}
          disabled={disabled}
          onChange={(e) => onStatementChange(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. I'm the co-commissioner and manage imports for our league."
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[13px] text-white placeholder:text-white/25 focus:border-amber-400/50 focus:outline-none focus:ring-1 focus:ring-amber-400/30 disabled:opacity-50"
        />
      </div>
    </div>
  )
}
