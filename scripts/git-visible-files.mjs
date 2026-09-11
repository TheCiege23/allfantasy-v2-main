import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Candidate source files as GIT sees them: tracked files, plus untracked files that no ignore
 * rule covers.
 *
 * Extracted 2026-09-11 from `check-db-first-api-boundary.mjs` and
 * `check-decision-engine-boundary.mjs`, which had byte-for-byte equivalent copies. The bodies
 * differed only in quote style, the wording of two warnings, and `error.message` vs the safer
 * `err?.message` — so this is a de-duplication, not a behaviour change. Both call sites are
 * asserted to produce identical finding sets before and after; see that commit.
 *
 * ⚠ WHY THIS EXISTS AT ALL. Both guards walked the filesystem and so descended into anything
 * gitignored that was not on a hardcoded directory list. Measured in the primary checkout:
 * the db-first scan reported 333 findings of which 222 came from `.tmp-pr671/`, a 2.4G scratch
 * COPY of the repo; the decision-engine scan took 2m12s and had one scratch directory patched
 * into its exclusion list BY NAME. Asking git removes the need to maintain either list.
 *
 * ⚠ TRACKED FILES ARE LISTED UNCONDITIONALLY via `--cached`, and git does not report a tracked
 * path as ignored. Committing a file into a `tmp-*` directory therefore does NOT exempt it from
 * a guard — this drops ignored scratch, never source.
 *
 * ⚠ AND IT MUST NOT NARROW TO TRACKED-ONLY. `--others --exclude-standard` keeps brand-new files
 * visible before they are staged, which is exactly when a developer wants a guard to speak.
 *
 * 🛑 THIS DOES NOT REPLACE A CALLER'S OWN DIRECTORY EXCLUSIONS, and dropping them restores a
 * flood. `.claude/` is NOT gitignored in this repo — only `.claude/settings.local.json*` and
 * `.claude/scheduled_tasks.lock` are — so it holds a full checkout per concurrent session and
 * `--others` lists every one of them. Callers still filter their own `EXCLUDED_DIRS` and build
 * output on top of this. Neither filter subsumes the other.
 *
 * @param {string} rootDir  directory to enumerate; git is run with this as cwd
 * @param {{extensions: Set<string>, label: string}} opts
 *   `extensions` — lowercase, dot-prefixed; the two guards deliberately watch different sets.
 *   `label` — prefixes the fail-open warnings so a reader can tell which guard degraded.
 * @returns {string[] | null} relative paths, or null meaning "could not answer — fall back"
 */
export function listGitVisibleFiles(rootDir, { extensions, label }) {
  let output;
  try {
    output = execSync("git ls-files -z --cached --others --exclude-standard", {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // `err?.message` rather than `err.message`: a thrown non-Error would turn a fail-open path
    // into a crash, which is the one thing a guard's degraded path must not do.
    console.warn(
      `${label}: git could not enumerate files (${err?.message}). Falling back to a filesystem ` +
        "walk, which may descend into ignored directories and report duplicates out of them.",
    );
    return null;
  }

  const paths = output
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);

  /*
   * 🛑 AN EMPTY ANSWER IS NOT THE ANSWER "no source files". It is a git that ran and told us
   * nothing useful, and treating it as a clean tree is the guard-goes-quiet failure these guards
   * exist to avoid — a check that stopped looking is indistinguishable from one that found
   * nothing. Fall back to the caller's walk and be noisy instead.
   */
  if (paths.length === 0) {
    console.warn(`${label}: git listed no files. Falling back to a filesystem walk.`);
    return null;
  }

  return [...new Set(paths)].filter((filePath) =>
    extensions.has(path.extname(filePath).toLowerCase()),
  );
}
