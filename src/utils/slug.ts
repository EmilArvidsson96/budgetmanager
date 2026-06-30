// Turn a Swedish display name into a stable, url/id-safe slug.
// Shared by category creation in the import flow and the settings editors.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// Append a numeric suffix until the slug is unique within `taken`.
export function uniqueSlug(name: string, taken: Set<string>, fallback = 'kategori'): string {
  const base = slugify(name) || fallback
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}
