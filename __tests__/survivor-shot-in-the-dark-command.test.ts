import { describe, expect, it } from 'vitest'
import { parseSurvivorCommand } from '@/lib/survivor/SurvivorCommandParser'

describe('@Chimmy shot in the dark', () => {
  it('is recognised in the private Chimmy command grammar', () => {
    expect(parseSurvivorCommand('@Chimmy shot in the dark').intent).toBe('shot_in_the_dark')
    expect(parseSurvivorCommand('@chimmy play my Shot in the Dark!').intent).toBe('shot_in_the_dark')
  })

  it('does not swallow a vote for a manager whose name contains the words', () => {
    expect(parseSurvivorCommand('@Chimmy vote @ShotInTheDark').intent).toBe('vote')
  })
})
