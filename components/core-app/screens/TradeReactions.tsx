'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"
import { useSyncExternalStore } from 'react'
import styles from './TradeVisuals.module.css'
const key = 'af-trade-reactions'
const event = 'af-trade-reactions-changed'
function subscribe(callback: () => void) { window.addEventListener(event,callback); window.addEventListener('storage',callback); return () => {window.removeEventListener(event,callback);window.removeEventListener('storage',callback)} }
function snapshot() { try { return localStorage.getItem(key) === 'on' } catch { return false } }
export function TradeReactionSettings() {
  const {copy}=useTradeVisualCopy()

  const enabled = useSyncExternalStore(subscribe,snapshot,() => false)
  return <label className={styles.controls}><input type="checkbox" checked={enabled} onChange={e => {try {localStorage.setItem(key,e.target.checked ? 'on' : 'off');window.dispatchEvent(new Event(event))} catch { /* Browser privacy settings can prevent persistence. */ }}} />{copy(" Chimmy reactions ")}<small>{copy("Optional · saved on this device")}</small></label>
}
const reactions: Record<string,[string,string]> = {A:['🚀','Value lift. Let Chimmy cook.'],B:['✨','Nice edge. Quietly cooking.'],C:['🤝','Fair exchange. Both teams eat.'],D:['🔍','Counter time. Check the receipt.'],F:['🧾','Price check. Read the fine print.']}
export function TradeReaction({letter,completed=false}:{letter:string;completed?:boolean}) {
  const {copy}=useTradeVisualCopy()

  const enabled = useSyncExternalStore(subscribe,snapshot,() => false)
  if (!enabled) return null
  const [emoji,phrase] = reactions[letter.charAt(0)] ?? ['🔍','Review the evidence.']
  return <span className={styles.reaction}><span aria-hidden="true" className={completed ? styles.celebrate : undefined}>{copy(emoji)}</span>{copy(phrase)}</span>
}
export function AcceptedTradeReaction({completed}:{completed:boolean}) {
  const {copy}=useTradeVisualCopy()

  const enabled = useSyncExternalStore(subscribe,snapshot,() => false)
  return enabled ? <p className={styles.reaction}><span aria-hidden="true" className={styles.celebrate}>{copy("🤝✨")}</span>{copy(completed ? 'Deal sealed. Chimmy has the receipt.' : 'Handshake secured. Execution is still pending.')}</p> : null
}
