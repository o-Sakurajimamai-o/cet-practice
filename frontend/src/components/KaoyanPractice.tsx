import Icon from './Icon'
import { resultSectionRank } from '../exam'
import '../kaoyan.css'

export type GroupTab = { key: string; label: string; done: number; total: number }

/** Text 1…n or 小作文/大作文 above the material. The right column shows only the chosen group; groups a partial
 *  redo does not include are disabled. The current group follows current_uid, so a reload restores it. */
export function KaoyanGroupSwitch({ section, groups, current, disabled, onSelect }: {
  section: string; groups: GroupTab[]; current: string; disabled?: boolean; onSelect: (key: string) => void
}) {
  return <div className="ky-group-switch" role="group" aria-label={section === 'writing' ? '切换作文' : '切换阅读篇目'}>
    {groups.map(g => <button key={g.key} type="button" aria-pressed={g.key === current}
      className={g.total && g.done === g.total ? 'complete' : undefined} disabled={disabled || !g.total}
      title={g.total ? `${g.label}：已答 ${g.done}/${g.total}` : '本次练习不含这一部分'} onClick={() => onSelect(g.key)}>
      <span>{g.label}</span><small>{g.total ? `${g.done}/${g.total}` : '—'}</small>
    </button>)}
  </div>
}

/** Whole-paper PDFs are downloaded from their verified source links. */
export function KaoyanPdfLinks({ pdfs }: { pdfs?: { label: string; path: string; url?: string }[] | null }) {
  if (!Array.isArray(pdfs) || !pdfs.length) return null
  return <div className="ky-pdf-links"><span>整卷 PDF（联网下载）</span>
    {pdfs.map(p => <a key={p.path} href={p.url || `/api/pdf?path=${encodeURIComponent(p.path)}`} target="_blank" rel="noreferrer">
      <Icon name="file" size={14}/>{p.label.replace(/\s*PDF$/, '')} ↗</a>)}
  </div>
}

const points = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '—'
}

/** 客观题参考分 x / 60 with the per-part split and the rule (2005+ whole papers only; CONTRACT §0.3). */
export function KaoyanScore({ score }: { score: any }) {
  const parts = Object.entries(score?.by_section || {}).sort(([a], [b]) => resultSectionRank(a, 'kaoyan') - resultSectionRank(b, 'kaoyan'))
  return <div className="ky-score" role="group" aria-label="客观题参考分">
    <span className="ky-score-main">客观题参考分<b>{points(score?.earned)}</b>/ {points(score?.total)}</span>
    {parts.length > 0 && <span className="ky-score-parts">{parts.map(([name, v]: [string, any]) => <span key={name}>{name} {points(v?.earned)}/{points(v?.total)}</span>)}</span>}
    {score?.rule && <span className="ky-score-rule">{score.rule}。按非官方参考答案计，仅供参考。</span>}
  </div>
}
