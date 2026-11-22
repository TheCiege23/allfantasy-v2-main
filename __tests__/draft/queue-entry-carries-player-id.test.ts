/**
 * 🛑 A QUEUED PLAYER WAS SAVED WITHOUT HIS ID, SO AUTOPICK DRAFTED HIM WITHOUT ONE. Live NFL draft,
 * 2026-11-19: of 120 picks, the two with no id were the two the manager had queued.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { queueEntryFromPlayer, stablePoolPlayerId } from '@/lib/draft-queue-engine/queueEntryFromPlayer'
import { normalizeQueueEntries } from '@/lib/draft-queue-engine'

describe('queueEntryFromPlayer', () => {
  it('🛑 the queue row carries the pool row’s id', () => {
    expect(queueEntryFromPlayer({ name: 'Kenneth Walker III', position: 'RB', team: 'KC', playerId: '8151' })).toEqual({
      playerName: 'Kenneth Walker III', position: 'RB', team: 'KC', playerId: '8151',
    })
  })
  it('and the id survives the server’s own normalizing of a saved queue', () => {
    const [saved] = normalizeQueueEntries([queueEntryFromPlayer({ name: 'Caleb Williams', position: 'QB', team: 'CHI', display: { playerId: '11560' } })], 25)
    expect(saved).toMatchObject({ playerName: 'Caleb Williams', playerId: '11560' })
  })
  it('a pool row with no id gives a row with none, not a made-up one', () => {
    expect(queueEntryFromPlayer({ name: 'Nobody', position: 'WR' }).playerId).toBeNull()
  })
})

describe('stablePoolPlayerId', () => {
  it('prefers a plain id over a namespaced one, from either field', () => {
    expect(stablePoolPlayerId({ display: { playerId: 'NFL:8150' }, playerId: '8150' })).toBe('8150')
    expect(stablePoolPlayerId({ display: { playerId: '8150' }, playerId: 'NFL:8150' })).toBe('8150')
  })
  it('a namespaced id is better than none', () => {
    expect(stablePoolPlayerId({ display: { playerId: 'NFL:8150' } })).toBe('NFL:8150')
    expect(stablePoolPlayerId({ playerId: ' ' })).toBeNull()
  })
})

describe('the two places that drafted without an id', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
  it('the draft room builds a queue row through the helper', () => {
    expect(read('components/app/draft-room/DraftRoomPageClient.tsx')).toMatch(/^\s*const entry: QueueEntry = queueEntryFromPlayer\(player\)$/m)
  })
  it('an AI manager’s pick is submitted with a player id', () => {
    expect(read('lib/orphan-ai-manager/OrphanAIManagerService.ts')).toMatch(/^\s*playerId: poolIdOf\.get\(poolKey\(pickResult\.player\.name, pickResult\.player\.position\)\) \|\| null,$/m)
  })
})
