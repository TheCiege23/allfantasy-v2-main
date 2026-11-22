'use client'

import { useMessages } from '@/components/i18n/useMessages'
import { StatStrip } from '@/components/core-app/primitives/StatStrip'
import { yourWeekGlanceMessages } from '@/lib/core-app/messages/yourWeekGlance'
import type { YourWeekProgress } from '@/lib/core-app/yourWeekProgress'

/**
 * The Your Week board's header progress bar ("N of M decided"), and the glance tiles under the
 * header. Every number is `yourWeekProgress` over the loader's own matchups; with no head-to-head
 * game on file, both render nothing rather than "0 of 0".
 */
export function YourWeekProgressBar({ progress }: { progress: YourWeekProgress }) {
  const m = useMessages(yourWeekGlanceMessages)
  if (progress.headToHead === 0) return null
  const pct = Math.round((progress.decided / progress.headToHead) * 100)
  return (
    <div className="af-wk-progress" data-testid="your-week-progress">
      <span className="af-wk-progress-label">{m.progress(progress.decided, progress.headToHead)}</span>
      <div
        className="af-wk-progress-bar"
        role="progressbar"
        aria-label={m.progressAria}
        aria-valuemin={0}
        aria-valuemax={progress.headToHead}
        aria-valuenow={progress.decided}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function YourWeekGlance({ progress }: { progress: YourWeekProgress }) {
  const m = useMessages(yourWeekGlanceMessages)
  if (progress.headToHead === 0) return null
  return (
    <StatStrip
      className="af-wk-glance"
      ariaLabel={m.glanceAria}
      testId="your-week-glance"
      items={[
        { key: 'coin', label: m.coinFlips, value: progress.coinFlips, sub: m.coinFlipsSub, tone: 'warn' },
        { key: 'live', label: m.live, value: progress.live, sub: m.liveSub, tone: 'accent' },
        { key: 'todo', label: m.notStarted, value: progress.notStarted, sub: m.notStartedSub },
        { key: 'done', label: m.decided, value: progress.decided, sub: m.decidedSub, tone: 'good' },
      ]}
    />
  )
}
