import type { ReactNode } from 'react'
import { useEffect } from 'react'

interface DialogProps {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
}

export function Dialog({ title, description, children, onClose }: DialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">{title}</h2>
        {description && <p className="text-sm text-gray-500 mb-5">{description}</p>}
        {children}
      </div>
    </div>
  )
}

interface OptionRowProps {
  label: string
  sublabel?: string
  selected: boolean
  disabled?: boolean
  onClick: () => void
}

export function OptionRow({ label, sublabel, selected, disabled, onClick }: OptionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all
        ${selected
          ? 'border-brand-500 bg-brand-50'
          : disabled
            ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer'
        }`}
    >
      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
        ${selected ? 'border-brand-500' : 'border-gray-300'}`}>
        {selected && <span className="w-2 h-2 rounded-full bg-brand-500" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        {sublabel && <span className="block text-xs text-gray-400 mt-0.5">{sublabel}</span>}
      </span>
    </button>
  )
}
