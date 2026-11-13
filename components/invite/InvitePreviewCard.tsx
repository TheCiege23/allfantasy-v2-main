'use client'

import Link from 'next/link'

interface InvitePreviewCardProps {
  title: string
  description?: string | null
  targetName?: string | null
  sport?: string | null
  memberCount?: number | null
  maxMembers?: number | null
  isFull?: boolean
  expired?: boolean
  expiresAt?: string | null
  status: string
  statusReason?: string | null
  acceptUrl?: string
  inviteType?: string
  destinationHref?: string | null
  destinationLabel?: string | null
  createdByLabel?: string | null
  acceptLabel?: string
  acceptDisabled?: boolean
  onAccept?: (() => void) | null
}

function canAccept(status: string, expired?: boolean, isFull?: boolean) {
  return !expired && !isFull && !['invalid', 'already_member', 'already_redeemed', 'max_used'].includes(status)
}

export function InvitePreviewCard({
  title,
  description,
  targetName,
  sport,
  memberCount,
  maxMembers,
  isFull,
  expired,
  expiresAt,
  status,
  statusReason,
  acceptUrl,
  inviteType,
  destinationHref,
  destinationLabel,
  createdByLabel,
  acceptLabel = 'Accept invite',
  acceptDisabled = false,
  onAccept,
}: InvitePreviewCardProps) {
  const acceptEnabled = canAccept(status, expired, isFull)

  return (
    <div
      data-testid="invite-preview-card"
      className="rounded-2xl border p-5"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 60%, transparent)' }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {inviteType && (
          <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            {inviteType.replace(/_/g, ' ')}
          </span>
        )}
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--text)' }}>
          {status.replace(/_/g, ' ')}
        </span>
      </div>

      <h2 className="mb-1 text-lg font-bold" style={{ color: 'var(--text)' }}>
        {title}
      </h2>

      {targetName && (
        <p className="mb-1 text-sm" style={{ color: 'var(--muted)' }}>
          {targetName}
          {sport ? ` - ${sport}` : ''}
        </p>
      )}

      {createdByLabel && (
        <p className="mb-2 text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Shared by {createdByLabel}
        </p>
      )}

      {description && (
        <p className="mb-2 text-sm" style={{ color: 'var(--muted)' }}>
          {description}
        </p>
      )}

      {memberCount != null && maxMembers != null && (
        <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
          {memberCount} / {maxMembers} members
        </p>
      )}

      {expiresAt && (
        <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
          Expires {new Date(expiresAt).toLocaleString()}
        </p>
      )}

      {statusReason && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-sm"
          style={{
            color: status === 'valid' ? 'var(--text)' : 'var(--destructive)',
            background:
              status === 'valid'
                ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                : 'color-mix(in srgb, var(--destructive) 12%, transparent)',
          }}
        >
          {statusReason}
        </p>
      )}

      {acceptEnabled && onAccept && (
        <button
          type="button"
          onClick={onAccept}
          disabled={acceptDisabled}
          data-testid="invite-accept-button"
          className="inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          {acceptLabel}
        </button>
      )}

      {acceptEnabled && !onAccept && acceptUrl && (
        <Link
          href={acceptUrl}
          data-testid="invite-accept-link"
          className="inline-block rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          {acceptLabel}
        </Link>
      )}

      {!acceptEnabled && destinationHref && destinationLabel && (
        <Link
          href={destinationHref}
          data-testid="invite-destination-link"
          className="inline-flex rounded-xl border px-4 py-2.5 text-sm font-semibold"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          {destinationLabel}
        </Link>
      )}

      {status === 'invalid' && !destinationHref && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Invalid invite link.
        </p>
      )}
    </div>
  )
}
