'use client'

import { useCallback, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div id={id} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
      <h3 className="mb-0.5 text-[15px] font-bold text-white">{title}</h3>
      {description ? <p className="mb-4 text-[12px] text-white/40">{description}</p> : null}
      <div className="space-y-4">{children}</div>
    </div>
  )
}

export function SettingsRow({
  label,
  description,
  control,
  faqText,
}: {
  label: string
  description?: string
  control: React.ReactNode
  faqText?: string
}) {
  const [faqOpen, setFaqOpen] = useState(false)
  return (
    <div className="border-b border-white/[0.04] py-2 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-white">{label}</span>
            {faqText ? <FaqButton open={faqOpen} onToggle={() => setFaqOpen((v) => !v)} /> : null}
          </div>
          {description ? <p className="mt-0.5 text-[11px] text-white/40">{description}</p> : null}
        </div>
        <div className="flex-shrink-0">{control}</div>
      </div>
      {faqOpen && faqText ? (
        <div className="mt-2 rounded-xl border border-[#ff3d81]/10 bg-[#ff3d81]/[0.06] p-3 text-[11px] leading-relaxed text-[#ffd7e5]/80">
          {faqText}
        </div>
      ) : null}
    </div>
  )
}

export function FaqButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] text-white/40 transition hover:bg-white/10 hover:text-white/60"
      aria-expanded={open}
      aria-label={t('league.draftSettings.aria.help')}
    >
      ?
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative h-6 w-10 flex-shrink-0 rounded-full transition-colors ${
        checked ? 'bg-[#ff3d81]' : 'bg-white/[0.12]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function Select({
  value,
  onChange,
  children,
  className = '',
  disabled,
}: {
  value: string | number
  onChange: (v: string) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-xl border border-white/[0.10] bg-white/[0.06] px-3 py-2 text-[13px] text-white outline-none transition hover:border-white/[0.20] focus:border-[#ff3d81]/50 disabled:opacity-50 ${className}`}
    >
      {children}
    </select>
  )
}

export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & { className?: string },
) {
  const { className = '', ...rest } = props
  return (
    <input
      {...rest}
      className={`rounded-xl border border-white/[0.10] bg-white/[0.06] px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-white/30 hover:border-white/[0.20] focus:border-[#ff3d81]/50 disabled:opacity-50 ${className}`}
    />
  )
}

export function DangerButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] font-semibold text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

export function LeagueSettingsHeader({
  isDirty,
  onSaveAll,
  canEdit = true,
}: {
  isDirty: boolean
  onSaveAll: () => void
  /** When false, hide bulk save (view-only member). */
  canEdit?: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className="mb-5 flex items-center justify-between">
      <div>
        <h2 className="text-[17px] font-bold text-white">{t('league.draftSettings.title')}</h2>
        <p className="mt-0.5 text-[12px] text-white/40">
          {canEdit
            ? t('league.draftSettings.subtitle.commissioner')
            : t('league.draftSettings.subtitle.member')}
        </p>
      </div>
      {isDirty && canEdit ? (
        <button
          type="button"
          onClick={onSaveAll}
          disabled={!canEdit}
          className="rounded-xl bg-[#ff3d81] px-4 py-2 text-[13px] font-bold text-black transition hover:bg-[#ff3d81] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('league.draftSettings.saveChanges')}
        </button>
      ) : null}
    </div>
  )
}

/** Full nav — commissioner / co-commissioner draft & league controls */
const SECTION_NAV_COMMISSIONER_IDS = [
  'draft-time',
  'automation',
  'draft-format',
  'draft-order',
  'keepers',
  'player-pool',
  'ai-controls',
  'reset',
] as const

/** Members: schedule + format + order (read-only); no league automation or destructive blocks in nav */
const SECTION_NAV_MEMBER_IDS = ['draft-time', 'draft-format', 'draft-order'] as const

const NAV_SECTION_I18N: Record<string, string> = {
  'draft-time': 'league.draftSettings.nav.draftTime',
  automation: 'league.draftSettings.nav.automation',
  'draft-format': 'league.draftSettings.nav.format',
  'draft-order': 'league.draftSettings.nav.draftOrder',
  keepers: 'league.draftSettings.nav.keepers',
  'player-pool': 'league.draftSettings.nav.playerPool',
  'ai-controls': 'league.draftSettings.nav.ai',
  reset: 'league.draftSettings.nav.reset',
}

export function SettingsNav({ canEdit }: { canEdit: boolean }) {
  const { t } = useLanguage()
  const ids = canEdit ? SECTION_NAV_COMMISSIONER_IDS : SECTION_NAV_MEMBER_IDS
  const scrollTo = useCallback((sectionId: string) => {
    const el = document.getElementById(sectionId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="sticky top-0 z-10 mb-4 border-b border-white/[0.06] bg-[#0f1521]/90 px-1 py-2 backdrop-blur-sm">
      <div className="flex gap-1 overflow-x-auto">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => scrollTo(id)}
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-medium text-white/50 transition hover:bg-white/[0.06] hover:text-white"
          >
            {t(NAV_SECTION_I18N[id] ?? id)}
          </button>
        ))}
      </div>
    </div>
  )
}
