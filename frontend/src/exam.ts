/** 考试类型、试卷标题与题型名称：四级、六级、考研共用的纯函数（无 React、无 DOM）。 */

export type Exam = 'cet4' | 'cet6' | 'kaoyan'
/** 考研卷别：英语（一）、英语（二）、1998–2009 统考卷。 */
export type Track = 'one' | 'two' | 'historical'

export const EXAMS: { value: Exam; num: string; name: string; code: string }[] = [
  { value: 'cet4', num: '4', name: '英语四级', code: 'CET-4' },
  { value: 'cet6', num: '6', name: '英语六级', code: 'CET-6' },
  { value: 'kaoyan', num: '研', name: '考研英语', code: 'KY' },
]
export const EXAM_NAME: Record<Exam, string> = { cet4: '英语四级', cet6: '英语六级', kaoyan: '考研英语' }
export const EXAM_SHORT: Record<Exam, string> = { cet4: '四级', cet6: '六级', kaoyan: '考研' }
export const EXAM_CODE: Record<Exam, string> = { cet4: 'CET-4', cet6: 'CET-6', kaoyan: 'KY' }

export const isExam = (value: unknown): value is Exam => value === 'cet4' || value === 'cet6' || value === 'kaoyan'

const EXAM_STORAGE_KEY = 'cet-exam'
/** The board last chosen on any page (试卷库、复习、报告 share it). */
export function readExam(fallback: Exam = 'cet6'): Exam {
  try {
    const value = localStorage.getItem(EXAM_STORAGE_KEY)
    return isExam(value) ? value : fallback
  } catch { return fallback }
}
export function saveExam(exam: Exam) {
  try { localStorage.setItem(EXAM_STORAGE_KEY, exam) } catch { /* The choice still applies for this visit. */ }
}

// Kaoyan keys look like 2024-kaoyan-1 / 2024-kaoyan-2 / 2003-kaoyan-historical; uids append :section:q_no.
const KAOYAN_KEY = /^(\d{4})-kaoyan-(1|2|historical)(?::|$)/
const CET_KEY = /^(?:cet4-)?(\d{4})-(\d{1,2})-(\d+)(?::|$)/

type PaperLike = { exam_type?: string | null; paper_key?: string | null; uid?: string | null; year?: number | null; month?: number | null; set_no?: number | null }

/** exam_type from the API wins; rows without it (orphan marks, old backups) fall back to the key prefix. */
export function examOf(row: PaperLike | string | null | undefined): Exam {
  if (row && typeof row === 'object' && isExam(row.exam_type)) return row.exam_type
  const key = typeof row === 'string' ? row : String(row?.paper_key || row?.uid || '')
  if (key.startsWith('cet4-')) return 'cet4'
  if (KAOYAN_KEY.test(key)) return 'kaoyan'
  return 'cet6'
}

export const TRACK_NAME: Record<Track, string> = { one: '英语（一）', two: '英语（二）', historical: '统考' }
export const TRACK_SHORT: Record<Track, string> = { one: '英一', two: '英二', historical: '统考' }
export const TRACK_ORDER: Track[] = ['one', 'two', 'historical']

/** Kaoyan track from the key, else from set_no (1 英一, 2 英二, 0 统考); null for CET. */
export function trackOf(row: PaperLike | string | null | undefined): Track | null {
  const key = typeof row === 'string' ? row : String(row?.paper_key || row?.uid || '')
  const m = KAOYAN_KEY.exec(key)
  if (m) return m[2] === '1' ? 'one' : m[2] === '2' ? 'two' : 'historical'
  if (row && typeof row === 'object' && examOf(row) === 'kaoyan') return row.set_no === 1 ? 'one' : row.set_no === 2 ? 'two' : 'historical'
  return null
}

/** Year/month/set from the row, falling back to the key. Kaoyan month is meaningless and returned as 0. */
function parts(row: PaperLike | string | null | undefined): { year: number; month: number; set: number } | null {
  if (row && typeof row === 'object' && row.year) {
    return { year: Number(row.year), month: examOf(row) === 'kaoyan' ? 0 : Number(row.month) || 0, set: Number(row.set_no) || 0 }
  }
  const key = typeof row === 'string' ? row : String(row?.paper_key || row?.uid || '')
  const k = KAOYAN_KEY.exec(key)
  if (k) return { year: Number(k[1]), month: 0, set: k[2] === '1' ? 1 : k[2] === '2' ? 2 : 0 }
  const c = CET_KEY.exec(key)
  return c ? { year: Number(c[1]), month: Number(c[2]), set: Number(c[3]) } : null
}

/** Full title. CET stays byte-identical to the original「2024 年 12 月 · 第 1 套」; kaoyan never uses month or 第 0 套. */
export function paperTitle(row: PaperLike | string | null | undefined): string {
  const p = parts(row)
  const fallback = typeof row === 'string' ? row : String(row?.paper_key || '未知试卷')
  if (!p) return fallback
  if (examOf(row) === 'kaoyan') return `${p.year} 年考研英语（${trackOf(row) === 'one' ? '一' : trackOf(row) === 'two' ? '二' : '统考'}）`
  return `${p.year} 年 ${p.month} 月 · 第 ${p.set} 套`
}

/** Compact label for tags and lists:「2024年12月 第1套」or「2024 英一」. */
export function paperShort(row: PaperLike | string | null | undefined): string {
  const p = parts(row)
  const fallback = typeof row === 'string' ? row : String(row?.paper_key || '未知试卷')
  if (!p) return fallback
  if (examOf(row) === 'kaoyan') { const t = trackOf(row); return `${p.year} ${t ? TRACK_SHORT[t] : '考研'}` }
  return `${p.year}年${p.month}月${p.set ? ` 第${p.set}套` : ''}`
}

export const CET_SECTION_ORDER = ['listening', 'cloze', 'matching', 'reading1', 'reading2', 'writing', 'translation']
export const CET_SECTION_CN: Record<string, string> = {
  listening: '听力', cloze: '选词填空', matching: '长篇阅读', reading1: '仔细阅读一', reading2: '仔细阅读二', writing: '写作', translation: '翻译',
}
/** Kaoyan papers follow the exam order 完形 → 阅读 A → 新题型 → 翻译 → 写作 (identical to q_no order). */
export const KAOYAN_SECTION_ORDER = ['cloze', 'reading1', 'matching', 'translation', 'writing']
export const KAOYAN_SECTION_CN: Record<string, string> = {
  cloze: '完形填空', reading1: '阅读理解', matching: '新题型', translation: '翻译', writing: '写作',
}
/** Headings that name the paper part, e.g. above the material panel. */
export const KAOYAN_SECTION_LONG: Record<string, string> = {
  cloze: '完形填空 · Use of English', reading1: '阅读理解 · Part A', matching: '新题型 · Part B', translation: '翻译 · 英译汉', writing: '写作',
}
/** Part B (新题型) layouts; the API sends one of these keys as `variant`. */
export const PARTB_VARIANT_CN: Record<string, string> = {
  ordering: '排序', gap: '七选五', heading: '小标题', opinion: '观点概括', match: '信息匹配', tf: '判断正误',
}

export const sectionOrder = (exam: Exam) => exam === 'kaoyan' ? KAOYAN_SECTION_ORDER : CET_SECTION_ORDER

/** Short section name. Kaoyan Part B appends the layout when known:「新题型 · 排序」. */
export function sectionLabel(section: string, exam: Exam, variant?: string | null): string {
  if (exam !== 'kaoyan') return CET_SECTION_CN[section] || section
  const base = KAOYAN_SECTION_CN[section] || CET_SECTION_CN[section] || section
  return section === 'matching' && variant && PARTB_VARIANT_CN[variant] ? `${base} · ${PARTB_VARIANT_CN[variant]}` : base
}

/** Results saved before the kaoyan labels existed used the CET names; section ids are accepted too. */
const KAOYAN_LEGACY_RESULT_LABEL: Record<string, string> = { 选词填空: '完形填空', 仔细阅读一: '阅读理解', 长篇阅读: '新题型' }
export function resultSectionLabel(key: string, exam: Exam): string {
  if (exam !== 'kaoyan') return CET_SECTION_CN[key] || key
  return KAOYAN_LEGACY_RESULT_LABEL[key] || KAOYAN_SECTION_CN[key] || key
}

/** Sort rank of a saved per_section label, so result bars follow the exam order. */
export function resultSectionRank(key: string, exam: Exam): number {
  const order = sectionOrder(exam)
  const labels = exam === 'kaoyan' ? KAOYAN_SECTION_CN : CET_SECTION_CN
  const label = resultSectionLabel(key, exam)
  const i = order.findIndex(s => s === key || labels[s] === label)
  return i < 0 ? order.length : i
}

/** Name of a material group inside a section: Text 1–5 for reading, 小作文/大作文 for writing. */
export function groupLabel(section: string, groupKey: string | null | undefined, groupCount = 1): string {
  const key = String(groupKey || '')
  const text = /^text_(\d+)$/.exec(key)
  if (section === 'reading1' && text) return `Text ${text[1]}`
  if (section === 'writing') {
    if (key === 'part_b') return '大作文 · Part B'
    if (key === 'part_a') return groupCount > 1 ? '小作文 · Part A' : '作文'
  }
  return ''
}
