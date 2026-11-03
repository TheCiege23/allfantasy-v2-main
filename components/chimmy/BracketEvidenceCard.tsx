import type { BracketEvidence } from '@/lib/chimmy/bracketEvidence'

const time = (value: string) => new Date(value).toLocaleString(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
})

export function BracketEvidenceCard({ evidence }: { evidence: BracketEvidence }) {
  return (
    <aside data-testid="chimmy-bracket-evidence" aria-label="Bracket data source"
      className="mt-3 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.07] px-3 py-2 text-xs text-white/70">
      <div className="font-semibold text-cyan-200">Your bracket data</div>
      <a href={evidence.href} className="mt-1 inline-block text-white underline decoration-cyan-300/50 hover:text-cyan-200">
        {evidence.entryName} · {evidence.poolName}
      </a>
      <div className="mt-1">Entry updated {time(evidence.entryUpdatedAt)} · Read {time(evidence.readAt)}</div>
      <div>{evidence.scoreUpdatedAt
        ? `${evidence.format === 'world_cup' ? 'Challenge data last synced' : 'Leaderboard snapshot updated'} ${time(evidence.scoreUpdatedAt)}`
        : evidence.format === 'playoff'
          ? 'Entry score and rank are unavailable for this format; matchup sync times appear in the answer.'
          : evidence.format === 'world_cup' ? 'Challenge sync time unavailable' : 'Leaderboard snapshot time unavailable'}</div>
      <div className="mt-1 text-white/50">Stored bracket records. Game scores are shown only when this format has verified match data.</div>
    </aside>
  )
}
