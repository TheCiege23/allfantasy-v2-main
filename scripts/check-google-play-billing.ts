/** Read-only Play catalog/permission audit; never performs a purchase or changes a product. */
import fs from "node:fs"
import { checkGooglePlayReadiness } from "../lib/google-play/billingReadiness"
const file = process.argv.find(arg => arg.startsWith("--service-account-file="))?.slice("--service-account-file=".length)
if (file) process.env.GOOGLE_PLAY_BILLING_SERVICE_ACCOUNT_JSON = fs.readFileSync(file, "utf8")
checkGooglePlayReadiness().then(result => {
  console.log(JSON.stringify(result, null, 2))
  if (!result.catalogVerified) process.exitCode = 1
}).catch(() => { console.error("Google Play readiness check could not run."); process.exitCode = 1 })
