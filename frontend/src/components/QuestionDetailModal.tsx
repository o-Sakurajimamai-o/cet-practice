import { useEffect, useRef, useState } from 'react'
import { questionDetail } from '../api'
import MaterialPanel from './MaterialPanel'
import PdfProse from './PdfProse'

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
          <b>{q ? `${q.paper_key} · ${q.section_cn} · 第 ${q.q_no} 题` : '题目详情'}</b>
          {q?.status === 'needs_review' && <span className="tag warn" title={q.flags?.join('；')}>待核对</span>}
          <button style={{ marginLeft: 'auto' }} onClick={onClose}>关闭</button>
        </div>
        {err && <div className="notice error" role="alert">加载失败：{err}<button onClick={() => setReload(value => value + 1)}>重新加载</button></div>}
        {!q && !err && <div className="loading">加载题目…</div>}
        {q && (
          <>
            <div className="modal-columns">
              <div style={{ flex: '1 1 44%' }}>
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
              <div style={{ flex: '1 1 56%' }}>
                <div className="qcard">
                  <div className="qhead"><span className="qno">{q.q_no}.</span></div>
                  {q.stem && <div className="stem">{q.stem}</div>}
                  {(q.options || []).map((o: any) => {
                    const isAns = q.answer === o.key
                    return (
                      <div key={o.key} className={`opt${isAns ? ' correct' : ''}`}>
                        <span className="okey">{o.key})</span>
                        <span>{o.text}</span>
                        {isAns && <span className="verdict">✓ 答案</span>}
                      </div>
                    )
                  })}
                  {(q.qtype === 'essay' || q.qtype === 'translation') &&
                    mat?.content && (
                      <div className="analysis">
                        {q.qtype === 'essay' ? (
                          <>
                            <div style={{ fontWeight: 700 }}>参考范文：</div>
                            <PdfProse className="model-essay" text={mat.content.model_essay || '（材料中未提供）'}/>
                            {mat.content.model_essay_cn && (
                              <><div style={{ fontWeight: 700, marginTop: 8 }}>范文中译：</div>
                                <PdfProse className="model-essay" text={mat.content.model_essay_cn}/></>
                            )}
                            {mat.content.paragraph_notes && (
                              <><div style={{ fontWeight: 700, marginTop: 8 }}>逐段解析：</div>{mat.content.paragraph_notes}</>
                            )}
                          </>
                        ) : (
                          <>
                            <div style={{ fontWeight: 700 }}>参考译文：</div>
                            <PdfProse className="model-essay" text={mat.content.reference_translation || '（材料中未提供）'}/>
                            {mat.content.sentence_notes && (
                              <><div style={{ fontWeight: 700, marginTop: 8 }}>逐句解析：</div>{mat.content.sentence_notes}</>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  {q.qtype !== 'essay' && q.qtype !== 'translation' && (
                    <div className="answer-line" style={{ marginTop: 8 }}>
                      答案：
                      {q.has_answer
                        ? <span className="ok">{q.answer}{q.answer_word ? ` (${q.answer_word})` : ''}</span>
                        : <span className="bad">材料中未提供</span>}
                      {q.answer_source && <div className="muted small">来源：{q.answer_source}</div>}
                    </div>
                  )}
                </div>
                {q.analysis_text && (
                  <div className="analysis" style={{ maxHeight: 320 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>解析：</div>
                    {q.analysis_text}
                  </div>
                )}
                {q.note && (
                  <div className="card"><b>我的笔记：</b><div className="analysis" style={{ border: 'none', background: 'none', padding: 0 }}>{q.note}</div></div>
                )}
                {q.source_file && (
                  <a className="muted small" href={`/api/pdf?path=${encodeURIComponent(q.source_file)}#page=${q.source_page || 1}`} target="_blank" rel="noreferrer">
                    查看原 PDF（第 {q.source_page || 1} 页附近）
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
