/** Read-only, aggregate-only report. Run against the intended environment's DATABASE_URL. */
import { prisma } from '../lib/prisma'

const requestedDays = Number(process.argv[2] ?? 14)
if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 90) {
  throw new Error('Pass a whole number of days from 1 to 90')
}
const since = new Date(Date.now() - requestedDays * 86_400_000)
const sources = ['bracket_entry', 'world_cup_bracket_entry', 'playoff_bracket_entry', 'bracket_change_alert'] as const
type Source = typeof sources[number]
type Counts = { sent: number; answered: number; helpful: number; unhelpful: number }
const counts = Object.fromEntries(sources.map((source) => [source,
  { sent: 0, answered: 0, helpful: 0, unhelpful: 0 }])) as Record<Source, Counts>
const clicks = { tournament: 0, world_cup: 0, playoff: 0 }
let alertOpens = 0
let optIns = 0
let introChipClicks = 0
let cursor: string | undefined
let scanned = 0
const MAX_ROWS = 50_000
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

try {
  while (scanned < MAX_ROWS) {
    const rows = await prisma.analyticsEvent.findMany({
      where: { toolKey: 'chimmy_ai_chat', createdAt: { gte: since } },
      orderBy: { id: 'asc' }, take: Math.min(1000, MAX_ROWS - scanned),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, event: true, meta: true },
    })
    if (!rows.length) break
    scanned += rows.length
    cursor = rows.at(-1)?.id
    for (const row of rows) {
      const meta = object(row.meta)
      const detail = object(meta.metadata)
      if (row.event === 'bracket_entry_cta_click') {
        const format = detail.format
        if (format === 'tournament' || format === 'world_cup' || format === 'playoff') clicks[format]++
      }
      if (row.event === 'bracket_alert_open') alertOpens++
      if (row.event === 'bracket_alert_opt_in' && meta.action === 'enabled') optIns++
      if (row.event === 'chip_click' && detail.chipId === 'chip-my-brackets') introChipClicks++
      const source = detail.source
      if (typeof source !== 'string' || !sources.includes(source as Source)) continue
      const tally = counts[source as Source]
      if (row.event === 'message_send') tally.sent++
      if (row.event === 'response_rendered' && meta.action === 'response_success') tally.answered++
      if (row.event === 'feedback_submit' && meta.action === 'thumbs_up') tally.helpful++
      if (row.event === 'feedback_submit' && meta.action === 'thumbs_down') tally.unhelpful++
    }
    if (rows.length < 1000) break
  }
  console.log(JSON.stringify({ since: since.toISOString(), scanned, truncated: scanned >= MAX_ROWS,
    introChipClicks, entryClicks: clicks, alertOpens, optIns, conversations: counts }, null, 2))
} finally {
  await prisma.$disconnect()
}
