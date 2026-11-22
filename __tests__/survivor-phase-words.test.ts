/** The commissioner's command center prints a survivor phase in words, never the stored key. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { survivorPhaseWords } from '@/lib/survivor/survivorPhaseWords'

describe('survivorPhaseWords', () => {
  it('names the phases a game moves through', () => {
    expect(survivorPhaseWords('pre_merge')).toBe('Before the merge')
    expect(survivorPhaseWords('post_swap')).toBe('After the tribe swap')
    expect(survivorPhaseWords('post_merge')).toBe('After the merge')
    expect(survivorPhaseWords('finale')).toBe('Finale')
  })
  it('never shows an unknown key raw', () => {
    expect(survivorPhaseWords('some_new_phase')).toBe('Some new phase')
  })
  it('has nothing to say about no phase', () => {
    expect(survivorPhaseWords(null)).toBeNull()
    expect(survivorPhaseWords('  ')).toBeNull()
  })
})

describe('the command center uses it', () => {
  const src = readFileSync(join(process.cwd(), 'components/survivor/SurvivorCommissionerDashboard.tsx'), 'utf8')
  it('prints no raw phase', () => {
    expect(src).not.toMatch(/^.*\{gs\?\.phase \?\? /m)
    expect(src.match(/survivorPhaseWords\(gs\?\.phase\)/g)?.length).toBe(2)
  })
})
