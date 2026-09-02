import './globals.css'
import { cookies } from 'next/headers'
import { Tracker } from './components/Tracker'
export const metadata = { title: 'reprod2' }
export const dynamic = 'force-dynamic'
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = await cookies()
  const lang = c.get('af_lang')?.value === 'es' ? 'es' : 'en'
  return (
    <html lang={lang} className="scroll-smooth" suppressHydrationWarning>
      <body className="antialiased min-h-screen mode-readable">
        <Tracker />
        {children}
      </body>
    </html>
  )
}
