/**
 * Tracked `.env*` files for the secret scan's credential check (scripts/secret-scan.mjs).
 *
 * Separate module so the listing can be tested without running the whole scanner.
 */
import { execFileSync } from 'node:child_process'

/** Same ceiling as the scanner's other `git ls-files` call. */
export const GIT_LS_FILES_MAX_BUFFER = 256 * 1024 * 1024

/**
 * Paths of every tracked `.env` / `.env.*` file. Throws when git cannot list files — the caller
 * turns that into a loud UNVERIFIED error, never a pass.
 */
export function listTrackedEnvFiles(root, exec = execFileSync) {
  // `git ls-files -z` on this repo passed Node's default 1 MiB maxBuffer (~1,048,800 bytes, 2026-10-22),
  // so the call threw and every scan reported UNVERIFIED. Give it the same ceiling as line ~79.
  return exec('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: GIT_LS_FILES_MAX_BUFFER })
    .split('\0')
    .filter((p) => /(^|\/)\.env($|\.)/.test(p))
}
