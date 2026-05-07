import { useState } from 'react'

interface AmountInputProps {
  value: number
  onChange: (value: number) => void
  placeholder?: string
  className?: string
  defaultNegative?: boolean
}

export function AmountInput({ value, onChange, placeholder = '0', className = '', defaultNegative }: AmountInputProps) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)

  const displayValue = focused ? raw : (value === 0 ? '' : String(value))

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        inputMode="text"
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true)
          if (value === 0) {
            setRaw(defaultNegative ? '-' : '')
          } else {
            setRaw(String(value))
          }
        }}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          setFocused(false)
          const cleaned = raw.replace(',', '.').replace(/[^\d.-]/g, '')
          const parsed = parseFloat(cleaned)
          onChange(isNaN(parsed) ? 0 : parsed)
          setRaw('')
        }}
        className="w-full text-right rounded-md border border-warm-300 bg-warm-50 pl-3 pr-8 py-1.5
          text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent
          placeholder:text-warm-400"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 pointer-events-none select-none">
        kr
      </span>
    </div>
  )
}
