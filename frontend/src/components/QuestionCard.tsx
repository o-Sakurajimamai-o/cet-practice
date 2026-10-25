import { useEffect, useRef, useState } from 'react'
import { getNoteDraft, rememberNoteDraft, persistNoteDraft } from '../noteDrafts'
import PdfProse from './PdfProse'

/** 单题卡片：按题型渲染点击作答交互；交卷后显示对错。 */
export default function QuestionCard({
  q: baseQuestion, answer, onAnswer, submitted, detail, isCurrent, favorite,
  onToggleFav, onReveal, analysisData, paragraphLabels, saving = false,
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
}) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [favoriteLoading, setFavoriteLoading] = useState(false)
  const [favoriteError, setFavoriteError] = useState('')
  const [loadedDetail, setLoadedDetail] = useState<any | null>(null)
  const q = { ...loadedDetail, ...baseQuestion }
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
    <div className={`qcard${isCurrent ? ' current-q' : ''}`} id={`q-${q.uid}`}>
      <div className="qhead">
        <span className="qno">{q.q_no}.</span>
        <span className="tag">{q.section_cn}</span>
        {q.paper_key && <span className="muted small">{q.paper_key}</span>}
        {q.status === 'needs_review' && <span className="tag warn" title={q.flags?.join('；')}>待核对</span>}
        {!q.has_answer && q.qtype !== 'essay' && q.qtype !== 'translation' && (
          <span className="tag warn">无标准答案（不判分）</span>
        )}
        <button
          style={{ marginLeft: 'auto', padding: '2px 10px' }}
          title={favorite ? '取消收藏' : '收藏本题'}
          aria-label={favorite ? `取消收藏第 ${q.q_no} 题` : `收藏第 ${q.q_no} 题`}
          aria-pressed={favorite}
          disabled={favoriteLoading}
          onClick={toggleFavorite}
        >{favorite ? '★' : '☆'}</button>
      </div>
      {favoriteError && <div className="muted small" role="alert">{favoriteError}</div>}

      {q.qtype === 'mcq' && (
        <>
          {q.stem && <div className="stem">{q.stem}</div>}
          {(q.options || []).map((o: any) => {
            let cls = 'opt'
            const selected = answer === o.key
            if (selected) cls += ' selected'
            if (canShowAnalysis && q.answer) {
              if (o.key === q.answer) cls += ' correct'
              else if (selected) cls += ' wrong'
            }
            return (
              <button key={o.key} className={cls}
                disabled={submitted || saving}
                aria-pressed={selected}
                onClick={() => onAnswer(o.key)}
              >
                <span className="okey">{o.key})</span>
                <span>{o.text}</span>
                {canShowAnalysis && q.answer && o.key === q.answer && (
                  <span className="verdict">✓ 正确答案</span>
                )}
                {canShowAnalysis && selected && q.answer && o.key !== q.answer && (
                  <span className="verdict">✗ 你的选择</span>
                )}
              </button>
            )
          })}
        </>
      )}

      {q.qtype === 'blank' && (
        <>
          {q.stem && (
            <div className="stem muted">
              {q.stem.split(/__\(\d+\)__/).map((s: string, i: number, arr: any[]) => (
                <span key={i}>{s}{i < arr.length - 1 ? <b style={{ color: 'var(--primary)' }}>［{q.q_no}］</b> : null}</span>
              ))}
            </div>
          )}
          <div className="letter-row">
            {(q.options || []).map((o: any) => {
              let cls = 'L'
              if (answer === o.key) cls += ' selected'
              return (
                <button key={o.key} className={cls}
                  disabled={submitted || saving}
                  aria-pressed={answer === o.key}
                  title={`${o.key}) ${o.text}`}
                  onClick={() => onAnswer(o.key)}
                >{o.key}</button>
              )
            })}
          </div>
          <div className="muted small">点击字母选择填入本空的词。</div>
        </>
      )}

      {q.qtype === 'match' && (
        <>
          <div className="stem">{q.stem}</div>
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
          <div className="muted small">点击段落字母作答（同一段落可被多题选择）。</div>
        </>
      )}

      {(q.qtype === 'essay' || q.qtype === 'translation') && (
        <>
          <div className="muted small">
            此题由你自行完成，可只看题目；下方文本框仅用于记录草稿（可不填，不判分，不影响交卷）。
          </div>
          <textarea
            className="essay"
            placeholder={q.qtype === 'essay' ? '（可选）在此记录你的作文草稿…' : '（可选）在此记录你的译文草稿…'}
            value={typeof answer === 'string' ? answer : ''}
            disabled={submitted || saving}
            onChange={(e) => onAnswer(e.target.value)}
          />
        </>
      )}

      {canShowAnalysis && (
        <div className="analysis">
          {q.qtype !== 'essay' && q.qtype !== 'translation' && (
            <div className="answer-line">
              标准答案：
              {q.has_answer
                ? <span className="ok">{q.answer}{q.answer_word ? ` (${q.answer_word})` : ''}</span>
                : <span className="bad">材料中未提供（本题不判分）</span>}
              {submitted && detail && (
                <span> ｜ 你的作答：
                  {detail.choice ? <b>{detail.choice}</b> : <span className="muted">未作答</span>}
                  {verdict === 'correct' && <span className="ok"> ✓ 正确</span>}
                  {verdict === 'wrong' && <span className="bad"> ✗ 错误</span>}
                  {verdict === 'unanswered' && <span className="muted">（未作答）</span>}
                  {verdict === 'no_key' && <span className="muted">（无标准答案，不计分）</span>}
                  {detail.revealed && <span className="tag warn" style={{ marginLeft: 8 }}>练习中看过答案</span>}
                </span>
              )}
            </div>
          )}
          {q.answer_source && <div className="muted small">答案来源：{q.answer_source}</div>}
          {q.analysis_text && (
            <>
              <div style={{ fontWeight: 700, marginTop: 8 }}>解析（来自解析 PDF）：</div>
              {q.analysis_text}
            </>
          )}
          {q.qtype === 'essay' && analysisData?.materials?.map((m: any, i: number) => {
            const c = m.content || {}
            return (
              <div key={i}>
                {c.model_essay && (
                  <>
                    <div style={{ fontWeight: 700, marginTop: 8 }}>参考范文：</div>
                    <PdfProse className="model-essay" text={c.model_essay}/>
                  </>
                )}
                {c.model_essay_cn && (
                  <>
                    <div style={{ fontWeight: 700, marginTop: 8 }}>范文中译：</div>
                    <PdfProse className="model-essay" text={c.model_essay_cn}/>
                  </>
                )}
                {c.paragraph_notes && (
                  <>
                    <div style={{ fontWeight: 700, marginTop: 8 }}>逐段写作解析：</div>
                    {c.paragraph_notes}
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
                    <div style={{ fontWeight: 700, marginTop: 8 }}>参考译文：</div>
                    <PdfProse className="model-essay" text={c.reference_translation}/>
                  </>
                )}
                {c.sentence_notes && (
                  <>
                    <div style={{ fontWeight: 700, marginTop: 8 }}>逐句解析：</div>
                    {c.sentence_notes}
                  </>
                )}
              </div>
            )
          })}
          {/* 笔记 */}
          <div style={{ marginTop: 10 }}>
            <textarea
              className="essay" style={{ minHeight: 60 }}
              placeholder="笔记（仅自己可见，随备份导出）"
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {!submitted && (
          <button disabled={analysisLoading || saving} onClick={toggleAnalysis}>
            {analysisLoading ? '正在加载解析…' : showAnalysis ? '收起解析' : '查看解析（会记录）'}
          </button>
        )}
        {submitted && !showAnalysis && (
          <button disabled={analysisLoading || saving} onClick={toggleAnalysis}>{analysisLoading ? '正在加载解析…' : '查看解析'}</button>
        )}
        {submitted && showAnalysis && (
          <button onClick={toggleAnalysis}>收起解析</button>
        )}
        {q.source_file && (
          <a
            className="muted small"
            style={{ alignSelf: 'center' }}
            href={`/api/pdf?path=${encodeURIComponent(q.source_file)}#page=${q.source_page || 1}`}
            target="_blank" rel="noreferrer"
          >原 PDF（第 {q.source_page || 1} 页附近）</a>
        )}
      </div>
    </div>
  )
}
