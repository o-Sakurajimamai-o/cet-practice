import { Fragment } from 'react'
import { SubjectivePrompt } from './PdfProse'
import PdfProse from './PdfProse'
import type { ReadingTranslationParagraph } from '../readingTranslation'
import Icon from './Icon'
import readingParagraphs from '../readingParagraphs.json'

/** 左侧材料面板：按题型渲染共享材料（文章/词库/段落/写作翻译题面）。 */
export default function MaterialPanel({
  section, mat, selectedBlank, onBlankClick, paperKey,
  wordAnswer, showTranscript, disabled = false, availableBlanks, showReadingTranslation = false, readingTranslation = [],
}: {
  section: string
  paperKey?: string
  mat: any
  selectedBlank: number | null
  onBlankClick: (qNo: number) => void
  wordAnswer: Record<number, string>
  showTranscript: boolean
  disabled?: boolean
  availableBlanks?: number[]
  showReadingTranslation?: boolean
  readingTranslation?: ReadingTranslationParagraph[]
}) {
  if (!mat) return <div className="card material-card muted">该题型无共享材料。</div>
  const c = mat.content || {}

  if (section === 'listening') {
    const groups = c.groups || []
    return (
      <div className="card material-card">
        <div className="material-head"><Icon name="headphones" size={16}/>听力篇目</div>
        <p className="hint">{showTranscript ? '交卷后可查看每篇录音原文与中文翻译。' : '录音原文与翻译在交卷后提供。'}</p>
        <div className="listen-groups">
          {groups.map((g: any, i: number) => (
            <div key={i} className="listen-group">
              <div className="listen-group-head"><span className="tag info">篇目 {i + 1}</span><b>第 {g.from}–{g.to} 题</b></div>
              {showTranscript && g.lines?.length > 0 && (
                <div className="transcript" data-mark-index={10 + i}>
                  {g.lines.map((l: any, j: number) => (
                    <div key={j} className="transcript-line">
                      <div className="en">{l.speaker && <b>{l.speaker}: </b>}{l.en}</div>
                      {l.cn && <div className="cn">{l.cn}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {mat.directions && <div className="directions">{mat.directions}</div>}
      </div>
    )
  }

  if (section === 'cloze') {
    const passage: string = c.passage || ''
    const bank = c.word_bank || []
    const parts = passage.split(/(__\(\d+\)__)/)
    return (
      <div className="card material-card">
        <div className="material-head"><Icon name="book" size={16}/>选词填空 · 原文</div>
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
                  {val ? <><small>{no}</small>{val}</> : no}
                </button>
              )
            }
            return <Fragment key={i}>{p}</Fragment>
          })}
        </div>
        <div className="material-head sub">词库 Word Bank</div>
        <div className="word-bank">
          {bank.map((w: any) => (
            <span key={w.key} className={`word${Object.values(wordAnswer).includes(w.key) ? ' used' : ''}`}>
              <span className="k">{w.key}</span>{w.text}
            </span>
          ))}
        </div>
        <div className="hint">点击原文空位选中题目，再在右侧点击词库字母作答。已用单词会淡化显示。</div>
      </div>
    )
  }

  if (section === 'matching') {
    const paras = c.paragraphs || []
    return (
      <div className="card material-card">
        <div className="material-head"><Icon name="book" size={16}/>长篇阅读</div>
        {c.title && <h3 className="passage-title">{c.title}</h3>}
        {mat.directions && <div className="directions">{mat.directions}</div>}
        <div className="passage">
          {paras.map((p: any) => (
            <div key={p.label} className="para">
              <span className="p-label">{p.label}</span>{p.text}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (section === 'reading1' || section === 'reading2') {
    const passage: string = c.passage || ''
    const cuts: number[] = (readingParagraphs as Record<string, number[]>)[`${paperKey}:${section}`] || []
    const instructionPattern = /\bQuestions\s+\d+\s+(?:to|and)\s+\d+\s+are\s+based\s+on\s+the\s+following\s+passage\.?/gi
    const instruction = passage.match(instructionPattern)?.[0]
    // Cut on source offsets first; PDF extraction sometimes inserts this heading inside the body.
    const paragraphs = [0, ...cuts, passage.length].slice(0, -1).map((start, i) => passage.slice(start, [...cuts, passage.length][i]).replace(instructionPattern, ' ').trim()).filter(Boolean)
    return (
      <div className="card material-card">
        <div className="material-head"><Icon name="book" size={16}/>仔细阅读{section === 'reading1' ? ' · Passage One' : ' · Passage Two'}</div>
        {mat.directions && <div className="directions">{mat.directions}</div>}
        {instruction && <div className="reading-instruction">{instruction}</div>}
        <div className={`passage${showReadingTranslation ? ' bilingual-passage' : ''}`} id="reading-passage">
          {paragraphs.map((p: string, i: number) => <div className="reading-paragraph-pair" key={i}>
            <p className="reading-paragraph">{p}</p>
            {showReadingTranslation && readingTranslation[i] && <div className="reading-paragraph-cn" lang="zh-CN" data-mark-skip data-mark-index={600 + readingTranslation[i].number}>
              <PdfProse text={readingTranslation[i].text}/>
            </div>}
          </div>)}
        </div>
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
      <div className="card material-card">
        <div className="material-head"><Icon name={section === 'writing' ? 'note' : 'text'} size={16}/>{section === 'writing' ? '写作题目' : '翻译题目'}</div>
        <div data-mark-index={50}><SubjectivePrompt section={section} text={c.prompt}/></div>
      </div>
    )
  }

  return <div className="card material-card muted">未知题型材料。</div>
}
