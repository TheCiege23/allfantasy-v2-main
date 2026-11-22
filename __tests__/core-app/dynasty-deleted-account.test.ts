/**
 * A Sleeper account its owner deleted reports its name as "DELETED-" plus a random id
 * ("DELETED-RD0j0D3ZJl1k", live in AFC Dreaming!'s record book on 2026-11-14). The record book says
 * "Former manager" instead, and never prints the id as a manager.
 */
import { describe, expect, it } from 'vitest'
import { deletedAccount, shownName } from '@/lib/core-app/dynastyStandingsHistory'

describe('deleted Sleeper accounts in the record book', () => {
  it('recognises the platform’s deleted-account name, and nothing else', () => {
    expect(deletedAccount('DELETED-RD0j0D3ZJl1k')).toBe(true)
    expect(deletedAccount(' DELETED-abc123 ')).toBe(true)
    expect(deletedAccount('Deleted Scenes FC')).toBe(false)
    expect(deletedAccount('DELETED')).toBe(false)
    expect(deletedAccount('TheDELETED-Team')).toBe(false)
    expect(deletedAccount(null)).toBe(false)
  })

  it('prints "Former manager" for one, and every real name unchanged', () => {
    expect(shownName('DELETED-RD0j0D3ZJl1k')).toBe('Former manager')
    expect(shownName('Dolphins (B2B Champs)')).toBe('Dolphins (B2B Champs)')
  })
})
