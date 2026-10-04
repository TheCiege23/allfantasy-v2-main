'use client'

export function TradePartnerEvidence({ notes, copy }: {
  notes: readonly string[]
  copy: (text: string) => string
}) {
  const evidence = [...new Set(notes.map(note => note.trim()).filter(Boolean))]
  return <div className="af-tc-partner-evidence">
    {evidence.length ? <details>
      <summary>{copy('Partner roster evidence')}</summary>
      <ul>{evidence.map((note, index) => <li key={index}>{copy(note)}</li>)}</ul>
      <p>{copy('These are roster signals, not the manager’s preferences or an acceptance forecast.')}</p>
    </details> : <p>{copy('No partner roster evidence was returned for this analysis. Confirm their needs and timeline.')}</p>}
  </div>
}
