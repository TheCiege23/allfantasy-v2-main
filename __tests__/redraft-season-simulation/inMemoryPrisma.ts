/**
 * An in-memory stand-in for the Prisma client, driven by the generated client's own DMMF, for the
 * full-season simulations. Nothing here opens a connection: every model is a JS array.
 *
 * It implements the subset of the query API the redraft season engines use — `findUnique/First/Many`,
 * `create/createMany`, `update/updateMany`, `upsert`, `delete/deleteMany`, `count`, `aggregate`,
 * `$transaction` — with real `where` filters (scalar operators, AND/OR/NOT, compound unique keys,
 * relation filters), `select`/`include` across relations, `orderBy`, `take`, `skip` and `distinct`.
 * Relations, defaults (`cuid()`, `now()`, literals) and `@updatedAt` come from the schema, so a query
 * the real schema would reject (an unknown field, a missing required column, a duplicate unique key)
 * throws here too instead of quietly succeeding.
 *
 * `$queryRaw` / `$executeRaw` return empty results; a simulation that depends on raw SQL is out of scope.
 */
import { Prisma } from '@prisma/client'

type Row = Record<string, any>
type DmmfField = (typeof Prisma.dmmf.datamodel.models)[number]['fields'][number]
type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number]

const MODELS = new Map<string, DmmfModel>(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]))
const DELEGATE_TO_MODEL = new Map<string, string>(
  [...MODELS.keys()].map((name) => [name.charAt(0).toLowerCase() + name.slice(1), name]),
)

export class InMemoryPrismaError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'PrismaClientKnownRequestError'
  }
}

function isPlainObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function fieldOf(model: DmmfModel, name: string): DmmfField | undefined {
  return model.fields.find((f) => f.name === name)
}

function uniqueKeySets(model: DmmfModel): string[][] {
  const sets: string[][] = []
  const id = model.fields.find((f) => f.isId)
  if (id) sets.push([id.name])
  if (model.primaryKey?.fields?.length) sets.push([...model.primaryKey.fields])
  for (const f of model.fields) if (f.isUnique) sets.push([f.name])
  for (const u of model.uniqueFields) sets.push([...u])
  return sets
}

function compoundKeyName(fields: readonly string[]): string {
  return fields.join('_')
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  const av = a instanceof Date ? a.getTime() : a
  const bv = b instanceof Date ? b.getTime() : b
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av).localeCompare(String(bv))
}

function scalarEquals(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : a == null ? a : new Date(a as string).getTime()
    const bt = b instanceof Date ? b.getTime() : b == null ? b : new Date(b as string).getTime()
    return at === bt
  }
  if (isPlainObject(a) || Array.isArray(a)) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

function coerceForField(field: DmmfField | undefined, value: unknown): unknown {
  if (value == null || !field) return value
  if (field.type === 'DateTime' && !(value instanceof Date)) return new Date(value as string)
  return value
}

export type InMemoryPrisma = Record<string, any> & {
  $tables: Map<string, Row[]>
  $rawQueries: string[]
}

export function createInMemoryPrisma(): InMemoryPrisma {
  const tables = new Map<string, Row[]>()
  const rawQueries: string[] = []
  let autoincrement = 1
  let idCounter = 1

  const table = (modelName: string): Row[] => {
    let rows = tables.get(modelName)
    if (!rows) {
      rows = []
      tables.set(modelName, rows)
    }
    return rows
  }

  const nextId = (modelName: string) => `${modelName.slice(0, 6).toLowerCase()}_${String(idCounter++).padStart(6, '0')}`

  // ---------------------------------------------------------------- where

  function matchScalar(field: DmmfField | undefined, value: unknown, filter: unknown): boolean {
    if (filter === undefined) return true
    if (filter === null) return value == null
    const jsonOperators = isPlainObject(filter) && ('equals' in filter || 'not' in filter || 'path' in filter)
    if (!isPlainObject(filter) || (field?.type === 'Json' && !jsonOperators)) {
      return scalarEquals(value, coerceForField(field, filter))
    }
    const insensitive = filter.mode === 'insensitive'
    const norm = (v: unknown) => (insensitive && typeof v === 'string' ? v.toLowerCase() : v)
    for (const [op, raw] of Object.entries(filter)) {
      if (raw === undefined || op === 'mode') continue
      const operand = Array.isArray(raw) ? raw.map((r) => coerceForField(field, r)) : coerceForField(field, raw)
      switch (op) {
        case 'equals':
          if (operand === null ? value != null : !scalarEquals(norm(value), norm(operand))) return false
          break
        case 'in':
          if (!(operand as unknown[]).some((o) => scalarEquals(norm(value), norm(o)))) return false
          break
        case 'notIn':
          if ((operand as unknown[]).some((o) => scalarEquals(norm(value), norm(o)))) return false
          break
        case 'not':
          if (isPlainObject(operand)) {
            if (matchScalar(field, value, operand)) return false
          } else if (operand === null ? value == null : scalarEquals(norm(value), norm(operand))) return false
          break
        case 'lt':
          if (value == null || compareValues(value, operand) >= 0) return false
          break
        case 'lte':
          if (value == null || compareValues(value, operand) > 0) return false
          break
        case 'gt':
          if (value == null || compareValues(value, operand) <= 0) return false
          break
        case 'gte':
          if (value == null || compareValues(value, operand) < 0) return false
          break
        case 'contains':
          if (typeof value !== 'string' || !String(norm(value)).includes(String(norm(operand)))) return false
          break
        case 'startsWith':
          if (typeof value !== 'string' || !String(norm(value)).startsWith(String(norm(operand)))) return false
          break
        case 'endsWith':
          if (typeof value !== 'string' || !String(norm(value)).endsWith(String(norm(operand)))) return false
          break
        case 'has':
          if (!Array.isArray(value) || !value.some((v) => scalarEquals(v, operand))) return false
          break
        case 'hasSome':
          if (!Array.isArray(value) || !(operand as unknown[]).some((o) => value.some((v) => scalarEquals(v, o)))) return false
          break
        case 'hasEvery':
          if (!Array.isArray(value) || !(operand as unknown[]).every((o) => value.some((v) => scalarEquals(v, o)))) return false
          break
        case 'isEmpty':
          if (!Array.isArray(value) || (value.length === 0) !== Boolean(operand)) return false
          break
        case 'path': {
          const path = Array.isArray(raw) ? raw : [raw]
          let cursor: any = value
          for (const key of path) cursor = cursor == null ? undefined : cursor[key as string]
          const rest = { ...filter }
          delete rest.path
          return matchScalar(undefined, cursor, Object.keys(rest).length ? rest : undefined)
        }
        default:
          throw new Error(`in-memory prisma: unsupported filter operator "${op}" on ${field?.name ?? 'field'}`)
      }
    }
    return true
  }

  function matches(model: DmmfModel, row: Row, where: unknown): boolean {
    if (where == null) return true
    if (!isPlainObject(where)) throw new Error(`in-memory prisma: where on ${model.name} must be an object`)
    for (const [key, filter] of Object.entries(where)) {
      if (filter === undefined) continue
      if (key === 'AND') {
        if (!(Array.isArray(filter) ? filter : [filter]).every((w) => matches(model, row, w))) return false
        continue
      }
      if (key === 'OR') {
        if (!(filter as unknown[]).some((w) => matches(model, row, w))) return false
        continue
      }
      if (key === 'NOT') {
        if ((Array.isArray(filter) ? filter : [filter]).some((w) => matches(model, row, w))) return false
        continue
      }
      const field = fieldOf(model, key)
      if (!field) {
        const named = [...model.uniqueIndexes, ...(model.primaryKey ? [model.primaryKey] : [])].find((u) => u.name === key)
        const compound = named
          ? named.fields
          : uniqueKeySets(model).find((fields) => fields.length > 1 && compoundKeyName(fields) === key)
        if (compound && isPlainObject(filter)) {
          if (!matches(model, row, filter)) return false
          continue
        }
        throw new Error(`in-memory prisma: unknown field "${key}" in where on ${model.name}`)
      }
      if (field.kind === 'object') {
        if (!matchRelation(model, row, field, filter)) return false
        continue
      }
      if (!matchScalar(field, row[key], filter)) return false
    }
    return true
  }

  function relatedRows(model: DmmfModel, row: Row, field: DmmfField): Row[] {
    const target = MODELS.get(field.type)!
    const rows = table(target.name)
    if (field.relationFromFields?.length) {
      const from = field.relationFromFields
      const to = field.relationToFields ?? []
      if (from.some((f) => row[f] == null)) return []
      return rows.filter((r) => from.every((f, i) => scalarEquals(r[to[i]!], row[f])))
    }
    const back = target.fields.find(
      (f) => f.kind === 'object' && f.relationName === field.relationName && f.type === model.name && f !== field,
    )
    if (!back?.relationFromFields?.length) return []
    const from = back.relationFromFields
    const to = back.relationToFields ?? []
    return rows.filter((r) => from.every((f, i) => scalarEquals(r[f], row[to[i]!])))
  }

  function matchRelation(model: DmmfModel, row: Row, field: DmmfField, filter: unknown): boolean {
    const target = MODELS.get(field.type)!
    const related = relatedRows(model, row, field)
    if (field.isList) {
      const f = (filter ?? {}) as Row
      if ('some' in f) return related.some((r) => matches(target, r, f.some))
      if ('every' in f) return related.every((r) => matches(target, r, f.every))
      if ('none' in f) return !related.some((r) => matches(target, r, f.none))
      throw new Error(`in-memory prisma: list relation filter on ${model.name}.${field.name} needs some/every/none`)
    }
    if (filter === null) return related.length === 0
    const f = filter as Row
    if ('is' in f) return f.is === null ? related.length === 0 : related.some((r) => matches(target, r, f.is))
    if ('isNot' in f) return f.isNot === null ? related.length > 0 : !related.some((r) => matches(target, r, f.isNot))
    return related.some((r) => matches(target, r, f))
  }

  // ---------------------------------------------------------------- read shaping

  function sortRows(model: DmmfModel, rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows
    const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o as Row))
    return [...rows].sort((a, b) => {
      for (const [key, dir] of specs) {
        if (!fieldOf(model, key) || fieldOf(model, key)!.kind === 'object') continue
        const direction = isPlainObject(dir) ? dir.sort : dir
        const c = compareValues(a[key], b[key])
        if (c !== 0) return direction === 'desc' ? -c : c
      }
      return 0
    })
  }

  function countRelations(model: DmmfModel, row: Row, spec: unknown): Row {
    const select = isPlainObject(spec) && isPlainObject(spec.select) ? spec.select : null
    const out: Row = {}
    for (const field of model.fields.filter((f) => f.kind === 'object' && f.isList)) {
      if (select && !select[field.name]) continue
      const cfg = select?.[field.name]
      const where = isPlainObject(cfg) ? cfg.where : undefined
      out[field.name] = relatedRows(model, row, field).filter((r) => matches(MODELS.get(field.type)!, r, where)).length
    }
    return out
  }

  function shape(model: DmmfModel, row: Row, args: Row | undefined): Row {
    const select = args?.select
    const include = args?.include
    const out: Row = {}
    if (select) {
      for (const [key, spec] of Object.entries(select)) {
        if (!spec) continue
        if (key === '_count') {
          out._count = countRelations(model, row, spec)
          continue
        }
        const field = fieldOf(model, key)
        if (!field) throw new Error(`in-memory prisma: unknown field "${key}" in select on ${model.name}`)
        out[key] = field.kind === 'object' ? readRelation(model, row, field, spec === true ? {} : (spec as Row)) : clone(row[key])
      }
      return out
    }
    for (const field of model.fields) if (field.kind !== 'object') out[field.name] = clone(row[field.name])
    for (const [key, spec] of Object.entries(include ?? {})) {
      if (!spec) continue
      if (key === '_count') {
        out._count = countRelations(model, row, spec)
        continue
      }
      const field = fieldOf(model, key)
      if (!field || field.kind !== 'object') throw new Error(`in-memory prisma: unknown relation "${key}" in include on ${model.name}`)
      out[key] = readRelation(model, row, field, spec === true ? {} : (spec as Row))
    }
    return out
  }

  function readRelation(model: DmmfModel, row: Row, field: DmmfField, args: Row): unknown {
    const target = MODELS.get(field.type)!
    let rows = relatedRows(model, row, field)
    if (!field.isList) return rows[0] ? shape(target, rows[0], args) : null
    rows = rows.filter((r) => matches(target, r, args.where))
    rows = sortRows(target, rows, args.orderBy)
    if (args.skip) rows = rows.slice(args.skip)
    if (args.take != null) rows = args.take >= 0 ? rows.slice(0, args.take) : rows.slice(args.take)
    return rows.map((r) => shape(target, r, args))
  }

  function findRows(model: DmmfModel, args: Row = {}): Row[] {
    let rows = table(model.name).filter((r) => matches(model, r, args.where))
    rows = sortRows(model, rows, args.orderBy)
    if (args.distinct) {
      const keys = Array.isArray(args.distinct) ? args.distinct : [args.distinct]
      const seen = new Set<string>()
      rows = rows.filter((r) => {
        const k = JSON.stringify(keys.map((key: string) => (r[key] instanceof Date ? r[key].getTime() : r[key])))
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    }
    if (args.skip) rows = rows.slice(args.skip)
    if (args.take != null) rows = args.take >= 0 ? rows.slice(0, args.take) : rows.slice(args.take)
    return rows
  }

  // ---------------------------------------------------------------- writes

  function defaultFor(field: DmmfField): unknown {
    if (field.isUpdatedAt) return new Date()
    if (!field.hasDefaultValue) return field.isList ? [] : null
    const d = field.default as any
    if (isPlainObject(d) && typeof d.name === 'string') {
      if (d.name === 'cuid' || d.name === 'uuid' || d.name === 'nanoid') return null
      if (d.name === 'now') return new Date()
      if (d.name === 'autoincrement') return autoincrement++
      return null
    }
    if (field.type === 'DateTime' && typeof d === 'string') return new Date(d)
    if (field.kind === 'enum' || typeof d !== 'object') return d
    return clone(d)
  }

  // Unique keys are checked through an index per model, rebuilt after anything but an insert: a season
  // writes tens of thousands of stat and lineup rows, and a scan per insert made that quadratic.
  const uniqueIndexes = new Map<string, Map<string, Map<string, Row>>>()
  const keyOf = (row: Row, fields: readonly string[]) =>
    fields.some((f) => row[f] == null) ? null : JSON.stringify(fields.map((f) => (row[f] instanceof Date ? row[f].getTime() : row[f])))
  const markDirty = (modelName: string) => uniqueIndexes.delete(modelName)

  function indexFor(model: DmmfModel): Map<string, Map<string, Row>> {
    let index = uniqueIndexes.get(model.name)
    if (!index) {
      index = new Map()
      for (const fields of uniqueKeySets(model)) {
        const byKey = new Map<string, Row>()
        for (const row of table(model.name)) {
          const key = keyOf(row, fields)
          if (key != null) byKey.set(key, row)
        }
        index.set(fields.join(','), byKey)
      }
      uniqueIndexes.set(model.name, index)
    }
    return index
  }

  function assertUnique(model: DmmfModel, candidate: Row, ignore?: Row) {
    const index = indexFor(model)
    for (const fields of uniqueKeySets(model)) {
      const key = keyOf(candidate, fields)
      if (key == null) continue
      const clash = index.get(fields.join(','))?.get(key)
      if (clash && clash !== ignore) throw new InMemoryPrismaError('P2002', `Unique constraint failed on ${model.name}(${fields.join(', ')})`)
    }
  }

  function indexInsert(model: DmmfModel, row: Row) {
    const index = indexFor(model)
    for (const fields of uniqueKeySets(model)) {
      const key = keyOf(row, fields)
      if (key != null) index.get(fields.join(','))?.set(key, row)
    }
  }

  function applyScalar(field: DmmfField, current: unknown, value: unknown): unknown {
    if (isPlainObject(value) && field.type !== 'Json') {
      if ('set' in value) return coerceForField(field, value.set)
      if ('increment' in value) return Number(current ?? 0) + Number(value.increment)
      if ('decrement' in value) return Number(current ?? 0) - Number(value.decrement)
      if ('multiply' in value) return Number(current ?? 0) * Number(value.multiply)
      if ('divide' in value) return Number(current ?? 0) / Number(value.divide)
      if ('push' in value) return [...((current as unknown[]) ?? []), ...(Array.isArray(value.push) ? value.push : [value.push])]
    }
    return clone(coerceForField(field, value))
  }

  type Deferred = () => void

  function resolveConnect(target: DmmfModel, where: Row): Row {
    const found = table(target.name).find((r) => matches(target, r, where))
    if (!found) throw new InMemoryPrismaError('P2025', `No ${target.name} found to connect`)
    return found
  }

  function createRow(model: DmmfModel, data: Row, deferred: Deferred[]): Row {
    const row: Row = {}
    for (const field of model.fields) if (field.kind !== 'object') row[field.name] = defaultFor(field)
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      const field = fieldOf(model, key)
      if (!field) throw new Error(`in-memory prisma: unknown field "${key}" in create on ${model.name}`)
      if (field.kind === 'object') {
        writeRelation(model, row, field, value as Row, deferred, true)
        continue
      }
      row[key] = applyScalar(field, undefined, value)
    }
    const id = model.fields.find((f) => f.isId)
    if (id && row[id.name] == null) row[id.name] = id.type === 'Int' ? autoincrement++ : nextId(model.name)
    for (const field of model.fields) {
      if (field.kind === 'object' || !field.isRequired || field.isList) continue
      if (row[field.name] == null) {
        throw new InMemoryPrismaError('P2011', `Null constraint violation on ${model.name}.${field.name}`)
      }
    }
    assertUnique(model, row)
    table(model.name).push(row)
    indexInsert(model, row)
    return row
  }

  function writeRelation(model: DmmfModel, row: Row, field: DmmfField, op: Row, deferred: Deferred[], creating: boolean) {
    const target = MODELS.get(field.type)!
    const back = target.fields.find((f) => f.kind === 'object' && f.relationName === field.relationName && f !== field)
    if (field.relationFromFields?.length) {
      // This side holds the foreign key.
      const setFk = (other: Row | null) => {
        field.relationFromFields!.forEach((f, i) => {
          row[f] = other ? other[field.relationToFields![i]!] : null
        })
      }
      if (op.connect) setFk(resolveConnect(target, op.connect))
      else if (op.create) setFk(createRow(target, op.create, deferred))
      else if (op.connectOrCreate) {
        const found = table(target.name).find((r) => matches(target, r, op.connectOrCreate.where))
        setFk(found ?? createRow(target, op.connectOrCreate.create, deferred))
      } else if (op.disconnect) setFk(null)
      else if (!creating) throw new Error(`in-memory prisma: unsupported nested write on ${model.name}.${field.name}`)
      return
    }
    // The other side holds the foreign key: write after this row has its id.
    deferred.push(() => {
      const fk = (child: Row) => {
        back!.relationFromFields!.forEach((f, i) => {
          child[f] = row[back!.relationToFields![i]!]
        })
      }
      const creates = op.create ? (Array.isArray(op.create) ? op.create : [op.create]) : []
      for (const data of creates) {
        const childData: Row = { ...data }
        back!.relationFromFields!.forEach((f, i) => {
          childData[f] = row[back!.relationToFields![i]!]
        })
        createRow(target, childData, deferred)
      }
      if (op.createMany) {
        for (const data of op.createMany.data ?? []) {
          const childData: Row = { ...data }
          back!.relationFromFields!.forEach((f, i) => {
            childData[f] = row[back!.relationToFields![i]!]
          })
          createRow(target, childData, deferred)
        }
      }
      for (const where of op.connect ? (Array.isArray(op.connect) ? op.connect : [op.connect]) : []) fk(resolveConnect(target, where))
      if (op.deleteMany !== undefined) {
        const wheres = Array.isArray(op.deleteMany) ? op.deleteMany : [op.deleteMany]
        const rows = table(target.name)
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const child = rows[i]!
          const linked = back!.relationFromFields!.every((f, j) => scalarEquals(child[f], row[back!.relationToFields![j]!]))
          if (linked && wheres.some((w: Row) => matches(target, child, w))) {
            rows.splice(i, 1)
            markDirty(target.name)
          }
        }
      }
    })
  }

  function updateRow(model: DmmfModel, row: Row, data: Row, deferred: Deferred[]) {
    const next: Row = { ...row }
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      const field = fieldOf(model, key)
      if (!field) throw new Error(`in-memory prisma: unknown field "${key}" in update on ${model.name}`)
      if (field.kind === 'object') {
        writeRelation(model, next, field, value as Row, deferred, false)
        continue
      }
      next[key] = applyScalar(field, row[key], value)
    }
    for (const field of model.fields) if (field.isUpdatedAt && data[field.name] === undefined) next[field.name] = new Date()
    assertUnique(model, next, row)
    Object.assign(row, next)
    markDirty(model.name)
  }

  function runDeferred(deferred: Deferred[]) {
    while (deferred.length) deferred.shift()!()
  }

  // ---------------------------------------------------------------- delegates

  function delegate(model: DmmfModel) {
    const findFirst = async (args: Row = {}) => {
      const [row] = findRows(model, { ...args, take: 1 })
      return row ? shape(model, row, args) : null
    }
    const notFound = () => new InMemoryPrismaError('P2025', `No ${model.name} found`)
    return {
      findUnique: findFirst,
      findFirst,
      findUniqueOrThrow: async (args: Row) => (await findFirst(args)) ?? Promise.reject(notFound()),
      findFirstOrThrow: async (args: Row) => (await findFirst(args)) ?? Promise.reject(notFound()),
      findMany: async (args: Row = {}) => findRows(model, args).map((r) => shape(model, r, args)),
      count: async (args: Row = {}) => findRows(model, { where: args.where }).length,
      create: async (args: Row) => {
        const deferred: Deferred[] = []
        const row = createRow(model, args.data ?? {}, deferred)
        runDeferred(deferred)
        return shape(model, row, args)
      },
      createMany: async (args: Row) => {
        let count = 0
        for (const data of Array.isArray(args.data) ? args.data : [args.data]) {
          try {
            const deferred: Deferred[] = []
            createRow(model, data, deferred)
            runDeferred(deferred)
            count += 1
          } catch (error) {
            if (args.skipDuplicates && (error as InMemoryPrismaError).code === 'P2002') continue
            throw error
          }
        }
        return { count }
      },
      createManyAndReturn: async (args: Row) => {
        const out: Row[] = []
        for (const data of Array.isArray(args.data) ? args.data : [args.data]) {
          const deferred: Deferred[] = []
          out.push(createRow(model, data, deferred))
          runDeferred(deferred)
        }
        return out.map((r) => shape(model, r, args))
      },
      update: async (args: Row) => {
        const row = table(model.name).find((r) => matches(model, r, args.where))
        if (!row) throw notFound()
        const deferred: Deferred[] = []
        updateRow(model, row, args.data ?? {}, deferred)
        runDeferred(deferred)
        return shape(model, row, args)
      },
      updateMany: async (args: Row = {}) => {
        const rows = table(model.name).filter((r) => matches(model, r, args.where))
        for (const row of rows) {
          const deferred: Deferred[] = []
          updateRow(model, row, args.data ?? {}, deferred)
          runDeferred(deferred)
        }
        return { count: rows.length }
      },
      upsert: async (args: Row) => {
        const row = table(model.name).find((r) => matches(model, r, args.where))
        const deferred: Deferred[] = []
        let out: Row
        if (row) {
          updateRow(model, row, args.update ?? {}, deferred)
          out = row
        } else {
          // The unique key named in `where` is part of the created row, as Prisma requires.
          out = createRow(model, args.create ?? {}, deferred)
        }
        runDeferred(deferred)
        return shape(model, out, args)
      },
      delete: async (args: Row) => {
        const rows = table(model.name)
        const index = rows.findIndex((r) => matches(model, r, args.where))
        if (index < 0) throw notFound()
        const [row] = rows.splice(index, 1)
        markDirty(model.name)
        return shape(model, row!, args)
      },
      deleteMany: async (args: Row = {}) => {
        const rows = table(model.name)
        let count = 0
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (matches(model, rows[i]!, args.where)) {
            rows.splice(i, 1)
            markDirty(model.name)
            count += 1
          }
        }
        return { count }
      },
      aggregate: async (args: Row = {}) => {
        const rows = findRows(model, { where: args.where })
        const out: Row = {}
        for (const op of ['_sum', '_avg', '_min', '_max'] as const) {
          if (!args[op]) continue
          out[op] = {}
          for (const key of Object.keys(args[op])) {
            const values = rows.map((r) => r[key]).filter((v) => v != null)
            if (op === '_sum') out[op][key] = values.length ? values.reduce((s, v) => s + Number(v), 0) : null
            if (op === '_avg') out[op][key] = values.length ? values.reduce((s, v) => s + Number(v), 0) / values.length : null
            if (op === '_min') out[op][key] = values.length ? [...values].sort(compareValues)[0] : null
            if (op === '_max') out[op][key] = values.length ? [...values].sort(compareValues).at(-1) : null
          }
        }
        if (args._count) out._count = args._count === true ? rows.length : Object.fromEntries(Object.keys(args._count).map((k) => [k, rows.filter((r) => k === '_all' || r[k] != null).length]))
        return out
      },
      groupBy: async (args: Row) => {
        const by: string[] = Array.isArray(args.by) ? args.by : [args.by]
        const groups = new Map<string, Row[]>()
        for (const row of findRows(model, { where: args.where })) {
          const key = JSON.stringify(by.map((b) => row[b]))
          groups.set(key, [...(groups.get(key) ?? []), row])
        }
        return [...groups.values()].map((rows) => {
          const out: Row = Object.fromEntries(by.map((b) => [b, clone(rows[0]![b])]))
          if (args._count) out._count = args._count === true ? rows.length : Object.fromEntries(Object.keys(args._count).map((k) => [k, rows.length]))
          if (args._sum) out._sum = Object.fromEntries(Object.keys(args._sum).map((k) => [k, rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)]))
          if (args._max) out._max = Object.fromEntries(Object.keys(args._max).map((k) => [k, rows.map((r) => r[k]).sort(compareValues).at(-1) ?? null]))
          return out
        })
      },
    }
  }

  const delegates = new Map<string, ReturnType<typeof delegate>>()
  const client: InMemoryPrisma = new Proxy({} as InMemoryPrisma, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop === '$tables') return tables
      if (prop === '$rawQueries') return rawQueries
      if (prop === 'then') return undefined
      if (prop === '$transaction') {
        return async (arg: unknown) => {
          if (Array.isArray(arg)) return Promise.all(arg)
          const snapshot = new Map([...tables].map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]))
          try {
            return await (arg as (tx: InMemoryPrisma) => Promise<unknown>)(client)
          } catch (error) {
            tables.clear()
            uniqueIndexes.clear()
            for (const [k, rows] of snapshot) tables.set(k, rows)
            throw error
          }
        }
      }
      if (prop === '$queryRaw' || prop === '$queryRawUnsafe') {
        return async (query: unknown) => {
          rawQueries.push(String((query as { strings?: string[] })?.strings?.join('?') ?? query))
          return []
        }
      }
      if (prop === '$executeRaw' || prop === '$executeRawUnsafe') {
        return async (query: unknown) => {
          rawQueries.push(String((query as { strings?: string[] })?.strings?.join('?') ?? query))
          return 0
        }
      }
      if (prop === '$extends') return () => client
      if (prop === '$connect' || prop === '$disconnect') return async () => undefined
      if (prop === '$on' || prop === '$use') return () => undefined
      const modelName = DELEGATE_TO_MODEL.get(prop)
      if (!modelName) return undefined
      let d = delegates.get(modelName)
      if (!d) {
        d = delegate(MODELS.get(modelName)!)
        delegates.set(modelName, d)
      }
      return d
    },
  })
  return client
}

/** Rows of one model, by its Prisma model name — for assertions. */
export function rowsOf(db: InMemoryPrisma, modelName: string): Row[] {
  if (!MODELS.has(modelName)) throw new Error(`in-memory prisma: unknown model ${modelName}`)
  return db.$tables.get(modelName) ?? []
}
