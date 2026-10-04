'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"
import type { PackageCost } from '@/lib/decision-os/trade/packageCost'
import styles from './TradeVisuals.module.css'
export function TradePackageCost({cost}:{cost:PackageCost|null|undefined}) {
  const {copy,locale}=useTradeVisualCopy()

  if (!cost) return null
  return <section className={styles.panel} aria-label={copy("Roster space and opportunity cost")}><h4>{copy("Does this package fit?")}</h4><p>{copy("Active players: ")}{copy(cost.activeBefore)}{copy(" → ")}{copy(cost.activeAfter)}{copy(". Recorded capacity: ")}{copy(cost.capacity??'unknown')}{copy(".")}</p><strong>{copy(cost.requiredDrops==null?'Roster capacity is unverified.':cost.requiredDrops>0?`${cost.requiredDrops} drop${cost.requiredDrops===1?'':'s'} needed before this package fits.`:'No active-roster drops needed under the recorded capacity.')}</strong>{cost.displacedStarters.length?<p>{copy("Current projected starters moved to the bench: ")}{copy(cost.displacedStarters.join(', '))}{copy(".")}</p>:null}{cost.candidates.length?<details><summary>{copy("Explore individual drop costs")}</summary><p>{copy("The lineup graph shows the package before required drops. These are independent scenarios, not recommended cuts.")}</p><div className={styles.table}><table><thead><tr><th>{copy("Retained player")}</th><th>{copy("Weekly starter points lost if dropped")}</th></tr></thead><tbody>{cost.candidates.map(c=><tr key={c.playerId}><td>{c.name}</td><td>{copy(c.singleDropLineupCost==null?'Unavailable':c.singleDropLineupCost.toLocaleString(locale,{minimumFractionDigits:1,maximumFractionDigits:1}))}</td></tr>)}</tbody></table></div></details>:null}<p>{copy(cost.note)}</p></section>
}
