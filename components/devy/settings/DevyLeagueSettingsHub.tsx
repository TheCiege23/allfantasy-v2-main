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
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

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

/** Labels are dictionary keys (`lsRules.dv.tab.<id>`), resolved at render. */
const TABS: { id: TabId; icon: typeof Settings }[] = [
  { id: 'league', icon: Settings },
  { id: 'rosters', icon: Users },
  { id: 'pool', icon: LayoutGrid },
  { id: 'drafts', icon: ClipboardList },
  { id: 'promotions', icon: ArrowDownToLine },
  { id: 'trading', icon: Scale },
  { id: 'scoring', icon: Trophy },
  { id: 'assets', icon: Coins },
  { id: 'chimmy', icon: Bot },
  { id: 'tools', icon: Shield },
  { id: 'danger', icon: AlertTriangle },
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
  const { t } = useOptionalLanguage()
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
        throw new Error(j.error ?? t('lsRules.dv.saveFailed'))
      }
      toast.success(t('lsRules.dv.saved'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('lsRules.dv.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [ctx.league.id, config, t])

  return (
    <div className="space-y-4 pb-8">
      <div className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-[#0c1828] via-[#070d18] to-[#050915] p-4">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">{t('lsRules.dv.eyebrow')}</p>
            <h3 className="mt-1 text-lg font-bold text-white">{t('lsRules.dv.title')}</h3>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-white/55">
              {t('lsRules.dv.intro')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void persist()}
            disabled={saving || !ctx.isCommissioner}
            className="shrink-0 rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-4 py-2 text-[12px] font-bold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            {saving ? t('lsRules.dv.saving') : t('lsRules.dv.save')}
          </button>
        </div>
      </div>

      <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/20 p-1">
        {TABS.map((tb) => {
          const Icon = tb.icon
          const active = tab === tb.id
          return (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition ${
                active ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/45 hover:bg-white/[0.05] hover:text-white/75'
              }`}
            >
              <Icon className="h-3.5 w-3.5 opacity-80" aria-hidden />
              {t(`lsRules.dv.tab.${tb.id}`)}
            </button>
          )
        })}
      </div>

      {tab === 'league' ? (
        <DevyLeagueSetupSection sport={sport} value={config} onChange={setConfig} />
      ) : null}

      {tab === 'rosters' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">{t('lsRules.dv.rosters.title')}</h4>
          <p className="mt-1 text-[12px] text-white/55">
            {t('lsRules.dv.rosters.body')}
          </p>
          <ul className="mt-3 space-y-2 text-[12px] text-white/70">
            <li>{t('lsRules.dv.rosters.b1')}</li>
            <li>{t('lsRules.dv.rosters.b2')}</li>
            <li>{t('lsRules.dv.rosters.b3')}</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'pool' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">{t('lsRules.dv.pool.title')}</h4>
          <p className="mt-2 text-[12px] text-white/55">
            {t('lsRules.dv.pool.body')}
          </p>
          <p className="mt-2 text-[11px] text-white/45">
            {t('lsRules.dv.pool.filters')}
          </p>
        </GlassCard>
      ) : null}

      {tab === 'drafts' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">{t('lsRules.dv.drafts.title')}</h4>
          <p className="mt-1 text-[12px] text-white/55">
            {t('lsRules.dv.drafts.body')}
          </p>
          <ul className="mt-3 space-y-1.5 text-[12px] text-white/65">
            <li>{t('lsRules.dv.drafts.b1')}</li>
            <li>{t('lsRules.dv.drafts.b2')}</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'promotions' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">{t('lsRules.dv.promotions.title')}</h4>
          <p className="mt-2 text-[12px] text-amber-100/90">
            {t('lsRules.dv.promotions.body')}
          </p>
        </GlassCard>
      ) : null}

      {tab === 'trading' ? (
        <div className="space-y-4">
          <GlassCard>
            <h4 className="text-sm font-bold text-white">{t('lsRules.dv.trading.title')}</h4>
            <p className="mt-1 text-[12px] text-white/55">
              {t('lsRules.dv.trading.body')}
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
          <h4 className="text-sm font-bold text-white">{t('lsRules.dv.scoring.title')}</h4>
          <p className="mt-1 text-[12px] text-white/55">
            {t('lsRules.dv.scoring.body')}
          </p>
          <p className="mt-2 text-[11px] text-white/45">{t('lsRules.dv.scoring.note')}</p>
        </GlassCard>
      ) : null}

      {tab === 'assets' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">{t('lsRules.dv.assets.title')}</h4>
          <p className="mt-1 text-[12px] text-white/55">
            {t('lsRules.dv.assets.body')}
          </p>
        </GlassCard>
      ) : null}

      {tab === 'chimmy' ? (
        <GlassCard>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-300" />
            <h4 className="text-sm font-bold text-white">{t('lsRules.dv.chimmy.title')}</h4>
          </div>
          <p className="mt-2 text-[12px] text-white/55">
            {t('lsRules.dv.chimmy.body')}
          </p>
          <ul className="mt-3 space-y-1 text-[11px] text-white/50">
            <li>{t('lsRules.dv.chimmy.q1')}</li>
            <li>{t('lsRules.dv.chimmy.q2')}</li>
          </ul>
        </GlassCard>
      ) : null}

      {tab === 'tools' ? (
        <GlassCard>
          <h4 className="text-sm font-bold text-white">{t('lsRules.dv.tools.title')}</h4>
          <p className="mt-1 text-[12px] text-white/55">
            {t('lsRules.dv.tools.body')}
          </p>
        </GlassCard>
      ) : null}

      {tab === 'danger' ? (
        <GlassCard className="border-amber-500/25 bg-amber-500/[0.06]">
          <h4 className="text-sm font-bold text-amber-100">{t('lsRules.dv.danger.title')}</h4>
          <p className="mt-2 text-[12px] text-amber-100/80">
            {t('lsRules.dv.danger.body')}
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
  const { t } = useOptionalLanguage()
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
      <h4 className="text-sm font-bold text-white">{t('lsRules.xr.title')}</h4>
      <p className="mt-1 text-[12px] leading-relaxed text-white/55">
        {t('lsRules.xr.body')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
          {t('lsRules.xr.label')}
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
          placeholder={t('lsRules.xr.placeholder')}
          aria-label={t('lsRules.xr.label')}
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
            {t('lsRules.xr.clear')}
          </button>
        ) : null}
      </div>

      {/* The consequence, which is the part a commissioner can actually judge. */}
      {preview != null ? (
        <p className="mt-2 text-[12px] text-cyan-100/80">
          {t('lsRules.xr.previewBefore')}{' '}
          <span className="font-bold">{preview.toLocaleString()}</span> {t('lsRules.xr.previewAfter')}
        </p>
      ) : null}

      {text.trim() !== '' && !isNumber ? (
        <p className="mt-2 text-[12px] text-amber-200/85">
          {t('lsRules.xr.notNumber')}
        </p>
      ) : null}

      {isNumber && !inRange ? (
        <p className="mt-2 text-[12px] text-amber-200/85">
          {t('lsRules.xr.outOfRange').split('{{min}}').join(String(DEVY_BRIDGE_MIN)).split('{{max}}').join(String(DEVY_BRIDGE_MAX))}
        </p>
      ) : null}

      {value == null ? (
        <p className="mt-2 text-[11px] text-white/40">
          {t('lsRules.xr.notSet')}
        </p>
      ) : null}

      <p className="mt-3 border-t border-white/[0.06] pt-2 text-[11px] leading-relaxed text-white/45">
        {DEVY_BRIDGE_CAVEAT}
      </p>
    </GlassCard>
  )
}
