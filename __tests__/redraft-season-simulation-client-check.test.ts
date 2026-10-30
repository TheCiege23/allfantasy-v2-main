/**
 * The full-season simulations build every table from the generated Prisma client, so a client generated
 * before a model was added must fail with a message that names the cause, not as an engine crash.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInMemoryPrisma, modelsMissingFromClient } from './redraft-season-simulation/inMemoryPrisma'

const SCHEMA = `model PlayerWeeklyScore {\n  id String @id\n}\n\nmodel PlayerDailyScore {\n  id String @id\n}\n// model NotAModel {\nenum Status {\n  A\n}\n`

describe('in-memory prisma: client vs schema', () => {
  it('names the schema models a stale client does not know', () => {
    expect(modelsMissingFromClient(SCHEMA, new Set(['PlayerWeeklyScore']))).toEqual(['PlayerDailyScore'])
    expect(modelsMissingFromClient(SCHEMA, new Set(['PlayerWeeklyScore', 'PlayerDailyScore']))).toEqual([])
  })

  it('the client in this checkout matches its schema, so the simulations can build', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
    expect(modelsMissingFromClient(schema)).toEqual([])
    expect(() => createInMemoryPrisma()).not.toThrow()
  })
})
