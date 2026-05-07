export const RECEIPT_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (snabbast, billigast)' },
  { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6 (balanserad)' },
  { id: 'claude-opus-4-7',           label: 'Opus 4.7 (bäst, dyrast)' },
] as const

export const DEFAULT_RECEIPT_MODEL = 'claude-haiku-4-5-20251001'
