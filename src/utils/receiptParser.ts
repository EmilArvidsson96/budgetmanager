import Anthropic from '@anthropic-ai/sdk'
import * as pdfjsLib from 'pdfjs-dist'
import type { GroceryReceipt, GroceryReceiptItem, GroceryCategory } from '@/types'
export { RECEIPT_MODELS, DEFAULT_RECEIPT_MODEL } from './receiptModels'
import { DEFAULT_RECEIPT_MODEL } from './receiptModels'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

const GROCERY_CATEGORIES = [
  'frukt_gront',
  'mejeri_agg',
  'kott_chark',
  'fisk',
  'brod_bageri',
  'torrvaror',
  'frys',
  'dryck',
  'godis_snacks',
  'hushall',
  'hygien',
  'ovrigt',
] as const

const SYSTEM_PROMPT = `Du analyserar svenska matkvitton och extraherar varor med priser och kategorier.

Kategorier att använda:
- frukt_gront: Frukt, grönsaker, bär, svamp, örter, sallad
- mejeri_agg: Mjölk, ost, yoghurt, grädde, smör, ägg, fil
- kott_chark: Kött, kyckling, fläsk, nöt, chark, korv, bacon, skinka
- fisk: Fisk, räkor, skaldjur, lax, tonfisk, sill
- brod_bageri: Bröd, knäckebröd, kakor, kex, bullar, müsli, havre, cornflakes, frukostflingor
- torrvaror: Pasta, ris, linser, bönor, konserver, burkar, sås, dressing, olja, vinäger, mjöl, socker, kryddor, nudlar
- frys: Frysta varor, glass, fryspizza, frysta grönsaker, frysta färdigrätter
- dryck: Vatten, juice, läsk, öl, cider, vin, kaffe, te, saft, sportdryck
- godis_snacks: Godis, choklad, chips, popcorn, nötter (snacksorter), kex (söta)
- hushall: Diskmedel, tvättmedel, hushållspapper, toalettpapper, soppåsar, plastpåsar, städprodukter, glödlampor, batterier
- hygien: Schampo, tvål, tandkräm, rakprodukter, deodorant, hudvård, kosmetika, blöjor, tamponger
- ovrigt: Allt annat

Returnera ENDAST giltig JSON utan markdown-kodblock, på detta exakta format:
{
  "merchant": "butiksnamn",
  "date": "YYYY-MM-DD",
  "total": -belopp,
  "items": [
    { "name": "produktnamn", "amount": -pris, "category": "kategori" }
  ]
}

Regler:
- Alla belopp ska vara negativa tal (kostnader)
- Hoppa över rader för rabatter, moms, betalningssätt, bong-nummer, telefon, adress
- Om en vara har en rabattrad, dra av rabatten från priset och ta med netto-priset
- date ska vara i format YYYY-MM-DD, härledd från kvittot; om datum saknas, använd dagens datum
- Inkludera INTE moms-rader, summa-rader eller betalningsrader som egna items`

interface ParsedReceipt {
  merchant: string
  date: string
  total: number
  items: Array<{ name: string; amount: number; category: string }>
}

function isValidCategory(cat: string): cat is GroceryCategory {
  return (GROCERY_CATEGORIES as readonly string[]).includes(cat)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function extractPdfText(file: File): Promise<string | null> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }
    const text = pages.join('\n').trim()
    // If less than 50 non-whitespace chars, extraction likely failed
    return text.replace(/\s/g, '').length >= 50 ? text : null
  } catch {
    return null
  }
}

function parseResponse(text: string): ParsedReceipt {
  try {
    const json = text.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(json)
  } catch {
    throw new Error(`Kunde inte tolka svar från Claude: ${text.slice(0, 200)}`)
  }
}

function normalizeReceipt(
  parsed: ParsedReceipt,
  fileName: string
): Omit<GroceryReceipt, 'id' | 'parsedAt'> {
  const items: GroceryReceiptItem[] = parsed.items.map((item) => ({
    name: item.name,
    amount: typeof item.amount === 'number' ? item.amount : -Math.abs(Number(item.amount)),
    category: isValidCategory(item.category) ? item.category : 'ovrigt',
  }))
  return {
    fileName,
    date: parsed.date,
    merchant: parsed.merchant,
    total: typeof parsed.total === 'number' ? parsed.total : -Math.abs(Number(parsed.total)),
    items,
  }
}

function makeClient(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

export async function parseReceiptPDF(
  file: File,
  apiKey: string,
  model = DEFAULT_RECEIPT_MODEL
): Promise<Omit<GroceryReceipt, 'id' | 'parsedAt'>> {
  const extractedText = await extractPdfText(file)
  if (extractedText) {
    return parseReceiptText(extractedText, apiKey, model, file.name)
  }

  // Fallback: send the PDF as a document (scanned/image-based PDFs)
  const client = makeClient(apiKey)
  const base64 = await fileToBase64(file)

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: 'Extrahera alla varor från detta kvitto.' },
        ],
      },
    ],
  })

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  return normalizeReceipt(parseResponse(text), file.name)
}

export async function parseReceiptImage(
  file: File,
  apiKey: string,
  model = DEFAULT_RECEIPT_MODEL
): Promise<Omit<GroceryReceipt, 'id' | 'parsedAt'>> {
  const client = makeClient(apiKey)
  const base64 = await fileToBase64(file)
  const mediaType = file.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: 'Extrahera alla varor från detta kvitto.' },
        ],
      },
    ],
  })

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  return normalizeReceipt(parseResponse(text), file.name)
}

export async function parseReceiptText(
  receiptText: string,
  apiKey: string,
  model = DEFAULT_RECEIPT_MODEL,
  fileName = 'Inklistrat kvitto'
): Promise<Omit<GroceryReceipt, 'id' | 'parsedAt'>> {
  const client = makeClient(apiKey)

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Extrahera alla varor från detta kvitto:\n\n${receiptText}`,
      },
    ],
  })

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  return normalizeReceipt(parseResponse(text), fileName)
}

export function findMatchingTransaction(
  receiptDate: string,
  receiptTotal: number,
  transactions: Array<{ date: string; amount: number; description?: string }>
): { date: string; description: string; amount: number } | undefined {
  // Allow ±1 day for timezone/end-of-day receipt timing
  const receiptMs = new Date(receiptDate).getTime()
  const oneDayMs = 86_400_000

  for (const tx of transactions) {
    const txMs = new Date(tx.date).getTime()
    const dateDiff = Math.abs(txMs - receiptMs)
    const amountDiff = Math.abs(tx.amount - receiptTotal)

    if (dateDiff <= oneDayMs && amountDiff < 1) {
      return {
        date: tx.date,
        description: tx.description ?? '',
        amount: tx.amount,
      }
    }
  }
  return undefined
}
