import { useEffect, useRef, useState } from 'react'
import { questionDetail } from '../api'
import MaterialPanel from './MaterialPanel'
import PdfProse from './PdfProse'
import Icon from './Icon'
import SentenceInsights from './SentenceInsights'

/** 单题详情弹窗：错题/收藏回看，必须带材料与解析。 */
export default function QuestionDetailModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const [q, setQ] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [reload, setReload] = useState(0)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')
        if (!focusable?.length) { e.preventDefault(); return }
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [])

  useEffect(() => {
    let active = true
    setQ(null)
    setErr('')
    questionDetail(uid).then(d => { if (active) setQ(d) }).catch((e) => { if (active) setErr(String(e.message || e)) })
    return () => { active = false }
  }, [uid, reload])

  const mat = q?.materials?.find((m: any) => m.group_key === q.group_key) || q?.materials?.[0]

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="题目详情" className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title"><small>{q ? `${q.paper_key} · ${q.section_cn}` : '题目详情'}</small><b>{q ? `第 ${q.q_no} 题` : '加载中…'}</b></div>
          {q?.status === 'needs_review' && <span className="tag warn" title={q.flags?.join('；')}>待核对</span>}
          <button className="icon-btn modal-close" onClick={onClose} aria-label="关闭" title="关闭（Esc）"><Icon name="close" size={18}/></button>
        </div>
        {err && <div className="notice error" role="alert">加载失败：{err}<button onClick={() => setReload(value => value + 1)}>重新加载</button></div>}
        {!q && !err && <div className="loading"><span className="spinner"/>加载题目…</div>}
        {q && (
          <>
            <div className="modal-columns">
              <div className="modal-material">
                <MaterialPanel
                  section={q.section}
                  mat={mat}
                  selectedBlank={null}
                  onBlankClick={() => {}}
                  disabled
                  wordAnswer={{}}
                  showTranscript
                />
              </div>
              <div className="modal-question">
                <div className="qcard">
                  <div className="qhead"><span className="qno">{q.q_no}</span><span className="tag">{q.section_cn}</span></div>
                  {q.stem && <div className="stem">{q.stem}</div>}
                  <div className="opts">{(q.options || []).map((o: any) => {
                    const isAns = q.answer === o.key
                    return (
                      <div key={o.key} className={`opt${isAns ? ' correct' : ''}`}>
                        <span className="okey">{o.key}</span>
                        <span className="otext">{o.text}</span>
                        {isAns && <span className="verdict"><Icon name="check" size={14}/>答案</span>}
                      </div>
                    )
                  })}</div>
                  {(q.qtype === 'essay' || q.qtype === 'translation') &&
                    mat?.content && (
                      <div className="analysis">
                        {q.qtype === 'essay' ? (
                          <>
                            <div className="analysis-title">参考范文</div>
                            <PdfProse className="model-essay" text={mat.content.model_essay || '（材料中未提供）'}/>
                            {mat.content.model_essay_cn && (
                              <><div className="analysis-title">范文中译</div>
                                <PdfProse className="model-essay" text={mat.content.model_essay_cn}/></>
                            )}
                            {mat.content.paragraph_notes && (
                              <><div className="analysis-title">逐段解析</div><div className="analysis-text">{mat.content.paragraph_notes}</div></>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="analysis-title">参考译文</div>
                            <PdfProse className="model-essay" text={mat.content.reference_translation || '（材料中未提供）'}/>
                            {mat.content.sentence_notes && (
                              <><div className="analysis-title">逐句解析</div><div className="analysis-text">{mat.content.sentence_notes}</div></>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  {q.qtype !== 'essay' && q.qtype !== 'translation' && (
                    <div className="answer-line">
                      <span className="answer-key"><small>标准答案</small>
                      {q.has_answer
                        ? <b className="ok">{q.answer}{q.answer_word ? ` · ${q.answer_word}` : ''}</b>
                        : <b className="bad">材料中未提供</b>}</span>
                      {q.answer_source && <div className="muted small source-line">来源：{q.answer_source}</div>}
                    </div>
                  )}
                </div>
                {q.analysis_text && (
                  <div className="analysis">
                    <div className="analysis-title">解析</div>
                    <div className="analysis-text">{q.analysis_text}</div>
                  </div>
                )}
                <SentenceInsights materials={q.materials}/>
                {q.note && (
                  <div className="analysis note-view"><div className="analysis-title"><Icon name="note" size={15}/>我的笔记</div><div className="analysis-text">{q.note}</div></div>
                )}
                {q.source_file && (
                  <a className="pdf-link" href={`/api/pdf?path=${encodeURIComponent(q.source_file)}#page=${q.source_page || 1}`} target="_blank" rel="noreferrer">
                    <Icon name="file" size={15}/>查看原 PDF（第 {q.source_page || 1} 页附近）
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
