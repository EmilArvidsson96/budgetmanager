import type { CategoryDef, ZlantarCategoryRule } from '@/types'

// Category IDs and subcategory IDs match Zlantar's exact category/subcategory values
// so the parser can do a direct lookup without fuzzy matching.

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  // ─── Income ───────────────────────────────────────────────────────────────
  // Subcategory IDs that match Zlantar's top-level category values (salary,
  // interest, refund, sale) are kept identical so the parser can remap them
  // directly without fuzzy matching.
  {
    id: 'income',
    name: 'Inkomst',
    type: 'income',
    color: '#22c55e',
    icon: 'Wallet',
    subcategories: [
      // ── Lön ──────────────────────────────────────────────────────────────
      { id: 'salary',           name: 'Lön',                parentId: 'income' },
      // ── Bidrag ───────────────────────────────────────────────────────────
      { id: 'sjukpenning',      name: 'Sjukpenning',         parentId: 'income' },
      { id: 'foraldrapenning',  name: 'Föräldrapenning',     parentId: 'income' },
      { id: 'studiemedel',      name: 'Studiemedel / CSN',   parentId: 'income' },
      { id: 'aktivitetsstod',   name: 'Aktivitetsstöd',      parentId: 'income' },
      { id: 'other_bidrag',     name: 'Övriga bidrag',       parentId: 'income' },
      // ── Kapital ──────────────────────────────────────────────────────────
      { id: 'interest',         name: 'Räntor & utdelning',  parentId: 'income' },
      { id: 'refund',           name: 'Återbetalningar',     parentId: 'income' },
      { id: 'sale',             name: 'Försäljning',         parentId: 'income' },
      // ── Sparuttag ────────────────────────────────────────────────────────
      { id: 'savings_vacation', name: 'Semester-spar',       parentId: 'income' },
      { id: 'savings_capex',    name: 'Kapitalutgifter',     parentId: 'income' },
      { id: 'savings_other',    name: 'Övriga sparuttag',    parentId: 'income' },
    ],
  },

  // ─── Expense ──────────────────────────────────────────────────────────────
  {
    id: 'food',
    name: 'Mat & Dryck',
    type: 'expense',
    color: '#ef4444',
    icon: 'UtensilsCrossed',
    subcategories: [
      { id: 'groceries',  name: 'Matvaror',          parentId: 'food' },
      { id: 'restaurant', name: 'Restaurang',         parentId: 'food' },
      { id: 'cafe',       name: 'Kafé & fika',        parentId: 'food' },
      { id: 'alcohol',    name: 'Alkohol',             parentId: 'food' },
      { id: 'other',      name: 'Övrigt mat',         parentId: 'food' },
    ],
  },
  {
    id: 'household',
    name: 'Boende & Hushåll',
    type: 'expense',
    color: '#f59e0b',
    icon: 'Home',
    subcategories: [
      { id: 'rent',           name: 'Hyra / Bolån',        parentId: 'household' },
      { id: 'operational',    name: 'El, vatten & drift',  parentId: 'household' },
      { id: 'media_telecoms', name: 'Internet & media',    parentId: 'household' },
      { id: 'maintenance',    name: 'Underhåll & reparation', parentId: 'household' },
      { id: 'services',       name: 'Tjänster & abonnemang', parentId: 'household' },
      { id: 'insurance',      name: 'Hemförsäkring',       parentId: 'household' },
      { id: 'loans_taxes',    name: 'Lån & skatt',         parentId: 'household' },
      { id: 'alarm',          name: 'Larm & säkerhet',     parentId: 'household' },
      { id: 'other',          name: 'Övrigt boende',       parentId: 'household' },
    ],
  },
  {
    id: 'transport',
    name: 'Transport',
    type: 'expense',
    color: '#8b5cf6',
    icon: 'Car',
    subcategories: [
      { id: 'public',     name: 'Kollektivtrafik',    parentId: 'transport' },
      { id: 'vehicle',    name: 'Fordon & parkering', parentId: 'transport' },
      { id: 'train_bus',  name: 'Tåg & buss',         parentId: 'transport' },
      { id: 'flights',    name: 'Flyg',                parentId: 'transport' },
      { id: 'other',      name: 'Övrigt transport',   parentId: 'transport' },
    ],
  },
  {
    id: 'shopping',
    name: 'Shopping',
    type: 'expense',
    color: '#ec4899',
    icon: 'ShoppingBag',
    subcategories: [
      { id: 'clothing',    name: 'Kläder & skor',     parentId: 'shopping' },
      { id: 'furnishing',  name: 'Hem & inredning',   parentId: 'shopping' },
      { id: 'multimedia',  name: 'Elektronik',        parentId: 'shopping' },
      { id: 'beauty',      name: 'Skönhet & hygien',  parentId: 'shopping' },
      { id: 'media_books', name: 'Böcker & media',    parentId: 'shopping' },
      { id: 'gardening',   name: 'Trädgård',          parentId: 'shopping' },
      { id: 'gifts',       name: 'Gåvor',             parentId: 'shopping' },
      { id: 'other',       name: 'Övrigt shopping',   parentId: 'shopping' },
    ],
  },
  {
    id: 'leisure',
    name: 'Nöje & Fritid',
    type: 'expense',
    color: '#f97316',
    icon: 'Music',
    subcategories: [
      { id: 'sports',   name: 'Sport & träning',   parentId: 'leisure' },
      { id: 'vacation', name: 'Semester & resor',  parentId: 'leisure' },
      { id: 'culture',  name: 'Kultur & evenemang', parentId: 'leisure' },
      { id: 'gambling', name: 'Spel & gambling',   parentId: 'leisure' },
      { id: 'other',    name: 'Övrigt nöje',       parentId: 'leisure' },
    ],
  },
  {
    id: 'other',
    name: 'Övrigt',
    type: 'expense',
    color: '#94a3b8',
    icon: 'MoreHorizontal',
    subcategories: [
      { id: 'healthcare',    name: 'Hälsa & sjukvård',   parentId: 'other' },
      { id: 'children',      name: 'Barn',               parentId: 'other' },
      { id: 'cash',          name: 'Kontantuttag',        parentId: 'other' },
      { id: 'outlay',        name: 'Utlägg',              parentId: 'other' },
      { id: 'uncategorized', name: 'Okategoriserat',      parentId: 'other' },
      { id: 'other',         name: 'Övrigt',             parentId: 'other' },
    ],
  },

  // ─── Savings / Investments ────────────────────────────────────────────────
  {
    id: 'stocks',
    name: 'Aktier & Fonder',
    type: 'savings',
    color: '#14b8a6',
    icon: 'TrendingUp',
    subcategories: [],
  },
]

// Default rules for mapping Zlantar's category values to app categories.
// Zlantar exports 'salary', 'interest', 'refund', 'sale' as top-level category values;
// after income consolidation these are subcategories under 'income'.
// Categories whose Zlantar ID already matches an app category ID (food, household, etc.)
// do NOT need explicit rules — the parser falls through to direct ID matching.
export const DEFAULT_ZLANTAR_RULES: ZlantarCategoryRule[] = [
  { id: 'z_salary',   zlantarCategory: 'salary',   appCategoryId: 'income', appSubcategoryId: 'salary' },
  { id: 'z_interest', zlantarCategory: 'interest', appCategoryId: 'income', appSubcategoryId: 'interest' },
  { id: 'z_refund',   zlantarCategory: 'refund',   appCategoryId: 'income', appSubcategoryId: 'refund' },
  { id: 'z_sale',     zlantarCategory: 'sale',     appCategoryId: 'income', appSubcategoryId: 'sale' },
]

// Agreement type → category/subcategory mapping for auto-converting Zlantar agreements to recurring items
export const AGREEMENT_CATEGORY_MAP: Record<string, { categoryId: string; subcategoryId?: string }> = {
  'media/streaming':      { categoryId: 'household', subcategoryId: 'media_telecoms' },
  'media/broadband':      { categoryId: 'household', subcategoryId: 'media_telecoms' },
  'media/news':           { categoryId: 'household', subcategoryId: 'media_telecoms' },
  'media/other':          { categoryId: 'household', subcategoryId: 'media_telecoms' },
  'leisure/sports':       { categoryId: 'leisure',   subcategoryId: 'sports' },
  'leisure/vacation':     { categoryId: 'leisure',   subcategoryId: 'vacation' },
  'leisure/culture':      { categoryId: 'leisure',   subcategoryId: 'culture' },
  'leisure/other':        { categoryId: 'leisure',   subcategoryId: 'other' },
  'transport/car':        { categoryId: 'transport', subcategoryId: 'vehicle' },
  'transport/public':     { categoryId: 'transport', subcategoryId: 'public' },
  'transport/other':      { categoryId: 'transport', subcategoryId: 'other' },
  'finance/loan':         { categoryId: 'household', subcategoryId: 'loans_taxes' },
  'finance/other':        { categoryId: 'household', subcategoryId: 'loans_taxes' },
  'household/el':         { categoryId: 'household', subcategoryId: 'operational' },
  'household/alarm':      { categoryId: 'household', subcategoryId: 'alarm' },
  'household/maintenance':{ categoryId: 'household', subcategoryId: 'maintenance' },
  'household/services':   { categoryId: 'household', subcategoryId: 'services' },
  'household/other':      { categoryId: 'household', subcategoryId: 'other' },
  'insurance/car':        { categoryId: 'transport', subcategoryId: 'vehicle' },
  'insurance/home':       { categoryId: 'household', subcategoryId: 'insurance' },
  'insurance/personal':   { categoryId: 'household', subcategoryId: 'insurance' },
  'insurance/other':      { categoryId: 'household', subcategoryId: 'insurance' },
}
