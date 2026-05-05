interface ProgressBarProps {
  value: number
  max: number
  className?: string
}

export function ProgressBar({ value, max, className = '' }: ProgressBarProps) {
  if (max <= 0) return null
  const pct = Math.min((value / max) * 100, 150)
  const over = value > max

  return (
    <div className={`h-1 rounded-full bg-gray-100 overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          over ? 'bg-red-400' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'
        }`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}
