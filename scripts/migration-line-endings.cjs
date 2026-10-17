/**
 * A production `prisma migrate deploy` / `resolve` records each migration's checksum as the plain
 * sha256 of the `migration.sql` bytes ON DISK. This repo stores SQL with LF, but a Windows checkout
 * (`core.autocrlf=true`) writes CRLF to the working tree — so a deploy from it records the CRLF
 * digest, and every Linux checkout of the same commit then disagrees with the ledger.
 *
 * Measured 2026-10-03: four production `_prisma_migrations` rows carried CRLF digests
 * (`devy_head_coach_context`, `generic_trade_comparisons`, `legal_acceptances`, and one Codex
 * resolve), each written by a careful, target-checked deploy. Each had to be corrected by hand with
 * a guarded UPDATE. Nothing in the deploy path looked at line endings, so nothing could notice.
 *
 * ⚠ THE OBVIOUS FIXES DO NOT WORK, AND THEY WERE MEASURED. `git -c core.autocrlf=false checkout --
 * prisma/migrations` and `git restore --source=HEAD --worktree` both leave every CR byte in place:
 * git skips any file whose stat matches the index. Removing the tracked files first and then
 * checking out with autocrlf=false does rewrite them (199 files, 22,945 CR bytes → 0, status clean,
 * and the result hashed to its production ledger checksum). That is the command printed below —
 * offered only for a clean `prisma/migrations`, because `rm` discards uncommitted edits.
 */
const fs = require("fs");
const path = require("path");

/** Migration folders whose `migration.sql` contains any CR byte. Read-only. */
function findCrMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(migrationsDir, entry.name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    let crBytes = 0;
    for (const b of bytes) if (b === 13) crBytes++;
    if (crBytes > 0) out.push({ name: entry.name, crBytes });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function formatCrlfRefusal(found) {
  const shown = found.slice(0, 5).map((f) => `    ${f.name}  (${f.crBytes} CR bytes)`).join("\n");
  const more = found.length > 5 ? `\n    … and ${found.length - 5} more` : "";
  return (
    `\n[db:migrate:deploy] REFUSING — ${found.length} migration.sql file(s) have CRLF line endings:\n` +
    `${shown}${more}\n\n` +
    `Prisma records the sha256 of the bytes on disk, so deploying from this checkout writes CRLF\n` +
    `checksums into production's _prisma_migrations that no Linux checkout will ever match.\n\n` +
    `Fix the checkout (only if \`git status --porcelain -- prisma/migrations\` prints nothing —\n` +
    `this rewrites tracked files and would discard uncommitted edits):\n\n` +
    `    git ls-files -z -- prisma/migrations | xargs -0 rm -f\n` +
    `    git -c core.autocrlf=false checkout -- prisma/migrations\n\n` +
    `⚠ A plain \`git -c core.autocrlf=false checkout\` or \`git restore\` does NOT rewrite them —\n` +
    `git skips files it considers unchanged. Or deploy from a checkout made with\n` +
    `core.autocrlf=false (any Linux machine, or Railway).\n`
  );
}

module.exports = { findCrMigrations, formatCrlfRefusal };
