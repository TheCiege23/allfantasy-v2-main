'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowDownToLine,
  Bot,
  ClipboardList,
  Coins,
  LayoutGrid,
  Scale,
  Settings,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react'
import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import {
  DEVY_BRIDGE_CAVEAT,
  DEVY_BRIDGE_MAX,
  DEVY_BRIDGE_MIN,
} from '@/lib/devy/devyMarketBridge'
import { DEVY_FIRST_PICK_VALUE } from '@/lib/trade-intel/devyTradeValue'
import {
  defaultDevyLeagueSetup,
  parseDevyLeagueConfig,
  type DevyLeagueSetupState,
} from '@/lib/devy/devy-league-config'
import { DevyLeagueSetupSection } from '@/components/league-creation-wizard/DevyLeagueSetupSection'

type TabId =
  | 'league'
  | 'rosters'
  | 'pool'
  | 'drafts'
  | 'promotions'
  | 'trading'
  | 'scoring'
  | 'assets'
  | 'chimmy'
  | 'tools'
  | 'danger'

const TABS: { id: TabId; label: string; icon: typeof Settings }[] = [
  { id: 'league', label: 'League', icon: Settings },
  { id: 'rosters', label: 'Rosters & slots', icon: Users },
  { id: 'pool', label: 'Devy pool', icon: LayoutGrid },
  { id: 'drafts', label: 'Drafts & picks', icon: ClipboardList },
  { id: 'promotions', label: 'Promotions', icon: ArrowDownToLine },
  { id: 'trading', label: 'Trading', icon: Scale },
  { id: 'scoring', label: 'Scoring', icon: Trophy },
  { id: 'assets', label: 'Future assets', icon: Coins },
  { id: 'chimmy', label: 'AI / Chimmy', icon: Bot },
  { id: 'tools', label: 'Commissioner', icon: Shield },
  { id: 'danger', label: 'Danger zone', icon: AlertTriangle },
]

function GlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  )
}

export function DevyLeagueSettingsHub({ ctx }: { ctx: SubPanelContext }) {
  const sport = ctx.league.sport
  const initial = useMemo(() => {
    const raw = ctx.league.settings && typeof ctx.league.settings === 'object' && !Array.isArray(ctx.league.settings)
      ? (ctx.league.settings as Record<string, unknown>).devy_league_config
      : undefined
    return parseDevyLeagueConfig(raw) ?? defaultDevyLeagueSetup(sport)
  }, [ctx.league.settings, sport])

  const [config, setConfig] = useState<DevyLeagueSetupState>(initial)
  const [tab, setTab] = useState<TabId>('league')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setConfig(initial)
  }, [initial])

  const persist = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/league/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId: ctx.league.id, devyLeagueConfig: config }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'Save failed')
      }
      toast.success('Devy settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [ctx.league.id, config])

  return (
    <div className="space-y-4 pb-8">
      <div className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-[#0c1828] via-[#070d18] to-[#050915] p-4">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">Devy command center</p>
            <h3 className="mt-1 text-lg font-bold text-white">Multi-year prospect development</h3>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-white/55">
              This league is built for long-term pipelines: active pros, taxi stashes, devy prospects, and tradable
              future capital. MLB and NHL Devy formats are not supported — your sport uses a football or basketball
              prospect path.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void persist()}
            disabled={saving || !ctx.isCommissioner}
            className="shrink-0 rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-4 py-2 text-[12px] font-bold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/20 p-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition ${
                active ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/45 hover:bg-white/[0.05] hover:text-white/75'
              }`}
            >
              <Icon className="h-3.5 w-3.5 opacity-80" aria-hidden />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'league' ? (
        <DevyLeagueSetupSection sport={sport} value={config} onChange={setConfig} />
      ) : null}

      {tab === 'rosters' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">Rosters & slots</h4>
          <p className="mt-1 text-[12px] text-white/55">
            Taxi and Devy are separate: taxi holds eligible young pros; devy holds pre-pro developmental players.
            Defaults include both — tune slot counts without removing the pipelines.
          </p>
          <ul className="mt-3 space-y-2 text-[12px] text-white/70">
            <li>• Enforce separate devy roster section in lineup UIs</li>
            <li>• Block devy players from active starting slots (non-scoring for weekly lineups)</li>
            <li>• Roster preview: active / bench / IR / taxi / devy / future picks (wiring to league roster views)</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'pool' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">Devy player pool</h4>
          <p className="mt-2 text-[12px] text-white/55">
            This controls which future or developmental players can be drafted and stored in devy slots.
          </p>
          <p className="mt-2 text-[11px] text-white/45">
            Filters: class year, position, school, ranking feed, declaration status — connected to scouting imports and
            commissioner curation.
          </p>
        </GlassCard>
      ) : null}

      {tab === 'drafts' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">Drafts & picks</h4>
          <p className="mt-1 text-[12px] text-white/55">
            Annual rookie and devy drafts support linear, snake, auction, and weighted lottery. Weighted lottery is
            only for annual drafts — never for startup drafts.
          </p>
          <ul className="mt-3 space-y-1.5 text-[12px] text-white/65">
            <li>• Future pick trading, max years, ownership validation</li>
            <li>• Draft calendar, open trading during draft, clock pauses, queue autopick</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'promotions' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">Promotion rules</h4>
          <p className="mt-2 text-[12px] text-amber-100/90">
            Promotion rules determine when a devy player must move out of developmental inventory and onto an active
            roster, taxi, or waivers, depending on league rules.
          </p>
        </GlassCard>
      ) : null}

      {tab === 'trading' ? (
        <div className="space-y-4">
          <GlassCard>
            <h4 className="text-sm font-bold text-white">Trading rules</h4>
            <p className="mt-1 text-[12px] text-white/55">
              Supports players, devy assets, rookie picks, future picks, taxi players, and multi-team deals. Trade review,
              veto thresholds, deadlines, and pick labeling (year/round/original owner) surface in trade UIs.
            </p>
          </GlassCard>
          <DevyExchangeRateCard
            value={config.devyMarketUnitsPerDevyPoint ?? null}
            disabled={!ctx.isCommissioner}
            onChange={(v) => setConfig((c) => ({ ...c, devyMarketUnitsPerDevyPoint: v }))}
          />
        </div>
      ) : null}

      {tab === 'scoring' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">Scoring</h4>
          <p className="mt-1 text-[12px] text-white/55">
            Uses your sport scoring template. Devy/taxi non-scoring enforcement keeps devy prospects off weekly scores
            unless you run a special event format.
          </p>
          <p className="mt-2 text-[11px] text-white/45">NFL and NBA devy templates — no MLB/NHL devy scoring paths.</p>
        </GlassCard>
      ) : null}

      {tab === 'assets' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">Future assets</h4>
          <p className="mt-1 text-[12px] text-white/55">
            Future rookie and devy picks, traded pick history, original-owner labels, protected/conditional picks
            (when enabled), pick ledger export, and commissioner repair tools.
          </p>
        </GlassCard>
      ) : null}

      {tab === 'chimmy' ? (
        <GlassCard>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-300" />
            <h4 className="text-sm font-bold text-white">Chimmy + Devy</h4>
          </div>
          <p className="mt-2 text-[12px] text-white/55">
            Ask about devy eligibility, promotions, pick value, trades, and long-term outlook. Chimmy should read this
            league&apos;s devy config, rosters, taxi/devy buckets, and owned picks when context is available.
          </p>
          <ul className="mt-3 space-y-1 text-[11px] text-white/50">
            <li>• “Should I draft this prospect?” · “Compare these two devy players”</li>
            <li>• “What future picks do I own?” · “Evaluate this devy trade”</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'tools' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">Commissioner tools</h4>
          <p className="mt-1 text-[12px] text-white/55">
            Overrides (eligibility, promotions, pick assignment, pool refresh, audit logs) should confirm destructive
            actions and write commissioner audit entries when wired to the backend.
          </p>
        </GlassCard>
      ) : null}

      {tab === 'danger' ? (
        <GlassCard className="border-amber-500/25 bg-amber-500/[0.06]">
          <h4 className="text-sm font-bold text-amber-100">Advanced / danger zone</h4>
          <p className="mt-2 text-[12px] text-amber-100/80">
            Disabling devy, converting formats, resetting picks, or mass promotions can destroy league history. These
            flows require typed confirmation and audit trails in production.
          </p>
        </GlassCard>
      ) : null}
    </div>
  )
}

/**
 * The devy/NFL exchange rate — the one setting in this hub that changes whether a trade can be
 * graded at all.
 *
 * 🛑 THE DEFAULT IS "NOT SET", AND THE CARD SAYS WHAT THAT MEANS. Nothing prices college
 * players, so a trade spanning devy and NFL assets is reported ungradeable. That is the honest
 * state and most leagues should stay in it; this control exists for a commissioner who would
 * rather his league used a stated house rule than got no answer.
 *
 * ⚠ IT SHOWS THE CONSEQUENCE, NOT JUST THE NUMBER. A rate is an abstraction — "3.5" tells a
 * commissioner nothing. "Your best prospect becomes 3,500" is the thing he can actually judge
 * against the NFL players he knows the price of, so the preview updates as he types.
 *
 * ⚠ AND IT NEVER CALLS THE NUMBER CORRECT. The copy says house rule, not valuation, in the same
 * words the grade itself will carry (DEVY_BRIDGE_CAVEAT). A settings screen that presented this
 * as a calibration would undo the refusal it is lifting.
 */
function DevyExchangeRateCard({
  value,
  disabled,
  onChange,
}: {
  value: number | null
  disabled: boolean
  onChange: (v: number | null) => void
}) {
  const [text, setText] = useState(value == null ? '' : String(value))

  useEffect(() => {
    setText(value == null ? '' : String(value))
  }, [value])

  const parsed = text.trim() === '' ? null : Number(text.trim())
  const isNumber = parsed != null && Number.isFinite(parsed)
  const inRange = isNumber && parsed >= DEVY_BRIDGE_MIN && parsed <= DEVY_BRIDGE_MAX
  const preview = inRange ? Math.round(DEVY_FIRST_PICK_VALUE * (parsed as number)) : null

  return (
    <GlassCard>
      <h4 className="text-sm font-bold text-white">Devy ↔ NFL exchange rate</h4>
      <p className="mt-1 text-[12px] leading-relaxed text-white/55">
        Leave this empty and a trade mixing college prospects with NFL players is reported as
        ungradeable — which is the honest answer, because nothing prices college players and no
        such exchange rate has ever been measured. Set it and those trades get graded at your
        number, labelled as a house rule.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
          Market units per devy point
        </label>
        <input
          value={text}
          onChange={(e) => {
            const next = e.target.value
            setText(next)
            const n = next.trim() === '' ? null : Number(next.trim())
            if (next.trim() === '') onChange(null)
            else if (Number.isFinite(n) && (n as number) >= DEVY_BRIDGE_MIN && (n as number) <= DEVY_BRIDGE_MAX)
              onChange(n as number)
          }}
          disabled={disabled}
          inputMode="decimal"
          placeholder="not set"
          aria-label="Market units per devy point"
          className="w-28 rounded-lg border border-white/[0.12] bg-black/30 px-3 py-1.5 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-cyan-400/50 disabled:opacity-40"
        />
        {text.trim() !== '' ? (
          <button
            type="button"
            onClick={() => {
              setText('')
              onChange(null)
            }}
            disabled={disabled}
            className="rounded-lg border border-white/[0.12] px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:text-white/90 disabled:opacity-40"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* The consequence, which is the part a commissioner can actually judge. */}
      {preview != null ? (
        <p className="mt-2 text-[12px] text-cyan-100/80">
          At this rate the top prospect on your devy board is worth about{' '}
          <span className="font-bold">{preview.toLocaleString()}</span> — compare that with an NFL
          player you already know the price of.
        </p>
      ) : null}

      {text.trim() !== '' && !isNumber ? (
        <p className="mt-2 text-[12px] text-amber-200/85">
          That is not a number, so it will be ignored and mixed trades stay ungradeable.
        </p>
      ) : null}

      {isNumber && !inRange ? (
        <p className="mt-2 text-[12px] text-amber-200/85">
          Outside the accepted range of {DEVY_BRIDGE_MIN}–{DEVY_BRIDGE_MAX}, so it will be ignored.
          At {DEVY_BRIDGE_MAX} your top prospect would price level with the most valuable NFL asset
          in existence; at {DEVY_BRIDGE_MIN} the whole devy board rounds to nothing.
        </p>
      ) : null}

      {value == null ? (
        <p className="mt-2 text-[11px] text-white/40">
          Not set — mixed devy/NFL trades are reported as ungradeable.
        </p>
      ) : null}

      <p className="mt-3 border-t border-white/[0.06] pt-2 text-[11px] leading-relaxed text-white/45">
        {DEVY_BRIDGE_CAVEAT}
      </p>
    </GlassCard>
  )
}
