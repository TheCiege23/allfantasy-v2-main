'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Heart, ArrowLeft } from 'lucide-react'

export default function DonateSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full text-center space-y-6"
      >
        <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)' }}>
          <Heart className="w-10 h-10 text-green-500" fill="currentColor" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight" style={{ color: 'var(--text)' }}>Thank You!</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Your donation means a lot to the AllFantasy team. Every dollar goes directly toward keeping our servers running, improving our Chimmy tools, and building new features for the fantasy community.
          </p>
        </div>

        <div className="p-4 rounded-xl" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>
            A receipt has been sent to your email. If you have any questions, reach out to us anytime.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition active:scale-[0.97]"
          style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to AllFantasy
        </Link>
      </motion.div>
    </div>
  )
}
