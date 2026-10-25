import { useEffect, useState } from 'react'
import { reportApi } from '../api'

export default function Report() {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    reportApi().then(setData).catch((e) => setErr(String(e.message || e)))
  }, [])

  if (err) return <div className="card">加载失败：{err}（请先运行导入脚本生成报告）</div>
  if (!data) return <div className="loading">加载导入报告…</div>

  const s = data.summary
  const sectionNames: Record<string, string> = { listening:'听力', cloze:'选词填空', matching:'长篇阅读', reading1:'仔细阅读一', reading2:'仔细阅读二', writing:'写作', translation:'翻译' }
  const generated = s.generated_at ? new Date(s.generated_at).toLocaleString('zh-CN', { hour12: false }) : '暂无记录'
  return (
    <div>
      <div className="page-heading">
        <div className="eyebrow">YOUR LIBRARY, AT A GLANCE</div>
        <h1>题库报告</h1>
        <p className="muted small">最近导入：{generated}。已导入的题目可直接练习，材料异常列于下方待核对清单。</p>
        <div className="stats-grid" style={{ justifyContent: 'flex-start' }}>
          <div className="stat"><b>{s.papers}</b>套试卷</div>
          <div className="stat"><b>{s.objective.questions}</b>客观题</div>
          <div className="stat"><b>{s.objective.with_answers}</b>题有标准答案</div>
          <div className="stat"><b>{s.subjective}</b>作文+翻译题</div>
          <div className="stat"><b>{s.writing_with_model_essay}</b>套有参考范文</div>
          <div className="stat"><b>{s.translation_with_reference}</b>套有参考译文</div>
        </div>
      </div>

      <details className="card report-details" style={{ padding: 0 }}>
        <summary>材料来源与覆盖范围</summary>
        <div className="detail-content source-coverage">
          <p>本题库按本地第三方重排 PDF 整理，可在题目卡片的「原 PDF」入口对照原材料。</p>
          <p>2015 年的 6 套听力采用了 2016 年改革后的题型结构，适合按现有材料练习，但不代表完整的 2015 年历史原卷。</p>
          <p>另有 27 套试卷的源目录未提供听力材料；这些套次按已收录的阅读、写作与翻译材料练习。</p>
        </div>
      </details>

      <details className="card report-details" style={{ padding: 0 }}>
        <summary>各套次明细 · {data.papers?.length || 0} 套</summary>
        <div className="detail-content">
        <table className="list">
          <thead><tr><th>套次</th><th>各题型（题/答案）</th></tr></thead>
          <tbody>
            {(data.papers || []).map((p: any) => (
              <tr key={p.paper_key}>
                <td><b>{p.paper_key}</b></td>
                <td>
                  {Object.entries(p.sections || {}).map(([sec, r]: any) => (
                    <span key={sec} className="tag" style={{ margin: 2 }}>
                      {sec === 'listening' ? '听力' : sec === 'cloze' ? '选词' : sec === 'matching' ? '匹配'
                        : sec === 'reading1' ? '阅读1' : sec === 'reading2' ? '阅读2'
                        : sec === 'writing' ? (r.essay ? '写作(范文✓)' : '写作') : (r.reference_translation ? '翻译(译文✓)' : '翻译')}
                      ：{r.questions}题/{r.answers ?? 0}答案
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>待核对清单（{data.issues?.length || 0} 条）</h3>
        <p className="muted small">
          以下为导入时发现的材料异常：缺答案、题数与常规不同、原文空位未能定位等。这些题仍可练习；
          建议对照原 PDF 核查；待核对题目不应视为完整、无误的题库材料。
        </p>
        {(data.issues || []).map((it: any, i: number) => (
          <div key={i} className="issue-line">
            <span className={`tag ${it.level === 'error' ? 'err' : 'warn'}`}>{it.level === 'error' ? '需处理' : '待核对'}</span>
            <b>{it.paper_key}</b> {it.section ? `${sectionNames[it.section] || it.section} · ` : ''} {it.message}
          </div>
        ))}
        {!(data.issues || []).length && <div className="muted">没有待核对项。</div>}
      </div>
    </div>
  )
}
