import { Fragment, useEffect, useRef, type RefObject } from 'react'
import Icon, { type IconName } from './Icon'
import { KAOYAN_SECTION_LONG, PARTB_VARIANT_CN } from '../exam'
import { blankPieces, isSubheading, stripQuestionNo, underlinePieces, usedLetters, type ChainSlot, type Underline } from '../kaoyan'
import { KyFigure, KyPrompt } from './KaoyanText'
import '../kaoyan.css'

/** Left column of a kaoyan section (CONTRACT §5.4 material, §6.2 mark indices, §6.3 layouts).
 *  With onFocus it is interactive (practice); without it every slot is static text (question detail). */
export type KaoyanMaterialProps = {
  section: string
  mat: any
  questions?: any[]                    // in-scope questions of this paper and section
  answers?: Record<string, any>
  currentQNo?: number | null
  onFocus?: (qNo: number, keyboard: boolean) => void   // keyboard: activated with Enter/Space (click detail 0)
  disabled?: boolean
  bilingual?: boolean                  // only ever true after submission
  verdicts?: Record<number, string>
}

type Ctx = KaoyanMaterialProps & { byNo: Record<number, any>; answers: Record<string, any>; used: Record<string, number[]>; options: any[] }

const ICON: Record<string, IconName> = { cloze: 'book', reading1: 'book', matching: 'layers', translation: 'text', writing: 'note' }

/** Keep the current blank visible inside the sticky material column; the page itself never jumps. */
function useActiveIntoView(root: RefObject<HTMLDivElement>, qNo: number | null | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || qNo == null) return
    const el = root.current?.querySelector<HTMLElement>(`[data-ky-q="${qNo}"]`)
    const box = root.current?.closest<HTMLElement>('.material')
    if (!el || !box || box.scrollHeight <= box.clientHeight + 1 || !/auto|scroll/.test(getComputedStyle(box).overflowY)) return
    const a = el.getBoundingClientRect(), b = box.getBoundingClientRect()
    if (a.top < b.top + 56 || a.bottom > b.bottom - 16) box.scrollTop += a.top - b.top - box.clientHeight / 3
  }, [qNo, enabled])
}

function slotClass(ctx: Ctx, no: number, base: string, value: unknown) {
  const verdict = ctx.verdicts?.[no]
  return `${base}${ctx.currentQNo === no ? ' active' : ''}${value ? ' has-val filled' : ''}${verdict === 'correct' || verdict === 'wrong' ? ` ${verdict}` : ''}`
}

/** A numbered blank: "3 · convenience" for cloze, the letter for Part B; whole-paragraph blanks also show the option. */
function Blank({ no, ctx, block = false }: { no: number; ctx: Ctx; block?: boolean }) {
  const q = ctx.byNo[no]
  const value: string | undefined = q ? ctx.answers[q.uid] : undefined
  const option = value ? (ctx.section === 'cloze' ? q.options : ctx.options)?.find((o: any) => o.key === value) : undefined
  const cloze = ctx.section === 'cloze'
  const cls = slotClass(ctx, no, `blank-slot ky-gap-btn${block ? ' ky-gap-block' : ''}`, value)
  const title = `第 ${no} 空${value ? `：${value}${option?.text ? ` ${option.text}` : ''}` : '（未作答）'}`
  const content = value
    ? <><small>{no} ·</small>{cloze ? option?.text || value : value}{block && !cloze && option?.text && <span className="ky-gap-text">{option.text}</span>}</>
    : <>{no}{block && <span className="ky-gap-text muted">未作答</span>}</>
  if (!ctx.onFocus) return <span className={cls} data-ky-q={no} title={title}>{content}</span>
  return <button type="button" className={cls} data-ky-q={no} disabled={ctx.disabled || !q} aria-current={ctx.currentQNo === no ? 'true' : undefined}
    aria-label={q ? `${title}，跳到这一题` : `第 ${no} 空，未加入本次练习`} title={q ? title : `第 ${no} 空（未加入本次练习）`} onClick={e => ctx.onFocus!(no, e.detail === 0)}>{content}</button>
}

function withBlanks(text: string, ctx: Ctx) {
  return blankPieces(text).map((piece, i) => piece.kind === 'blank' ? <Blank key={i} no={piece.no} ctx={ctx}/> : <Fragment key={i}>{piece.text}</Fragment>)
}

/** Paragraph translation i (1-based) under its English paragraph; data-mark-skip keeps the English offsets stable. */
function chinese(ctx: Ctx, i: number, markIndex: number) {
  const text = ctx.bilingual ? ctx.mat?.translation?.paragraphs?.[i] : undefined
  return text ? <p className="ky-para-cn" lang="zh-CN" data-mark-skip data-mark-index={markIndex}>{text}</p> : null
}

function OptionList({ ctx, title }: { ctx: Ctx; title: string }) {
  if (!ctx.options.length) return null
  const current = ctx.currentQNo != null && ctx.byNo[ctx.currentQNo] ? ctx.answers[ctx.byNo[ctx.currentQNo].uid] : undefined
  return <div className="ky-options">
    <div className="ky-options-head">{title}</div>
    <div data-mark-index={60}>
      {ctx.options.map((o: any) => {
        const by = ctx.used[o.key]
        return <div key={o.key} className={`ky-option-row${by ? ' used' : ''}${current === o.key ? ' current' : ''}`}>
          <span className="ky-key">{o.key}</span><span className="ky-option-text" lang="en">{o.text}</span>
          {by && <span className="ky-used-tag" data-mark-skip>{by.map(n => `第 ${n} 题`).join('、')}</span>}
        </div>
      })}
    </div>
  </div>
}

function Ordering({ ctx }: { ctx: Ctx }) {
  const c = ctx.mat.content
  const chain: ChainSlot[] = Array.isArray(c.chain) ? c.chain : []
  const given = new Set<string>(Array.isArray(c.given) ? c.given : [])
  const paragraphs: { label: string; text: string }[] = Array.isArray(c.labeled_paragraphs) ? c.labeled_paragraphs : []
  return <>
    {chain.length > 0 && <div className="ky-order-chain" role="group" aria-label="段落顺序">
      <span className="ky-order-label">段落顺序 · 灰色段落为原卷已给定</span>
      {chain.map((slot, i) => <Fragment key={i}>
        {i > 0 && <span className="ky-order-arrow" aria-hidden="true">→</span>}
        {slot.given
          ? <span className="ky-order-given" title="原卷已给定的段落，不作答"><b>{slot.given}</b><small>原卷已给定</small></span>
          : <ChainButton no={slot.q_no!} ctx={ctx}/>}
      </Fragment>)}
    </div>}
    <div className="passage ky-passage" id="kaoyan-passage" lang="en">
      {paragraphs.map((p, i) => {
        const by = ctx.used[p.label]
        return <div key={p.label || i} className={`ky-lp${given.has(p.label) ? ' given' : ''}${by ? ' used' : ''}`}>
          <div className="ky-lp-head"><span className="p-label">{p.label}</span>
            {given.has(p.label) && <span className="tag" data-mark-skip>原卷已给定</span>}
            {by && <span className="tag info" data-mark-skip>已选用 · {by.map(n => `第 ${n} 空`).join('、')}</span>}
          </div>
          <p className="ky-para">{p.text}</p>
          {chinese(ctx, i, 601 + i)}
        </div>
      })}
    </div>
  </>
}

function ChainButton({ no, ctx }: { no: number; ctx: Ctx }) {
  const q = ctx.byNo[no]
  const value: string | undefined = q ? ctx.answers[q.uid] : undefined
  const cls = slotClass(ctx, no, 'ky-order-slot', value)
  const content = <><small>{no}</small><b>{value || '?'}</b></>
  if (!ctx.onFocus) return <span className={cls} data-ky-q={no} title={`第 ${no} 空${value ? `：${value}` : ''}`}>{content}</span>
  return <button type="button" className={cls} data-ky-q={no} disabled={ctx.disabled || !q} aria-current={ctx.currentQNo === no ? 'true' : undefined}
    aria-label={`第 ${no} 空${value ? `，已选 ${value}` : '，未作答'}`} title={q ? undefined : '未加入本次练习'} onClick={e => ctx.onFocus!(no, e.detail === 0)}>{content}</button>
}

/** gap / heading / opinion / match / tf: the article, then the shared options (index 60) where the layout has them. */
function PartBArticle({ ctx }: { ctx: Ctx }) {
  const c = ctx.mat.content
  const paragraphs: string[] = Array.isArray(c.paragraphs) ? c.paragraphs : []
  return <>
    <div className="passage ky-passage" id="kaoyan-passage" lang="en">
      {paragraphs.map((p, i) => {
        const whole = /^\s*__\(\d+\)__\s*$/.exec(p)
        return <Fragment key={i}>
          {whole ? <div className="ky-para"><Blank no={Number(/\d+/.exec(p)![0])} ctx={ctx} block/></div>
            : isSubheading(p) ? <h4 className="ky-subhead">{p}</h4>
            : <p className="ky-para">{withBlanks(p, ctx)}</p>}
          {chinese(ctx, i, 601 + i)}
        </Fragment>
      })}
    </div>
    {c.variant !== 'tf' && <OptionList ctx={ctx} title={c.variant === 'match' ? '右栏 · 供选陈述 A–G（其中两项不用）' : '供选项 A–G（其中两项不用）'}/>}
  </>
}

function Translation({ ctx }: { ctx: Ctx }) {
  const c = ctx.mat.content
  const paragraphs: string[] = Array.isArray(c.paragraphs) ? c.paragraphs : []
  const underlines: Underline[] = c.variant === 'translation_sentence' && Array.isArray(c.underlines) ? c.underlines : []
  return <>
    {ctx.mat.status === 'needs_review' && <p className="ky-material-note">有划线句未能在原文中精确定位，未加下划线；请以题目卡中的英文句子为准。</p>}
    <div className="ky-passage ky-translation-text" data-mark-index={50} lang="en">
      {paragraphs.map((text, i) => <p key={i} className="ky-para">
        {underlinePieces(text, underlines.filter(u => u.paragraph === i)).map((piece, j) => {
          if (piece.kind === 'text') return <Fragment key={j}>{piece.text}</Fragment>
          const active = ctx.currentQNo === piece.q_no
          if (piece.kind === 'underline') return <u key={j} className={`ky-ul${active ? ' current' : ''}`}>{piece.text}</u>
          const inScope = !!ctx.byNo[piece.q_no]
          return ctx.onFocus
            ? <button key={j} type="button" className={`ky-ul-badge${active ? ' active' : ''}`} data-ky-q={piece.q_no} disabled={ctx.disabled || !inScope}
              aria-label={`第 ${piece.q_no} 题划线句`} title={inScope ? '跳到这一题' : '未加入本次练习'} onClick={e => ctx.onFocus!(piece.q_no, e.detail === 0)}>{piece.text}</button>
            : <span key={j} className={`ky-ul-badge${active ? ' active' : ''}`} data-ky-q={piece.q_no}>{piece.text}</span>
        })}
      </p>)}
    </div>
  </>
}

export default function KaoyanMaterial(props: KaoyanMaterialProps) {
  const root = useRef<HTMLDivElement>(null)
  useActiveIntoView(root, props.currentQNo, !!props.onFocus)
  const { section, mat } = props
  if (!mat) return <div className="card material-card muted">该题型无共享材料。</div>
  const c = mat.content || {}
  const questions = props.questions || []
  const answers = props.answers || {}
  const ctx: Ctx = {
    ...props, answers,
    byNo: Object.fromEntries(questions.map(q => [q.q_no, q])),
    used: section === 'matching' ? usedLetters(questions, answers) : {},
    options: Array.isArray(c.options) ? c.options : [],
  }
  const sub = section === 'reading1' ? c.title
    : section === 'matching' ? PARTB_VARIANT_CN[c.variant]
    : section === 'writing' ? c.title
    : section === 'translation' ? (c.variant === 'translation_sentence' ? '划线句子' : '整篇翻译') : ''
  const directions = section === 'writing' ? '' : stripQuestionNo(section === 'reading1' ? mat.section_directions || mat.directions : mat.directions)
  const text = /^text_(\d+)$/.exec(String(mat.group_key || ''))
  const textNo = text ? Number(text[1]) : 1
  const hintKey = section === 'matching' ? (c.variant === 'ordering' ? 'ordering' : ['gap', 'heading', 'opinion'].includes(c.variant) ? 'gap' : '')
    : section === 'translation' ? (c.variant === 'translation_sentence' ? 'translation' : '') : section
  return <div className="card material-card ky-matcard" ref={root}>
    <div className="material-head"><Icon name={ICON[section] || 'book'} size={16}/>{KAOYAN_SECTION_LONG[section] || section}{sub && <span className="ky-head-sub">{sub}</span>}</div>
    {directions && <div className="directions ky-dir" lang="en">{directions}</div>}
    {section === 'cloze' && <div className="passage ky-passage" id="kaoyan-passage" lang="en">
      {(c.paragraphs || []).map((p: string, i: number) => <Fragment key={i}><p className="ky-para">{withBlanks(p, ctx)}</p>{chinese(ctx, i, 601 + i)}</Fragment>)}
    </div>}
    {section === 'reading1' && <div className="ky-passage" id="kaoyan-passage" lang="en" data-mark-index={100 + textNo}>
      {(c.paragraphs || []).map((p: string, i: number) => <Fragment key={i}><p className="ky-para">{p}</p>{chinese(ctx, i, 200 + 20 * textNo + i + 1)}</Fragment>)}
    </div>}
    {section === 'matching' && (c.variant === 'ordering' ? <Ordering ctx={ctx}/> : <PartBArticle ctx={ctx}/>)}
    {section === 'translation' && <Translation ctx={ctx}/>}
    {section === 'writing' && <>
      <KyPrompt prompt={c.prompt} markIndex={mat.group_key === 'part_b' ? 51 : 50}/>
      {(Array.isArray(c.images) ? c.images : []).map((img: any) => <KyFigure key={img.src} src={img.src} alt={img.alt || '作文图画'}/>)}
    </>}
    {props.onFocus && HINT[hintKey] && <div className="hint">{HINT[hintKey]}</div>}
  </div>
}

const HINT: Record<string, string> = {
  cloze: '点击原文空位可跳到对应题目；作答后空位显示所选单词。',
  gap: '点击原文空位可跳到对应题目；已用的选项会淡化显示。',
  ordering: '点击链条中的空位可跳到对应题目；已给定、已选用的段落分别标出。',
  translation: '点击划线句前的题号可跳到对应题目。',
}
