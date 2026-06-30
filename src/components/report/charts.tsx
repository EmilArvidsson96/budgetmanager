// ─── Report chart primitives ──────────────────────────────────────────────────
//
// Hand-built SVG/flex charts (not Recharts). Three reasons: they print cleanly to
// PDF, they sidestep the React-19 Recharts-on-mount empty-render issue this app
// already hit with the donut, and they let the report look distinctive. All colours
// are explicit so print-color-adjust renders them; strokes use non-scaling-stroke
// so stretching the viewBox to fit width keeps lines crisp.

import type { ReactNode } from 'react'

export interface Slice {
  label: string
  value: number
  color: string
}

// Donut via the circle-stroke / stroke-dasharray technique (pathLength = 100, so
// each slice's dash is just its percentage). Children render in the centre hole.
export function Donut({
  data,
  size = 176,
  thickness = 24,
  children,
}: {
  data: Slice[]
  size?: number
  thickness?: number
  children?: ReactNode
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = (size - thickness) / 2
  const c = size / 2
  const gap = data.length > 1 ? 0.8 : 0   // tiny visual gap between slices
  let acc = 0

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="#f1ece3" strokeWidth={thickness} />
        {data.map((d, i) => {
          const pct = (d.value / total) * 100
          const dash = Math.max(0, pct - gap)
          const el = (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={-acc}
              pathLength={100}
            />
          )
          acc += pct
          return el
        })}
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
          {children}
        </div>
      )}
    </div>
  )
}

// Vertical bars around a centre zero line — for "resultat per månad" where values
// can go negative. Last bar is highlighted; earlier ones are dimmed.
export function MiniBars({
  data,
  height = 104,
  positive = '#059669',
  negative = '#dc2626',
  labelEvery = 1,
}: {
  data: { label: string; value: number }[]
  height?: number
  positive?: string
  negative?: string
  labelEvery?: number
}) {
  const n = data.length || 1
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)))
  const W = 100
  const H = height
  const slot = W / n
  const bw = slot * 0.58
  const zeroY = H / 2
  const half = H / 2 - 3

  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="#e7e0d4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / maxAbs) * half
          const x = i * slot + (slot - bw) / 2
          const y = d.value >= 0 ? zeroY - h : zeroY
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={bw}
              height={Math.max(0.6, h)}
              rx={0.8}
              fill={d.value >= 0 ? positive : negative}
              opacity={i === n - 1 ? 1 : 0.4}
            />
          )
        })}
      </svg>
      <div className="flex mt-1.5">
        {data.map((d, i) => (
          <div
            key={i}
            className={`flex-1 text-center text-[10px] tabular-nums ${i === n - 1 ? 'text-gray-600 font-medium' : 'text-gray-400'}`}
          >
            {i % labelEvery === 0 ? d.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

// Smooth-ish area sparkline for net worth over time. Stroke stays crisp via
// non-scaling-stroke even though the viewBox is stretched to the container width.
export function Sparkline({
  data,
  height = 72,
  color = '#111827',
  fillId = 'spark',
}: {
  data: { label: string; value: number }[]
  height?: number
  color?: string
  fillId?: string
}) {
  if (data.length === 0) return null
  const vals = data.map((d) => d.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || Math.abs(max) || 1
  const W = 100
  const H = height
  const padY = 8
  const xAt = (i: number) => (data.length === 1 ? W / 2 : (i / (data.length - 1)) * W)
  const yAt = (v: number) => padY + (1 - (v - min) / span) * (H - 2 * padY)

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(d.value).toFixed(2)}`).join(' ')
  const area = `${line} L${xAt(data.length - 1).toFixed(2)},${H} L${xAt(0).toFixed(2)},${H} Z`

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// 100%-style horizontal bar: how the month's income was used.
export interface FlowSegment {
  label: string
  frac: number
  amount: number
  color: string
}

export function FlowBar({ segments }: { segments: FlowSegment[] }) {
  const visible = segments.filter((s) => s.frac > 0.001)
  return (
    <div>
      <div className="flex h-9 w-full rounded-full overflow-hidden bg-warm-200">
        {visible.map((s, i) => (
          <div
            key={i}
            className="h-full flex items-center justify-center"
            style={{ width: `${s.frac * 100}%`, background: s.color }}
            title={`${s.label}: ${Math.round(s.amount).toLocaleString('sv-SE')} kr`}
          >
            {s.frac > 0.12 && (
              <span className="text-[11px] font-semibold text-white/95 tabular-nums px-1">
                {Math.round(s.frac * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
