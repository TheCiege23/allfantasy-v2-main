'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'

type TeamRow = {
  rosterId: string
  status: string
  displayName: string | null
  fantasyTeamName: string | null
  wins: number
  losses: number
  totalWinnings: number | null
}

const OVERRIDE_ACTIONS = [
  {
    id: 'override_status',
    label: 'Override Player Status',
    description: 'Force-change a player from Survivor to Zombie or vice versa. Requires reason.',
    icon: '🧟',
    destructive: true,
  },
  {
    id: 'override_winnings',
    label: 'Adjust Winnings',
    description: 'Add or subtract from a player\'s winnings/points balance.',
    icon: '💰',
    destructive: false,
  },
  {
    id: 'award_item',
    label: 'Award Item',
    description: 'Give a player a serum, weapon, or other item manually.',
    icon: '🎒',
    destructive: false,
  },
  {
    id: 'pause_league',
    label: 'Pause League',
    description: 'Temporarily pause all automation. Scoring continues but no infections process.',
    icon: '⏸️',
    destructive: true,
  },
  {
    id: 'generate_rules_doc',
    label: 'Regenerate Rules Doc',
    description: 'Rebuild the rules document from current settings and sport template.',
    icon: '📜',
    destructive: false,
  },
]

const STATUSES = ['Survivor', 'Zombie', 'Whisperer', 'Revived', 'Eliminated']
const ITEM_TYPES = [
  { value: 'serum_antidote', label: '🧪 Serum Antidote' },
  { value: 'weapon_knife', label: '🔪 Knife' },
  { value: 'weapon_axe', label: '🪓 Axe' },
  { value: 'weapon_bow', label: '🏹 Bow' },
  { value: 'weapon_gun', label: '🔫 Gun' },
  { value: 'weapon_bomb', label: '💣 Bomb' },
]

export function ZombieOverridePanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState('')
  const [newStatus, setNewStatus] = useState('Survivor')
  const [amount, setAmount] = useState('0')
  const [itemType, setItemType] = useState('serum_antidote')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { league?: { teams?: TeamRow[] } } | null) => {
        if (d?.league?.teams) setTeams(d.league.teams)
      })
      .catch(() => null)
  }, [leagueId])

  async function executeAction() {
    if (!selectedAction) return
    setStatus('Processing...')
    setConfirmOpen(false)

    const payload: Record<string, unknown> = {
      leagueId,
      action: selectedAction,
      reason: reason.trim() || 'Commissioner override',
    }

    if (selectedAction === 'override_status') {
      payload.userId = selectedUser
      payload.newStatus = newStatus
    } else if (selectedAction === 'override_winnings') {
      payload.userId = selectedUser
      payload.adjustmentAmount = parseFloat(amount)
    } else if (selectedAction === 'award_item') {
      payload.userId = selectedUser
      payload.itemType = itemType
    }

    const r = await fetch('/api/zombie/commissioner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })

    if (r.ok) {
      setStatus('Action completed successfully. Audit log updated.')
      setSelectedAction(null)
      setReason('')
    } else {
      const j = await r.json().catch(() => ({ error: 'Request failed' }))
      setStatus(`Error: ${(j as { error?: string }).error ?? 'Unknown error'}`)
    }
    setTimeout(() => setStatus(''), 5000)
  }

  const d = !canEdit
  const actionDef = OVERRIDE_ACTIONS.find((a) => a.id === selectedAction)
  const needsUser = ['override_status', 'override_winnings', 'award_item'].includes(selectedAction ?? '')

  return (
    <div className="px-6 py-5 text-[13px] text-white/85">
      {/* Info banner */}
      <div className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
        <p className="text-[12px] font-semibold text-amber-200">Commissioner Overrides</p>
        <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
          All overrides are permanently logged in the audit trail. Players affected will be notified.
          Some overrides cannot be reversed without a second override.
        </p>
      </div>

      {/* Action cards */}
      <div className="space-y-2">
        {OVERRIDE_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={d}
            onClick={() => {
              setSelectedAction(selectedAction === action.id ? null : action.id)
              setStatus('')
            }}
            className={clsx(
              'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-40',
              selectedAction === action.id
                ? 'border-[var(--zombie-crimson)]/40 bg-[var(--zombie-crimson)]/[0.06]'
                : 'border-[var(--zombie-border)] bg-[var(--zombie-panel)] hover:bg-white/[0.02]',
            )}
          >
            <span className="text-xl">{action.icon}</span>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-[var(--zombie-text-full)]">{action.label}</p>
              <p className="text-[11px] text-[var(--zombie-text-mid)]">{action.description}</p>
            </div>
            {action.destructive && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-bold text-red-300">
                DESTRUCTIVE
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Action form */}
      {selectedAction && (
        <div className="mt-5 rounded-xl border border-[var(--zombie-border)] bg-black/30 p-5">
          <p className="mb-3 text-[13px] font-bold text-[var(--zombie-text-full)]">
            {actionDef?.icon} {actionDef?.label}
          </p>

          {needsUser && (
            <div className="mb-3">
              <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">Target player</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full rounded-lg border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-3 py-2 text-[12px] text-white focus:outline-none"
              >
                <option value="">Select player...</option>
                {teams.map((t) => (
                  <option key={t.rosterId} value={t.rosterId}>
                    {t.fantasyTeamName || t.displayName || t.rosterId} — {t.status} ({t.wins}-{t.losses})
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedAction === 'override_status' && (
            <div className="mb-3">
              <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">New status</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="w-full rounded-lg border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-3 py-2 text-[12px] text-white focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          {selectedAction === 'override_winnings' && (
            <div className="mb-3">
              <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">
                Adjustment amount (positive = add, negative = subtract)
              </label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-3 py-2 text-[12px] text-white focus:outline-none"
              />
            </div>
          )}

          {selectedAction === 'award_item' && (
            <div className="mb-3">
              <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">Item type</label>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value)}
                className="w-full rounded-lg border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-3 py-2 text-[12px] text-white focus:outline-none"
              >
                {ITEM_TYPES.map((it) => (
                  <option key={it.value} value={it.value}>{it.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">
              Reason (required for audit trail)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this override is being applied..."
              rows={2}
              className="w-full rounded-lg border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-3 py-2 text-[12px] text-white placeholder:text-[var(--zombie-text-dim)] focus:outline-none"
            />
          </div>

          {!confirmOpen ? (
            <button
              type="button"
              disabled={d || (needsUser && !selectedUser) || !reason.trim()}
              onClick={() => actionDef?.destructive ? setConfirmOpen(true) : void executeAction()}
              className="rounded-lg bg-[var(--zombie-crimson)]/20 px-5 py-2 text-[12px] font-semibold text-[var(--zombie-crimson)] transition hover:bg-[var(--zombie-crimson)]/30 disabled:opacity-40"
            >
              Execute override
            </button>
          ) : (
            <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4">
              <p className="text-[12px] font-bold text-red-300">Confirm destructive action</p>
              <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
                This action will be permanently logged and may not be reversible. Continue?
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void executeAction()}
                  className="rounded-lg bg-red-500/25 px-4 py-2 text-[12px] font-semibold text-red-200 transition hover:bg-red-500/35"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-lg border border-white/10 px-4 py-2 text-[12px] text-white/60 transition hover:bg-white/[0.04]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {status && (
        <p className={clsx(
          'mt-4 text-[11px]',
          status.includes('Error') ? 'text-red-400' : 'text-[var(--zombie-green)]',
        )}>
          {status}
        </p>
      )}
    </div>
  )
}
