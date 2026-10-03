'use client'

import { useEffect, useState } from 'react'

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

function safeDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString()
}

function downloadCard(item: TradeSnapshot) {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = '#0b1022'
  ctx.fillRect(0, 0, 1200, 630)
  ctx.fillStyle = '#75e2dc'
  ctx.font = '700 24px Arial'
  ctx.fillText('ALLFANTASY · TRADE COMPARISON', 48, 64)
  ctx.fillStyle = '#eaf1ff'
  ctx.font = '700 36px Arial'
  ctx.fillText(item.title.slice(0, 48), 48, 120)
  ctx.fillStyle = '#aab9d4'
  ctx.font = '22px Arial'
  ctx.fillText(`${item.sport} · ${item.basis}`.slice(0, 88), 48, 158)
  item.sides.forEach((side, index) => {
    const x = index === 0 ? 48 : 615
    ctx.fillStyle = '#182442'
    ctx.fillRect(x, 190, 535, 280)
    ctx.fillStyle = '#eaf1ff'
    ctx.font = '700 28px Arial'
    ctx.fillText(side.slice(0, 25), x + 24, 230)
    ctx.fillStyle = '#75e2dc'
    ctx.font = '700 56px Arial'
    ctx.fillText(item.grades[index], x + 24, 300)
    ctx.fillStyle = '#c8d4e7'
    ctx.font = '22px Arial'
    item.assets[index].slice(0, 4).forEach((asset, row) => ctx.fillText(asset.slice(0, 36), x + 24, 345 + row * 30))
    if (item.assets[index].length > 4) ctx.fillText(`+${item.assets[index].length - 4} more`, x + 24, 455)
  })
  ctx.fillStyle = '#eaf1ff'
  ctx.font = '700 25px Arial'
  ctx.fillText(item.verdict.slice(0, 75), 48, 515)
  ctx.fillStyle = '#aab9d4'
  ctx.font = '20px Arial'
  ctx.fillText(`As of ${safeDate(item.at)} · ${item.uncertainty}`.slice(0, 105), 48, 555)
  ctx.fillText('Value comparison only · Acceptance and future performance are not predicted', 48, 590)
  const anchor = document.createElement('a')
  anchor.href = canvas.toDataURL('image/png')
  anchor.download = `allfantasy-trade-${item.id}.png`
  anchor.click()
  return true
}

export function TradeComparisonSnapshots({ snapshot, scope }: { snapshot: TradeSnapshot | null; scope: string }) {
  const [saved, setSaved] = useState<TradeSnapshot[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { setSaved(readSaved()) }, [])
  const visible = saved.filter((item) => item.scope === scope)
  const card = visible.find((item) => item.id === selected) ?? snapshot

  function save() {
    if (!snapshot) return
    try {
      const item = { ...snapshot, id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }
      const next = [item, ...readSaved()].slice(0, 30)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setSaved(next)
      setSelected(item.id)
      setNotice('Comparison saved on this device. Reanalyze before acting on older values.')
    } catch { setNotice('This browser could not save the comparison.') }
  }

  function remove(id: string) {
    try {
      const next = readSaved().filter((item) => item.id !== id)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setSaved(next)
      if (selected === id) setSelected(null)
      setNotice('Saved comparison removed.')
    } catch { setNotice('This browser could not remove the comparison.') }
  }

  return (
    <section className="af-tc-snapshots" aria-label="Saved trade comparisons">
      <div className="af-tc-snapshots-head">
        <div><h3>Trade comparisons</h3><p>Saved on this device. Values are snapshots, not live offers.</p></div>
        <button type="button" className="af-btn af-btn-ghost" onClick={save} disabled={!snapshot}>Save this comparison</button>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      {card ? (
        <div className="af-tc-share-card">
          <div className="af-tc-share-top"><strong>{card.title}</strong><span>{card.sport} · {card.basis}</span></div>
          <div className="af-tc-share-sides">{card.sides.map((side, index) => (
            <div key={`${side}-${index}`}><span>{side}</span><strong>{card.grades[index]}</strong><small>Sends {card.assets[index].join(', ')}</small></div>
          ))}</div>
          <p>Value verdict: {card.verdict}</p>
          <small>As of {safeDate(card.at)} · {card.uncertainty}. Fairness does not predict acceptance or future performance.</small>
          <button type="button" className="af-btn af-btn-ghost" onClick={() => {
            setNotice(downloadCard(card) ? 'Share card downloaded as PNG.' : 'The share card could not be created in this browser.')
          }}>Download share card</button>
        </div>
      ) : null}
      {visible.length ? (
        <details className="af-tc-saved-list"><summary>Saved comparisons ({visible.length})</summary>
          <ul>{visible.map((item) => <li key={item.id}>
            <button type="button" onClick={() => setSelected(item.id)}>{item.title} · {safeDate(item.at)}</button>
            <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.title} from ${safeDate(item.at)}`}>Remove</button>
          </li>)}</ul>
        </details>
      ) : null}
    </section>
  )
}
