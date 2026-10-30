import { Fragment, useMemo, useState } from 'react'
import Icon from './Icon'
import { blankPieces, formatAnalysis, splitPrompt } from '../kaoyan'
import '../kaoyan.css'

/** Text that quotes the passage: __(n)__ markers show as numbered gaps, never as raw markers (CONTRACT §6.4 rule 6). */
export function WithGaps({ text }: { text: string }) {
  return <>{blankPieces(text).map((piece, i) => piece.kind === 'blank'
    ? <span key={i} className="ky-gap-ref">{piece.no}</span>
    : <Fragment key={i}>{piece.text}</Fragment>)}</>
}

/** Writing directions (§6.4 rule 3): "---" blocks, the quoted letter as a quote block, list items on their own lines. */
export function KyPrompt({ prompt, markIndex }: { prompt?: string | null; markIndex: number }) {
  const blocks = useMemo(() => splitPrompt(prompt), [prompt])
  return <div className="ky-prompt" data-mark-index={markIndex}>
    {blocks.map((block, i) => {
      const lines = block.lines.map((line, j) => <p key={j} className={line.enumerator ? 'ky-enum-line' : undefined}>
        {line.enumerator && <span className="ky-enum">{line.enumerator}</span>}{line.text}
      </p>)
      return block.kind === 'quote'
        ? <blockquote key={i} className="ky-prompt-quote" lang="en">{lines}</blockquote>
        : <div key={i} lang="en">{lines}</div>
    })}
  </div>
}

/** Essay picture or chart: served offline from /kaoyan-assets/; a failed load says so instead of a broken image. */
export function KyFigure({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return <figure className="ky-figure">
    {failed
      ? <div className="ky-figure-missing" role="img" aria-label={`${alt}：图片未能离线加载`}><Icon name="alert" size={18}/>图片未能离线加载</div>
      : <a href={src} target="_blank" rel="noreferrer" title="在新标签页打开原图"><img src={src} alt={alt} onError={() => setFailed(true)}/></a>}
    {!failed && <figcaption>{alt} · 点击图片可在新标签页查看原图</figcaption>}
  </figure>
}

/** Lazynote analysis rebuilt into natural lines (§6.4 rule 4); the raw source lines stay one click away. */
export function KyAnalysisText({ text, title, qNo, stem, markIndex }: {
  text: string; title: string; qNo?: number | null; stem?: string | null; markIndex: number
}) {
  const [raw, setRaw] = useState(false)
  const lines = useMemo(() => formatAnalysis(text, { qNo, stem }), [text, qNo, stem])
  return <>
    <div className="analysis-title ky-an-title">{title}
      <button type="button" className="ky-raw-toggle" aria-pressed={raw} title={raw ? '回到整理后的文本' : '按来源页面的原始分行显示'} onClick={() => setRaw(value => !value)}>原始文本</button>
    </div>
    {raw
      ? <div className="analysis-text ky-an-raw" data-mark-index={markIndex}><WithGaps text={text}/></div>
      : <div className="ky-an" data-mark-index={markIndex}>{lines.map((line, i) => line.kind === 'heading'
        ? <div key={i} className="ky-an-head">{line.text}</div>
        : <p key={i} className="ky-an-line"><WithGaps text={line.text}/></p>)}</div>}
  </>
}
