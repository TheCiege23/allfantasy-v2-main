/**
 * Generic CSV/file-download primitives shared across Commissioner OS
 * modules. Originally written inline in League Analytics'
 * `exportCsv.ts`; promoted here once Reports needed the identical
 * escaping/row/download logic for its own CSV export — the same "one
 * owner, many consumers" rule that promoted `CommissionerRelatedLink` to
 * Platform Contracts. Analytics' own `buildAnalyticsCsv` and Reports'
 * own report-export logic both build on these; neither re-implements
 * escaping.
 */
export function escapeCsvValue(value: string | number): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function csvRow(cells: (string | number)[]): string {
  return cells.map(escapeCsvValue).join(',')
}

/** The generic Blob-download trigger — reusable for CSV or any other text-based export format. */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
