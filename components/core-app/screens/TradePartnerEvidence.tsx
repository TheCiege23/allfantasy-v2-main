'use client'

export function TradePartnerEvidence({ notes, copy }: {
  notes: readonly string[]
  copy: (text: string) => string
}) {
  const evidence = [...new Set(notes.map(note => note.trim()).filter(Boolean))]
  return <div className="af-tc-partner-evidence">
    {evidence.length ? <details>
      <summary>{copy('What their roster shows')}</summary>
      <ul>{evidence.map((note, index) => <li key={index}>{copy(note)}</li>)}</ul>
      <p>{copy('These come from their roster. They don’t tell you what the manager wants or whether they’ll accept.')}</p>
    </details> : <p>{copy('We couldn’t read their roster for this trade. Ask what they need and whether they’re contending or rebuilding.')}</p>}
  </div>
}
