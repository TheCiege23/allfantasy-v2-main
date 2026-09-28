'use client'

import { useCallback, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Lock, UserPlus, Calendar, Trophy, Shield, Edit3 } from 'lucide-react'

interface CommissionerToolsTabProps {
  leagueId: string
  hasAfCommissionerSub: boolean
}

function SectionHeader({ icon: Icon, label }: { icon: typeof Calendar; label: string }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/70 uppercase tracking-wide">
      <Icon className="h-4 w-4" />{label}
    </h3>
  )
}

function ToolRow({ label, children, gated, hasSubscription }: {
  label: string; children: React.ReactNode; gated?: boolean; hasSubscription?: boolean
}) {
  const locked = gated && !hasSubscription
  return (
    <div className={`flex items-center justify-between gap-4 py-2.5 border-b border-white/5 last:border-0 ${locked ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-white/80">{label}</span>
        {locked && <Lock className="h-3 w-3 text-amber-400/60" />}
      </div>
      <div className="flex-shrink-0">
        {locked ? (
          <span className="text-xs text-amber-300/60">Pro</span>
        ) : children}
      </div>
    </div>
  )
}

function DangerButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-300">Confirm?</span>
        <Button size="sm" variant="destructive" onClick={() => { onConfirm(); setConfirming(false) }}>Yes</Button>
        <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>No</Button>
      </div>
    )
  }
  return (
    <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
      <AlertTriangle className="h-3 w-3 mr-1" />{label}
    </Button>
  )
}

/**
 * Commissioner Tools Tab — schedule changes, co-commissioners,
 * playoff bracket, roster locks, matchup score edits, etc.
 * Commissioner-only (never shown to regular members).
 */
export function CommissionerToolsTab({ leagueId, hasAfCommissionerSub }: CommissionerToolsTabProps) {
  const [saving, setSaving] = useState(false)

  const apiAction = useCallback(async (action: string, data?: Record<string, unknown>) => {
    setSaving(true)
    await fetch(`/api/commissioner/leagues/${leagueId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
    }).catch(() => {})
    setSaving(false)
  }, [leagueId])

  return (
    <div className="space-y-6">
      {saving && <div className="text-xs text-cyan-300 animate-pulse">Saving...</div>}

      {/* Co-Commissioners */}
      <section>
        <SectionHeader icon={UserPlus} label="Co-Commissioners" />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <ToolRow label="Add Co-Commissioner">
            <div className="flex items-center gap-2">
              <Input placeholder="Username or email" className="w-48" />
              <Button size="sm" onClick={() => apiAction('add_co_commissioner')}>Add</Button>
            </div>
          </ToolRow>
        </div>
      </section>

      {/* Schedule */}
      <section>
        <SectionHeader icon={Calendar} label="Schedule" />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <ToolRow label="Regular Season Weeks">
            <Input type="number" min={1} max={18} className="w-20 text-right" defaultValue={14} />
          </ToolRow>
          <ToolRow label="Playoff Start Week">
            <Input type="number" min={10} max={18} className="w-20 text-right" defaultValue={15} />
          </ToolRow>
          <ToolRow label="Playoff Weeks Per Round">
            <Input type="number" min={1} max={3} className="w-20 text-right" defaultValue={1} />
          </ToolRow>
        </div>
      </section>

      {/* Playoff Bracket */}
      <section>
        <SectionHeader icon={Trophy} label="Playoff Bracket" />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <ToolRow label="Playoff Teams">
            <Input type="number" min={2} max={8} className="w-20 text-right" defaultValue={6} />
          </ToolRow>
          <ToolRow label="Seeding Rule">
            <select className="rounded bg-white/5 border border-white/10 px-2 py-1 text-sm text-white">
              <option value="record">Record</option>
              <option value="points_for">Points For</option>
              <option value="manual">Manual</option>
            </select>
          </ToolRow>
          {/* Free: an odd bracket seeds with byes exactly like the free 6-team one. */}
          <ToolRow label="Odd Number of Playoff Teams">
            <Switch defaultChecked={false} />
          </ToolRow>
          <ToolRow label="Lower Bracket (Consolation)">
            <Switch defaultChecked={false} />
          </ToolRow>
          <ToolRow label="Edit Playoff Bracket">
            <Button size="sm" variant="outline" onClick={() => apiAction('edit_bracket')}>
              <Edit3 className="h-3 w-3 mr-1" />Edit
            </Button>
          </ToolRow>
        </div>
      </section>

      {/* Roster Controls */}
      <section>
        <SectionHeader icon={Shield} label="Roster Controls" />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <ToolRow label="Lock All Rosters">
            <DangerButton label="Lock Rosters" onConfirm={() => apiAction('lock_all_rosters')} />
          </ToolRow>
          <ToolRow label="Lock All Moves (trades + waivers)">
            <DangerButton label="Lock Moves" onConfirm={() => apiAction('lock_all_moves')} />
          </ToolRow>
          <ToolRow label="Force Player to Bench">
            <Button size="sm" variant="outline" onClick={() => {}}>Select Player</Button>
          </ToolRow>
        </div>
      </section>

      {/* Matchup Edits */}
      <section>
        <SectionHeader icon={Edit3} label="Matchup & Score Edits" />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <ToolRow label="Edit Matchup Scores">
            <Button size="sm" variant="outline" onClick={() => apiAction('edit_scores')}>
              <Edit3 className="h-3 w-3 mr-1" />Edit Scores
            </Button>
          </ToolRow>
          <ToolRow label="Override Weekly Result">
            <DangerButton label="Override" onConfirm={() => apiAction('override_result')} />
          </ToolRow>
          <ToolRow label="Extended Scoring Corrections" gated hasSubscription={hasAfCommissionerSub}>
            <Switch defaultChecked={false} />
          </ToolRow>
        </div>
      </section>

      {/* Anti-Competitive (Gated) */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/70 uppercase tracking-wide">
          <Shield className="h-4 w-4" />Competitive Integrity
          {!hasAfCommissionerSub && <Lock className="h-3 w-3 text-amber-400/60" />}
        </h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <ToolRow label="Anti-Tanking Detection" gated hasSubscription={hasAfCommissionerSub}>
            <Switch defaultChecked={false} />
          </ToolRow>
          <ToolRow label="Anti-Collusion Monitoring" gated hasSubscription={hasAfCommissionerSub}>
            <Switch defaultChecked={false} />
          </ToolRow>
          <ToolRow label="Suspicious Trade Alerts" gated hasSubscription={hasAfCommissionerSub}>
            <Switch defaultChecked={false} />
          </ToolRow>
          <ToolRow label="Lineup Neglect Warnings" gated hasSubscription={hasAfCommissionerSub}>
            <Switch defaultChecked={false} />
          </ToolRow>
        </div>
      </section>
    </div>
  )
}
