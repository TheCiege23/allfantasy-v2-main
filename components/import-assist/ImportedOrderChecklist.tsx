'use client'

import { useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { buildDraftOrderChecklist, type ChecklistSlot, type Phase } from '@/lib/import-assist/draftOrderChecklist'

/**
 * Imported-league assist: "set it on Sleeper/ESPN/…" for the live rookie order. AllFantasy cannot
 * write the order back to the platform, so this gives the commissioner the steps and a block of text
 * for league chat (lib/import-assist/draftOrderChecklist.ts).
 */
export function ImportedOrderChecklist({ platform, draftSeason, phase, slots }: { platform: string | null; draftSeason: number; phase: Phase; slots: ChecklistSlot[] }) {
  const { language } = useLanguage()
  const lang = language === 'es' ? 'es' : 'en'
  const t = (en: string, es: string) => (lang === 'es' ? es : en)
  const [copied, setCopied] = useState<'steps' | 'chat' | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  if (slots.length === 0) return null
  const c = buildDraftOrderChecklist({ platform, draftSeason, phase, slots, lang })

  const copy = async (what: 'steps' | 'chat') => {
    const text = what === 'chat' ? c.shareText : c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setManual(null)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      // No clipboard (an insecure context or a refused permission): show the text to select by hand.
      setManual(text)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-cyan-400/25 bg-cyan-950/15 p-3" data-testid="imported-order-checklist">
      <p className="text-[13px] font-semibold text-white">{t(`Set this order on ${c.platform}`, `Pon este orden en ${c.platform}`)}</p>
      <p className="text-[11px] text-white/50">
        {t(`AllFantasy can’t change your ${c.platform} league, so here is exactly what to do there.`, `AllFantasy no puede cambiar tu liga de ${c.platform}, así que aquí tienes exactamente qué hacer allí.`)}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[12px] text-white/80">
        {c.steps.map((s, i) => (
          <li key={i} className={!c.final && i === 0 ? 'text-amber-300' : undefined}>{s}</li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void copy('steps')} className="rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white/85 hover:text-white">
          {copied === 'steps' ? t('Copied', 'Copiado') : t('Copy the steps', 'Copiar los pasos')}
        </button>
        <button type="button" onClick={() => void copy('chat')} className="rounded-lg bg-cyan-600/80 px-3 py-2 text-[12px] font-semibold text-white hover:bg-cyan-600">
          {copied === 'chat' ? t('Copied', 'Copiado') : t('Copy for league chat', 'Copiar para el chat')}
        </button>
      </div>
      {manual && (
        <textarea readOnly value={manual} rows={6} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-white/15 bg-[#0d1526] p-2 text-[12px] text-white" aria-label={t('Text to copy', 'Texto para copiar')} />
      )}
    </div>
  )
}
