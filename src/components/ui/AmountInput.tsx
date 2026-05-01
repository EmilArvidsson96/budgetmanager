import { useState } from 'react'

interface AmountInputProps {
  value: number
  onChange: (value: number) => void
  placeholder?: string
  className?: string
  allowNegative?: boolean
}

export function AmountInput({ value, onChange, placeholder = '0', className = '', allowNegative }: AmountInputProps) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)

  const displayValue = focused ? raw : (value === 0 ? '' : String(value))

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true)
          setRaw(value === 0 ? '' : String(value))
        }}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          setFocused(false)
          const cleaned = raw.replace(',', '.').replace(/[^\d.-]/g, '')
          const parsed = parseFloat(cleaned)
          if (!isNaN(parsed)) {
            onChange(allowNegative ? parsed : Math.abs(parsed))
          } else {
            onChange(0)
          }
          setRaw('')
        }}
        className="w-full text-right rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5
          text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
          placeholder:text-gray-300"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
        kr
      </span>
    </div>
  )
}
