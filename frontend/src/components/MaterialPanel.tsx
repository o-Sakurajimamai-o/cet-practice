import { Fragment } from 'react'
import { SubjectivePrompt } from './PdfProse'

/** 左侧材料面板：按题型渲染共享材料（文章/词库/段落/写作翻译题面）。 */
export default function MaterialPanel({
  section, mat, selectedBlank, onBlankClick,
  wordAnswer, showTranscript, disabled = false, availableBlanks,
}: {
  section: string
  mat: any
  selectedBlank: number | null
  onBlankClick: (qNo: number) => void
  wordAnswer: Record<number, string>
  showTranscript: boolean
  disabled?: boolean
  availableBlanks?: number[]
}) {
  if (!mat) return <div className="card muted">该题型无共享材料。</div>
  const c = mat.content || {}

  if (section === 'listening') {
    const groups = c.groups || []
    return (
      <div className="card">
        <div className="muted small">听力各篇目对应题号（录音文字稿在交卷后解析中提供）：</div>
        {groups.map((g: any, i: number) => (
          <div key={i} style={{ margin: '6px 0' }}>
            <span className="tag info">篇目 {i + 1}</span>
            <b> 第 {g.from}–{g.to} 题</b>
            {showTranscript && g.lines?.length > 0 && (
              <div className="analysis" style={{ maxHeight: 260 }}>
                {g.lines.map((l: any, j: number) => (
                  <div key={j} style={{ marginBottom: 4 }}>
                    <b>{l.speaker ? l.speaker + ': ' : ''}{l.en}</b>
                    {l.cn && <div className="muted">{l.cn}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {mat.directions && <div className="directions">{mat.directions}</div>}
      </div>
    )
  }

  if (section === 'cloze') {
    const passage: string = c.passage || ''
    const bank = c.word_bank || []
    const parts = passage.split(/(__\(\d+\)__)/)
    return (
      <div className="card">
        {mat.directions && <div className="directions">{mat.directions}</div>}
        <div className="passage">
          {parts.map((p, i) => {
            const m = p.match(/^__\((\d+)\)__$/)
            if (m) {
              const no = Number(m[1])
              const val = wordAnswer[no]
              return (
                <button
                  key={i}
                  className={`blank-slot${selectedBlank === no ? ' active' : ''}${val ? ' has-val' : ''}`}
                  disabled={disabled || (availableBlanks !== undefined && !availableBlanks.includes(no))}
                  onClick={() => onBlankClick(no)}
                  title={`第 ${no} 空${availableBlanks !== undefined && !availableBlanks.includes(no) ? '（未加入本次练习）' : ''}`}
                >
                  {val ? `${val} (${no})` : `${no}`}
                </button>
              )
            }
            return <Fragment key={i}>{p}</Fragment>
          })}
        </div>
        <div className="word-bank">
          {bank.map((w: any) => (
            <span key={w.key} className={`word${Object.values(wordAnswer).includes(w.key) ? ' used' : ''}`}>
              <span className="k">{w.key})</span>{w.text}
            </span>
          ))}
        </div>
        <div className="muted small">点击原文空位选中题目，再在题目区点击词库字母作答。已用单词会淡化显示，请按原题要求选择。</div>
      </div>
    )
  }

  if (section === 'matching') {
    const paras = c.paragraphs || []
    return (
      <div className="card">
        {c.title && <b>{c.title}</b>}
        {mat.directions && <div className="directions">{mat.directions}</div>}
        <div className="passage">
          {paras.map((p: any) => (
            <div key={p.label} style={{ marginBottom: 10 }}>
              <span className="p-label">{p.label})</span>{p.text}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (section === 'reading1' || section === 'reading2') {
    return (
      <div className="card">
        {mat.directions && <div className="directions">{mat.directions}</div>}
        <div className="passage">{c.passage}</div>
        {c.passage2 && (
          <>
            <div className="sec-divider">Passage Two</div>
            <div className="passage">{c.passage2}</div>
          </>
        )}
      </div>
    )
  }

  if (section === 'writing' || section === 'translation') {
    return (
      <div className="card">
        <SubjectivePrompt section={section} text={c.prompt}/>
      </div>
    )
  }

  return <div className="card muted">未知题型材料。</div>
}
