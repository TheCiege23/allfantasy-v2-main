import 'server-only'

import { createHash } from 'node:crypto'
import { BlobNotFoundError, del, get, head, list } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { getBlobReadWriteToken } from '@/lib/blob/readWriteToken'
import {
  privateChatFileExists,
  privateChatStorageConfigured,
  privateChatStorageKind,
  putPrivateChatFile,
} from '@/lib/chat-core/privateStorage'
import {
  CHAT_UPLOAD_SCOPE_ID,
  chatUploadPrefix,
  chatUploadReadUrl,
  parseChatUploadPath,
  type ChatUploadMedia,
  type ChatUploadScope,
} from '@/lib/chat-core/chatUploadAccess'

/**
 * MOVE CHAT PHOTOS STILL SITTING IN PUBLIC BLOB STORAGE INTO PRIVATE CHAT STORAGE.
 *
 * Until 2026-09-25 three upload routes wrote chat attachments to the PUBLIC Vercel Blob store
 * (`<store>.public.blob.vercel-storage.com`), where anyone holding a link could open them without
 * signing in or belonging to the chat: `/api/chat/upload` under `chat/<leagueId>/<type>/…`,
 * `/api/shared/chat/upload` under `shared-chat/<userId>/…`, and `/api/bracket/chat-upload` under
 * `bracket-chat/<userId>/…`. All three now write PRIVATE storage and hand out only the
 * authenticated reader URL (`chatUploadReadUrl` → `/api/chat/upload?path=…`), but the rows written
 * before that still point at the public originals. This module is the one-off repair the owner
 * approved, knowing that links to those photos shared OUTSIDE the app will stop working.
 *
 * Three modes, one per admin click (`app/api/admin/chat/migrate-public-photos/route.ts`):
 *   dry-run        read-only census: every DB reference and every public blob, classified.
 *   apply          copy each referenced public blob into private storage and rewrite that one field
 *                  to the private read URL. Deletes NOTHING.
 *   delete-public  delete a public blob only when no row references it AND (its private copy is
 *                  proven to exist OR it is an orphan nothing ever pointed at).
 *
 * 🛑 NOTHING THAT LEAVES THIS MODULE CARRIES A URL, A PUBLIC PATHNAME OR A CREDENTIAL. Public
 * pathnames embed USER ids (`shared-chat/<userId>/…`) and old filenames, so a blob is identified
 * by `blobId` — a name-based UUID (v5) of its pathname — never by the pathname itself. Errors are
 * reported as fixed reason codes plus an error CLASS name, never `error.message`, because SDK and
 * S3 messages can carry bucket names, endpoints and URLs.
 *
 * ⚠ THE PRIVATE FILENAME IS THAT SAME `blobId`, AND THAT IS WHAT MAKES THE WHOLE THING SAFE TO
 * RE-RUN. `chat/<leagueId>/image/<blobId>.<ext>` is deterministic, so:
 *   - apply is idempotent: a second run finds no public reference in a moved row, and a row whose
 *     copy was written but whose rewrite failed REUSES the existing copy instead of duplicating it;
 *   - the rewritten rows ARE the manifest: delete-public finds "was this blob moved, and where to"
 *     by searching the three tables for its `blobId`, then proves each copy exists in private
 *     storage before touching the original. No schema change, no side table.
 * Random upload names are v4 UUIDs; a v5 name is only ever produced here.
 *
 * ⚠ THE SEARCH COVERS THREE TABLES — `league_chat_messages` (message, imageUrl, metadata),
 * `platform_chat_messages` (body, metadata) and `bracket_league_messages` (message, imageUrl,
 * metadata) — the ones the three public upload routes fed. "No DB row references it" means none of
 * those. Other chat tables (survivor, draft room, mock draft) were never written by those routes.
 */

export const MIGRATION_MODES = ['dry-run', 'apply', 'delete-public'] as const
export type MigrationMode = (typeof MIGRATION_MODES)[number]

/** The only public prefixes the old chat uploaders wrote. Nothing outside them is moved or deleted. */
export const PUBLIC_CHAT_PREFIXES = ['chat/', 'shared-chat/', 'bracket-chat/'] as const
export type PublicChatPrefix = (typeof PUBLIC_CHAT_PREFIXES)[number]

const PUBLIC_HOST_SUFFIX = '.public.blob.vercel-storage.com'
/** Case-insensitive SQL prefilter for "this row mentions a public Blob URL". JS does the exact parse. */
const PUBLIC_HOST_NEEDLE = `${PUBLIC_HOST_SUFFIX}/`
/** A public Blob URL inside free text or a JSON string. Trailing sentence punctuation is trimmed after. */
const PUBLIC_URL_IN_TEXT = /https?:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s"'<>()[\]{}\\|^`]+/gi
/** A private read URL as `chatUploadReadUrl` writes it; group 1 is the encoded storage path. */
const PRIVATE_READ_IN_TEXT = /\/api\/chat\/upload\?path=([^\s"'<>()[\]{}\\&#|^`]+)/g
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Fixed namespace for the name-based ids. Changing it would orphan every copy already written. */
const MIGRATION_NAMESPACE = '6f1d7c1e-8a3b-4f0e-9c52-2d7e4b9a1c30'

/** Largest object the old routes accepted (video, 100MB). Anything bigger is not one of ours. */
const MAX_BYTES = 100 * 1024 * 1024
/**
 * Wall-clock budget per call. This runs on Railway, where `export const maxDuration` is a Vercel
 * directive that nothing enforces (CLAUDE.md), so the bound has to live in the code: stop starting
 * new units after the budget and hand back `hasMore` + `nextCursor`.
 */
const DEFAULT_BUDGET_MS = 25_000
const ROW_PAGE = 500
/** Public-reference rows a single census will read before declaring itself incomplete. */
const MAX_REFERENCE_ROWS = 5_000
const NEEDLE_CHUNK = 50
const MAX_REPORTED_ITEMS = 200

const LIMITS: Record<MigrationMode, { def: number; max: number }> = {
  'dry-run': { def: 200, max: 1000 },
  apply: { def: 25, max: 100 },
  'delete-public': { def: 50, max: 200 },
}

// ─── tables ─────────────────────────────────────────────────────────────────────────────────────

export type TableName = 'league_chat_messages' | 'platform_chat_messages' | 'bracket_league_messages'
type TextField = 'message' | 'imageUrl' | 'body'
export type FieldName = TextField | 'metadata'

type TableSpec = {
  table: TableName
  scopeKind: ChatUploadScope['kind']
  scopeColumn: 'leagueId' | 'threadId'
  textFields: readonly TextField[]
  /** `PlatformChatMessage.updatedAt` is `@updatedAt`; a storage move is not an edit, so keep it. */
  keepUpdatedAt: boolean
}

const TABLES: readonly TableSpec[] = [
  { table: 'league_chat_messages', scopeKind: 'league', scopeColumn: 'leagueId', textFields: ['message', 'imageUrl'], keepUpdatedAt: false },
  { table: 'platform_chat_messages', scopeKind: 'thread', scopeColumn: 'threadId', textFields: ['body'], keepUpdatedAt: true },
  { table: 'bracket_league_messages', scopeKind: 'bracket', scopeColumn: 'leagueId', textFields: ['message', 'imageUrl'], keepUpdatedAt: false },
]

export const TABLE_FIELDS: ReadonlyArray<`${TableName}.${FieldName}`> = TABLES.flatMap((spec) =>
  [...spec.textFields, 'metadata' as const].map((field) => `${spec.table}.${field}` as const),
)

type Row = {
  id: string
  scopeId: string
  message?: string | null
  imageUrl?: string | null
  body?: string | null
  metadata?: unknown
  updatedAt?: Date | string | null
}

/**
 * The one raw query. Every search here is "rows of THIS table whose text or metadata contains ANY
 * of these needles", case-insensitively, keyset-paged by id. The SQL is only a PREFILTER — every
 * row it returns is parsed exactly in JS — so it errs towards returning too much, which for the
 * delete path is the safe direction (an extra hit means "keep").
 *
 * Table and column names come from the constant `TABLES`, never from input; needles, the page
 * cursor and nothing else are bound parameters. `strpos`, not LIKE: pathnames contain `_`, which
 * LIKE would read as a wildcard.
 */
export function buildRowSearchSql(table: TableName, needleCount: number, limit: number): string {
  const spec = TABLES.find((t) => t.table === table)
  if (!spec) throw new Error('unknown table')
  if (!Number.isInteger(needleCount) || needleCount < 1) throw new Error('needleCount must be a positive integer')
  if (!Number.isInteger(limit) || limit < 1 || limit > ROW_PAGE) throw new Error('limit out of range')
  const select = [
    `t."id" AS "id"`,
    `t."${spec.scopeColumn}" AS "scopeId"`,
    ...spec.textFields.map((f) => `t."${f}" AS "${f}"`),
    `t."metadata" AS "metadata"`,
    ...(spec.keepUpdatedAt ? [`t."updatedAt" AS "updatedAt"`] : []),
  ]
  const haystack = `lower(concat_ws(chr(10), ${[...spec.textFields.map((f) => `t."${f}"`), `t."metadata"::text`].join(', ')}))`
  const anyNeedle = Array.from({ length: needleCount }, (_, i) => `strpos(h.hay, $${i + 2}) > 0`).join(' OR ')
  return (
    `SELECT ${select.join(', ')} FROM "${spec.table}" t ` +
    `CROSS JOIN LATERAL (SELECT ${haystack} AS hay) h ` +
    `WHERE t."id" > $1 AND (${anyNeedle}) ORDER BY t."id" ASC LIMIT ${limit}`
  )
}

async function searchRows(spec: TableSpec, needles: string[], afterId: string, limit: number): Promise<Row[]> {
  const unique = [...new Set(needles.map((n) => n.toLowerCase()).filter(Boolean))]
  if (unique.length === 0) return []
  const rows = await prisma.$queryRawUnsafe<Row[]>(buildRowSearchSql(spec.table, unique.length, limit), afterId, ...unique)
  return Array.isArray(rows) ? rows : []
}

/** Every row of every table matching any needle. Chunked so no single query carries hundreds of OR arms. */
async function forEachMatchingRow(needles: string[], visit: (spec: TableSpec, row: Row, chunk: string[]) => void): Promise<void> {
  const unique = [...new Set(needles.map((n) => n.toLowerCase()).filter(Boolean))]
  for (const spec of TABLES) {
    for (let i = 0; i < unique.length; i += NEEDLE_CHUNK) {
      const chunk = unique.slice(i, i + NEEDLE_CHUNK)
      let afterId = ''
      for (;;) {
        const page = await searchRows(spec, chunk, afterId, ROW_PAGE)
        for (const row of page) visit(spec, row, chunk)
        if (page.length < ROW_PAGE) break
        afterId = page[page.length - 1].id
      }
    }
  }
}

// ─── parsing ────────────────────────────────────────────────────────────────────────────────────

type FoundUrl = { matched: string; host: string; pathname: string }

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** Every public Blob URL in a string. `matched` is the exact text, so a rewrite replaces only it. */
export function findPublicBlobUrls(text: string): FoundUrl[] {
  const out: FoundUrl[] = []
  for (const m of text.matchAll(PUBLIC_URL_IN_TEXT)) {
    const matched = m[0].replace(/[.,;:!?]+$/, '')
    try {
      const url = new URL(matched)
      const pathname = safeDecode(url.pathname.slice(1))
      if (pathname) out.push({ matched, host: url.hostname.toLowerCase(), pathname })
    } catch {
      /* not a URL after all */
    }
  }
  return out
}

function replacePublicUrls(text: string, replacements: Map<string, string>): string {
  if (replacements.size === 0) return text
  return text.replace(PUBLIC_URL_IN_TEXT, (m) => {
    const trimmed = m.replace(/[.,;:!?]+$/, '')
    const next = replacements.get(trimmed)
    return next ? next + m.slice(trimmed.length) : m
  })
}

const MAX_DEPTH = 32

/** A JSON path that is safe to report: plain identifier keys verbatim, anything else as `*`. */
function childPath(path: string, key: string): string {
  const seg = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : '*'
  return path ? `${path}.${seg}` : seg
}

function walkStrings(value: unknown, path: string, visit: (s: string, path: string) => void, depth = 0): void {
  if (depth > MAX_DEPTH) return
  if (typeof value === 'string') return visit(value, path)
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit, depth + 1))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) walkStrings(v, childPath(path, k), visit, depth + 1)
  }
}

/**
 * The same JSON with only its STRING LEAVES passed through `replace`. Every key, number, boolean,
 * null and array position is carried over as it was, so a rewrite of `attachments[0].url` cannot
 * disturb `attachments[0].type`, `reactions`, `poll` or anything else stored beside it.
 */
function rewriteStrings(value: unknown, replace: (s: string) => string, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value
  if (typeof value === 'string') return replace(value)
  if (Array.isArray(value)) return value.map((v) => rewriteStrings(v, replace, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rewriteStrings(v, replace, depth + 1)
    return out
  }
  return value
}

type Occurrence = { field: FieldName; jsonPath: string | null; url: FoundUrl }

function occurrencesIn(spec: TableSpec, row: Row): Occurrence[] {
  const out: Occurrence[] = []
  for (const field of spec.textFields) {
    const value = row[field]
    if (typeof value === 'string') for (const url of findPublicBlobUrls(value)) out.push({ field, jsonPath: null, url })
  }
  walkStrings(row.metadata, '', (s, path) => {
    for (const url of findPublicBlobUrls(s)) out.push({ field: 'metadata', jsonPath: path || null, url })
  })
  return out
}

/** Private storage paths referenced (as read URLs) anywhere in a row. */
function privatePathsIn(spec: TableSpec, row: Row): string[] {
  const out: string[] = []
  const collect = (s: string) => {
    for (const m of s.matchAll(PRIVATE_READ_IN_TEXT)) {
      // In free text the read URL is often followed by sentence punctuation ("…/x.png. nice").
      // A path we write always ends in `.<ext>`, so a trailing `.` is never part of it — and
      // keeping it would look up `x.png.`, find nothing, and misreport the copy as missing.
      const path = safeDecode(m[1].replace(/[.,;:!?]+$/, ''))
      if (path && parseChatUploadPath(path)) out.push(path)
    }
  }
  for (const field of spec.textFields) {
    const value = row[field]
    if (typeof value === 'string') collect(value)
  }
  walkStrings(row.metadata, '', (s) => collect(s))
  return out
}

/** A name-based (v5) UUID of a public pathname: the blob's reportable id AND its private filename. */
export function publicBlobId(pathname: string): string {
  const ns = Buffer.from(MIGRATION_NAMESPACE.replace(/-/g, ''), 'hex')
  const bytes = Buffer.from(createHash('sha1').update(ns).update(pathname, 'utf8').digest().subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = bytes.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function prefixOf(pathname: string): PublicChatPrefix | null {
  return PUBLIC_CHAT_PREFIXES.find((p) => pathname.startsWith(p)) ?? null
}

/**
 * Types the private reader may serve, mirroring what the upload routes accept. Anything else is
 * stored as an opaque `file` (`application/octet-stream`), which the reader serves as a download —
 * never as something rendered on our origin.
 */
const STORED_TYPES: Record<string, { media: ChatUploadMedia; ext: string }> = {
  'image/jpeg': { media: 'image', ext: 'jpg' },
  'image/png': { media: 'image', ext: 'png' },
  'image/gif': { media: 'image', ext: 'gif' },
  'image/webp': { media: 'image', ext: 'webp' },
  'video/mp4': { media: 'video', ext: 'mp4' },
  'video/webm': { media: 'video', ext: 'webm' },
  'video/quicktime': { media: 'video', ext: 'mov' },
  'audio/webm': { media: 'voice', ext: 'webm' },
  'audio/mp4': { media: 'voice', ext: 'm4a' },
  'audio/ogg': { media: 'voice', ext: 'ogg' },
  'audio/wav': { media: 'voice', ext: 'wav' },
  'application/pdf': { media: 'file', ext: 'pdf' },
  'text/plain': { media: 'file', ext: 'txt' },
  'text/csv': { media: 'file', ext: 'csv' },
}

type Target = { path: string; contentType: string }

/** Where a public blob lands for one chat: `chat/<leagueId>/image/<blobId>.jpg` and its siblings. */
export function privateTargetFor(scope: ChatUploadScope, pathname: string, contentType: string | null | undefined): Target | null {
  if (!CHAT_UPLOAD_SCOPE_ID.test(scope.id)) return null
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  const known = STORED_TYPES[type]
  const path = `${chatUploadPrefix(scope)}/${known?.media ?? 'file'}/${publicBlobId(pathname)}.${known?.ext ?? 'bin'}`
  // Only a path the reader itself would accept is worth writing: anything else is unreadable.
  return parseChatUploadPath(path) ? { path, contentType: known ? type : 'application/octet-stream' } : null
}

// ─── storage ────────────────────────────────────────────────────────────────────────────────────

type PublicStore = { token: string; host: string }

/**
 * The public store the old uploaders wrote to, and its hostname. The host is derived from the
 * token exactly as `@vercel/blob` derives it (`vercel_blob_rw_<storeId>_…`), so a reference counts
 * as "ours" only when it points at the store this token can read and delete — a URL on any OTHER
 * store is reported and left alone, never fetched with our token.
 */
function publicStore(): PublicStore | null {
  const token = getBlobReadWriteToken()
  if (!token) return null
  const storeId = token.split('_')[3] ?? ''
  if (!/^[A-Za-z0-9]+$/.test(storeId)) return null
  return { token, host: `${storeId.toLowerCase()}${PUBLIC_HOST_SUFFIX}` }
}

function errorKind(error: unknown): string {
  const e = error as { name?: unknown; constructor?: { name?: unknown } } | null
  const raw =
    typeof e?.name === 'string' && e.name && e.name !== 'Error'
      ? e.name
      : typeof e?.constructor?.name === 'string'
        ? e.constructor.name
        : 'unknown'
  return /^[A-Za-z0-9_]{1,48}$/.test(raw) ? raw : 'unknown'
}

class TooLargeError extends Error {}

async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      throw new TooLargeError()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out.buffer
}

type Failure = { ok: false; reason: string; errorKind?: string; targetPath?: string }
type Move = { ok: true; targetPath: string; copy: 'created' | 'reused' }

/** Metadata of one public blob in our store, or why not. */
async function headPublic(store: PublicStore, pathname: string): Promise<{ ok: true; contentType: string; size: number } | Failure> {
  try {
    const meta = await head(pathname, { token: store.token })
    if (meta.size > MAX_BYTES) return { ok: false, reason: 'too_large' }
    return { ok: true, contentType: meta.contentType, size: meta.size }
  } catch (error) {
    if (error instanceof BlobNotFoundError) return { ok: false, reason: 'public_blob_missing' }
    return { ok: false, reason: 'public_head_failed', errorKind: errorKind(error) }
  }
}

/** Copy one public blob into private storage for one chat — or reuse the copy a previous run made. */
async function moveOne(store: PublicStore, scope: ChatUploadScope, pathname: string): Promise<Move | Failure> {
  const meta = await headPublic(store, pathname)
  if (!meta.ok) return meta
  const target = privateTargetFor(scope, pathname, meta.contentType)
  if (!target) return { ok: false, reason: 'invalid_scope' }

  try {
    if (await privateChatFileExists(target.path)) return { ok: true, targetPath: target.path, copy: 'reused' }
  } catch (error) {
    return { ok: false, reason: 'private_check_failed', errorKind: errorKind(error), targetPath: target.path }
  }

  let bytes: ArrayBuffer
  try {
    const res = await get(pathname, { access: 'public', token: store.token })
    if (!res || res.statusCode !== 200 || !res.stream) return { ok: false, reason: 'public_blob_missing', targetPath: target.path }
    bytes = await readCapped(res.stream, MAX_BYTES)
  } catch (error) {
    if (error instanceof TooLargeError) return { ok: false, reason: 'too_large', targetPath: target.path }
    return { ok: false, reason: 'download_failed', errorKind: errorKind(error), targetPath: target.path }
  }

  try {
    const written = await putPrivateChatFile(target.path, new Blob([bytes], { type: target.contentType }), target.contentType)
    // The rewrite and delete-public both locate the copy by this exact path.
    if (written !== target.path) return { ok: false, reason: 'private_path_mismatch', targetPath: target.path }
  } catch (error) {
    return { ok: false, reason: 'private_write_failed', errorKind: errorKind(error), targetPath: target.path }
  }
  return { ok: true, targetPath: target.path, copy: 'created' }
}

// ─── reports ────────────────────────────────────────────────────────────────────────────────────

export type ReferenceItem = {
  table: TableName
  rowId: string
  field: FieldName
  /** Where inside `metadata`, e.g. `attachments[0].url`. Null for a text column. */
  jsonPath: string | null
  prefix: PublicChatPrefix | null
  blobId: string
  targetPath: string | null
  status: 'would_move' | 'moved' | 'skipped' | 'would_fail' | 'failed'
  reason?: string
  privateCopy?: 'created' | 'reused' | 'exists' | 'absent'
  errorKind?: string
}

export type BlobVerdict =
  | 'still_referenced'
  | 'moved'
  | 'orphan'
  | 'private_copy_missing'
  | 'private_check_failed'
  | 'not_public_store'

export type BlobItem = {
  blobId: string
  prefix: PublicChatPrefix
  size: number
  verdict: BlobVerdict
  action: 'would_delete' | 'would_keep' | 'deleted' | 'kept' | 'failed'
  errorKind?: string
}

type StorageStatus = { publicStore: 'configured' | 'missing'; privateStore: 's3' | 'blob' | 'none' }

export type MigrationResult = { status: number; body: Record<string, unknown> }

type Clock = () => number

export type MigrationOptions = {
  mode: MigrationMode
  limit?: number
  cursor?: string | null
  /** Tests only. */
  budgetMs?: number
  now?: Clock
}

function storageStatus(store: PublicStore | null): StorageStatus {
  return { publicStore: store ? 'configured' : 'missing', privateStore: privateChatStorageKind() }
}

function emptyTableFieldCounts(): Record<string, number> {
  return Object.fromEntries(TABLE_FIELDS.map((k) => [k, 0]))
}

function countBy<T>(items: T[], key: (item: T) => string | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    const k = key(item)
    if (k) out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function refused(status: number, mode: MigrationMode, error: string, store: PublicStore | null): MigrationResult {
  return { status, body: { ok: false, mode, error, storage: storageStatus(store) } }
}

// ─── cursors ────────────────────────────────────────────────────────────────────────────────────

type ApplyCursor = { m: 'apply'; t: number; a: string }
type ListCursor = { m: 'dry-run' | 'delete-public'; p: number; c?: string }

function encodeCursor(cursor: ApplyCursor | ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(mode: MigrationMode, raw: string | null | undefined): ApplyCursor | ListCursor | null | 'invalid' {
  if (!raw) return null
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>
    if (value?.m !== mode) return 'invalid'
    if (mode === 'apply') {
      const t = value.t
      const a = value.a
      if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > TABLES.length || typeof a !== 'string' || a.length > 200) return 'invalid'
      return { m: 'apply', t, a }
    }
    const p = value.p
    const c = value.c
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > PUBLIC_CHAT_PREFIXES.length) return 'invalid'
    if (c !== undefined && (typeof c !== 'string' || c.length > 2000)) return 'invalid'
    return { m: mode, p, ...(typeof c === 'string' ? { c } : {}) }
  } catch {
    return 'invalid'
  }
}

// ─── the reference census ───────────────────────────────────────────────────────────────────────

type CensusEntry = { spec: TableSpec; row: Row; occ: Occurrence }
type Census = { entries: CensusEntry[]; rowsScanned: number; complete: boolean }

/** Every public Blob URL referenced by the three tables. Bounded; `complete: false` if it stopped early. */
async function censusPublicReferences(deadline: number, now: Clock): Promise<Census> {
  const entries: CensusEntry[] = []
  let rowsScanned = 0
  for (const spec of TABLES) {
    let afterId = ''
    for (;;) {
      if (now() > deadline || rowsScanned >= MAX_REFERENCE_ROWS) return { entries, rowsScanned, complete: false }
      const page = await searchRows(spec, [PUBLIC_HOST_NEEDLE], afterId, ROW_PAGE)
      for (const row of page) {
        rowsScanned++
        for (const occ of occurrencesIn(spec, row)) entries.push({ spec, row, occ })
      }
      if (page.length < ROW_PAGE) break
      afterId = page[page.length - 1].id
    }
  }
  return { entries, rowsScanned, complete: true }
}

type Eligible = { ok: true; scope: ChatUploadScope; prefix: PublicChatPrefix }

function eligibility(store: PublicStore | null, spec: TableSpec, row: Row, occ: Occurrence): Eligible | Failure {
  if (!store) return { ok: false, reason: 'public_store_unconfigured' }
  if (occ.url.host !== store.host) return { ok: false, reason: 'not_our_store' }
  const prefix = prefixOf(occ.url.pathname)
  if (!prefix) return { ok: false, reason: 'outside_chat_prefixes' }
  const scope: ChatUploadScope = { kind: spec.scopeKind, id: String(row.scopeId ?? '') }
  if (!CHAT_UPLOAD_SCOPE_ID.test(scope.id)) return { ok: false, reason: 'invalid_scope' }
  return { ok: true, scope, prefix }
}

function baseItem(spec: TableSpec, row: Row, occ: Occurrence): Omit<ReferenceItem, 'status'> {
  return {
    table: spec.table,
    rowId: row.id,
    field: occ.field,
    jsonPath: occ.jsonPath,
    prefix: prefixOf(occ.url.pathname),
    blobId: publicBlobId(occ.url.pathname),
    targetPath: null,
  }
}

// ─── blob listing and classification (shared by dry-run and delete-public) ───────────────────────

type ListedBlob = { pathname: string; url: string; size: number; prefix: PublicChatPrefix; blobId: string }

async function listPublicPage(
  store: PublicStore,
  start: ListCursor | null,
  mode: 'dry-run' | 'delete-public',
  max: number,
  deadline: number,
  now: Clock,
): Promise<{ blobs: ListedBlob[]; next: ListCursor | null }> {
  let p = start?.p ?? 0
  let c = start?.c
  const blobs: ListedBlob[] = []
  while (p < PUBLIC_CHAT_PREFIXES.length && blobs.length < max && now() <= deadline) {
    const prefix = PUBLIC_CHAT_PREFIXES[p]
    const res = await list({ prefix, limit: Math.min(max - blobs.length, 1000), token: store.token, ...(c ? { cursor: c } : {}) })
    for (const b of res.blobs ?? []) {
      // `list` filters by prefix server-side; re-check rather than trust it with a delete behind it.
      if (!b.pathname.startsWith(prefix)) continue
      blobs.push({ pathname: b.pathname, url: b.url, size: b.size, prefix, blobId: publicBlobId(b.pathname) })
    }
    if (res.hasMore && res.cursor) c = res.cursor
    else {
      p++
      c = undefined
    }
  }
  return { blobs, next: p < PUBLIC_CHAT_PREFIXES.length ? { m: mode, p, ...(c ? { c } : {}) } : null }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The forms a blob's pathname can take inside a stored URL, lowercased for the SQL prefilter. */
function pathNeedles(blob: ListedBlob): string[] {
  const needles = [blob.pathname.toLowerCase()]
  try {
    const encoded = new URL(blob.url).pathname.slice(1).toLowerCase()
    if (encoded && encoded !== needles[0]) needles.push(encoded)
  } catch {
    /* keep the decoded form */
  }
  return needles
}

/**
 * Decide, for each listed public blob, whether deleting it is safe — WITHOUT deleting anything.
 * Dry-run reports these verdicts; delete-public acts on them. One code path, so the dry run is an
 * exact preview of what delete-public would do on the same data.
 *
 *   not_public_store      its URL is not on our public host (a private or foreign object) — keep.
 *   still_referenced      a row still points at it — keep. Checked TWICE: against the full census,
 *                         then by a literal search for its pathname in every row, so a reference the
 *                         URL parser missed (odd encoding, embedded text) still keeps it.
 *   moved                 rows point at private copies named by its blobId and EVERY such copy is
 *                         confirmed present in private storage — deletable.
 *   private_copy_missing  a moved reference exists but its copy does not — keep.
 *   private_check_failed  private storage could not answer — keep. "Could not look" is never "absent".
 *   orphan                nothing references it, publicly or as a moved copy — deletable.
 */
async function classifyBlobs(store: PublicStore, blobs: ListedBlob[], referenced: Set<string>): Promise<Map<ListedBlob, BlobVerdict>> {
  const verdicts = new Map<ListedBlob, BlobVerdict>()
  const candidates: ListedBlob[] = []
  for (const blob of blobs) {
    if (hostOf(blob.url) !== store.host) verdicts.set(blob, 'not_public_store')
    else if (referenced.has(blob.pathname)) verdicts.set(blob, 'still_referenced')
    else candidates.push(blob)
  }
  if (candidates.length === 0) return verdicts

  // Second, independent reference check: a literal search for the pathname itself.
  const owners = new Map<string, ListedBlob[]>()
  for (const blob of candidates) {
    for (const n of pathNeedles(blob)) owners.set(n, [...(owners.get(n) ?? []), blob])
  }
  await forEachMatchingRow([...owners.keys()], (spec, row, chunk) => {
    const hay = [...spec.textFields.map((f) => row[f] ?? ''), JSON.stringify(row.metadata ?? null)].join('\n').toLowerCase()
    const hits = chunk.filter((n) => hay.includes(n))
    // The SQL matched this row but JS cannot say which needle did: keep every candidate it could be.
    for (const n of hits.length > 0 ? hits : chunk) for (const blob of owners.get(n) ?? []) verdicts.set(blob, 'still_referenced')
  })

  const remaining = candidates.filter((blob) => !verdicts.has(blob))
  if (remaining.length === 0) return verdicts

  const copies = new Map<string, Set<string>>()
  const ids = new Set(remaining.map((b) => b.blobId))
  await forEachMatchingRow([...ids], (spec, row) => {
    for (const path of privatePathsIn(spec, row)) {
      const file = path.slice(path.lastIndexOf('/') + 1)
      const id = file.slice(0, 36)
      if (file[36] === '.' && UUID_V5.test(id) && ids.has(id)) copies.set(id, new Set([...(copies.get(id) ?? []), path]))
    }
  })

  for (const blob of remaining) {
    const paths = copies.get(blob.blobId)
    if (!paths || paths.size === 0) {
      verdicts.set(blob, 'orphan')
      continue
    }
    try {
      let allPresent = true
      for (const path of paths) {
        if (!(await privateChatFileExists(path))) {
          allPresent = false
          break
        }
      }
      verdicts.set(blob, allPresent ? 'moved' : 'private_copy_missing')
    } catch {
      verdicts.set(blob, 'private_check_failed')
    }
  }
  return verdicts
}

const DELETABLE: ReadonlySet<BlobVerdict> = new Set<BlobVerdict>(['moved', 'orphan'])

function summarizeBlobs(blobs: ListedBlob[], verdicts: Map<ListedBlob, BlobVerdict>) {
  const byPrefix = Object.fromEntries(
    PUBLIC_CHAT_PREFIXES.map((prefix) => {
      const mine = blobs.filter((b) => b.prefix === prefix)
      const n = (v: BlobVerdict) => mine.filter((b) => verdicts.get(b) === v).length
      return [prefix, { listed: mine.length, referenced: n('still_referenced'), movedByApply: n('moved'), orphans: n('orphan') }]
    }),
  )
  return { byPrefix, byVerdict: countBy(blobs, (b) => verdicts.get(b)) }
}

// ─── modes ──────────────────────────────────────────────────────────────────────────────────────

async function runDryRun(opts: { limit: number; cursor: ListCursor | null; deadline: number; now: Clock }): Promise<MigrationResult> {
  const store = publicStore()
  const census = await censusPublicReferences(opts.deadline, opts.now)
  const privateReady = privateChatStorageConfigured()

  const items: ReferenceItem[] = []
  const heads = new Map<string, Promise<Awaited<ReturnType<typeof headPublic>>>>()
  for (const { spec, row, occ } of census.entries) {
    const base = baseItem(spec, row, occ)
    const el = eligibility(store, spec, row, occ)
    if (!el.ok) {
      items.push({ ...base, status: 'skipped', reason: el.reason })
      continue
    }
    let pending = heads.get(occ.url.pathname)
    if (!pending) {
      pending = headPublic(store!, occ.url.pathname)
      heads.set(occ.url.pathname, pending)
    }
    const meta = await pending
    if (!meta.ok) {
      items.push({ ...base, status: 'would_fail', reason: meta.reason, ...(meta.errorKind ? { errorKind: meta.errorKind } : {}) })
      continue
    }
    const target = privateTargetFor(el.scope, occ.url.pathname, meta.contentType)
    if (!target) {
      items.push({ ...base, status: 'would_fail', reason: 'invalid_scope' })
      continue
    }
    let privateCopy: ReferenceItem['privateCopy']
    if (privateReady) {
      try {
        privateCopy = (await privateChatFileExists(target.path)) ? 'exists' : 'absent'
      } catch {
        privateCopy = undefined
      }
    }
    items.push({ ...base, targetPath: target.path, status: 'would_move', ...(privateCopy ? { privateCopy } : {}) })
  }

  const byTableField = emptyTableFieldCounts()
  for (const { spec, occ } of census.entries) byTableField[`${spec.table}.${occ.field}`]++

  let blobs: Record<string, unknown> = { listed: 0, skipped: 'public_store_unconfigured' }
  let nextCursor: string | null = null
  if (store) {
    const page = await listPublicPage(store, opts.cursor, 'dry-run', opts.limit, opts.deadline, opts.now)
    const referenced = new Set(census.entries.map((e) => e.occ.url.pathname))
    const verdicts = await classifyBlobs(store, page.blobs, referenced)
    const blobItems: BlobItem[] = page.blobs.map((b) => {
      const verdict = verdicts.get(b)!
      return { blobId: b.blobId, prefix: b.prefix, size: b.size, verdict, action: DELETABLE.has(verdict) ? 'would_delete' : 'would_keep' }
    })
    nextCursor = page.next ? encodeCursor(page.next) : null
    blobs = {
      listed: page.blobs.length,
      ...summarizeBlobs(page.blobs, verdicts),
      wouldDelete: blobItems.filter((b) => b.action === 'would_delete').length,
      referenceCensusComplete: census.complete,
      items: blobItems.slice(0, MAX_REPORTED_ITEMS),
      itemsTruncated: blobItems.length > MAX_REPORTED_ITEMS,
      hasMore: page.next !== null,
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'dry-run',
      storage: storageStatus(store),
      references: {
        total: census.entries.length,
        rows: new Set(census.entries.map((e) => `${e.spec.table}:${e.row.id}`)).size,
        wouldMove: items.filter((i) => i.status === 'would_move').length,
        byTableField,
        byStatus: countBy(items, (i) => i.status),
        byReason: countBy(items, (i) => i.reason),
        complete: census.complete,
        items: items.slice(0, MAX_REPORTED_ITEMS),
        itemsTruncated: items.length > MAX_REPORTED_ITEMS,
      },
      blobs,
      hasMore: nextCursor !== null,
      nextCursor,
    },
  }
}

type UpdateManyArgs = { where: Record<string, unknown>; data: Record<string, unknown> }

async function updateRow(spec: TableSpec, args: UpdateManyArgs): Promise<number> {
  let res: { count: number } | null | undefined
  if (spec.table === 'league_chat_messages') res = await prisma.leagueChatMessage.updateMany(args as never)
  else if (spec.table === 'platform_chat_messages') res = await prisma.platformChatMessage.updateMany(args as never)
  else res = await prisma.bracketLeagueMessage.updateMany(args as never)
  return res?.count ?? 0
}

/**
 * Move every eligible public reference in one row, then rewrite ONLY the fields that held one.
 *
 * The write is conditional on each rewritten field still holding the value it was read with
 * (`updateMany` with the originals in `where`), so a message edited in the instant between read and
 * write is reported `row_changed` and left for the next run rather than overwritten with stale text.
 */
async function applyRow(
  store: PublicStore,
  spec: TableSpec,
  row: Row,
  moves: Map<string, Promise<Move | Failure>>,
): Promise<ReferenceItem[]> {
  const items: ReferenceItem[] = []
  const replacements = new Map<string, string>()
  const moved: Array<{ occ: Occurrence; item: ReferenceItem }> = []

  for (const occ of occurrencesIn(spec, row)) {
    const base = baseItem(spec, row, occ)
    const el = eligibility(store, spec, row, occ)
    if (!el.ok) {
      items.push({ ...base, status: 'skipped', reason: el.reason })
      continue
    }
    const key = `${el.scope.kind}:${el.scope.id}:${occ.url.pathname}`
    let pending = moves.get(key)
    if (!pending) {
      pending = moveOne(store, el.scope, occ.url.pathname)
      moves.set(key, pending)
    }
    const result = await pending
    if (!result.ok) {
      items.push({
        ...base,
        targetPath: result.targetPath ?? null,
        status: 'failed',
        reason: result.reason,
        ...(result.errorKind ? { errorKind: result.errorKind } : {}),
      })
      continue
    }
    replacements.set(occ.url.matched, chatUploadReadUrl(result.targetPath))
    const item: ReferenceItem = { ...base, targetPath: result.targetPath, status: 'moved', privateCopy: result.copy }
    items.push(item)
    moved.push({ occ, item })
  }
  if (moved.length === 0) return items

  const where: Record<string, unknown> = { id: row.id }
  const data: Record<string, unknown> = {}
  for (const field of new Set(moved.map((m) => m.occ.field))) {
    if (field === 'metadata') {
      where.metadata = { equals: row.metadata }
      data.metadata = rewriteStrings(row.metadata, (s) => replacePublicUrls(s, replacements))
    } else {
      where[field] = row[field]
      data[field] = replacePublicUrls(String(row[field] ?? ''), replacements)
    }
  }
  if (spec.keepUpdatedAt && row.updatedAt) data.updatedAt = row.updatedAt

  let failure: Failure | null = null
  try {
    if ((await updateRow(spec, { where, data })) !== 1) failure = { ok: false, reason: 'row_changed' }
  } catch (error) {
    failure = { ok: false, reason: 'db_update_failed', errorKind: errorKind(error) }
  }
  if (failure) {
    // The private copy stays; the next run finds the row still public and reuses it.
    for (const { item } of moved) {
      item.status = 'failed'
      item.reason = failure.reason
      if (failure.errorKind) item.errorKind = failure.errorKind
    }
  }
  return items
}

async function runApply(opts: { limit: number; cursor: ApplyCursor | null; deadline: number; now: Clock }): Promise<MigrationResult> {
  const store = publicStore()
  if (!store) return refused(503, 'apply', 'public_store_unconfigured', store)
  if (!privateChatStorageConfigured()) return refused(503, 'apply', 'private_storage_unconfigured', store)

  let t = opts.cursor?.t ?? 0
  let afterId = opts.cursor?.a ?? ''
  let rowsLeft = opts.limit
  let rowsProcessed = 0
  let rowsUpdated = 0
  let hasMore = false
  const items: ReferenceItem[] = []
  const moves = new Map<string, Promise<Move | Failure>>()

  outer: while (t < TABLES.length) {
    if (rowsLeft <= 0 || opts.now() > opts.deadline) {
      hasMore = true
      break
    }
    const spec = TABLES[t]
    const want = Math.min(rowsLeft, ROW_PAGE)
    const page = await searchRows(spec, [PUBLIC_HOST_NEEDLE], afterId, want)
    for (const row of page) {
      if (opts.now() > opts.deadline) {
        hasMore = true
        break outer
      }
      const rowItems = await applyRow(store, spec, row, moves)
      items.push(...rowItems)
      if (rowItems.some((i) => i.status === 'moved')) rowsUpdated++
      rowsProcessed++
      rowsLeft--
      afterId = row.id
    }
    if (page.length < want) {
      t++
      afterId = ''
    }
  }

  const moved = items.filter((i) => i.status === 'moved')
  const skipped = items.filter((i) => i.status === 'skipped')
  const failed = items.filter((i) => i.status === 'failed')
  const nextCursor = hasMore ? encodeCursor({ m: 'apply', t, a: afterId }) : null
  return {
    status: 200,
    body: {
      ok: true,
      mode: 'apply',
      storage: storageStatus(store),
      counts: {
        rowsProcessed,
        rowsUpdated,
        moved: moved.length,
        skipped: skipped.length,
        failed: failed.length,
        privateCopiesCreated: moved.filter((i) => i.privateCopy === 'created').length,
        privateCopiesReused: moved.filter((i) => i.privateCopy === 'reused').length,
      },
      skippedByReason: countBy(skipped, (i) => i.reason),
      failedByReason: countBy(failed, (i) => i.reason),
      moved: moved.slice(0, MAX_REPORTED_ITEMS),
      skipped: skipped.slice(0, MAX_REPORTED_ITEMS),
      failed: failed.slice(0, MAX_REPORTED_ITEMS),
      itemsTruncated: Math.max(moved.length, skipped.length, failed.length) > MAX_REPORTED_ITEMS,
      hasMore,
      nextCursor,
    },
  }
}

async function runDeletePublic(opts: { limit: number; cursor: ListCursor | null; deadline: number; now: Clock }): Promise<MigrationResult> {
  const store = publicStore()
  if (!store) return refused(503, 'delete-public', 'public_store_unconfigured', store)
  // Without private storage no copy can be verified, so nothing moved could ever be proven safe.
  if (!privateChatStorageConfigured()) return refused(503, 'delete-public', 'private_storage_unconfigured', store)

  const census = await censusPublicReferences(opts.deadline, opts.now)
  // A partial census cannot prove "no row references it". Refuse rather than delete on a guess.
  if (!census.complete) return refused(409, 'delete-public', 'reference_census_incomplete', store)
  const referenced = new Set(census.entries.map((e) => e.occ.url.pathname))

  const startCursor: ListCursor = opts.cursor ?? { m: 'delete-public', p: 0 }
  const page = await listPublicPage(store, opts.cursor, 'delete-public', opts.limit, opts.deadline, opts.now)
  const verdicts = await classifyBlobs(store, page.blobs, referenced)

  const items: BlobItem[] = []
  let timedOut = false
  for (const blob of page.blobs) {
    const verdict = verdicts.get(blob)!
    if (!DELETABLE.has(verdict)) {
      items.push({ blobId: blob.blobId, prefix: blob.prefix, size: blob.size, verdict, action: 'kept' })
      continue
    }
    if (timedOut || opts.now() > opts.deadline) {
      // Out of time before this one: keep it, and hand back THIS page's cursor so the next call
      // re-lists and re-verifies it rather than skipping past it.
      timedOut = true
      items.push({ blobId: blob.blobId, prefix: blob.prefix, size: blob.size, verdict, action: 'kept' })
      continue
    }
    try {
      await del(blob.url, { token: store.token })
      items.push({ blobId: blob.blobId, prefix: blob.prefix, size: blob.size, verdict, action: 'deleted' })
    } catch (error) {
      items.push({ blobId: blob.blobId, prefix: blob.prefix, size: blob.size, verdict, action: 'failed', errorKind: errorKind(error) })
    }
  }

  const next = timedOut ? startCursor : page.next
  const nextCursor = next ? encodeCursor(next) : null
  const deleted = items.filter((i) => i.action === 'deleted')
  const kept = items.filter((i) => i.action === 'kept')
  return {
    status: 200,
    body: {
      ok: true,
      mode: 'delete-public',
      storage: storageStatus(store),
      counts: {
        listed: page.blobs.length,
        deleted: deleted.length,
        deletedMoved: deleted.filter((i) => i.verdict === 'moved').length,
        deletedOrphans: deleted.filter((i) => i.verdict === 'orphan').length,
        kept: kept.length,
        failed: items.filter((i) => i.action === 'failed').length,
      },
      keptByReason: countBy(kept, (i) => (timedOut && DELETABLE.has(i.verdict) ? 'time_budget' : i.verdict)),
      ...summarizeBlobs(page.blobs, verdicts),
      items: items.slice(0, MAX_REPORTED_ITEMS),
      itemsTruncated: items.length > MAX_REPORTED_ITEMS,
      hasMore: nextCursor !== null,
      nextCursor,
    },
  }
}

/** Entry point for the admin route. Never throws a message outward; the route maps throws to 500. */
export async function runPublicPhotoMigration(options: MigrationOptions): Promise<MigrationResult> {
  const mode = options.mode
  const now = options.now ?? Date.now
  const deadline = now() + (options.budgetMs ?? DEFAULT_BUDGET_MS)
  const { def, max } = LIMITS[mode]
  const limit = Math.max(1, Math.min(max, Math.floor(options.limit ?? def)))
  const cursor = decodeCursor(mode, options.cursor)
  if (cursor === 'invalid') return { status: 400, body: { ok: false, mode, error: 'invalid_cursor' } }

  if (mode === 'apply') return runApply({ limit, cursor: cursor as ApplyCursor | null, deadline, now })
  if (mode === 'delete-public') return runDeletePublic({ limit, cursor: cursor as ListCursor | null, deadline, now })
  return runDryRun({ limit, cursor: cursor as ListCursor | null, deadline, now })
}
