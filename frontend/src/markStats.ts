/** 复习空间「我的标记」：分组、统计与导出的纯函数（无 React、无 DOM）。 */

export type MarkRow = {
  id: string; paper_key: string; section: string; passage_index: number; text: string; created_at: string
  start_offset?: number; end_offset?: number; exam_type?: string | null; year?: number | null; month?: number | null
  set_no?: number | null; section_cn?: string | null; paper_missing?: boolean
}
export type MarkKind = 'word' | 'phrase'
export type MarkGroup = { key: string; label: string; items: MarkRow[] }
export type MarkItem = { key: string; text: string; kind: MarkKind; count: number; first: number; last: number }
export type Bucket = { key: string; label: string; count: number }

export const SECTION_ORDER = ['listening', 'cloze', 'matching', 'reading1', 'reading2', 'writing', 'translation']
export const SECTION_CN: Record<string, string> = {
  listening: '听力', cloze: '选词填空', matching: '长篇阅读', reading1: '仔细阅读一', reading2: '仔细阅读二', writing: '写作', translation: '翻译',
}
export const KIND_CN: Record<MarkKind, string> = { word: '单词', phrase: '短语/句子' }

// Edge punctuation and symbols, including Chinese and curly quotes; inner apostrophes and hyphens survive.
const EDGES = /^[\p{P}\s~`^|<>]+|[\p{P}\s~`^|<>]+$/gu
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g
// Zero-width characters and soft hyphens sneak in from PDF-extracted text.
const INVISIBLE = /[\u200b-\u200d\u00ad\ufeff]/g
const APOSTROPHES = /[\u2018\u2019\u02bc]/g, DOUBLE_QUOTES = /[\u201c\u201d\u201e\u00ab\u00bb]/g

/** Shared folding for comparison and search: NFKC, invisibles removed, curly quotes straightened, whitespace collapsed, lowercase. */
export function fold(text: unknown): string {
  return String(text ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(APOSTROPHES, "'").replace(DOUBLE_QUOTES, '"').replace(/\s+/g, ' ').toLowerCase()
}
/** Comparison key used for counting repeats. */
export const normalize = (text: unknown) => fold(text).replace(EDGES, '')
export const keyOf = (text: unknown) => normalize(text) || String(text ?? '').trim()

/** A single token (English word, hyphenated word, or a short Chinese term) counts as a word. */
export function kind(text: unknown): MarkKind {
  const s = normalize(text)
  if (/\s/.test(s)) return 'phrase'
  return (s.match(CJK)?.length || 0) > 4 ? 'phrase' : 'word'
}

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}', '“': '”', '«': '»', '《': '》', '「': '」', '『': '』', '【': '】' }
const CLOSE = Object.fromEntries(Object.entries(OPEN).map(([a, b]) => [b, a]))
const WORD_QUOTES = new Set(['"', "'", '“', '”', '«', '»', '「', '」', '『', '』'])
const PUNCT = /^[\p{P}~`^|<>]$/u
const SEPARATOR = /^[,;:、，；：]$/, LEAD_STOP = /^[.!?…。！？]$/
const ABBR = /^(?:[a-z]\.){2,}$|^(?:etc|mr|mrs|ms|dr|prof|st|vs|jr|sr|inc|ltd|co)\.$/i
const tally = (s: string, c: string) => s.split(c).length - 1

/** Display form: case and real punctuation kept; only stray edge punctuation from the selection is dropped. */
export function display(text: unknown, k: MarkKind = kind(text)): string {
  let s = String(text ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(APOSTROPHES, "'").replace(/\s+/g, ' ').trim()
  const word = k === 'word'
  for (let prev = ''; s && prev !== s;) {
    prev = s
    const a = s[0], z = s[s.length - 1]
    if (word && s.length > 1 && WORD_QUOTES.has(a) && WORD_QUOTES.has(z)) s = s.slice(1, -1)
    else if (OPEN[a] ? tally(s, a) > tally(s, OPEN[a]) : a === '"' || a === "'" ? word || tally(s, a) % 2 === 1 : SEPARATOR.test(a) || LEAD_STOP.test(a) || (word && PUNCT.test(a) && !CLOSE[a])) s = s.slice(1)
    else if (CLOSE[z] ? tally(s, z) > tally(s, CLOSE[z]) : z === "'" ? word && !/s'$/i.test(s) : z === '"' ? word || tally(s, z) % 2 === 1
      : z === '.' ? word && !ABBR.test(s) : SEPARATOR.test(z) || (word && PUNCT.test(z) && !OPEN[z])) s = s.slice(0, -1)
    s = s.trim()
  }
  return s
}

/** passage_index → human-readable location inside the paper (see MarkableMaterial / QuestionCard). */
export function locationLabel(index: unknown): string {
  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 0) return '未知位置'
  if (idx < 10) return '原文'
  if (idx < 50) return `听力原文 ${idx - 9}`
  if (idx === 50) return '题目要求'
  if (idx < 1000) return '材料'
  const q = Math.floor((idx - 1000) / 100), sub = (idx - 1000) % 100
  const part = sub === 0 ? '题干' : sub < 30 ? `选项 ${String.fromCharCode(64 + sub)}` : sub === 30 ? '解析'
    : sub >= 40 && sub < 50 ? '题干' : sub >= 80 ? '句子精讲' : sub >= 50 ? '范文与参考' : '题目'
  return q > 0 ? `第 ${q} 题 · ${part}` : part
}

const KEY_RE = /^(?:cet[46]-)?(\d{4})-(\d{1,2})-(\d+)$/
/** Year/month/set from the joined paper row, falling back to the paper_key for orphan marks. */
function paperParts(row: MarkRow): [number, number, number] | null {
  if (row.year && row.month) return [Number(row.year), Number(row.month), Number(row.set_no) || 0]
  const m = KEY_RE.exec(String(row.paper_key || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
export function paperLabel(row: MarkRow): string {
  const p = paperParts(row)
  return p ? `${p[0]}年${p[1]}月${p[2] ? ` 第${p[2]}套` : ''}` : String(row.paper_key || '未知试卷')
}
export const sectionLabel = (row: MarkRow) => row.section_cn || SECTION_CN[row.section] || row.section || '未知题型'

const pad = (n: number) => String(n).padStart(2, '0')
const time = (iso: unknown) => { const t = Date.parse(String(iso ?? '')); return Number.isNaN(t) ? -Infinity : t }
/** ISO timestamp → local "YYYY-MM-DD HH:mm"; unparsable input is shown as-is (or "—"). */
export function formatTime(iso: unknown): string {
  const t = time(iso)
  if (t === -Infinity) return String(iso ?? '').trim() || '—'
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** Local calendar date for export file names. */
export const dateStamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

const newestFirst = (a: MarkRow, b: MarkRow) => time(b.created_at) - time(a.created_at) || String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id))
const sectionRank = (s: string) => { const i = SECTION_ORDER.indexOf(s); return i < 0 ? SECTION_ORDER.length : i }

/** Groups by paper (year desc, month desc, set asc) or by section (SECTION_ORDER); newest first inside a group. */
export function groupMarks(rows: MarkRow[], by: 'paper' | 'section'): MarkGroup[] {
  const groups = new Map<string, MarkGroup>()
  for (const row of rows) {
    const key = by === 'paper' ? String(row.paper_key || '') : String(row.section || '')
    if (!groups.has(key)) groups.set(key, { key, label: by === 'paper' ? paperLabel(row) : sectionLabel(row), items: [] })
    groups.get(key)!.items.push(row)
  }
  const list = [...groups.values()]
  for (const g of list) g.items.sort(newestFirst)
  if (by === 'section') return list.sort((a, b) => sectionRank(a.key) - sectionRank(b.key) || a.key.localeCompare(b.key))
  const parts = new Map(list.map(g => [g.key, paperParts(g.items[0])]))
  return list.sort((a, b) => {
    const pa = parts.get(a.key), pb = parts.get(b.key)
    if (!pa || !pb) return pa ? -1 : pb ? 1 : a.key.localeCompare(b.key)
    return pb[0] - pa[0] || pb[1] - pa[1] || pa[2] - pb[2] || a.key.localeCompare(b.key)
  })
}

/** Distinct marked items keyed by normalize(); display text comes from the earliest mark. Ordered by count desc, then first seen. */
export function markItems(rows: MarkRow[]): MarkItem[] {
  const items = new Map<string, MarkItem>()
  for (const row of rows) {
    const key = keyOf(row.text), t = time(row.created_at), item = items.get(key)
    if (!item) { const k = kind(row.text); items.set(key, { key, text: display(row.text, k) || String(row.text ?? '').trim(), kind: k, count: 1, first: t, last: t }); continue }
    item.count++
    if (t < item.first) { item.first = t; item.text = display(row.text, item.kind) || item.text }
    if (t > item.last) item.last = t
  }
  return [...items.values()].sort((a, b) => b.count - a.count || a.first - b.first || a.key.localeCompare(b.key))
}

export function markStats(rows: MarkRow[]) {
  const items = markItems(rows)
  const sections = new Map<string, Bucket>(), years = new Map<string, Bucket>()
  for (const row of rows) {
    const s = String(row.section || '')
    const sb = sections.get(s) || { key: s, label: sectionLabel(row), count: 0 }
    sb.count++; sections.set(s, sb)
    const y = paperParts(row)?.[0], yk = y ? String(y) : ''
    const yb = years.get(yk) || { key: yk, label: y ? `${y}年` : '未知', count: 0 }
    yb.count++; years.set(yk, yb)
  }
  return {
    total: rows.length,
    distinct: items.length,
    words: items.filter(i => i.kind === 'word').length,
    phrases: items.filter(i => i.kind === 'phrase').length,
    repeated: items.filter(i => i.count >= 2).sort((a, b) => b.count - a.count || b.last - a.last || a.key.localeCompare(b.key)),
    bySection: [...sections.values()].sort((a, b) => sectionRank(a.key) - sectionRank(b.key) || a.key.localeCompare(b.key)),
    byYear: [...years.values()].sort((a, b) => (b.key ? Number(b.key) : -1) - (a.key ? Number(a.key) : -1)),
  }
}

/** Search over the text, paper, section and location with normalize()'s folding (case, full-width, curly quotes). */
export function filterMarks(rows: MarkRow[], query: string): MarkRow[] {
  const q = fold(query).trim()
  if (!q) return rows
  return rows.filter(r => fold([r.text, paperLabel(r), r.paper_key, sectionLabel(r), locationLabel(r.passage_index)].join(' \u0000 ')).includes(q))
}

/** Vocabulary list: one deduplicated item per line, most-marked first. */
export function vocabularyText(rows: MarkRow[]): string {
  const items = markItems(rows).filter(i => i.text)
  return items.length ? items.map(i => i.text.replace(/[\r\n]+/g, ' ')).join('\r\n') + '\r\n' : ''
}

/** RFC 4180 cell with a guard against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const CSV_HEADER = ['标记内容', '类型', '出现次数', '试卷', '题型', '位置', '标记时间']
/** Every mark as a CSV row (UTF-8 BOM, CRLF) so Excel opens Chinese text correctly.
 *  Pass the exam-wide counts so 出现次数 matches the 已标记 N 次 tag even when the export is a search subset. */
export function marksCsv(rows: MarkRow[], counts: Map<string, number> = new Map(markItems(rows).map(i => [i.key, i.count]))): string {
  const lines = [CSV_HEADER, ...rows.map(r => [String(r.text ?? '').trim(), KIND_CN[kind(r.text)], counts.get(keyOf(r.text)) || 1, paperLabel(r), sectionLabel(r), locationLabel(r.passage_index), formatTime(r.created_at)])]
  return '\uFEFF' + lines.map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function exportFileName(exam: string, type: 'vocab' | 'detail', date = new Date()) {
  return `四六级标记-${exam === 'cet4' ? '四级' : '六级'}-${type === 'vocab' ? '生词表' : '标记明细'}-${dateStamp(date)}.${type === 'vocab' ? 'txt' : 'csv'}`
}
