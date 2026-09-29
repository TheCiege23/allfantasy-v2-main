'use client'

import { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'

type AuditEntry = {
  id: string
  category: string
  action: string
  description: string
  actorUserId: string | null
  actorRole: string | null
  targetUserId: string | null
  targetStatus: string | null
  previousState: unknown
  newState: unknown
  amount: number | null
  week: number | null
  isPublic: boolean
  isVisibleToAffectedUser: boolean
  createdAt: string
}

const CATEGORY_ICONS: Record<string, string> = {
  commissioner_override: '⚙️',
  infection: '🧟',
  revive: '⚡',
  serum_award: '🧪',
  serum_use: '🧪',
  weapon_award: '⚔️',
  weapon_use: '⚔️',
  weapon_transfer: '⚔️',
  ambush_use: '🎭',
  weekly_winnings: '💰',
  item_acquisition: '🎒',
  whisperer_selected: '🎭',
  movement_projection: '🌍',
  stat_correction_reversal: '📊',
  dangerous_drop_flag: '⚠️',
  collusion_flag: '🚩',
  owner_replacement: '🔄',
  rules_doc_generated: '📜',
  bomb_use: '💣',
  bashing: '🔥',
  mauling: '💀',
}

const CATEGORY_COLORS: Record<string, string> = {
  commissioner_override: 'border-l-amber-500',
  infection: 'border-l-[var(--zombie-purple)]',
  revive: 'border-l-[var(--zombie-gold)]',
  serum_award: 'border-l-teal-500',
  serum_use: 'border-l-teal-500',
  weapon_award: 'border-l-white/30',
  weapon_use: 'border-l-white/30',
  ambush_use: 'border-l-[var(--zombie-crimson)]',
  weekly_winnings: 'border-l-green-500',
  collusion_flag: 'border-l-red-500',
  dangerous_drop_flag: 'border-l-amber-400',
  bashing: 'border-l-orange-500',
  mauling: 'border-l-[var(--zombie-red)]',
}

export function ZombieAuditLogPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'admin'>('all')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/zombie/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=audit`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { entries?: AuditEntry[] } | null) => {
        if (d?.entries) setEntries(d.entries)
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [leagueId])

  const categories = useMemo(() => {
    const set = new Set(entries.map((e) => e.category))
    return [...set].sort()
  }, [entries])

  const filtered = useMemo(() => {
    let list = entries
    if (filter.trim()) {
      const q = filter.toLowerCase()
      list = list.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          (e.actorUserId ?? '').toLowerCase().includes(q) ||
          (e.targetUserId ?? '').toLowerCase().includes(q),
      )
    }
    if (categoryFilter) list = list.filter((e) => e.category === categoryFilter)
    if (visibilityFilter === 'public') list = list.filter((e) => e.isPublic)
    if (visibilityFilter === 'admin') list = list.filter((e) => !e.isPublic)
    return list
  }, [entries, filter, categoryFilter, visibilityFilter])

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center px-6 py-6">
        <p className="text-[12px] text-[var(--zombie-text-dim)]">Loading audit log...</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-5 text-[13px] text-white/85">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search logs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="min-w-[180px] flex-1 rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-3 py-2 text-[12px] text-white placeholder:text-[var(--zombie-text-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--zombie-crimson)]"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-3 py-2 text-[12px] text-white focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <div className="flex gap-1">
          {(['all', 'public', 'admin'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVisibilityFilter(v)}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize transition',
                visibilityFilter === v
                  ? 'bg-[var(--zombie-crimson)]/20 text-[var(--zombie-crimson)]'
                  : 'text-[var(--zombie-text-dim)] hover:bg-white/[0.04]',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-[11px] text-[var(--zombie-text-dim)]">
        {filtered.length} entries {filter || categoryFilter ? '(filtered)' : ''} · Total: {entries.length}
      </p>

      <div className="space-y-1.5">
        {filtered.slice(0, 100).map((e) => (
          <AuditRow key={e.id} entry={e} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-[12px] text-[var(--zombie-text-dim)]">
          No audit entries match your filters.
        </p>
      )}

      {filtered.length > 100 && (
        <p className="mt-4 text-center text-[11px] text-[var(--zombie-text-dim)]">
          Showing first 100 of {filtered.length} entries
        </p>
      )}
    </div>
  )
}

function AuditRow({ entry: e }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  const icon = CATEGORY_ICONS[e.category] ?? '📋'
  const borderColor = CATEGORY_COLORS[e.category] ?? 'border-l-white/15'
  const hasStateChange = e.previousState != null || e.newState != null

  return (
    <div
      className={clsx(
        'rounded-lg border border-[var(--zombie-border)] bg-[var(--zombie-panel)] border-l-4 transition-colors',
        borderColor,
        expanded ? 'bg-white/[0.02]' : '',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[var(--zombie-text-full)]">
              {e.action.replace(/_/g, ' ')}
            </span>
            {!e.isPublic && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">
                ADMIN
              </span>
            )}
            {e.actorRole === 'commissioner' && (
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-bold text-sky-300">
                COMMISH
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--zombie-text-mid)] line-clamp-1">{e.description}</p>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--zombie-text-dim)]">
          {new Date(e.createdAt).toLocaleDateString()}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.04] px-3 py-2.5 text-[11px]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[var(--zombie-text-dim)]">Category:</span>{' '}
              <span className="text-white/80">{e.category.replace(/_/g, ' ')}</span>
            </div>
            <div>
              <span className="text-[var(--zombie-text-dim)]">Time:</span>{' '}
              <span className="text-white/80">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
            {e.actorUserId && (
              <div>
                <span className="text-[var(--zombie-text-dim)]">Actor:</span>{' '}
                <span className="text-white/80">{e.actorUserId}</span>
              </div>
            )}
            {e.targetUserId && (
              <div>
                <span className="text-[var(--zombie-text-dim)]">Target:</span>{' '}
                <span className="text-white/80">{e.targetUserId}</span>
              </div>
            )}
            {e.amount != null && (
              <div>
                <span className="text-[var(--zombie-text-dim)]">Amount:</span>{' '}
                <span className="text-white/80">{e.amount}</span>
              </div>
            )}
            {e.week != null && (
              <div>
                <span className="text-[var(--zombie-text-dim)]">Week:</span>{' '}
                <span className="text-white/80">{e.week}</span>
              </div>
            )}
          </div>
          {hasStateChange && (
            <div className="mt-2">
              {e.previousState != null && (
                <p className="text-[var(--zombie-text-dim)]">
                  Previous: <code className="text-[11px] text-white/60">{JSON.stringify(e.previousState)}</code>
                </p>
              )}
              {e.newState != null && (
                <p className="text-[var(--zombie-text-dim)]">
                  New: <code className="text-[11px] text-white/60">{JSON.stringify(e.newState)}</code>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
