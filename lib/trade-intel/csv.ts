/**
 * Minimal quote-aware CSV parsing.
 *
 * Dependency-free and deliberately NOT inside a 'server-only' module: parsing a
 * string has nothing to do with the server, and burying it in one means any pure
 * module that needs it drags server-only (and prisma) into its import graph.
 * Vitest stubs server-only, so that mistake passes every test and only fails in
 * a real non-server context — see lib/trade-intel/gradeScale.ts for the same
 * reasoning applied to the grade bands.
 */

/** Split one CSV row, honouring quoted fields and doubled escape-quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  // Trim only. Do NOT also strip leading/trailing quotes here: the loop above
  // already consumed the field's real quoting, so stripping again corrupts any
  // value that legitimately ends in one — `"say ""hi"""` became `say "hi`.
  return out.map((v) => v.trim())
}

/**
 * Parse a whole CSV into rows keyed by header name.
 *
 * Rows with fewer cells than headers are skipped rather than padded: a short row
 * means the file is not what we think it is, and silently filling the tail with
 * empty strings would turn a parse failure into confident wrong data.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]!)
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]!)
    if (cells.length < headers.length) continue
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? ''
    })
    rows.push(row)
  }
  return rows
}
