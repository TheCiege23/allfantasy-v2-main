import { redirect } from 'next/navigation'

/** Alias for the AF AI Tools hub at `/ai/tools`. */
export default function AiToolsAliasPage() {
  redirect('/ai/tools')
}
