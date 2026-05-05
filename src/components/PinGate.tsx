import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { hashPin } from '../utils/pinHash'

const PIN_HASH     = import.meta.env.VITE_PIN_HASH as string | undefined
const SESSION_KEY  = 'bh_session'
const ATTEMPTS_KEY = 'bh_attempts'
const SESSION_TTL  = 8 * 60 * 60 * 1000  // 8 hours
const MAX_ATTEMPTS = 5
const LOCKOUT_MS   = 30_000

interface Attempts { count: number; lockedUntil: number | null }

function loadAttempts(): Attempts {
  try { return JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || '') }
  catch { return { count: 0, lockedUntil: null } }
}

function saveAttempts(a: Attempts) {
  sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a))
}

function sessionValid(): boolean {
  try {
    const { ts } = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '')
    return Date.now() - ts < SESSION_TTL
  } catch { return false }
}

const NUMPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['⌫', '0', '✓'],
]

export function PinGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => !PIN_HASH || sessionValid())
  const [pin, setPin]           = useState('')
  const [shake, setShake]       = useState(false)
  const [error, setError]       = useState('')
  const [lockLeft, setLockLeft] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const a = loadAttempts()
    if (a.lockedUntil && a.lockedUntil > Date.now()) startCountdown(a.lockedUntil)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  function startCountdown(until: number) {
    if (timerRef.current) clearInterval(timerRef.current)
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000)
      if (left <= 0) { setLockLeft(0); setError(''); clearInterval(timerRef.current!) }
      else setLockLeft(left)
    }
    tick()
    timerRef.current = setInterval(tick, 500)
  }

  const triggerShake = useCallback(() => {
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }, [])

  const submit = useCallback(async (value: string) => {
    if (value.length < 4) {
      setError('PIN måste vara minst 4 siffror')
      triggerShake()
      return
    }
    const a = loadAttempts()
    if (a.lockedUntil && a.lockedUntil > Date.now()) return

    const digest = await hashPin(value)
    if (digest === PIN_HASH) {
      if (timerRef.current) clearInterval(timerRef.current)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }))
      saveAttempts({ count: 0, lockedUntil: null })
      setUnlocked(true)
    } else {
      const newCount = a.count + 1
      const lockedUntil = newCount >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null
      saveAttempts({ count: newCount, lockedUntil })
      setPin('')
      triggerShake()
      if (lockedUntil) {
        startCountdown(lockedUntil)
      } else {
        setError(`Fel PIN — ${MAX_ATTEMPTS - newCount} försök kvar`)
      }
    }
  }, [triggerShake])

  const pressKey = useCallback((key: string) => {
    if (lockLeft > 0) return
    if (key === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    if (key === '✓') { submit(pin); return }
    if (pin.length < 8) { setPin(p => p + key); setError('') }
  }, [lockLeft, pin, submit])

  useEffect(() => {
    if (unlocked) return
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') pressKey(e.key)
      else if (e.key === 'Backspace') pressKey('⌫')
      else if (e.key === 'Enter') pressKey('✓')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [unlocked, pressKey])

  if (unlocked) return <>{children}</>

  const isLocked = lockLeft > 0

  return (
    <div className="min-h-svh bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xs">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Budgethanteraren</h1>
          <p className="text-sm text-gray-500 mt-1">Ange PIN-kod</p>
        </div>

        {/* PIN dots */}
        <div className={`flex justify-center gap-3 mb-3 ${shake ? 'animate-shake' : ''}`}>
          {Array.from({ length: Math.max(pin.length, 4) }, (_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-all duration-150 ${
                i < pin.length ? 'bg-brand-600 scale-110' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>

        {/* Status line */}
        <div className="h-6 mb-5 text-center">
          {isLocked
            ? <p className="text-sm text-red-600">Låst — försök igen om {lockLeft}s</p>
            : error
            ? <p className="text-sm text-red-600">{error}</p>
            : null
          }
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2.5">
          {NUMPAD.flat().map(key => {
            const isBackspace = key === '⌫'
            const isConfirm   = key === '✓'
            const disabled    = isLocked || (isConfirm && pin.length < 4)
            return (
              <button
                key={key}
                onClick={() => pressKey(key)}
                disabled={disabled}
                aria-label={isBackspace ? 'Radera' : isConfirm ? 'Bekräfta' : key}
                className={`
                  h-14 rounded-xl text-lg font-medium transition-all active:scale-95 select-none
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${isConfirm
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : isBackspace
                    ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    : 'bg-white text-gray-800 border border-gray-200 shadow-sm hover:bg-gray-50'
                  }
                `}
              >
                {key}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
