import { useState } from 'react'

/** Original PDF appendix, kept separate from each question's answer explanation. */
export default function SentenceInsights({ materials }: { materials: any[] | undefined }) {
  const [open, setOpen] = useState(false)
  const material = materials?.find(m => m.content?.sentence_insights?.length)
  if (!material) return null
  const pages = material.content.sentence_insights
  const source = material.content.sentence_insights_source
  return <details className="sentence-insights" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>句子精讲 · 本题型 <span className="muted small">{pages.length} 页</span></summary>
    {open && <div className="sentence-insights-content"><p className="hint">保留原解析 PDF 中的句子精讲，按原页码整理。</p>{pages.map((page: any) => <section key={page.page}>
      <div className="sentence-insights-page">原解析第 {page.page} 页{source && <a href={`/api/pdf?path=${encodeURIComponent(source)}#page=${page.page}`} target="_blank" rel="noreferrer">对照原 PDF ↗</a>}</div>
      <div className="analysis-text">{page.text}</div>
    </section>)}</div>}
  </details>
}
