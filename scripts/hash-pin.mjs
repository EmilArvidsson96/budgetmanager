#!/usr/bin/env node
// Usage: node scripts/hash-pin.mjs <your-pin>
// Prints the VITE_PIN_HASH value to add to .env.local

import { createHash } from 'crypto'

const pin = process.argv[2]

if (!pin || !/^\d{4,8}$/.test(pin)) {
  console.error('Usage: node scripts/hash-pin.mjs <4–8 digit PIN>')
  process.exit(1)
}

const hash = createHash('sha256').update(`budgethanteraren:${pin}`).digest('hex')

console.log('\nAdd this line to your .env.local file:\n')
console.log(`VITE_PIN_HASH=${hash}`)
console.log('\nThen rebuild the app for the change to take effect.\n')
