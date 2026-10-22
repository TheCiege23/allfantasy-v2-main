'use client'

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="af-print-hide" style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #222', background: '#111', color: '#fff', fontWeight: 600 }}>
      {label}
    </button>
  )
}
