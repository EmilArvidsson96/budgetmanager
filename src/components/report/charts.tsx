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

// ─── Forward-looking line charts ──────────────────────────────────────────────

// Maps a value series to a y in [pad, H-pad] within a shared min/max range.
function makeScale(values: number[], H: number, pad = 8) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.abs(max) || 1
  return (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad)
}

// 2-year net-worth outlook: current projection (solid + area) with last month's
// projection overlaid as a faint dashed line so the shift is visible.
export function WealthOutlookChart({
  points,
  priorByMonth,
  height = 132,
  color = '#111827',
  priorColor = '#C96332',
}: {
  points: { monthId: string; label: string; netWorth: number }[]
  priorByMonth?: Record<string, number>
  height?: number
  color?: string
  priorColor?: string
}) {
  if (points.length < 2) return null
  const W = 100
  const H = height
  const xAt = (i: number) => (i / (points.length - 1)) * W
  const priorPairs = points
    .map((p, i) => ({ i, v: priorByMonth?.[p.monthId] }))
    .filter((p): p is { i: number; v: number } => p.v != null)

  const yScale = makeScale([...points.map((p) => p.netWorth), ...priorPairs.map((p) => p.v)], H)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yScale(p.netWorth).toFixed(2)}`).join(' ')
  const area = `${line} L${xAt(points.length - 1).toFixed(2)},${H} L0,${H} Z`
  const priorLine = priorPairs.map((p, j) => `${j === 0 ? 'M' : 'L'}${xAt(p.i).toFixed(2)},${yScale(p.v).toFixed(2)}`).join(' ')

  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="wealthArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.16} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#wealthArea)" stroke="none" />
        {priorPairs.length > 1 && (
          <path d={priorLine} fill="none" stroke={priorColor} strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="flex justify-between mt-1.5 text-[10px] text-gray-400">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  )
}

// 12-month liquidity: actual months (solid) stitched to projected months (dashed),
// with the largest expenses marked. Marker dots are HTML overlays so they stay
// round despite the viewBox being stretched to the container width.
export function LiquidityTimeline({
  points,
  markers,
  height = 150,
}: {
  points: { monthId: string; label: string; value: number; kind: 'actual' | 'projected' }[]
  markers: { monthId: string; kind: 'happened' | 'planned' }[]
  height?: number
}) {
  if (points.length < 2) return null
  const W = 100
  const H = height
  const pad = 12
  const n = points.length
  const min = Math.min(0, ...points.map((p) => p.value))
  const max = Math.max(0, ...points.map((p) => p.value))
  const span = max - min || 1
  const xAt = (i: number) => (i / (n - 1)) * W
  const xPct = (i: number) => (i / (n - 1)) * 100
  const yAt = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad)

  const idx = points.map((_, i) => i)
  const actualIdx = idx.filter((i) => points[i].kind === 'actual')
  const projIdx = idx.filter((i) => points[i].kind === 'projected')
  const projDraw = actualIdx.length ? [actualIdx[actualIdx.length - 1], ...projIdx] : projIdx
  const pathOf = (idxs: number[]) =>
    idxs.map((i, j) => `${j === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(points[i].value).toFixed(2)}`).join(' ')

  const MARK = { happened: '#dc2626', planned: '#d97706' }

  return (
    <div>
      <div className="relative" style={{ height: H }}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
          {min < 0 && <line x1={0} y1={yAt(0)} x2={W} y2={yAt(0)} stroke="#fca5a5" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
          {actualIdx.length > 1 && (
            <path d={pathOf(actualIdx)} fill="none" stroke="#2563eb" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {projDraw.length > 1 && (
            <path d={pathOf(projDraw)} fill="none" stroke="#2563eb" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          )}
        </svg>
        {/* Expense markers as round HTML dots positioned over the line. */}
        {markers.map((m, k) => {
          const i = points.findIndex((p) => p.monthId === m.monthId)
          if (i < 0) return null
          return (
            <span
              key={k}
              className="absolute w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${xPct(i)}%`, top: yAt(points[i].value), background: MARK[m.kind] }}
            />
          )
        })}
      </div>
      <div className="flex mt-1.5">
        {points.map((p, i) => (
          <div key={i} className={`flex-1 text-center text-[10px] ${p.kind === 'projected' ? 'text-gray-300' : 'text-gray-500'}`}>
            {i % 2 === 0 ? p.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}
