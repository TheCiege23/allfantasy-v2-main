import Link from 'next/link'
import { buildSeoMeta } from '@/lib/seo'
import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { ledgerRecordFor } from '@/lib/chimmy-outcomes/ledgerRecord'
import { publicTrackRecord, type PublicRecordTone } from '@/lib/chimmy-outcomes/publicTrackRecord'

/**
 * /track-record — AllFantasy's graded record, in public (owner's call, 2026-11-22).
 *
 * Every call the app grades against what happened next, across everyone, wins and misses alike
 * (`lib/chimmy-outcomes/publicTrackRecord.ts` holds the rules). Counts only: the per-user map is dropped before the
 * view is built, exactly as /api/advice-record does. One cached row, no provider, nothing per request.
 */

export const dynamic = 'force-dynamic'

export const metadata = buildSeoMeta({
  title: 'Track record: how our calls have held up | AllFantasy',
  description: 'Every start/sit swap, pickup and trade grade AllFantasy makes is checked against what happened next. This is the record, including the calls that did not hold up.',
  canonicalPath: '/track-record',
})

const TONE: Record<PublicRecordTone, { mark: string; label: string; cls: string }> = {
  held: { mark: '✓', label: 'Held up', cls: 'border-emerald-400/30 text-emerald-200' },
  not_held: { mark: '✕', label: 'Has not held up', cls: 'border-rose-400/40 text-rose-200' },
  even: { mark: '•', label: 'Reported as measured', cls: 'border-white/20 text-white/70' },
  pending: { mark: '…', label: 'Not enough graded yet', cls: 'border-white/20 text-white/60' },
}

export default async function TrackRecordPage() {
  const snapshot = await readAdviceLearningSnapshot().catch(() => null)
  const ledger = snapshot?.ledger
  const record = publicTrackRecord(ledger ? ledgerRecordFor({ ...ledger, users: {} }, null) : null)

  return (
    <main className="min-h-screen bg-[#050814] text-white">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-14 sm:px-6">
        <h1 className="text-[30px] font-black leading-tight tracking-tight sm:text-[40px]">How our calls have held up</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-white/65">
          Every start/sit swap, pickup and trade grade AllFantasy makes is saved when it is shown and checked against what
          happened next. This is the whole record{record.season ? ` for the ${record.season} season` : ''}, including the calls that did not hold up.
        </p>

        {record.lines.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/70" data-testid="track-record-empty">
            Nothing has been graded yet. Calls are graded once the games they were about have been played.
          </p>
        ) : (
          <ul className="mt-8 space-y-3" data-testid="track-record-lines">
            {record.lines.map((l) => (
              <li key={l.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" data-tone={l.tone} data-testid={`track-record-${l.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white/75">{l.title}</h2>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[l.tone].cls}`}>
                    <span aria-hidden>{TONE[l.tone].mark}</span>
                    {TONE[l.tone].label}
                  </span>
                </div>
                <p className="mt-1.5 text-xl font-bold tracking-tight">{l.headline}</p>
                <p className="mt-1 text-sm leading-relaxed text-white/60">{l.detail}</p>
              </li>
            ))}
          </ul>
        )}

        <h2 className="mt-10 text-sm font-semibold text-white">What this measures</h2>
        <p className="mt-1 text-sm leading-relaxed text-white/60" data-testid="track-record-measured">{record.measured}</p>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          A number appears only once enough calls stand behind it. The record is rebuilt every six hours, and the same
          numbers are shown inside the app beside the calls they grade.
        </p>
        <p className="mt-8 text-sm">
          <Link href="/" className="font-semibold text-cyan-300 hover:underline">Back to AllFantasy</Link>
        </p>
      </div>
    </main>
  )
}
