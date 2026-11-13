'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"
import type { PackageCost } from '@/lib/decision-os/trade/packageCost'
import styles from './TradeVisuals.module.css'
export function TradePackageCost({cost}:{cost:PackageCost|null|undefined}) {
  const {copy,locale}=useTradeVisualCopy()

  if (!cost) return null
  return <section className={styles.panel} aria-label={copy("Roster space")}><h4>{copy("Does this trade fit your roster?")}</h4><p>{copy("Active players: ")}{copy(cost.activeBefore)}{copy(" → ")}{copy(cost.activeAfter)}{copy(". Roster limit: ")}{copy(cost.capacity??'unknown')}{copy(".")}</p><strong>{copy(cost.requiredDrops==null?'We couldn’t check your roster limit.':cost.requiredDrops>0?`You need to drop ${cost.requiredDrops} player${cost.requiredDrops===1?'':'s'} to fit this trade.`:'You have room — no drops needed.')}</strong>{cost.displacedStarters.length?<p>{copy("Starters who’d move to your bench: ")}{copy(cost.displacedStarters.join(', '))}{copy(".")}</p>:null}{cost.candidates.length?<details><summary>{copy("What each possible drop would cost")}</summary><p>{copy("The lineup chart is before any drops. Each row is a separate what-if, not a suggestion to cut that player.")}</p><div className={styles.table}><table><thead><tr><th>{copy("Player you keep")}</th><th>{copy("Lineup points lost per week if dropped")}</th></tr></thead><tbody>{cost.candidates.map(c=><tr key={c.playerId}><td>{c.name}</td><td>{copy(c.singleDropLineupCost==null?'Unavailable':c.singleDropLineupCost.toLocaleString(locale,{minimumFractionDigits:1,maximumFractionDigits:1}))}</td></tr>)}</tbody></table></div></details>:null}<p>{copy(cost.note)}</p></section>
}
