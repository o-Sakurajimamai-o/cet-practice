import { useEffect, useState } from 'react'
import { reportApi, answerCheckEntries, answerCheckLabel, ANSWER_CHECK_NOTE, type AnswerCheckStatus } from '../api'
import Icon, { type IconName } from '../components/Icon'
import { EXAM_NAME, paperShort, paperTitle, readExam, saveExam, sectionLabel, type Exam } from '../exam'

const SECTION_SHORT: Record<string, string> = { listening: '听力', cloze: '选词', matching: '匹配', reading1: '阅读1', reading2: '阅读2', writing: '写作', translation: '翻译' }
const KAOYAN_SECTION_SHORT: Record<string, string> = { cloze: '完形', reading1: '阅读', matching: '新题型', translation: '翻译', writing: '写作' }
const EXAM_SWITCH: [Exam, string][] = [['cet4', '英语四级 CET-4'], ['cet6', '英语六级 CET-6'], ['kaoyan', '考研英语']]
// Tag tone per answer-check status: agreement reads as good, an open dispute as a warning, source-only stays neutral.
const CHECK_TONE: Record<string, string> = { external_agree: 'ok', disputed_resolved: 'info', disputed_unresolved: 'warn', manual: 'info' }
const SOURCE_KIND: Record<string, string> = { answer_key: '答案表', analysis: '解析', web_page: '网页', ocr_analysis: '扫描件 OCR' }
// 考研 issues: a resolved dispute is 已复核, a paper-level coverage note is a 说明, open items are 待核对 / 需处理.
const issueTag = (it: any): [string, string] => it.level === 'error' ? ['err', '需处理'] : it.level === 'warn' ? ['warn', '待核对'] : it.uid ? ['ok', '已复核'] : ['info', '说明']
// Open items first; the stable sort keeps the API order (paper, then question) inside each group.
const issueRank = (it: any) => it.level === 'error' ? 0 : it.level === 'warn' ? 1 : it.uid ? 2 : 3
const percent = (n: number, total: number) => !total ? '0%' : n > 0 && n / total < 0.001 ? '<0.1%' : `${((n / total) * 100).toFixed(1)}%`

/** Papers named by a source's coverage list (registry entries carry paper_key ranges); plain strings are shown as written. */
function coverageText(coverage: unknown): string {
  if (typeof coverage === 'string') return coverage
  if (!Array.isArray(coverage)) return ''
  const keys = [...new Set(coverage.map((c: any) => String(c?.paper_key || '')).filter(Boolean))]
  return keys.length ? `覆盖 ${keys.length} 套：${keys.map(k => paperShort(k)).join('、')}` : '未覆盖可比对的题目'
}

function KaoyanReport({ data }: { data: any }) {
  const s = data.summary
  const checks = answerCheckEntries(data.answer_checks)
  const total = checks.reduce((n, [, c]) => n + c, 0) || s.objective.questions
  const count = (status: AnswerCheckStatus) => Number(data.answer_checks?.[status]) || 0
  const verified = count('external_agree') + count('disputed_resolved')
  const sources = data.answer_sources, sourceList: any[] = Array.isArray(sources?.sources) ? sources.sources : []
  const issues: any[] = [...(data.issues || [])].sort((a, b) => issueRank(a) - issueRank(b))
  const tiles: [IconName, string, number, string][] = [
    ['book', 'indigo', s.papers, '套试卷'],
    ['layers', 'violet', s.objective.questions, '道客观题'],
    ['check', 'green', s.objective.with_answers, '题有参考答案'],
    ['note', 'amber', s.subjective, '道翻译与写作题'],
    ['file', 'indigo', s.writing_with_model_essay, '套有参考范文'],
    ['text', 'violet', s.translation_with_reference, '套有参考译文'],
  ]
  return <>
    <div className="report-grid">
      {tiles.map(([icon, tone, n, label]) => (
        <div className="stat-tile" key={label}><span className={`stat-icon ${tone}`}><Icon name={icon} size={19}/></span><div><strong>{Number(n).toLocaleString()}</strong><span className="stat-caption">{label}</span></div></div>
      ))}
    </div>

    <section className="card evidence-card" aria-labelledby="evidence-title">
      <div className="evidence-head">
        <h3 id="evidence-title"><Icon name="shield" size={18}/>参考答案核验</h3>
        <span className="evidence-total"><b>{verified.toLocaleString()}</b> / {total.toLocaleString()} 道客观题已与外部资料核对</span>
      </div>
      <p className="muted small">客观题参考答案整理自懒笔记整卷答案表，非官方答案。只有能逐题定位到本地存档外部资料（页码、行号）的才算「外部资料一致」；有分歧的题列在下方待核对清单，暂按参考答案判分。</p>
      {/* Part-to-whole of one total: a single stacked bar, read through the legend below (labels, counts, shares). */}
      <div className="evidence-bar" role="img" aria-label={checks.map(([st, n]) => `${answerCheckLabel(st)} ${n} 题`).join('，')}>
        {checks.map(([st, n]) => <span key={st} className={`evidence-seg ${st}`} style={{ flexGrow: n }} title={`${answerCheckLabel(st)}：${n.toLocaleString()} 题（${percent(n, total)}）`}/>)}
      </div>
      <ul className="evidence-legend">
        {checks.map(([st, n]) => <li key={st}>
          <span className={`evidence-dot ${st}`} aria-hidden="true"/>
          <div><b>{answerCheckLabel(st)}</b><span className="evidence-count">{n.toLocaleString()} 题 · {percent(n, total)}</span><p>{ANSWER_CHECK_NOTE[st as AnswerCheckStatus] || ''}</p></div>
        </li>)}
      </ul>
      {sourceList.length > 0
        ? <details className="evidence-sources">
          <summary><Icon name="chevron" size={15}/>核对用到的外部资料<span className="tab-count">{sourceList.length} 份</span></summary>
          <ul>{sourceList.map((src, i) => <li key={src.id || i}>
            <b>{src.name || src.id}</b>
            <span className="muted small">{[SOURCE_KIND[src.kind] || src.kind, coverageText(src.coverage), src.doc].filter(Boolean).join(' · ')}</span>
            {src.note && <p>{src.note}</p>}
          </li>)}</ul>
          {(sources.generated_at || sources.version) && <p className="hint">核验数据生成于 {sources.generated_at ? new Date(sources.generated_at).toLocaleString('zh-CN', { hour12: false }) : '—'}{sources.version && ` · 版本 ${sources.version}`}</p>}
        </details>
        : <p className="evidence-note"><Icon name="alert" size={15}/>{verified || count('disputed_unresolved')
          ? '已有核验记录，但缺少外部资料清单，暂时无法列出依据来源。'
          : '核验数据尚未生成：目前全部客观题都按「仅来源答案」显示。完成外部资料比对后，这里会列出每份资料的名称、类型与覆盖范围。'}</p>}
    </section>

    <details className="card report-details">
      <summary><Icon name="shield" size={18}/>材料来源与覆盖范围<Icon name="chevron" size={16} className="summary-chevron"/></summary>
      <div className="detail-content source-coverage">
        <p>考研题库整理自懒笔记（lazynote）历年真题网页的本地存档，非官方发布；题目、客观题参考答案、参考译文与范文均以该来源为准。</p>
        <p>1998–2001 年的来源未收录原卷的语法与词汇部分，2002–2004 年未收录听力部分；这些年份的题号按来源网站重新编号，与原卷不同，不代表完整的历史原卷。1998–2004 年原卷没有新题型，这是当年的考试结构，并非缺失。</p>
        <p>答案依据：客观题参考答案取自懒笔记整卷答案表；翻译与写作的参考译文和范文取自分题型解析页，均非官方，主观题不自动评分。与外部资料的核对结果见上方「参考答案核验」。</p>
        <p>各套试卷提供「真题整卷」与「真题及解析」PDF 下载链接，需联网打开；PDF 不包含在程序包内。</p>
      </div>
    </details>

    <details className="card report-details">
      <summary><Icon name="grid" size={18}/>各套次明细<span className="tab-count">{data.papers?.length || 0} 套</span><Icon name="chevron" size={16} className="summary-chevron"/></summary>
      <div className="detail-content">
        <div className="table-wrap flat"><table className="list">
          <thead><tr><th>试卷</th><th>各题型（题数 / 答案数）</th><th>答案核对（客观题）</th></tr></thead>
          <tbody>
            {(data.papers || []).map((p: any) => (
              <tr key={p.paper_key}>
                <td className="paper-cell"><b>{p.display_title || paperTitle(p)}</b>{p.coverage_note && <p className="paper-note">{p.coverage_note}</p>}</td>
                <td><div className="chip-row">
                  {Object.entries(p.sections || {}).map(([sec, r]: any) => (
                    <span key={sec} className="tag">
                      {sec === 'writing' ? (r.essay ? '写作 · 范文✓' : '写作') : sec === 'translation' ? (r.reference_translation ? '翻译 · 译文✓' : '翻译') : KAOYAN_SECTION_SHORT[sec] || sec}
                      <span className="tag-num">{r.questions}/{r.answers ?? 0}</span>
                    </span>
                  ))}
                </div></td>
                <td><div className="chip-row">
                  {answerCheckEntries(p.answer_check_counts).map(([st, n]) => <span key={st} className={`tag ${CHECK_TONE[st] || ''}`.trim()}>{answerCheckLabel(st)}<span className="tag-num">{n}</span></span>)}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </details>

    <section className="card">
      <div className="card-title"><h3><Icon name="flag" size={18}/>待核对清单</h3><span className="tab-count">{issues.length} 条</span></div>
      <p className="muted small">
        这里列出外部资料有分歧的题（已复核或待裁定）、核验记录已过期的题，以及 1998–2004 年来源不完整的说明。
        这些题都可以练习；参考答案非官方，有分歧的题暂按参考答案判分。
      </p>
      <div className="issue-list">
        {issues.map((it: any, i: number) => {
          const [tone, label] = issueTag(it), qNo = /:(\d+)$/.exec(String(it.uid || ''))?.[1]
          return <div key={i} className="issue-line">
            <span className={`tag ${tone}`}>{label}</span>
            <div><b>{paperTitle(it.paper_key)}</b>{it.section && <span className="muted"> · {sectionLabel(it.section, 'kaoyan')}{qNo && ` · 第 ${qNo} 题`}</span>}<p>{it.message}</p></div>
          </div>
        })}
      </div>
      {!issues.length && <div className="muted">没有待核对项。</div>}
    </section>
  </>
}

export default function Report() {
  // The data remembers its exam, so a switch never renders one board's view with the other board's numbers.
  const [loaded, setLoaded] = useState<{ exam: Exam; data: any } | null>(null)
  const [err, setErr] = useState('')
  const [exam, setExam] = useState<Exam>(() => readExam())

  useEffect(() => {
    let live = true; setLoaded(null); setErr(''); reportApi(exam).then(d => { if (live) setLoaded({ exam, data: d }) }).catch(e => { if (live) setErr(String(e.message || e)) }); return () => { live = false }
  }, [exam])

  const examSwitch = <div className="exam-switch-row"><h2>{EXAM_NAME[exam]}</h2><div className="segmented" role="group" aria-label="考试类型">{EXAM_SWITCH.map(([value, label]) => <button key={value} className={exam === value ? 'active' : ''} aria-pressed={exam === value} onClick={() => { setExam(value); saveExam(value) }}>{label}</button>)}</div></div>
  // The switch stays reachable on failure: the board choice is shared, so a failing board must not trap the page.
  if (err) return <div className="report-page">{examSwitch}<div className="empty-state card"><Icon name="alert" size={32}/><h3>加载失败</h3><p>{err}{exam === 'kaoyan' ? '' : '（请先运行导入脚本生成报告）'}</p></div></div>
  if (!loaded || loaded.exam !== exam) return <div className="loading"><span className="spinner"/>加载导入报告…</div>

  const data = loaded.data
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

      {examSwitch}
      {exam === 'kaoyan' ? <KaoyanReport data={data}/> : <>
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
      </>}
    </div>
  )
}
