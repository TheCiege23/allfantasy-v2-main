/**
 * Enrol an administrator in the admin second factor (lib/security/adminTotp.ts).
 *
 *   npx tsx scripts/admin-totp-enroll.ts --identity you@example.com --out <private dir>
 *
 * Writes two files into --out and prints only their paths — never the secret:
 *
 *   admin-totp-qr.html   open it and scan the QR code with an authenticator app
 *   admin-totp-entry.txt the `identity=SECRET` entry to add to ADMIN_TOTP_SECRETS
 *
 * --identity must be an email or username the admin allowlist already trusts
 * (ADMIN_EMAILS / ALL_ACCESS_EMAILS / ALL_ACCESS_USERNAMES, see lib/auth/admin.ts).
 *
 * ⚠ Adding the FIRST entry turns codes on for every admin at once. Scan the QR code
 * before setting the variable, and delete both files once the entry is saved.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QRCodeSVG } from "qrcode.react"
import { generateTotpSecret, totpAuthUri } from "../lib/security/totp"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const identity = String(arg("identity") ?? "").trim().toLowerCase()
const outDir = arg("out")
if (!identity || !outDir) {
  console.error("Usage: npx tsx scripts/admin-totp-enroll.ts --identity <email-or-username> --out <dir>")
  process.exit(2)
}
if (/[=,;\s]/.test(identity)) {
  console.error("The identity cannot contain '=', ',', ';' or whitespace.")
  process.exit(2)
}

const secret = generateTotpSecret()
const uri = totpAuthUri(secret, identity)
const qr = renderToStaticMarkup(createElement(QRCodeSVG, { value: uri, size: 256, marginSize: 2 }))
const escapedIdentity = identity.replace(/[<>&"]/g, "")
const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret

const html = `<!doctype html><meta charset="utf-8"><title>AllFantasy admin code setup</title>
<meta name="robots" content="noindex">
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;color:#111">
<h1 style="font-size:20px">Admin sign-in code for ${escapedIdentity}</h1>
<p>Scan this with your authenticator app (Google Authenticator, 1Password, Authy…).</p>
<div style="background:#fff;display:inline-block;padding:8px">${qr}</div>
<p>Can't scan? Enter this key by hand:</p>
<p style="font-family:monospace;font-size:16px;letter-spacing:1px">${grouped}</p>
<p style="color:#a00"><b>Delete this file</b> once the app shows a 6-digit code for AllFantasy Admin.</p>
</body>`

const dir = resolve(outDir)
mkdirSync(dir, { recursive: true })
const htmlPath = join(dir, "admin-totp-qr.html")
const entryPath = join(dir, "admin-totp-entry.txt")
writeFileSync(htmlPath, html, { mode: 0o600 })
writeFileSync(entryPath, `${identity}=${secret}`, { mode: 0o600 })

console.log(`QR page:   ${htmlPath}`)
console.log(`Env entry: ${entryPath}  (add to ADMIN_TOTP_SECRETS; separate several with commas)`)
