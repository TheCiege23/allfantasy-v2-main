'use client'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import { getIntlLocale, type LanguageCode } from '@/lib/i18n/constants'
import { useTradeVisualCopy } from "./useTradeVisualCopy"

import { useEffect, useState } from 'react'
import { genericComparisonSchema, type GenericComparison } from '@/lib/trade-value/genericComparison'

export type TradeSnapshot = {
  id: string
  scope: string
  sport: string
  title: string
  at: string
  basis: string
  uncertainty: string
  sides: [string, string]
  assets: [string[], string[]]
  grades: [string, string]
  verdict: string
}

const STORAGE_KEY = 'af-trade-comparisons:v1'

function readSaved(): TradeSnapshot[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is TradeSnapshot =>
      Boolean(item && typeof item.id === 'string' && typeof item.scope === 'string' &&
        typeof item.at === 'string' && Array.isArray(item.sides) && Array.isArray(item.assets))) : []
  } catch { return [] }
}

function safeDate(value: string, locale = 'en-US'): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(locale)
}

function downloadCard(item: TradeSnapshot, language: LanguageCode) {
  const copy=(value:string)=>tradeVisualCopy(value,language)
  const locale=getIntlLocale(language)
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#0b1022'
  ctx.fillRect(0, 0, 1200, 630)
  ctx.fillStyle = '#75e2dc'
  ctx.font = '700 24px Arial'
  ctx.fillText(copy('ALLFANTASY · TRADE COMPARISON'), 48, 64)
  ctx.fillStyle = '#eaf1ff'
  ctx.font = '700 36px Arial'
  ctx.fillText(copy(item.title).slice(0, 48), 48, 120)
  ctx.fillStyle = '#aab9d4'
  ctx.font = '22px Arial'
  ctx.fillText(`${item.sport} · ${copy(item.basis)}`.slice(0, 88), 48, 158)
  item.sides.forEach((side, index) => {
    const x = index === 0 ? 48 : 615
    ctx.fillStyle = '#182442'
    ctx.fillRect(x, 190, 535, 280)
    ctx.fillStyle = '#eaf1ff'
    ctx.font = '700 28px Arial'
    ctx.fillText(copy(side).slice(0, 25), x + 24, 230)
    ctx.fillStyle = '#75e2dc'
    ctx.font = '700 56px Arial'
    ctx.fillText(item.grades[index], x + 24, 300)
    ctx.fillStyle = '#c8d4e7'
    ctx.font = '22px Arial'
    item.assets[index].slice(0, 4).forEach((asset, row) => ctx.fillText(copy(asset).slice(0, 36), x + 24, 345 + row * 30))
    if (item.assets[index].length > 4) ctx.fillText(copy(`+${item.assets[index].length - 4} more`), x + 24, 455)
  })
  ctx.fillStyle = '#eaf1ff'
  ctx.font = '700 25px Arial'
  ctx.fillText(copy(item.verdict).slice(0, 75), 48, 515)
  ctx.fillStyle = '#aab9d4'
  ctx.font = '20px Arial'
  ctx.fillText(`${copy('As of')} ${safeDate(item.at,locale)} · ${copy(item.uncertainty)}`.slice(0, 105), 48, 555)
  ctx.fillText(copy('Value comparison only · Acceptance and future performance are not predicted'), 48, 590,1104)
  const anchor = document.createElement('a')
  anchor.href = canvas.toDataURL('image/png')
  anchor.download = `allfantasy-trade-${item.id}.png`
  anchor.click()
  return true
}

export function TradeComparisonSnapshots({ snapshot, scope }: { snapshot: TradeSnapshot | null; scope: string }) {
  const {copy,locale,language}=useTradeVisualCopy()

  const [saved, setSaved] = useState<TradeSnapshot[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [historyAvailable, setHistoryAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const account = scope !== 'generic:device'
  useEffect(() => {
    let cancelled = false
    const local = readSaved().filter((item) => item.scope === scope)
    if (!account) { setSaved(local); setHistoryAvailable(true); return }
    setHistoryAvailable(false)
    const load = async () => {
      let remote: TradeSnapshot[] = []
      try {
        const response = await fetch('/api/trade-value/comparisons', { cache: 'no-store' })
        if (!response.ok) throw new Error('Account history is unavailable. Existing device saves are still shown.')
        let data = await response.json() as { snapshots: GenericComparison[] }
        remote = data.snapshots.map((item) => ({ ...item, scope }))
        const old = local.flatMap((item) => {
          const parsed = genericComparisonSchema.safeParse(item)
          return parsed.success ? [parsed.data] : []
        })
        if (old.length) {
          const imported = await fetch('/api/trade-value/comparisons', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshots: old }),
          })
          if (!imported.ok) throw new Error('Account history loaded, but device saves could not sync. Retry when connected.')
          data = await imported.json() as { snapshots: GenericComparison[] }
          const importedIds = new Set(old.map((item) => item.id))
          const remaining = readSaved().filter((item) => item.scope !== scope || !importedIds.has(item.id))
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining))
        }
        if (!cancelled) {
          setSaved(data.snapshots.map((item) => ({ ...item, scope })))
          setHistoryAvailable(true)
          setNotice(null)
        }
      } catch (error) {
        if (!cancelled) {
          setSaved([...remote, ...local.filter((item) => !remote.some((row) => row.id === item.id))])
          setHistoryAvailable(false)
          setNotice(error instanceof Error ? error.message : 'Account history is unavailable.')
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [scope, account, reload])
  const visible = saved.filter((item) => item.scope === scope)
  const card = visible.find((item) => item.id === selected) ?? snapshot

  async function save() {
    if (!snapshot) return
    const item = { ...snapshot, id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }
    const parsed = genericComparisonSchema.safeParse(item)
    if (!parsed.success) { setNotice('This comparison could not be saved. Reanalyze the trade.'); return }
    setBusy(true)
    try {
      if (account) {
        const response = await fetch('/api/trade-value/comparisons', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshots: [parsed.data] }),
        })
        if (!response.ok) throw new Error('Could not save to your account. Try again shortly.')
        const data = await response.json() as { snapshots: GenericComparison[] }
        setSaved(data.snapshots.map((row) => ({ ...row, scope })))
      } else {
        const next = [item, ...readSaved()].slice(0, 30)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        setSaved(next)
      }
      setSelected(item.id)
      setNotice(account ? 'Comparison saved to your account. Reanalyze before acting on older values.' : 'Comparison saved on this device. Reanalyze before acting on older values.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save the comparison.') }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      if (account) {
        const response = await fetch(`/api/trade-value/comparisons?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!response.ok) throw new Error('Could not remove this comparison from your account.')
        const data = await response.json() as { snapshots: GenericComparison[] }
        setSaved(data.snapshots.map((row) => ({ ...row, scope })))
      } else {
        const next = readSaved().filter((item) => item.id !== id)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        setSaved(next)
      }
      if (selected === id) setSelected(null)
      setNotice('Saved comparison removed.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not remove the comparison.') }
    finally { setBusy(false) }
  }

  return (
    <section className="af-tc-snapshots" aria-label={copy("Saved trade comparisons")}>
      <div className="af-tc-snapshots-head">
        <div><h3>{copy("Trade comparisons")}</h3><p>{copy(account ? 'Saved to your account across devices.' : 'Saved on this device.')}{copy(" Values are snapshots, not live offers.")}</p></div>
        <button type="button" className="af-btn af-btn-ghost" onClick={() => void save()} disabled={!snapshot || busy || !historyAvailable}>{copy("Save this comparison")}</button>
      </div>
      {notice ? <p role="status">{copy(notice)}</p> : null}
      {account && !historyAvailable ? <button type="button" className="af-btn af-btn-ghost" onClick={() => setReload((value) => value + 1)}>{copy("Retry account sync")}</button> : null}
      {card ? (
        <div className="af-tc-share-card">
          <div className="af-tc-share-top"><strong>{copy(card.title)}</strong><span>{copy(card.sport)}{copy(" · ")}{copy(card.basis)}</span></div>
          <div className="af-tc-share-sides">{card.sides.map((side, index) => (
            <div key={`${side}-${index}`}><span>{copy(side)}</span><strong>{copy(card.grades[index])}</strong><small>{copy("Sends ")}{copy(card.assets[index].map(asset=>copy(asset)).join(', '))}</small></div>
          ))}</div>
          <p>{copy("Value verdict: ")}{copy(card.verdict)}</p>
          <small>{copy("As of ")}{copy(safeDate(card.at,locale))}{copy(" · ")}{copy(card.uncertainty)}{copy(". Fairness does not predict acceptance or future performance.")}</small>
          <button type="button" className="af-btn af-btn-ghost" onClick={() => {
            setNotice(downloadCard(card,language) ? 'Share card downloaded as PNG.' : 'The share card could not be created in this browser.')
          }}>{copy("Download share card")}</button>
        </div>
      ) : null}
      {visible.length ? (
        <details className="af-tc-saved-list"><summary>{copy("Saved comparisons (")}{copy(visible.length)}{copy(")")}</summary>
          <ul>{visible.map((item) => <li key={item.id}>
            <button type="button" onClick={() => setSelected(item.id)}>{copy(item.title)}{copy(" · ")}{copy(safeDate(item.at,locale))}</button>
            <button type="button" onClick={() => void remove(item.id)} disabled={busy || (account && !historyAvailable)} aria-label={copy(`Remove ${item.title} from ${safeDate(item.at,locale)}`)}>{copy("Remove")}</button>
          </li>)}</ul>
        </details>
      ) : null}
    </section>
  )
}
