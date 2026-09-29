'use client'

import { useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { QRCodeSVG } from 'qrcode.react'

type Props = {
  open: boolean
  onClose: () => void
  roomId: string | null
  inviteCode: string | null
  onStart?: () => void
}

export function DraftSettingsModal({ open, onClose, roomId, inviteCode, onStart }: Props) {
  const { t } = useLanguage()
  const [sport, setSport] = useState('NFL')
  const [teams, setTeams] = useState(12)
  const [rounds, setRounds] = useState(15)
  const [timer, setTimer] = useState(60)
  const [scoring, setScoring] = useState('PPR')
  const [pool, setPool] = useState('all')

  if (!open) return null

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const inviteUrl = roomId ? `${origin}/draft/mock/${roomId}` : ''

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0c0c1e] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white">{t('draftRoom.settingsModal.title')}</h2>
        <div className="mt-4 space-y-3 text-[12px] text-white/80">
          <label className="block">
            <span className="text-white/50">{t('draftRoom.settingsModal.sport')}</span>
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/40 px-2 py-1"
            >
              <option>NFL</option>
              <option>NBA</option>
              <option>MLB</option>
            </select>
          </label>
          <label className="block">
            <span className="text-white/50">Teams</span>
            <select
              value={teams}
              onChange={(e) => setTeams(Number(e.target.value))}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/40 px-2 py-1"
            >
              {[8, 10, 12, 14].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-white/50">{t('draftRoom.settingsModal.rounds')}</span>
            <select
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/40 px-2 py-1"
            >
              {[10, 12, 15, 16].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-white/50">{t('draftRoom.settingsModal.timer')}</span>
            <select
              value={timer}
              onChange={(e) => setTimer(Number(e.target.value))}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/40 px-2 py-1"
            >
              {[30, 45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>
                  {n}s
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="text-white/50">Scoring</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {['PPR', 'Half-PPR', 'Standard'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScoring(s)}
                  className={`rounded px-2 py-1 text-[11px] ${
                    scoring === s ? 'bg-cyan-500 text-black' : 'bg-white/[0.06]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-white/50">{t('draftRoom.settingsModal.playerPool')}</span>
            <select
              value={pool}
              onChange={(e) => setPool(e.target.value)}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/40 px-2 py-1"
            >
              <option value="all">All</option>
              <option value="rookies">Rookies</option>
              <option value="veterans">Veterans</option>
            </select>
          </label>
          {inviteUrl ? (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
              <p className="text-[11px] text-white/45">{t('draftRoom.settingsModal.inviteLink')}</p>
              <p className="break-all text-[11px] text-cyan-300/90">{inviteUrl}</p>
              {inviteCode ? (
                <p className="mt-1 text-[11px] text-white/40">
                  {t('draftRoom.settingsModal.code')} {inviteCode}
                </p>
              ) : null}
              <div className="mt-2 flex justify-center bg-white p-2">
                <QRCodeSVG value={inviteUrl} size={120} />
              </div>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                className="mt-2 w-full rounded bg-white/[0.08] py-1 text-[11px]"
              >
                Copy link
              </button>
            </div>
          ) : null}
        </div>
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-white/[0.1] py-2 text-[12px] text-white/70"
          >
            {t('draftRoom.settingsModal.close')}
          </button>
          {onStart ? (
            <button
              type="button"
              onClick={onStart}
              className="flex-1 rounded-lg bg-cyan-500 py-2 text-[12px] font-bold text-black"
            >
              {t('draftRoom.settingsModal.startMock')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
