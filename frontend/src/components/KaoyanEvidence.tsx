import Icon from './Icon'
import { CHECK_TONE, METHOD_CN, VERDICT_CN, evidencePdf, locator, reflowQuote } from '../kaoyan'
import '../kaoyan.css'

/** answer_check from the API (CONTRACT §5.3); only objective kaoyan questions carry one. */
export type AnswerCheck = {
  status: string; label: string; summary: string; basis?: string | null
  primary?: { name?: string; url?: string | null; letter?: string | null } | null
  external?: any[]; ruling?: any; stale?: boolean
}

export function CheckBadge({ check }: { check: AnswerCheck }) {
  return <span className={`tag ${CHECK_TONE[check.status] ?? ''}`} title={check.summary}>{check.label}</span>
}

function EvidenceItem({ item }: { item: any }) {
  const pdf = evidencePdf(item.doc)
  const where = locator(item)
  const letter = item.letter || item.ext_letter
  const tone = item.verdict === 'agree' ? 'ok' : item.verdict === 'conflict' ? 'err' : 'warn'
  return <li className="ky-ev-item">
    <div className="ky-ev-head">
      <span className="ky-ev-name">{item.name || item.source_id || '外部资料'}</span>
      {item.verdict && <span className={`tag ${tone}`}>{VERDICT_CN[item.verdict] || item.verdict}</span>}
    </div>
    <div className="ky-ev-meta">
      {where && <span>{where}</span>}
      {letter && <span>资料答案 {letter}{item.mapped_letter && item.mapped_letter !== letter ? `，对应本题 ${item.mapped_letter}` : ''}</span>}
      {item.method && <span>{METHOD_CN[item.method] || item.method}</span>}
      {pdf && <a href={`/api/pdf?path=${encodeURIComponent(pdf)}${item.page ? `#page=${item.page}` : ''}`} target="_blank" rel="noreferrer">打开本地 PDF{item.page ? ` 第 ${item.page} 页` : ''} ↗</a>}
    </div>
    {item.quote && <blockquote className="ky-ev-quote" lang={/[㐀-鿿]/.test(item.quote) ? 'zh-CN' : 'en'}>{reflowQuote(item.quote)}</blockquote>}
  </li>
}

/** 答案依据: summary first; sources, locations, quotes and any ruling on demand. Nothing here is an official answer. */
export function AnswerEvidence({ check, answer }: { check: AnswerCheck; answer?: string | null }) {
  const external = Array.isArray(check.external) ? check.external : []
  const ruling = check.ruling && typeof check.ruling === 'object' ? check.ruling : null
  const primary = check.primary && typeof check.primary === 'object' ? check.primary : null
  return <details className="ky-evidence">
    <summary><Icon name="chevron" size={14}/><b>答案依据</b><span>{check.summary}</span></summary>
    <div className="ky-evidence-body">
      {check.stale && <p className="ky-stale">核对记录针对的是另一个答案字母，当前参考答案尚待重新核对。</p>}
      {check.status === 'manual' && <p>本题答案已由你人工校正{external.length ? '；以下是校正前的核对记录' : ''}。</p>}
      <p>来源答案：{primary?.name || '懒笔记整卷答案表'}{primary?.letter ? `（${primary.letter}）` : ''}</p>
      {check.basis && <p>最强比对方式：{METHOD_CN[check.basis] || check.basis}</p>}
      {external.length
        ? <ol className="ky-ev-list" aria-label="外部资料">{external.map((item, i) => <EvidenceItem key={i} item={item}/>)}</ol>
        : <p className="muted">尚未找到可逐行定位的本地外部资料。</p>}
      {ruling && <div className="ky-ruling">
        <b>复核：</b>{ruling.answer ? `裁定答案 ${ruling.answer}${answer && ruling.answer !== answer ? `（与当前参考答案 ${answer} 不同，尚待处理）` : ''}。` : ''}{ruling.rationale}
        {(ruling.by || ruling.date) && <small>{[ruling.by, ruling.date].filter(Boolean).join(' · ')}</small>}
      </div>}
      <p className="ky-note-line">外部资料均非官方答案；“外部资料一致”只表示能在本地存档中逐行找到同一答案。</p>
    </div>
  </details>
}
