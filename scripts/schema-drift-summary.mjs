/**
 * Renders the schema drift guard's result as markdown, for the Actions job summary and the alert
 * issue. Used by .github/workflows/schema-drift.yml.
 *
 *   node scripts/schema-drift-summary.mjs --rc <exit> --report drift.json --stderr drift.err --out drift-summary.md
 *
 * A separate file rather than inline YAML so it is unit-tested, and because markdown full of
 * backticks inside a shell-quoted `node -e` is exactly where a quoting slip turns into a silently
 * empty issue body.
 *
 * ⚠ ONLY TWO INPUTS PRODUCE A VERDICT: exit 0 with a readable report, and exit 1 with a readable
 * report. Every other combination — exit 2, a missing exit code, an unparseable report — renders
 * as "could not measure", never as clean. A summary that says "✅" because it failed to read the
 * report is the false clean the guard was rebuilt to remove.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAX_ITEMS = 60

/**
 * @param {{ rc: string, report: unknown, stderr: string }} input
 * @returns {{ verdict: 'clean' | 'drift' | 'unmeasured', markdown: string }}
 */
export function renderDriftSummary({ rc, report, stderr }) {
  const r = report && typeof report === 'object' ? /** @type {any} */ (report) : null
  const readable = r !== null && typeof r.target === 'string' && Array.isArray(r.added)

  if (rc === '0' && readable) {
    const lines = [
      `✅ **No new schema drift.** Target: ${r.target}.`,
      '',
      `${r.items} clause(s) in the diff, ${r.destructive} destructive, all already in the baseline.`,
    ]
    if (Array.isArray(r.resolved) && r.resolved.length > 0) {
      lines.push('', `${r.resolved.length} baseline item(s) are no longer in the diff. Tighten with \`npm run db:drift:baseline\` in a reviewed PR.`)
    }
    return { verdict: 'clean', markdown: `${lines.join('\n')}\n` }
  }

  if (rc === '1' && readable && r.added.length > 0) {
    const added = [...r.added].sort((a, b) => Number(b.destructive) - Number(a.destructive))
    const destructive = added.filter((i) => i.destructive).length
    const lines = [
      `🛑 **${added.length} new schema drift item(s)** not in \`scripts/schema-drift-baseline.json\`, ${destructive} destructive. Target: ${r.target}.`,
      '',
      '```',
      ...added.slice(0, MAX_ITEMS).map((i) => `${i.destructive ? '!' : '+'} [${i.kind}] ${String(i.text).slice(0, 240)}`),
      ...(added.length > MAX_ITEMS ? [`… ${added.length - MAX_ITEMS} more`] : []),
      '```',
      '',
      '`!` items remove or rewrite live objects if the diff is applied. `+` items are schema the database lacks, which raises P2021/P2022 once code queries it.',
      '',
      'Resolve deliberately: a scoped migration, a model matching production, or, if the drift is accepted, `npm run db:drift:baseline` in a reviewed PR. **Never apply the full diff.**',
    ]
    return { verdict: 'drift', markdown: `${lines.join('\n')}\n` }
  }

  const tail = String(stderr ?? '').trim().split('\n').slice(-15).join('\n')
  const why = readable ? `exit ${rc}` : `exit ${rc}, report unreadable`
  const lines = [
    `⚠ **The schema drift guard could not measure** (${why}). This is not a verdict either way.`,
    '',
    '```',
    tail || '(no stderr)',
    '```',
  ]
  return { verdict: 'unmeasured', markdown: `${lines.join('\n')}\n` }
}

function argOf(args, name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const read = (p) => (p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')
  let report = null
  try {
    report = JSON.parse(read(argOf(args, 'report')))
  } catch {
    report = null
  }
  const { markdown } = renderDriftSummary({
    rc: String(argOf(args, 'rc') ?? 'missing'),
    report,
    stderr: read(argOf(args, 'stderr')),
  })
  const out = argOf(args, 'out')
  if (out) fs.writeFileSync(out, markdown)
  else process.stdout.write(markdown)
}
