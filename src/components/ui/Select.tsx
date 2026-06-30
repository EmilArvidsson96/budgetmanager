import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function Select({ value, onChange, options, placeholder, className = '', disabled }: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)
  const displayLabel = selected?.label ?? placeholder ?? '—'

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function pick(val: string) {
    onChange({ target: { value: val } } as React.ChangeEvent<HTMLSelectElement>)
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-left
          hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500
          disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>{displayLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-full bg-white border border-gray-200 rounded-xl shadow-xl py-1 overflow-y-auto"
          style={{ maxHeight: '16rem' }}
        >
          {placeholder && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 transition-colors"
              onMouseDown={() => pick('')}
            >
              {placeholder}
            </button>
          )}
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors
                ${o.value === value
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
                }`}
              onMouseDown={() => pick(o.value)}
            >
              <span className="flex-1">{o.label}</span>
              {o.value === value && <Check className="w-3.5 h-3.5 text-brand-600 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
