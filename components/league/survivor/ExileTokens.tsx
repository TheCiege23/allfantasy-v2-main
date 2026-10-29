'use client'
import styles from './ExileTokens.module.css'

/** Most coins drawn in the progress row; larger return counts show the rest as a number. */
const MAX_DRAWN = 8

/**
 * The simplified coin for 16–32px (chips, rows, counts). The full coin has ring lettering that does
 * not read below 40px, so never shrink token-coin.svg this far.
 */
export function ExileTokenIcon({ size = 16, wiped = false, label }: { size?: number; wiped?: boolean; label?: string }) {
  return <img
    src={wiped ? '/survivor/exile/token-coin-wiped.svg' : '/survivor/exile/token-icon.svg'}
    alt={label ?? ''} aria-hidden={label ? undefined : true}
    width={size} height={size} style={{ width: size, height: size, flex: 'none', display: 'inline-block' }}
  />
}

/** "N more tokens to return to the game" — the progress-row line. */
export function exileProgressLine(balance: number, required: number): string {
  if (required <= 0) return balance > 0 ? `You have ${balance} ${balance === 1 ? 'token' : 'tokens'}.` : 'No tokens yet.'
  const needed = Math.max(0, required - balance)
  if (needed === 0) return `You have ${balance} ${balance === 1 ? 'token' : 'tokens'}. You can return to the game.`
  if (balance <= 0) return 'No tokens. Win your week to earn one.'
  return `${needed} more ${needed === 1 ? 'token' : 'tokens'} to return to the game.`
}

/**
 * Progress toward the return: banked coins up to the balance, empty slots up to the return count,
 * a thin gold bar and one line of copy. `popLast` pops the newest coin in (token just earned).
 */
export function ExileTokenProgress({ balance, required, cap = null, popLast = false }: { balance: number; required: number; cap?: number | null; popLast?: boolean }) {
  const safeBalance = Math.max(0, Math.floor(balance))
  const target = Math.max(0, Math.floor(required))
  const slots = Math.max(safeBalance, target)
  const drawn = Math.min(slots, MAX_DRAWN)
  const pct = target > 0 ? Math.min(100, (safeBalance / target) * 100) : safeBalance > 0 ? 100 : 0
  return <div className={styles.progress}>
    <div className={styles.progressHead}>
      <span className={styles.label}>Your tokens</span>
      <span className={styles.count}><ExileTokenIcon size={16} />{safeBalance} / {target}</span>
    </div>
    <div className={styles.slots} role="img" aria-label={`${safeBalance} of ${target} tokens`}>
      {Array.from({ length: drawn }, (_, i) => {
        const filled = i < safeBalance
        const popping = popLast && filled && i === Math.min(safeBalance, drawn) - 1
        return <img key={i} alt=""
          src={filled ? popping ? '/survivor/exile/token-coin-earned.svg' : '/survivor/exile/token-coin.svg' : '/survivor/exile/token-empty.svg'}
          width={64} height={64} className={`${styles.coin} ${popping ? styles.coinPop : ''}`} />
      })}
      {slots > drawn && <span className={styles.more}>+{slots - drawn}</span>}
    </div>
    <div className={styles.bar} aria-hidden="true"><div className={styles.barFill} style={{ width: `${pct}%` }} /></div>
    <span className={styles.line}>{exileProgressLine(safeBalance, target)}{cap != null && cap > 0 ? ` You can hold up to ${cap}.` : ''}</span>
  </div>
}

export interface ExileWeekResult {
  id: string
  week: number
  weeklyScore: number
  bossScore: number | null
  tokenEarned: number
  tokenWiped: boolean
}

function score(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—'
}

/** Weekly result toast, driven by ExileWeeklyEntry.tokenEarned / tokenWiped. The coin pops in over 0.6s. */
export function ExileTokenToast({ result, balance, required, onDismiss }: { result: ExileWeekResult; balance: number; required: number; onDismiss?: () => void }) {
  const wiped = result.tokenWiped
  if (!wiped && result.tokenEarned <= 0) return null
  const needed = Math.max(0, required - balance)
  return <div role="status" className={`${styles.toast} ${wiped ? styles.toastWiped : styles.toastEarned}`}>
    <span className={styles.toastArt}>
      <img src={wiped ? '/survivor/exile/token-coin-wiped.svg' : '/survivor/exile/token-coin-earned.svg'} alt=""
        width={wiped ? 56 : 84} height={wiped ? 56 : 84} className={`${wiped ? '' : styles.toastArtEarned} ${styles.coinPop}`} />
    </span>
    <span className={styles.toastText}>
      {wiped ? <>
        <span className={`${styles.toastKicker} ${styles.kickerWiped}`}>Tokens wiped · week {result.week}</span>
        <span className={styles.toastTitle}>{result.bossScore != null ? `The Exile boss beat you ${score(result.bossScore)} to ${score(result.weeklyScore)}` : 'The Exile boss outscored you'}</span>
        <span className={styles.toastSub}>Your tokens are gone. Start again next week.</span>
      </> : <>
        <span className={`${styles.toastKicker} ${styles.kickerEarned}`}>Token earned · week {result.week}</span>
        <span className={styles.toastTitle}>You won Exile Island with {score(result.weeklyScore)}</span>
        <span className={styles.toastSub}>{required > 0
          ? needed === 0 ? `${balance} of ${required} tokens. You have enough to return.` : `${balance} of ${required} tokens. ${needed === 1 ? 'One more week and you’re back in the game.' : `${needed} more to go.`}`
          : `You have ${balance} ${balance === 1 ? 'token' : 'tokens'}.`}</span>
      </>}
    </span>
    {onDismiss && <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">Close</button>}
  </div>
}

/** Small chips: return count with the token icon, and the cap when the league sets one. */
export function ExileTokenRuleChips({ required, cap }: { required: number; cap: number | null }) {
  return <div className={styles.chips}>
    {required > 0 && <span className={styles.chip}><ExileTokenIcon size={14} />Return at {required} tokens</span>}
    {cap != null && cap > 0 && <span className={styles.chip}>Cap {cap}</span>}
  </div>
}
