/**
 * ToolAIEntryResolver maps each AI tool to the route that serves it. Its `psychological` and
 * `psychological_profiles` entries pointed at psychological-profiles/explain, which Milestone 32
 * retired to a constant 410. A registry that names a dead route is how a button ships pointing at
 * one, so this pins that no entry resolves to a retired profile route file.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAllToolEntries, getApiPathForTool, getToolEntry } from '@/lib/unified-ai/ToolAIEntryResolver'

function routeFileFor(apiPath: string): string | null {
  const file = path.join(process.cwd(), 'app', apiPath.replace(/^\//, ''), 'route.ts')
  return existsSync(file) ? file : null
}

describe('ToolAIEntryResolver — no entry points at a retired profile route', () => {
  it('no resolvable route file behind any entry is a retiredProfileRoute', () => {
    const resolved = getAllToolEntries()
      .map((entry) => ({ key: entry.key, file: routeFileFor(entry.apiPath) }))
      .filter((row): row is { key: typeof row.key; file: string } => row.file != null)
    // Positive control: the check really reads route files, not an empty list.
    expect(resolved.length).toBeGreaterThan(5)
    const retired = resolved.filter((row) => readFileSync(row.file, 'utf8').includes('retiredProfileRoute'))
    expect(retired.map((row) => row.key)).toEqual([])
  })

  it('the psychological keys resolve to nothing rather than to a 410', () => {
    // No longer members of ToolAIEntryKey (2026-09-29); an untyped caller still gets nothing.
    type Key = Parameters<typeof getToolEntry>[0]
    expect(getToolEntry('psychological' as Key)).toBeNull()
    expect(getToolEntry('psychological_profiles' as Key)).toBeNull()
    expect(getApiPathForTool('psychological' as Key, 'L1')).toBe('')
    expect(getAllToolEntries().filter((e) => /psych/i.test(`${e.key} ${e.label}`))).toEqual([])
    // Live entries still resolve.
    expect(getApiPathForTool('rivalries', 'L1')).toBe('/api/leagues/L1/rivalries/explain')
  })
})
