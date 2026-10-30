/** 考研练习页与题目详情共用的纯函数：空位与划线切分、排序链、写作要求分行、字数、解析整理、引文重排（无 React、无 DOM）。
 *  文本规则见 CONTRACT §6.4：只在显示层整理，不改数据；宁可少断，不可乱断。 */
import type { Exam } from './exam'

// ---------------------------------------------------------------- 材料与分组

/** Material of a question's group. CET keeps its original lookup (main, else the first), because its
 *  question group keys never name a material; kaoyan keys always do (CONTRACT §2). */
export function pickMaterial(groups: Record<string, any> | null | undefined, groupKey: string | null | undefined, exam: Exam): any {
  if (!groups) return undefined
  if (exam !== 'kaoyan') return groups.main || Object.values(groups)[0]
  return (groupKey && groups[groupKey]) || groups.main || Object.values(groups)[0]
}

/** Drop the leading "46. " the source puts before Directions; writing prompts arrive without it already. */
export const stripQuestionNo = (text: string | null | undefined) =>
  String(text || '').replace(/^\s*\d{1,2}\s*[.．]\s*(?=Directions?\b)/i, '').trim()

// ---------------------------------------------------------------- 空位 __(n)__

export type BlankPiece = { kind: 'text'; text: string } | { kind: 'blank'; no: number }

/** Split text on the __(n)__ blank markers; the markers never reach the page as raw text. */
export function blankPieces(text: string | null | undefined): BlankPiece[] {
  const pieces: BlankPiece[] = []
  const re = /__\((\d+)\)__/g
  const source = String(text || '')
  let last = 0
  for (let m: RegExpExecArray | null; (m = re.exec(source));) {
    if (m.index > last) pieces.push({ kind: 'text', text: source.slice(last, m.index) })
    pieces.push({ kind: 'blank', no: Number(m[1]) })
    last = m.index + m[0].length
  }
  if (last < source.length) pieces.push({ kind: 'text', text: source.slice(last) })
  return pieces
}

/** Where a blank sits in its paragraph, for Part B card hints and block rendering. */
export type BlankPlace = { paragraph: number; position: 'whole' | 'start' | 'middle' | 'end'; rest: string }
export function blankPlace(paragraphs: string[], no: number): BlankPlace | null {
  const marker = `__(${no})__`
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i] || ''
    const at = text.indexOf(marker)
    if (at < 0) continue
    const before = text.slice(0, at).replace(/__\(\d+\)__/g, '').trim(), after = text.slice(at + marker.length).replace(/__\(\d+\)__/g, '').trim()
    // Quotes and brackets around a blank do not make it a mid-sentence gap.
    const bare = (s: string) => s.replace(/[\s"“”'‘’()（）]/g, '')
    const position = !bare(before) && !bare(after) ? 'whole' : !bare(before) ? 'start' : !bare(after) ? 'end' : 'middle'
    return { paragraph: i, position, rest: `${before} ${after}`.trim() }
  }
  return null
}

/** A short Part B paragraph without a blank or closing punctuation is an in-text subheading (2021 英一). */
export function isSubheading(text: string): boolean {
  const t = String(text || '').trim()
  return t.length > 0 && t.length <= 70 && !/__\(\d+\)__/.test(t) && !/[.?!:;"”’)…。？！：；]$/.test(t) && /^[A-Z]/.test(t)
}

// ---------------------------------------------------------------- 翻译划线

export type Underline = { q_no: number; paragraph: number; marker_start: number; marker_end: number; start: number; end: number }
export type UnderlinePiece =
  | { kind: 'text'; text: string }
  | { kind: 'marker'; q_no: number; text: string }
  | { kind: 'underline'; q_no: number; text: string }

/** Cut one paragraph into plain text, "(46)" badges and underlined sentences. Spans are UTF-16 offsets from the
 *  API; any span that is out of range, overlapping or not on its "(N)" marker is ignored rather than guessed. */
export function underlinePieces(text: string, underlines: Underline[] | null | undefined): UnderlinePiece[] {
  const spans = (underlines || [])
    .filter(u => Number.isInteger(u.marker_start) && u.marker_start >= 0 && u.marker_start < u.marker_end
      && u.marker_end <= u.start && u.start < u.end && u.end <= text.length
      && text.slice(u.marker_start, u.marker_end) === `(${u.q_no})` && !text.slice(u.marker_end, u.start).trim())
    .sort((a, b) => a.marker_start - b.marker_start)
  const pieces: UnderlinePiece[] = []
  let last = 0
  for (const u of spans) {
    if (u.marker_start < last) continue
    if (u.marker_start > last) pieces.push({ kind: 'text', text: text.slice(last, u.marker_start) })
    pieces.push({ kind: 'marker', q_no: u.q_no, text: text.slice(u.marker_start, u.marker_end) })
    if (u.start > u.marker_end) pieces.push({ kind: 'text', text: text.slice(u.marker_end, u.start) })
    pieces.push({ kind: 'underline', q_no: u.q_no, text: text.slice(u.start, u.end) })
    last = u.end
  }
  if (last < text.length) pieces.push({ kind: 'text', text: text.slice(last) })
  return pieces
}

// ---------------------------------------------------------------- 排序链

export type ChainSlot = { given: string; q_no?: undefined } | { q_no: number; given?: undefined }

/** Ordering card hint from the chain: what comes before and after the box. */
export function orderingHint(chain: ChainSlot[] | null | undefined, qNo: number): string {
  const slots = Array.isArray(chain) ? chain : []
  const i = slots.findIndex(s => s.q_no === qNo)
  if (i < 0) return ''
  const name = (verb: string, s: ChainSlot) => s.given ? `${verb} ${s.given} 段` : `${verb}第 ${s.q_no} 空`
  const before = i > 0 ? name('前接', slots[i - 1]) : '开篇第一段'
  const after = i < slots.length - 1 ? name('后接', slots[i + 1]) : '全文最后一段'
  return `${before} · ${after}`
}

/** Letters chosen in a section, letter → question numbers (for "已选用" / dimmed options). */
export function usedLetters(questions: { uid: string; q_no: number }[], answers: Record<string, any>): Record<string, number[]> {
  const used: Record<string, number[]> = {}
  for (const q of questions) {
    const v = answers[q.uid]
    if (typeof v === 'string' && v) (used[v] = used[v] || []).push(q.q_no)
  }
  return used
}

// ---------------------------------------------------------------- 写作题目要求（§6.4 规则 3）

export type PromptLine = { enumerator: string; text: string }
export type PromptBlock = { kind: 'text' | 'quote'; lines: PromptLine[] }

type Candidate = { index: number; rank: number; length: number }

/** Explicit list markers only: 1) 2) 3) (also 1）), 1. 2. before a word, [A] [B] [C]. A chain must start at 1/A and
 *  count up in order, so "ANSWER SHEET 2. Do not…" never breaks a line. */
function enumeratorBreaks(text: string): Candidate[] {
  const styles: { re: RegExp; rank: (m: RegExpExecArray) => number }[] = [
    // 1) 2) — the OCR slip "l)" counts as 1) only when a 2) follows (2016 英一).
    { re: /(^|[\s:：;；,，.。])([1-9l])[)）]/g, rank: m => m[2] === 'l' ? 1 : Number(m[2]) },
    { re: /(^|[\s:：;；,，])([1-9])[.．](?=\s+[A-Za-z])/g, rank: m => Number(m[2]) },
    { re: /(^|[\s:：;；,，.。])[[［]([A-H])[\]］]/g, rank: m => m[2].charCodeAt(0) - 64 },
  ]
  const breaks: Candidate[] = []
  for (const style of styles) {
    const found: Candidate[] = []
    for (let m: RegExpExecArray | null; (m = style.re.exec(text));) {
      const index = m.index + m[1].length
      found.push({ index, rank: style.rank(m), length: m[0].length - m[1].length })
    }
    const chain: Candidate[] = []
    for (const c of found) if (c.rank === chain.length + 1) chain.push(c)
    if (chain.length >= 2) breaks.push(...chain)
  }
  return breaks.sort((a, b) => a.index - b.index)
}

function enumeratedLines(text: string): PromptLine[] {
  const lines: PromptLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const breaks = enumeratorBreaks(line)
    let start = 0, enumerator = ''
    for (const b of breaks) {
      const head = line.slice(start, b.index).trim()
      if (head || enumerator) lines.push({ enumerator, text: head })
      enumerator = line.slice(b.index, b.index + b.length)
      start = b.index + b.length
    }
    lines.push({ enumerator, text: line.slice(start).trim() })
  }
  return lines.filter(l => l.enumerator || l.text)
}

const CLOSING = /(^|[.!?。！？]\s+)((?:Yours(?: sincerely| truly| faithfully)?|Sincerely(?: yours)?|Best wishes|Best regards|Kind regards|Warm regards|Regards|All the best|Love|Cheers)[,，])\s+([^.!?。！？,，]{1,40})$/

/** A quoted letter: salutation, body and closing each on their own line; nothing else is split. */
function letterLines(text: string): PromptLine[] {
  if (text.includes('\n')) return text.split('\n').map(l => l.trim()).filter(Boolean).map(t => ({ enumerator: '', text: t }))
  let body = text.replace(/\s+/g, ' ').trim()
  const head: string[] = [], tail: string[] = []
  const salutation = /^((?:Dear|Dearest|Hi|Hello)\b[^,，.!?]{0,40}[,，:：])\s+/.exec(body)
  if (salutation) { head.push(salutation[1]); body = body.slice(salutation[0].length) }
  const closing = CLOSING.exec(body)
  if (closing) {
    tail.push(closing[2], closing[3].trim())
    body = body.slice(0, closing.index + closing[1].length).trim()
  }
  return [...head, body, ...tail].filter(Boolean).map(t => ({ enumerator: '', text: t }))
}

/** Writing directions → blocks split on "---": instructions, the quoted letter, then the answer requirements. */
export function splitPrompt(prompt: string | null | undefined): PromptBlock[] {
  const parts = String(prompt || '').replace(/\r\n?/g, '\n').split(/[ \t]*-{3,}[ \t]*/)
  return parts.map((part, i) => {
    const kind: PromptBlock['kind'] = parts.length > 2 && i % 2 === 1 ? 'quote' : 'text'
    return { kind, lines: kind === 'quote' ? letterLines(part) : enumeratedLines(part) }
  }).filter(block => block.lines.length > 0)
}

export type WordTarget = { min: number | null; max: number | null; label: string }

/** Word requirement stated in the prompt:「160–200 词」「约 100 词」「不少于 150 词」. Null when none is stated. */
export function wordTarget(prompt: string | null | undefined): WordTarget | null {
  const text = String(prompt || '').replace(/\s+/g, ' ')
  let m = /(\d{2,3})\s*[-–—~～]\s*(\d{2,3})\s*words/i.exec(text)
  if (m) return { min: Number(m[1]), max: Number(m[2]), label: `${m[1]}–${m[2]} 词` }
  m = /\babout\s+(\d{2,3})\s*words/i.exec(text)
  if (m) return { min: null, max: null, label: `约 ${m[1]} 词` }
  // "at less than" is a slip for "no less than" in the 1999 directions.
  m = /\b(?:no|not|at)\s+less\s+than\s+(\d{2,3})\s*words/i.exec(text)
  if (m) return { min: Number(m[1]), max: null, label: `不少于 ${m[1]} 词` }
  m = /\bat\s+least\s+(\d{2,3})\s*words/i.exec(text)
  if (m) return { min: Number(m[1]), max: null, label: `至少 ${m[1]} 词` }
  return null
}

/** English words in a draft; contractions, hyphenated words and numbers count once. */
export const englishWords = (text: string | null | undefined) =>
  String(text || '').match(/[A-Za-z0-9]+(?:['’.\-][A-Za-z0-9]+|,\d{3})*/g)?.length || 0

/** Chinese characters in a translation draft (punctuation and Latin letters excluded). */
export const chineseChars = (text: string | null | undefined) =>
  String(text || '').match(/[㐀-䶿一-鿿豈-﫿]/g)?.length || 0

/** Draft length against the target: under / ok / over, or null when the target sets no bound. */
export function targetState(count: number, target: WordTarget | null): 'under' | 'ok' | 'over' | null {
  if (!target || (target.min == null && target.max == null) || !count) return null
  if (target.min != null && count < target.min) return 'under'
  if (target.max != null && count > target.max) return 'over'
  return 'ok'
}

// ---------------------------------------------------------------- 范文、译文（§6.4 规则 2）

/** Every non-empty line is one paragraph: model essays and reference translations use a single "\n". */
export const textLines = (text: string | null | undefined) =>
  String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)

// ---------------------------------------------------------------- 解析整理（§6.3、§6.4 规则 4）

export type AnalysisLine = { kind: 'heading' | 'line'; text: string }

const CJK_CHAR = /[㐀-鿿　-〿＀-￯]/
// Full-width punctuation takes no space on either side.
const WIDE_PUNCT = /[　-〿！-／：-＠［-｀｛-･]/
const OPTION_LABEL = /^(?:[A-HTF][)）]|[[［]\s*[A-HTF]\s*[\]］])$/
const LEADING_CLOSER = /^[。，；）、：！？」』]/
const ARROW = /^[↔→]$/

function joinLine(a: string, b: string): string {
  if (!a) return b
  const end = a.slice(-1), start = b[0]
  if (/[↔→]$/.test(a) || /^[↔→]/.test(b)) return `${a} ${b}`  // arrows always stand between spaces
  return (CJK_CHAR.test(end) && CJK_CHAR.test(start)) || WIDE_PUNCT.test(end) || WIDE_PUNCT.test(start) ? a + b : `${a} ${b}`
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Lazynote analyses arrive one inline element per line. Rebuild natural lines:【…】become headings, option
 *  labels join the next line, ✓/✗ join the previous one, ↔/→ join both neighbours, lines that start with
 *  closing punctuation join the previous one, and the repeated question number at the top is dropped. */
export function formatAnalysis(text: string | null | undefined, opts: { qNo?: number | null; stem?: string | null } = {}): AnalysisLine[] {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length && /^\(?\d{1,3}\)?[.．、]?$/.test(lines[0])) lines.shift()
  else if (lines.length && opts.qNo != null && opts.stem) {
    // Translation analyses repeat "(46) <the sentence>" first; the card already shows it.
    const m = /^\((\d+)\)\s*(.*)$/.exec(lines[0])
    if (m && Number(m[1]) === Number(opts.qNo) && squash(m[2]) === squash(opts.stem)) lines.shift()
  }
  const out: AnalysisLine[] = []
  let absorbNext = false
  const lastLine = () => { const last = out[out.length - 1]; return last && last.kind === 'line' ? last : null }
  for (const line of lines) {
    const heading = /^【([^【】]+)】(.*)$/.exec(line)
    if (heading) {
      out.push({ kind: 'heading', text: heading[1].trim() })
      absorbNext = false
      if (!heading[2].trim()) continue
    }
    const textLine = heading ? heading[2].trim() : line
    const last = lastLine()
    if (absorbNext && last) {
      last.text = joinLine(last.text, textLine)
    } else if (last && /^[✓✗↔→]/.test(textLine)) {
      last.text = joinLine(last.text, textLine)
    } else if (last && LEADING_CLOSER.test(textLine)) {
      last.text += textLine
    } else if (last && /^[A-H]$/.test(textLine) && /^[㐀-鿿]{2,6}$/.test(last.text)) {
      last.text = `${last.text} ${textLine}`  // 正确段 / B
    } else {
      out.push({ kind: 'line', text: textLine })
    }
    const current = lastLine()
    const tail = current ? current.text : ''
    absorbNext = !!current && (OPTION_LABEL.test(textLine) || ARROW.test(textLine) || /[↔→]$/.test(tail)
      || (/[：:]$/.test(textLine) && textLine.length <= 12))
  }
  return out
}

// ---------------------------------------------------------------- 答案依据（§4、§6.4 规则 5）

/** PDF/OCR quotes on one line: whitespace collapsed, line-end hyphenation rejoined, no spaces between Chinese. */
export function reflowQuote(text: string | null | undefined): string {
  let s = String(text || '').replace(/\r\n?/g, '\n')
  s = s.replace(/([A-Za-z])-[ \t]*\n[ \t]*([a-z])/g, '$1$2')
  s = s.replace(/\s+/g, ' ').trim()
  // A hyphen left before a space inside a line is a compound split by extraction (top- down).
  s = s.replace(/([A-Za-z])- (?=[a-z])/g, '$1-')
  s = s.replace(/([㐀-鿿　-〿＀-￯]) (?=[㐀-鿿　-〿＀-￯])/g, '$1')
  s = s.replace(/ (?=[，。、；：？！）」』】])/g, '').replace(/([（「『【，。、；：？！]) /g, '$1')
  return s
}

export const CHECK_TONE: Record<string, string> = {
  external_agree: 'ok', disputed_resolved: 'info', disputed_unresolved: 'warn', source_only: '', manual: 'info',
}
export const VERDICT_CN: Record<string, string> = { agree: '一致', conflict: '冲突', unmapped: '未能对应', mixed: '不一致' }
export const METHOD_CN: Record<string, string> = { text: '按选项原文比对', printed_options: '按来源印出的选项比对', letter: '按字母比对' }

/** "第 131 页 · 第 5019 行" (web sources have no page; a quote may span lines). */
export function locator(item: { page?: number | null; line?: number | null; line_end?: number | null }): string {
  const parts: string[] = []
  if (item.page) parts.push(`第 ${item.page} 页`)
  if (item.line) parts.push(item.line_end && item.line_end !== item.line ? `第 ${item.line}–${item.line_end} 行` : `第 ${item.line} 行`)
  return parts.join(' · ')
}

/** /api/pdf path of an archived source document (paths are relative to the project; the API is rooted one level up). */
export function evidencePdf(doc: string | null | undefined): string | null {
  const path = String(doc || '').replace(/\\/g, '/')
  if (!/\.pdf$/i.test(path) || path.startsWith('/') || path.split('/').includes('..') || /^[a-z]+:/i.test(path)) return null
  return path.startsWith('cet6-practice/') ? path : `cet6-practice/${path}`
}
