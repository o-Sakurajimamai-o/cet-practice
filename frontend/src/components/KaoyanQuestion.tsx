import type { KeyboardEvent } from 'react'
import Icon from './Icon'
import { LineProse } from './PdfProse'
import { KyAnalysisText } from './KaoyanText'
import { AnswerEvidence, CheckBadge, type AnswerCheck } from './KaoyanEvidence'
import { blankPlace, chineseChars, englishWords, orderingHint, targetState, wordTarget } from '../kaoyan'
import '../kaoyan.css'

const PART_B = new Set(['ordering', 'gap', 'heading', 'opinion', 'match', 'tf'])
const POSITION_CN: Record<string, string> = { whole: '整段空缺', start: '段首', middle: '段中', end: '段末' }

/** Layout of a kaoyan question; the API sends it as `variant`, the section decides when it is missing. */
export function kaoyanVariant(q: any, material?: any): string {
  return q.variant || ({ cloze: 'cloze', reading1: 'reading', writing: 'writing' } as Record<string, string>)[q.section] || material?.content?.variant || ''
}

/** "B · If" for a cloze letter, else the letter itself. */
export function choiceText(q: any, key: string | null | undefined): string {
  if (!key) return ''
  const word = kaoyanVariant(q) === 'cloze' ? (q.options || []).find((o: any) => o.key === key)?.text : ''
  return word ? `${key} · ${word}` : key
}

const clip = (text: string, size: number) => text.length > size ? `${text.slice(0, size - 1)}…` : text

type BodyProps = {
  q: any; answer: any; material?: any
  displayAnswer: string | null | undefined
  submitted: boolean; saving: boolean; markBase: number
  review?: boolean                    // question detail: no draft box, nothing clickable
  onChoose: (key: string, keyboard?: boolean) => void
  onKeyChoose: (event: KeyboardEvent, key: string) => void
  onDraft: (text: string) => void
}

/** Answering area of a kaoyan question card (CONTRACT §6.3). */
export function KaoyanQuestionBody(props: BodyProps) {
  const { q } = props
  if (q.qtype === 'essay' || q.qtype === 'translation') return <KaoyanDraft {...props}/>
  const variant = kaoyanVariant(q, props.material)
  return PART_B.has(variant) ? <KaoyanLetters {...props} variant={variant}/> : <KaoyanOptions {...props} compact={variant === 'cloze'}/>
}

/** Reading options as on CET cards; cloze options as a compact grid without the placeholder stem. */
function KaoyanOptions({ q, answer, displayAnswer, submitted, saving, markBase, review, onChoose, onKeyChoose, compact }: BodyProps & { compact: boolean }) {
  const locked = submitted || saving || !!review
  return <>
    {!compact && q.stem && <div className="stem" data-mark-index={markBase}>{q.stem}</div>}
    <div className={`opts${compact ? ' ky-compact' : ''}`} role="group" aria-label={`第 ${q.q_no} ${compact ? '空' : '题'}选项`}>
      {(q.options || []).map((o: any, optionIndex: number) => {
        const selected = answer === o.key
        const correct = !!displayAnswer && o.key === displayAnswer, wrong = !!displayAnswer && selected && !correct
        return <div key={o.key} role="button" tabIndex={locked ? -1 : 0} aria-disabled={locked} aria-pressed={selected}
          className={`opt${selected ? ' selected' : ''}${correct ? ' correct' : ''}${wrong ? ' wrong' : ''}`}
          onClick={() => { if (!review) onChoose(o.key) }} onKeyDown={e => { if (!review) onKeyChoose(e, o.key) }}>
          <span className="okey">{o.key}</span>
          <span className="otext" data-mark-index={markBase + 1 + optionIndex}>{o.text}</span>
          {correct && (compact ? <span className="visually-hidden">（参考答案）</span> : <span className="verdict"><Icon name="check" size={14}/>参考答案</span>)}
          {wrong && (compact ? <span className="visually-hidden">（你的选择）</span> : <span className="verdict"><Icon name="close" size={14}/>你的选择</span>)}
        </div>
      })}
    </div>
  </>
}

function partBHint(q: any, variant: string, content: any): string {
  if (variant === 'ordering') return `第 ${q.q_no} 空 · ${orderingHint(content?.chain, q.q_no) || '段落排序'}`
  if (variant === 'heading') return `第 ${q.q_no} 空 · 为其后的段落选小标题`
  if (variant === 'gap' || variant === 'opinion') {
    const place = blankPlace(Array.isArray(content?.paragraphs) ? content.paragraphs : [], q.q_no)
    if (variant === 'opinion') return place?.rest ? `第 ${q.q_no} 空 · ${place.rest.replace(/[:：]$/, '')} 的观点` : `第 ${q.q_no} 空 · 概括观点`
    return `第 ${q.q_no} 空${place ? ` · ${POSITION_CN[place.position]}` : ''}`
  }
  return ''
}

/** Part B: a letter button per option; the chosen option's text shows under the buttons. */
function KaoyanLetters({ q, answer, material, displayAnswer, submitted, saving, markBase, review, onChoose, variant }: BodyProps & { variant: string }) {
  const options: any[] = q.options || []
  const hint = partBHint(q, variant, material?.content)
  const tf = variant === 'tf'
  const chosenIndex = options.findIndex(o => o.key === answer)
  const chosen = options[chosenIndex]
  return <>
    {(variant === 'match' || tf) && q.stem && <div className="stem" data-mark-index={markBase}>{q.stem}</div>}
    {hint && <div className="ky-slot-hint">{hint}</div>}
    <div className="letter-row ky-letters" role="group" aria-label={`第 ${q.q_no} 题选项`}>
      {options.map(o => {
        const selected = answer === o.key
        const correct = !!displayAnswer && o.key === displayAnswer, wrong = !!displayAnswer && selected && !correct
        const name = tf ? (o.key === 'T' ? '正确' : o.key === 'F' ? '错误' : o.text) : ''
        return <button key={o.key} type="button" className={`L${tf ? ' tf' : ''}${selected ? ' selected' : ''}${correct ? ' correct' : ''}${wrong ? ' wrong' : ''}`}
          disabled={submitted || saving || !!review} aria-pressed={selected}
          aria-label={tf ? `${o.key} ${name}${correct ? '，参考答案' : ''}` : `${o.key}：${clip(o.text, 80)}${correct ? '，参考答案' : ''}`}
          title={tf ? undefined : clip(o.text, 200)} onClick={() => onChoose(o.key, true)}>
          {o.key}{tf && <small>{name}</small>}
        </button>
      })}
    </div>
    {chosen && !tf && <div className={`ky-chosen${variant === 'ordering' ? ' clamp' : ''}`}>
      <b>{review ? '参考答案' : '已选'} {chosen.key}</b><span lang="en" data-mark-index={markBase + 1 + chosenIndex}>{chosen.text}</span>
    </div>}
  </>
}

/** Translation and essay drafts: the sentence to translate, the draft box, and its length against the stated target. */
function KaoyanDraft({ q, answer, material, submitted, saving, markBase, review, onDraft }: BodyProps) {
  const essay = q.qtype === 'essay'
  const sentence = !essay && q.variant === 'translation_sentence'
  const text = typeof answer === 'string' ? answer : ''
  const target = essay ? wordTarget(material?.content?.prompt || q.stem) : null
  const count = essay ? englishWords(text) : chineseChars(text)
  const state = targetState(count, target)
  return <>
    {sentence && q.stem && <blockquote className="ky-sentence" lang="en" data-mark-index={markBase}>{q.stem}</blockquote>}
    {!essay && !sentence && <div className="ky-slot-hint">英译汉（整篇）：对照原文逐段书写译文。</div>}
    {review ? (essay && target ? <div className="ky-slot-hint">字数要求：{target.label}</div> : null) : <>
      <div className="hint">此题由你自行完成，可只看题目；下方文本框仅用于记录草稿（可不填，不判分，不影响交卷）。</div>
      <textarea className="essay" value={text} disabled={submitted || saving}
        placeholder={essay ? '（可选）在此记录你的作文草稿…' : '（可选）在此记录你的译文草稿…'}
        aria-label={essay ? `第 ${q.q_no} 题作文草稿` : `第 ${q.q_no} 题译文草稿`} onChange={e => onDraft(e.target.value)}/>
      <div className="ky-draft-meta">
        <span>{essay ? `已写 ${count} 词` : `已写 ${count} 字`}</span>
        {target && <span className={state || undefined}>要求 {target.label}{state === 'under' ? ' · 还不够' : state === 'over' ? ' · 已超出' : state === 'ok' ? ' · 符合' : ''}</span>}
      </div>
    </>}
  </>
}

type AnalysisProps = { q: any; submitted: boolean; detail?: any; verdict?: string; markBase: number; material?: any }

/** Revealed answer, evidence and references of one kaoyan question; only its own group's material is read. */
export function KaoyanAnalysis({ q, submitted, detail, verdict, markBase, material }: AnalysisProps) {
  const objective = q.qtype !== 'essay' && q.qtype !== 'translation'
  const c = material?.content || {}
  const check: AnswerCheck | null = objective && q.answer_check && typeof q.answer_check === 'object' ? q.answer_check : null
  const references: string[] = Array.isArray(c.reference_paragraphs) ? c.reference_paragraphs.filter((p: unknown) => typeof p === 'string' && p.trim()) : []
  return <>
    {objective && <div className="answer-line">
      <span className="answer-key"><small>参考答案</small>
        {q.has_answer ? <b className="ok">{q.answer_word ? `${q.answer} · ${q.answer_word}` : choiceText(q, q.answer)}</b> : <b className="bad">无参考答案（本题不判分）</b>}</span>
      {submitted && detail && <span className="answer-key"><small>你的作答</small>
        <b className={verdict === 'correct' ? 'ok' : verdict === 'wrong' ? 'bad' : ''}>{choiceText(q, detail.choice) || '未作答'}{verdict === 'correct' && ' ✓'}{verdict === 'wrong' && ' ✗'}</b>
        {verdict === 'no_key' && <span className="muted small">无参考答案，不计分</span>}
        {detail.revealed && <span className="tag warn">练习中看过答案</span>}
      </span>}
      {check && <span className="ky-badge-wrap"><CheckBadge check={check}/>{check.stale && <span className="tag warn">核对已过期</span>}</span>}
    </div>}
    {check && <AnswerEvidence check={check} answer={q.answer}/>}
    {q.qtype === 'translation' && q.variant === 'translation_sentence' && q.answer && <>
      <div className="analysis-title">参考译文（本句）</div>
      <div data-mark-index={markBase + 50}><LineProse className="model-essay" text={q.answer}/></div>
    </>}
    {q.qtype === 'translation' && q.variant !== 'translation_sentence' && references.length > 0 && <>
      <div className="analysis-title">参考译文（逐段）</div>
      <div className="model-essay" data-mark-index={markBase + 50}>
        {references.map((text, i) => <p key={i} className="ky-ref-para"><span className="ky-ref-label">P{i + 1}</span>{text}</p>)}
      </div>
    </>}
    {q.qtype === 'translation' && c.reference_notes && <KyAnalysisText title="译文讲评" text={c.reference_notes} markIndex={markBase + 52}/>}
    {q.qtype === 'essay' && c.model_essay && <>
      <div className="analysis-title">参考范文</div>
      <div data-mark-index={markBase + 50}><LineProse className="model-essay" text={c.model_essay}/></div>
    </>}
    {q.qtype === 'essay' && c.model_essay_cn && <>
      <div className="analysis-title">范文中译</div>
      <div data-mark-index={markBase + 51}><LineProse className="model-essay" text={c.model_essay_cn}/></div>
    </>}
    {q.analysis_text && <KyAnalysisText title={q.qtype === 'essay' ? '逐段写作解析' : q.qtype === 'translation' ? '逐句解析' : '解析'}
      text={q.analysis_text} qNo={q.q_no} stem={q.stem} markIndex={markBase + 30}/>}
    {!objective && <div className="ky-note-line">参考译文和范文整理自懒笔记，非官方，不自动评分。</div>}
  </>
}
