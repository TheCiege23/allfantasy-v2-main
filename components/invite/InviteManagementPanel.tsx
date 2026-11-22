'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, ExternalLink, Trash2 } from 'lucide-react'
import { useUserTimezone } from '@/hooks/useUserTimezone'

interface InviteRow {
  id: string
  type: string
  token: string
  targetId: string | null
  status: string
  useCount: number
  maxUses: number
  expiresAt: string | null
  createdAt: string
  inviteUrl: string
  destinationHref: string | null
  destinationLabel: string | null
  viewCount: number
  shareCount: number
  acceptedCount: number
}

interface InviteManagementPanelProps {
  type?: string
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  return false
}

const InviteManagementPanel = ({ type }: InviteManagementPanelProps) => {
  const { formatDateInTimezone } = useUserTimezone()
  const [links, setLinks] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchLinks = useCallback(() => {
    setLoading(true)
    const query = type ? `?type=${encodeURIComponent(type)}` : ''
    fetch(`/api/invite/list${query}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.links)) setLinks(data.links)
        else setLinks([])
      })
      .catch(() => setLinks([]))
      .finally(() => setLoading(false))
  }, [type])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

  const copyUrl = async (row: InviteRow) => {
    const copied = await copyToClipboard(row.inviteUrl)
    if (!copied) return
    setCopiedId(row.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const revoke = (id: string) => {
    if (!confirm('Revoke this invite link? It will no longer work.')) return
    fetch('/api/invite/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteLinkId: id }),
    }).then(() => fetchLinks())
  }

  if (loading) {
    return (
      <div className="rounded-xl border p-6 text-center" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Loading...
        </p>
      </div>
    )
  }

  if (links.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No invite links yet. Create one from a league, bracket, creator league, or your referral dashboard.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {links.map((row) => (
        <div
          key={row.id}
          className="rounded-2xl border p-4"
          style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 40%, transparent)' }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  {row.type.replace(/_/g, ' ')}
                </span>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--text)' }}>
                  {row.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                Created {formatDateInTimezone(row.createdAt)}
                {row.expiresAt ? ` - Expires ${formatDateInTimezone(row.expiresAt)}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyUrl(row)}
                data-testid={`invite-management-copy-${row.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <Copy className="h-4 w-4" />
                {copiedId === row.id ? 'Copied' : 'Copy link'}
              </button>

              <Link
                href={`/invite/accept?code=${encodeURIComponent(row.token)}`}
                data-testid={`invite-management-preview-${row.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <ExternalLink className="h-4 w-4" />
                Preview
              </Link>

              {row.destinationHref && row.destinationLabel && (
                <Link
                  href={row.destinationHref}
                  data-testid={`invite-management-open-${row.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  <ExternalLink className="h-4 w-4" />
                  {row.destinationLabel}
                </Link>
              )}

              {row.status === 'active' && (
                <button
                  type="button"
                  onClick={() => revoke(row.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ color: 'var(--destructive)', borderColor: 'var(--destructive)' }}
                >
                  <Trash2 className="h-4 w-4" />
                  Revoke
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Uses
              </p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {row.useCount}
                {row.maxUses > 0 ? ` / ${row.maxUses}` : ''}
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Views
              </p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {row.viewCount}
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Shares
              </p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {row.shareCount}
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Accepted
              </p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {row.acceptedCount}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default InviteManagementPanel;
