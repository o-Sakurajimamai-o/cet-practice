import { useEffect, useState } from 'react'
import { reportApi } from '../api'
import Icon, { type IconName } from '../components/Icon'

const SECTION_SHORT: Record<string, string> = { listening: '听力', cloze: '选词', matching: '匹配', reading1: '阅读1', reading2: '阅读2', writing: '写作', translation: '翻译' }

export default function Report() {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [exam, setExam] = useState(() => localStorage.getItem('cet-exam') === 'cet4' ? 'cet4' : 'cet6')

  useEffect(() => {
    let live = true; setData(null); setErr(''); reportApi(exam).then(d => { if (live) setData(d) }).catch(e => { if (live) setErr(String(e.message || e)) }); return () => { live = false }
  }, [exam])

  if (err) return <div className="empty-state card"><Icon name="alert" size={32}/><h3>加载失败</h3><p>{err}（请先运行导入脚本生成报告）</p></div>
  if (!data) return <div className="loading"><span className="spinner"/>加载导入报告…</div>

  const s = data.summary
  const sectionNames: Record<string, string> = { listening:'听力', cloze:'选词填空', matching:'长篇阅读', reading1:'仔细阅读一', reading2:'仔细阅读二', writing:'写作', translation:'翻译' }
  const generated = s.generated_at ? new Date(s.generated_at).toLocaleString('zh-CN', { hour12: false }) : '暂无记录'
  const keyedPct = s.objective.questions ? (s.objective.with_answers / s.objective.questions) * 100 : 0
  const tiles: [IconName, string, number, string][] = [
    ['book', 'indigo', s.papers, '套试卷'],
    ['layers', 'violet', s.objective.questions, '道客观题'],
    ['check', 'green', s.objective.with_answers, '题有标准答案'],
    ['note', 'amber', s.subjective, '作文 + 翻译题'],
    ['file', 'indigo', s.writing_with_model_essay, '套有参考范文'],
    ['text', 'violet', s.translation_with_reference, '套有参考译文'],
  ]
  return (
    <div className="report-page">
      <header className="page-heading">
        <span className="eyebrow"><Icon name="chart" size={14}/>Your library, at a glance</span>
        <h1>题库报告</h1>
        <p>最近导入：{generated}。已导入的题目可直接练习，材料异常列于下方待核对清单。</p>
      </header>

      <div className="exam-switch-row"><h2>{exam === 'cet4' ? '英语四级' : '英语六级'}</h2><div className="segmented" role="group" aria-label="考试类型">{[['cet4', '英语四级 CET-4'], ['cet6', '英语六级 CET-6']].map(([value, label]) => <button key={value} className={exam === value ? 'active' : ''} aria-pressed={exam === value} onClick={() => { setExam(value); localStorage.setItem('cet-exam', value) }}>{label}</button>)}</div></div>
      <div className="report-grid">
        {tiles.map(([icon, tone, n, label]) => (
          <div className="stat-tile" key={label}><span className={`stat-icon ${tone}`}><Icon name={icon} size={19}/></span><div><strong>{Number(n).toLocaleString()}</strong><span className="stat-caption">{label}</span></div></div>
        ))}
      </div>

      <div className="card coverage-card">
        <div className="coverage-head"><span>标准答案覆盖率</span><b>{keyedPct.toFixed(1)}%</b></div>
        <div className="progress-track lg"><span style={{ width: `${keyedPct}%` }}/></div>
        <p className="muted small">{s.objective.with_answers.toLocaleString()} / {s.objective.questions.toLocaleString()} 道客观题可自动判分</p>
      </div>

      <details className="card report-details">
        <summary><Icon name="shield" size={18}/>材料来源与覆盖范围<Icon name="chevron" size={16} className="summary-chevron"/></summary>
        <div className="detail-content source-coverage">
          <p>本题库按本地第三方重排 PDF 整理，可在题目卡片的「原 PDF」入口对照原材料。</p>
          {exam === 'cet6' && <p>2015 年的 6 套听力采用了 2016 年改革后的题型结构，适合按现有材料练习，但不代表完整的 2015 年历史原卷。</p>}
          <p>四级部分套次在来源页明确标注共用听力或阅读，已按该标注关联，并在试卷卡片说明。其余缺少材料的套次按实际收录题型练习。答案来源与未解决的争议见下方清单及本地四级核查报告。</p>
        </div>
      </details>

      <details className="card report-details">
        <summary><Icon name="grid" size={18}/>各套次明细<span className="tab-count">{data.papers?.length || 0} 套</span><Icon name="chevron" size={16} className="summary-chevron"/></summary>
        <div className="detail-content">
          <div className="table-wrap flat"><table className="list">
            <thead><tr><th>套次</th><th>各题型（题数 / 答案数）</th></tr></thead>
            <tbody>
              {(data.papers || []).map((p: any) => (
                <tr key={p.paper_key}>
                  <td className="nowrap"><b>{p.paper_key}</b></td>
                  <td><div className="chip-row">
                    {Object.entries(p.sections || {}).map(([sec, r]: any) => (
                      <span key={sec} className="tag">
                        {sec === 'writing' ? (r.essay ? '写作 · 范文✓' : '写作') : sec === 'translation' ? (r.reference_translation ? '翻译 · 译文✓' : '翻译') : SECTION_SHORT[sec] || sec}
                        <span className="tag-num">{r.questions}/{r.answers ?? 0}</span>
                      </span>
                    ))}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </details>

      <section className="card">
        <div className="card-title"><h3><Icon name="flag" size={18}/>待核对清单</h3><span className="tab-count">{data.issues?.length || 0} 条</span></div>
        <p className="muted small">
          以下为导入时发现的材料异常：缺答案、题数与常规不同、原文空位未能定位等。这些题仍可练习；
          建议对照原 PDF 核查；待核对题目不应视为完整、无误的题库材料。
        </p>
        <div className="issue-list">
          {(data.issues || []).map((it: any, i: number) => (
            <div key={i} className="issue-line">
              <span className={`tag ${it.level === 'error' ? 'err' : 'warn'}`}>{it.level === 'error' ? '需处理' : '待核对'}</span>
              <div><b>{it.paper_key}</b>{it.section && <span className="muted"> · {sectionNames[it.section] || it.section}</span>}<p>{it.message}</p></div>
            </div>
          ))}
        </div>
        {!(data.issues || []).length && <div className="muted">没有待核对项。</div>}
      </section>
    </div>
  )
}
