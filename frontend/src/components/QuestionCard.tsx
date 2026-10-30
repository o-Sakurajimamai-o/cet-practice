import { useEffect, useRef, useState } from 'react'
import { getNoteDraft, rememberNoteDraft, persistNoteDraft } from '../noteDrafts'
import { examOf, paperShort } from '../exam'
import PdfProse from './PdfProse'
import Icon from './Icon'
import SentenceInsights from './SentenceInsights'
import { KaoyanAnalysis, KaoyanQuestionBody, choiceText, kaoyanVariant } from './KaoyanQuestion'

/** 单题卡片：按题型渲染点击作答交互；交卷后显示对错。考研题的作答区与解析由 KaoyanQuestion 渲染。 */
export default function QuestionCard({
  q: baseQuestion, answer, onAnswer, submitted, detail, isCurrent, favorite,
  onToggleFav, onReveal, analysisData, paragraphLabels, saving = false, kaoyanMaterial,
}: {
  q: any
  answer: any
  onAnswer: (v: any) => void
  submitted: boolean
  saving?: boolean
  detail: any        // 交卷结果中的该题判定
  isCurrent: boolean
  favorite: boolean
  onToggleFav: () => Promise<void>
  onReveal: () => Promise<any>
  analysisData: any  // questionDetail 结果（含解析/材料）
  paragraphLabels: string[]
  kaoyanMaterial?: any  // 考研：本题所在分组的会话材料（排序链、空位位置、写作要求）
}) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [favoriteLoading, setFavoriteLoading] = useState(false)
  const [favoriteError, setFavoriteError] = useState('')
  const [loadedDetail, setLoadedDetail] = useState<any | null>(null)
  const q = { ...loadedDetail, ...baseQuestion }
  const kaoyan = examOf(baseQuestion) === 'kaoyan'
  // Kaoyan references come from this question's own group: a pre-submit reveal only carries those (CONTRACT §9.2).
  const ownMaterial = kaoyan
    ? (analysisData?.materials || []).find((m: any) => (m.group_key || 'main') === (q.group_key || 'main')) || kaoyanMaterial
    : undefined
  const markBase = 1000 + (Number(q.q_no) || 0) * 100
  const choose = (key: string, keyboard = false) => {
    if (submitted || saving || (!keyboard && !window.getSelection()?.isCollapsed)) return
    onAnswer(key)
  }
  const chooseKey = (event: React.KeyboardEvent, key: string) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(key, true) }
  }
  const [note, setNote] = useState(analysisData?.note || '')
  const [noteSaved, setNoteSaved] = useState('')
  const [remoteNote, setRemoteNote] = useState<string | null>(null)
  const noteRef = useRef(note)
  const savedNoteRef = useRef<string | null>(null)
  const mounted = useRef(true)
  const analysisBusy = useRef(false)
  const favoriteBusy = useRef(false)

  async function persistNote() {
    const value = noteRef.current
    if (savedNoteRef.current === null || (value === savedNoteRef.current && !getNoteDraft(q.uid))) return
    if (mounted.current) setNoteSaved('正在保存…')
    try {
      await persistNoteDraft(q.uid, value)
      savedNoteRef.current = value
      if (mounted.current && noteRef.current === value && !getNoteDraft(q.uid)) setNoteSaved('已保存')
    } catch { if (mounted.current) setNoteSaved('保存失败，草稿仍保留在本机；请重试') }
  }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; void persistNote() }
  }, [q.uid])

  useEffect(() => {
    if (remoteNote === null || !showAnalysis) return
    const id = window.setTimeout(() => { void persistNote() }, 700)
    return () => clearTimeout(id)
  }, [note, remoteNote, showAnalysis])

  const verdict = detail?.verdict
  const canShowAnalysis = showAnalysis
  // A submitted attempt retains the answer used when it was graded, even if
  // the question is corrected later. Do not reveal answers during practice.
  const displayAnswer = submitted ? detail?.answer : canShowAnalysis ? q.answer : null

  async function toggleAnalysis() {
    if (showAnalysis) { void persistNote(); setShowAnalysis(false); return }
    if (analysisBusy.current || saving) return
    analysisBusy.current = true
    setAnalysisLoading(true)
    setAnalysisError('')
    try {
      const detail = await onReveal()
      if (!mounted.current) return
      setLoadedDetail(detail)
      const remote = detail.note || ''
      const draft = getNoteDraft(q.uid)
      const current = draft?.text ?? remote
      setRemoteNote(remote)
      savedNoteRef.current = remote
      noteRef.current = current
      setNote(current)
      setNoteSaved(draft ? '已恢复尚未保存的笔记草稿' : '')
      setShowAnalysis(true)
    } catch (error: any) {
      if (mounted.current) setAnalysisError('解析加载未完成：' + String(error.message || error) + '。请重试。')
    } finally {
      analysisBusy.current = false
      if (mounted.current) setAnalysisLoading(false)
    }
  }

  async function toggleFavorite() {
    if (favoriteBusy.current) return
    favoriteBusy.current = true
    setFavoriteLoading(true)
    setFavoriteError('')
    try { await onToggleFav() }
    catch { if (mounted.current) setFavoriteError('收藏未保存，请再点一次重试。') }
    finally { favoriteBusy.current = false; if (mounted.current) setFavoriteLoading(false) }
  }

  return (
    <div className={`qcard${kaoyan ? ` ky-card-${kaoyanVariant(q)}` : ''}${isCurrent ? ' current-q' : ''}${verdict ? ` verdict-${verdict}` : ''}`} id={`q-${q.uid}`}>
      <div className="qhead">
        <span className="qno">{q.q_no}</span>
        <span className="tag">{q.section_cn}</span>
        {q.paper_key && <span className="muted small">{kaoyan ? paperShort(q.paper_key) : q.paper_key}</span>}
        {q.status === 'needs_review' && <span className="tag warn" title={Array.isArray(q.flags) ? q.flags.join('；') : undefined}>待核对</span>}
        {!q.has_answer && q.qtype !== 'essay' && q.qtype !== 'translation' && (
          <span className="tag warn">{kaoyan ? '无参考答案（不判分）' : '无标准答案（不判分）'}</span>
        )}
        {submitted && verdict === 'correct' && <span className="tag ok"><Icon name="check" size={13}/>答对</span>}
        {submitted && verdict === 'wrong' && <span className="tag err"><Icon name="close" size={13}/>答错</span>}
        <button
          className={`fav-btn${favorite ? ' on' : ''}`}
          title={favorite ? '取消收藏' : '收藏本题'}
          aria-label={favorite ? `取消收藏第 ${q.q_no} 题` : `收藏第 ${q.q_no} 题`}
          aria-pressed={favorite}
          disabled={favoriteLoading}
          onClick={toggleFavorite}
        ><Icon name={favorite ? 'starFilled' : 'star'} size={19}/></button>
      </div>
      {favoriteError && <div className="muted small" role="alert">{favoriteError}</div>}

      {submitted && detail?.kind === 'objective' && <div className="review-answer">
        <span>你的作答：<b>{(kaoyan ? choiceText(q, detail.choice) : detail.choice) || '未作答'}</b></span>
        {kaoyan
          ? <span>交卷时的参考答案：<b>{choiceText(q, detail.answer) || '无参考答案'}</b></span>
          : <span>交卷时的答案：<b>{detail.answer || '无标准答案'}</b></span>}
      </div>}

      {kaoyan && <KaoyanQuestionBody q={q} answer={answer} material={kaoyanMaterial} displayAnswer={displayAnswer}
        submitted={submitted} saving={saving} markBase={markBase} onChoose={choose} onKeyChoose={chooseKey} onDraft={onAnswer}/>}

      {!kaoyan && q.qtype === 'mcq' && (
        <>
          {q.stem && <div className="stem" data-mark-index={markBase}>{q.stem}</div>}
          <div className="opts">
            {(q.options || []).map((o: any, optionIndex: number) => {
              let cls = 'opt'
              const selected = answer === o.key
              if (selected) cls += ' selected'
              if (displayAnswer) {
                if (o.key === displayAnswer) cls += ' correct'
                else if (selected) cls += ' wrong'
              }
              return (
                <div key={o.key} role="button" tabIndex={submitted || saving ? -1 : 0} className={cls}
                  aria-disabled={submitted || saving}
                  aria-pressed={selected}
                  onClick={() => choose(o.key)} onKeyDown={e => chooseKey(e, o.key)}
                >
                  <span className="okey">{o.key}</span>
                  <span className="otext" data-mark-index={markBase + 1 + optionIndex}>{o.text}</span>
                  {displayAnswer && o.key === displayAnswer && (
                    <span className="verdict"><Icon name="check" size={14}/>正确答案</span>
                  )}
                  {displayAnswer && selected && o.key !== displayAnswer && (
                    <span className="verdict"><Icon name="close" size={14}/>你的选择</span>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {!kaoyan && q.qtype === 'blank' && (
        <>
          {q.stem && (
            <div className="stem muted">
              {q.stem.split(/__\(\d+\)__/).map((s: string, i: number, arr: any[]) => (
                <span key={i}><span data-mark-index={markBase + 40 + i}>{s}</span>{i < arr.length - 1 ? <b className="blank-ref">{answer ? `${q.q_no} · ${answer}` : q.q_no}</b> : null}</span>
              ))}
            </div>
          )}
          <div className="word-options">
            {(q.options || []).map((o: any, optionIndex: number) => {
              let cls = 'word-option'
              if (answer === o.key) cls += ' selected'
              return (
                <div key={o.key} role="button" tabIndex={submitted || saving ? -1 : 0} className={cls}
                  aria-disabled={submitted || saving}
                  aria-pressed={answer === o.key}
                  title={`${o.key}) ${o.text}`}
                  onClick={() => choose(o.key)} onKeyDown={e => chooseKey(e, o.key)}
                ><span className="okey">{o.key}</span><span data-mark-index={markBase + 1 + optionIndex}>{o.text}</span></div>
              )
            })}
          </div>
          <div className="hint">点击字母和单词作答。</div>
        </>
      )}

      {!kaoyan && q.qtype === 'match' && (
        <>
          <div className="stem" data-mark-index={markBase}>{q.stem}</div>
          <div className="letter-row">
            {paragraphLabels.map((L) => {
              let cls = 'L'
              if (answer === L) cls += ' selected'
              return (
                <button key={L} className={cls}
                  disabled={submitted || saving}
                  aria-pressed={answer === L}
                  onClick={() => onAnswer(L)}
                >{L}</button>
              )
            })}
          </div>
          <div className="hint">点击段落字母作答（同一段落可被多题选择）。</div>
        </>
      )}

      {!kaoyan && (q.qtype === 'essay' || q.qtype === 'translation') && (
        <>
          <div className="hint">
            此题由你自行完成，可只看题目；下方文本框仅用于记录草稿（可不填，不判分，不影响交卷）。
          </div>
          <textarea
            className="essay"
            placeholder={q.qtype === 'essay' ? '（可选）在此记录你的作文草稿…' : '（可选）在此记录你的译文草稿…'}
            value={typeof answer === 'string' ? answer : ''}
            disabled={submitted || saving}
            onChange={(e) => onAnswer(e.target.value)}
          />
          {typeof answer === 'string' && answer.trim() && <div className="hint">约 {answer.trim().split(/\s+/).length} 词</div>}
        </>
      )}

      {canShowAnalysis && (
        <div className="analysis">
          {kaoyan ? <KaoyanAnalysis q={q} submitted={submitted} detail={detail} verdict={verdict} markBase={markBase} material={ownMaterial}/> : <>
          {q.qtype !== 'essay' && q.qtype !== 'translation' && (
            <div className="answer-line">
              <span className="answer-key">
                <small>标准答案</small>
                {q.has_answer
                  ? <b className="ok">{q.answer}{q.answer_word ? ` · ${q.answer_word}` : ''}</b>
                  : <b className="bad">材料中未提供（本题不判分）</b>}
              </span>
              {submitted && detail && (
                <span className="answer-key">
                  <small>你的作答</small>
                  <b className={verdict === 'correct' ? 'ok' : verdict === 'wrong' ? 'bad' : ''}>
                    {detail.choice || '未作答'}
                    {verdict === 'correct' && ' ✓'}
                    {verdict === 'wrong' && ' ✗'}
                  </b>
                  {verdict === 'no_key' && <span className="muted small">无标准答案，不计分</span>}
                  {detail.revealed && <span className="tag warn">练习中看过答案</span>}
                </span>
              )}
            </div>
          )}
          {q.answer_source && <div className="muted small source-line">答案来源：{q.answer_source}</div>}
          {q.analysis_text && (
            <>
              <div className="analysis-title">解析</div>
              <div className="analysis-text" data-mark-index={markBase + 30}>{q.analysis_text}</div>
            </>
          )}
          {q.qtype === 'essay' && analysisData?.materials?.map((m: any, i: number) => {
            const c = m.content || {}
            return (
              <div key={i}>
                {c.model_essay && (
                  <>
                    <div className="analysis-title">参考范文</div>
                    <div data-mark-index={markBase + 50 + i * 4}><PdfProse className="model-essay" text={c.model_essay}/></div>
                  </>
                )}
                {c.model_essay_cn && (
                  <>
                    <div className="analysis-title">范文中译</div>
                    <div data-mark-index={markBase + 51 + i * 4}><PdfProse className="model-essay" text={c.model_essay_cn}/></div>
                  </>
                )}
                {c.paragraph_notes && (
                  <>
                    <div className="analysis-title">逐段写作解析</div>
                    <div className="analysis-text" data-mark-index={markBase + 52 + i * 4}>{c.paragraph_notes}</div>
                  </>
                )}
              </div>
            )
          })}
          {q.qtype === 'translation' && analysisData?.materials?.map((m: any, i: number) => {
            const c = m.content || {}
            return (
              <div key={i}>
                {c.reference_translation && (
                  <>
                    <div className="analysis-title">参考译文</div>
                    <div data-mark-index={markBase + 50 + i * 4}><PdfProse className="model-essay" text={c.reference_translation}/></div>
                  </>
                )}
                {c.sentence_notes && (
                  <>
                    <div className="analysis-title">逐句解析</div>
                    <div className="analysis-text" data-mark-index={markBase + 52 + i * 4}>{c.sentence_notes}</div>
                  </>
                )}
              </div>
            )
          })}
          <SentenceInsights markBase={markBase} materials={analysisData?.materials || loadedDetail?.materials}/>
          </>}
          {/* 笔记 */}
          <div className="note-box">
            <div className="analysis-title"><Icon name="note" size={15}/>我的笔记</div>
            <textarea
              className="essay note"
              placeholder="记下易错点、生词或思路（仅自己可见，随备份导出）"
              value={note}
              maxLength={10000}
              disabled={remoteNote === null}
              aria-label={`第 ${q.q_no} 题笔记`}
              onChange={(e) => { noteRef.current = e.target.value; rememberNoteDraft(q.uid, e.target.value); setNote(e.target.value); setNoteSaved('待保存') }}
              onBlur={() => { void persistNote() }}
            />
            <div className="note-status muted small"><span role="status">{noteSaved}</span><span>{note.length}/10000</span>
              {noteSaved.startsWith('保存失败') && <button onClick={() => { void persistNote() }}>重试保存笔记</button>}
            </div>
          </div>
        </div>
      )}

      {analysisError && <div className="notice error" role="alert">{analysisError}</div>}
      <div className="qactions">
        {!submitted && (
          <button className="ghost" disabled={analysisLoading || saving} onClick={toggleAnalysis}>
            <Icon name="eye" size={16}/>{analysisLoading ? '正在加载解析…' : showAnalysis ? '收起解析' : '查看解析（会记录）'}
          </button>
        )}
        {submitted && !showAnalysis && (
          <button className="ghost" disabled={analysisLoading || saving} onClick={toggleAnalysis}><Icon name="eye" size={16}/>{analysisLoading ? '正在加载解析…' : '查看解析'}</button>
        )}
        {submitted && showAnalysis && (
          <button className="ghost" onClick={toggleAnalysis}><Icon name="eye" size={16}/>收起解析</button>
        )}
        {!kaoyan && q.source_file && (
          <a
            className="pdf-link"
            href={`/api/pdf?path=${encodeURIComponent(q.source_file)}#page=${q.source_page || 1}`}
            target="_blank" rel="noreferrer"
          ><Icon name="file" size={15}/>原 PDF（第 {q.source_page || 1} 页附近）</a>
        )}
      </div>
    </div>
  )
}
