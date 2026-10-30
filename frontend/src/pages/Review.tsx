import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wrongBook, favoritesList, historyList, createRedo, allMarks, deleteMark } from '../api'
import QuestionDetailModal from '../components/QuestionDetailModal'
import Icon from '../components/Icon'
import { KIND_CN, exportFileName, filterMarks, formatTime, groupMarks, keyOf, kind, locationLabel, markItems, markStats, marksCsv, paperLabel, sectionLabel, vocabularyText, type Bucket } from '../markStats'
import { EXAM_NAME, examOf, groupLabel, paperTitle, readExam, saveExam, sectionLabel as sectionName, type Exam } from '../exam'

const EXAM_SWITCH: [Exam, string][] = [['cet4', '英语四级 CET-4'], ['cet6', '英语六级 CET-6'], ['kaoyan', '考研英语']]
// CET rows have no exam_type and keep their original look (raw paper key, API label, listening placeholder);
// kaoyan rows name the paper and the part, and use the API preview because many kaoyan stems are placeholders.
const isKaoyan = (row: any) => examOf(row) === 'kaoyan'
// CONTRACT §6.4: a kaoyan preview is one line, so the writing prompt's "---" quote separators never show.
const oneLine = (text: string) => text.replace(/\s*-{3,}\s*/g, ' ').replace(/\s+/g, ' ').trim()
const itemText = (row: any, cetFallback: string) => isKaoyan(row) ? oneLine(String(row.preview || row.stem || '')) || '（题干在材料中，点击查看）' : row.stem || cetFallback
const paperName = (row: any) => isKaoyan(row) ? paperTitle(row) : row.paper_key
const partName = (row: any) => isKaoyan(row)
  ? [sectionName(row.section, 'kaoyan', row.variant), row.section === 'reading1' ? groupLabel(row.section, row.group_key) : ''].filter(Boolean).join(' · ')
  : row.section_cn
// Shared Part B options are whole paragraphs or statements; only T/F choices are short enough to preview.
const showOptions = (row: any) => row.options?.length > 0 && (!isKaoyan(row) || row.section !== 'matching' || row.variant === 'tf')
const SCORE_RULE = '客观题参考分：完形每题 0.5 分，阅读理解与新题型每题 2 分，满分 60（不含翻译和写作）；只计 2005 年起的整卷练习'

// Clipboard API needs a secure context; the textarea fallback covers plain http on a LAN address.
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return } catch { /* Fall back below. */ }
  const area = document.createElement('textarea')
  area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'
  document.body.appendChild(area); area.select()
  try { if (!document.execCommand('copy')) throw new Error('浏览器拒绝了复制') } finally { area.remove() }
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const Bars = ({ rows }: { rows: Bucket[] }) => {
  const max = Math.max(1, ...rows.map(r => r.count))
  return <ul className="mark-bars">{rows.map(r => <li key={r.key}><span className="mark-bar-label">{r.label}</span><span className="mark-bar-track"><span style={{ width: `${(r.count / max) * 100}%` }}/></span><b>{r.count}</b></li>)}</ul>
}
// Long marks are clamped to 4 lines; the toggle only shows when the clamp really hides text at the current width.
function MarkText({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, open])
  return <><p ref={ref} className={`mark-text ${className}${open ? '' : ' clamp-4'}`}>{text}</p>{(clamped || open) && <button className="text-button mark-expand" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '展开全文'}</button>}</>
}
const WIDE = '(min-width: 901px)'

export default function Review() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'wrong' | 'fav' | 'history' | 'marks'>('wrong')
  const [wrong, setWrong] = useState<any[] | null>(null)
  const [favs, setFavs] = useState<any[]>([])
  const [hist, setHist] = useState<any[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [onlyUnresolved, setOnlyUnresolved] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgError, setMsgError] = useState(false)
  const [marks, setMarks] = useState<any[] | null>(null)
  const [marksError, setMarksError] = useState('')
  const [markGroup, setMarkGroup] = useState<'paper' | 'section'>('paper')
  const [markQuery, setMarkQuery] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteErr, setDeleteErr] = useState<{ id: string; msg: string } | null>(null)
  const [exportMsg, setExportMsg] = useState<{ text: string; error: boolean } | null>(null)
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  const [distOpen, setDistOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const exportTimer = useRef<number>()
  const [detailUid, setDetailUid] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exam, setExam] = useState<Exam>(() => readExam())
  // Rows from the API: kaoyan rows carry exam_type, CET rows are classified by their key prefix.
  const belongs = (row: any) => examOf(row) === exam
  const favsShown = favs.filter(belongs), histShown = hist.filter(belongs), wrongInExam = wrong?.filter(belongs)
  const marksShown = useMemo(() => marks?.filter(belongs), [marks, exam])
  const marksFiltered = useMemo(() => filterMarks(marksShown || [], markQuery), [marksShown, markQuery])
  const stats = useMemo(() => markStats(marksShown || []), [marksShown])
  const markGroups = useMemo(() => groupMarks(marksFiltered, markGroup), [marksFiltered, markGroup])
  const markCounts = useMemo(() => new Map(markItems(marksShown || []).map(i => [i.key, i.count])), [marksShown])
  const notify = (text: string, error = false) => { setMsg(text); setMsgError(error) }
  // Export feedback sits next to the buttons, far below the page-level notice.
  const exportNote = (text: string, error = false) => { setExportMsg({ text, error }); window.clearTimeout(exportTimer.current); exportTimer.current = window.setTimeout(() => setExportMsg(null), error ? 8000 : 4000) }
  const focusMark = (id: string | null) => requestAnimationFrame(() => (id ? document.querySelector<HTMLElement>(`[data-mark-id="${CSS.escape(id)}"] .mark-delete`) : searchRef.current)?.focus())
  const cancelConfirm = (id: string) => { setConfirmId(null); setDeleteErr(null); focusMark(id) }
  const loadMarks = () => { setMarksError(''); allMarks().then(d => setMarks(d.marks)).catch(e => setMarksError('标记加载失败：' + String(e.message || e))) }

  useEffect(() => {
    Promise.all([wrongBook(), favoritesList(), historyList()]).then(([w, f, h]) => {
      setWrong(w.wrong); setFavs(f.favorites); setHist(h.history)
    }).catch(e => setLoadError('学习记录加载失败：' + String(e.message || e)))
    // Marks load separately so a failure here leaves the other tabs usable.
    loadMarks()
    const mq = window.matchMedia(WIDE), onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => { mq.removeEventListener('change', onChange); window.clearTimeout(exportTimer.current) }
  }, [])
  // A pending 确认删除 must not stay armed after the view changes.
  useEffect(() => { setConfirmId(null); setDeleteErr(null) }, [exam, tab, markGroup, markQuery])
  // Keep inline feedback on screen even when the button sat at the viewport edge.
  useEffect(() => { if (deleteErr) document.querySelector(`[data-mark-id="${CSS.escape(deleteErr.id)}"] .mark-action-error`)?.scrollIntoView({ block: 'nearest' }) }, [deleteErr])
  useEffect(() => { if (exportMsg) document.querySelector('.mark-export-status')?.scrollIntoView({ block: 'nearest' }) }, [exportMsg])

  const wrongShown = (wrongInExam || []).filter((w) => (onlyUnresolved ? !w.resolved : true))
  const unresolved = wrongInExam?.filter((w) => !w.resolved).length
  const selectedCount = wrongShown.filter(w => sel.has(w.uid)).length
  const allSelected = wrongShown.length > 0 && selectedCount === wrongShown.length

  async function redo(uids: string[]) {
    if (busy) return
    if (!uids.length) { notify('请先勾选要重做的题'); return }
    setBusy(true)
    try {
      const r = await createRedo(uids)
      nav(`/practice/${r.session_id}`)
    } catch (e: any) { notify(String(e.message || e)) }
    finally { setBusy(false) }
  }

  async function removeMark(m: any) {
    if (deletingId) return
    setDeletingId(m.id); setDeleteErr(null)
    // Pick the neighbouring card now; once this card unmounts, focus would otherwise fall back to <body>.
    const cards = [...document.querySelectorAll<HTMLElement>('.mark-card[data-mark-id]')], i = cards.findIndex(c => c.dataset.markId === m.id)
    const nextId = (cards[i + 1] || cards[i - 1])?.dataset.markId || null
    try {
      await deleteMark(m.id)
      setMarks(list => list && list.filter(x => x.id !== m.id)); setConfirmId(null)
      const text = m.text.trim()
      notify(`已删除标记「${text.length > 30 ? text.slice(0, 30) + '…' : text}」`)
      focusMark(nextId)
    } catch (e: any) { setDeleteErr({ id: m.id, msg: '删除失败，请重试：' + String(e.message || e) }) }
    finally { setDeletingId(null) }
  }

  async function exportMarks(type: 'copy' | 'txt' | 'csv') {
    if (!marksFiltered.length) return
    const scope = markQuery.trim() ? `筛选出的 ${marksFiltered.length} 条标记` : `全部 ${marksFiltered.length} 条标记`
    try {
      if (type === 'csv') { download(exportFileName(exam, 'detail'), marksCsv(marksFiltered, markCounts), 'text/csv;charset=utf-8'); exportNote(`已下载 CSV（${scope}）`); return }
      const text = vocabularyText(marksFiltered), n = text ? text.trimEnd().split('\n').length : 0
      if (type === 'txt') { download(exportFileName(exam, 'vocab'), text, 'text/plain;charset=utf-8'); exportNote(`已下载生词表 TXT，共 ${n} 项（来自${scope}）`); return }
      await copyText(text); exportNote(`已复制生词表，共 ${n} 项（来自${scope}）`)
    } catch (e: any) { exportNote((type === 'copy' ? '复制失败：' : '下载失败：') + String(e.message || e), true) }
  }

  function toggle(uid: string, checked: boolean) {
    const n = new Set(sel)
    if (checked) n.add(uid); else n.delete(uid)
    setSel(n)
  }

  return (
    <div className="review-page">
      <header className="page-heading">
        <span className="eyebrow"><Icon name="review" size={14}/>Reflect &amp; Refine</span>
        <h1>复习空间</h1>
        <p>重访每一个疑问，让做过的题真正成为自己的积累。</p>
      </header>
      <div className="exam-switch-row"><h2>{EXAM_NAME[exam]}</h2><div className="segmented" role="group" aria-label="考试类型">{EXAM_SWITCH.map(([value, label]) => <button key={value} className={exam === value ? 'active' : ''} aria-pressed={exam === value} onClick={() => { setExam(value); saveExam(value) }}>{label}</button>)}</div></div>
      <div className="review-summary">
        <div className="mini-stat danger"><Icon name="target" size={18}/><div><b>{unresolved ?? '…'}</b><span>未掌握错题</span></div></div>
        <div className="mini-stat amber"><Icon name="star" size={18}/><div><b>{favsShown.length}</b><span>收藏题目</span></div></div>
        <div className="mini-stat indigo"><Icon name="clock" size={18}/><div><b>{histShown.length}</b><span>完成练习</span></div></div>
        <div className="mini-stat violet"><Icon name="text" size={18}/><div><b>{marksShown?.length ?? (marksError ? '—' : '…')}</b><span>标记单词与句子</span></div></div>
      </div>
      <div className="tabs" role="tablist" aria-label="复习内容">
        <button role="tab" aria-selected={tab === 'wrong'} className={tab === 'wrong' ? 'active' : ''} onClick={() => setTab('wrong')}>
          错题本<span className="tab-count">{unresolved ?? '…'}<span className="tab-count-total">{'\u00a0/ '}{wrongInExam?.length ?? '…'}</span></span>
        </button>
        <button role="tab" aria-selected={tab === 'fav'} className={tab === 'fav' ? 'active' : ''} onClick={() => setTab('fav')}>收藏<span className="tab-count">{favsShown.length}</span></button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>练习历史<span className="tab-count">{histShown.length}</span></button>
        <button role="tab" aria-selected={tab === 'marks'} className={tab === 'marks' ? 'active' : ''} onClick={() => setTab('marks')}>我的标记<span className="tab-count">{marksShown?.length ?? (marksError ? '—' : '…')}</span></button>
      </div>
      {msg && <div className={`notice${msgError ? ' error' : ''}`} role={msgError ? 'alert' : 'status'}><span>{msg}</span><button onClick={() => setMsg('')} aria-label="关闭提示"><Icon name="close" size={14}/></button></div>}
      {loadError && <div className="notice error" role="alert"><span>{loadError}</span><button onClick={() => window.location.reload()}>重新加载</button></div>}

      {tab === 'wrong' && (
        <>
          <div className="review-toolbar">
            <label className="check-label"><input type="checkbox" checked={onlyUnresolved} onChange={(e) => setOnlyUnresolved(e.target.checked)} /> 只看未掌握</label>
            <label className="check-label"><input type="checkbox" checked={allSelected} disabled={!wrongShown.length} onChange={(e) => setSel(e.target.checked ? new Set(wrongShown.map(w => w.uid)) : new Set())} /> 全选</label>
            <span className="muted small grow">重做生成新记录，不覆盖旧记录；答对后标记为已掌握。</span>
            <button disabled={busy || !selectedCount} onClick={() => redo(wrongShown.filter(w => sel.has(w.uid)).map(w => w.uid))}>重做勾选（{selectedCount}）</button>
            <button className="primary" disabled={busy || !wrongShown.length} onClick={() => redo(wrongShown.map((w) => w.uid))}><Icon name="restart" size={16}/>重做全部错题</button>
          </div>
          {wrong === null ? <div className="loading">{loadError ? '请重新加载学习记录。' : <><span className="spinner"/>加载错题本…</>}</div> : (
            <ul className="item-list">
              {wrongShown.map((w) => (
                <li key={w.uid} className={`item-card${sel.has(w.uid) ? ' selected' : ''}`}>
                  <input type="checkbox" aria-label={`选择第 ${w.q_no} 题`} checked={sel.has(w.uid)} onChange={(e) => toggle(w.uid, e.target.checked)} />
                  <div className="item-body">
                    <button className="item-title" onClick={() => setDetailUid(w.uid)}>
                      <span className="qno sm">{w.q_no}</span>
                      <span className="clamp">{itemText(w, '（听力题，题干由录音念出；点击查看材料）')}</span>
                    </button>
                    {showOptions(w) && <div className="item-options">
                      {w.options.slice(0, 4).map((o: any) => <span key={o.key}><b>{o.key}</b>{o.text?.slice(0, 40)}</span>)}
                    </div>}
                    <div className="item-meta">
                      <span>{paperName(w)}</span><span>{partName(w)}</span><span>错 {w.wrong_count} 次</span><span>最近 {w.last_wrong_at}</span>
                    </div>
                  </div>
                  <span className={`status-pill ${w.resolved ? 'done' : 'wrong'}`}>{w.resolved ? '已掌握' : '未掌握'}</span>
                </li>
              ))}
              {!wrongShown.length && <li className="empty-state"><Icon name="check" size={32}/><h3>暂无错题</h3><p>交卷后答错的题会自动出现在这里。</p></li>}
            </ul>
          )}
        </>
      )}

      {tab === 'fav' && (
        <ul className="item-list">
          {favsShown.map((f) => (
            <li key={f.uid} className="item-card">
              <span className="fav-mark"><Icon name="starFilled" size={18}/></span>
              <div className="item-body">
                <button className="item-title" onClick={() => setDetailUid(f.uid)}>
                  <span className="qno sm">{f.q_no}</span><span className="clamp">{itemText(f, '（听力题）')}</span>
                </button>
                <div className="item-meta"><span>{paperName(f)}</span><span>{partName(f)}</span><span>收藏于 {f.created_at}</span></div>
              </div>
              <button className="ghost" onClick={() => setDetailUid(f.uid)}>查看</button>
            </li>
          ))}
          {!favsShown.length && <li className="empty-state"><Icon name="star" size={32}/><h3>暂无收藏</h3><p>做题时点击题目右上角的星标即可收藏。</p></li>}
        </ul>
      )}

      {tab === 'history' && (
        <div className="table-wrap"><table className="list">
          <thead><tr><th>交卷时间</th><th>试卷</th><th>模式</th><th>正确</th><th>错误</th><th>正确率</th>{exam === 'kaoyan' && <th title={SCORE_RULE}>参考分</th>}<th aria-label="操作"></th></tr></thead>
          <tbody>
            {histShown.map((h) => (
              <tr key={h.id}>
                <td className="nowrap">{h.submitted_at}</td>
                <td className="nowrap"><b>{paperName(h)}</b></td>
                <td><span className="tag">{h.mode === 'full' ? '整卷' : '重做'}</span></td>
                <td className="num ok-text">{h.correct}</td>
                <td className="num bad-text">{h.wrong}</td>
                <td>{h.accuracy != null ? <div className="acc"><div className="progress-track"><span style={{ width: `${h.accuracy * 100}%` }}/></div><span>{(h.accuracy * 100).toFixed(1)}%</span></div> : '—'}</td>
                {exam === 'kaoyan' && <td className="num nowrap">{h.score?.total ? <span title={SCORE_RULE}><b>{h.score.earned}</b> / {h.score.total}</span> : <span className="muted" title="只有 2005 年起的整卷练习计算参考分；其余只看正确率">—</span>}</td>}
                <td><button className="ghost sm" onClick={() => nav(`/practice/${h.id}`)}>查看<Icon name="chevron" size={14}/></button></td>
              </tr>
            ))}
            {!histShown.length && <tr><td colSpan={exam === 'kaoyan' ? 8 : 7}><div className="empty-state"><Icon name="clock" size={32}/><h3>暂无已完成练习</h3><p>交卷后的练习会记录在这里。</p></div></td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'marks' && (
        marksShown === undefined ? (marksError
          ? <div className="notice error" role="alert"><span>{marksError}</span><button onClick={loadMarks}>重试</button></div>
          : <div className="loading"><span className="spinner"/>加载标记…</div>)
        : !marksShown.length ? <div className="empty-state"><Icon name="text" size={32}/><h3>暂无标记</h3><p>做题时选中文章、题目或解析中的单词或短句，点击「标记选中内容」即可收集到这里。</p></div>
        : <>
          <section className="mark-stats" aria-label="标记统计">
            <div className="mark-panel mark-overview">
              <h3>标记概览</h3>
              <dl>
                <div><dt>标记总数</dt><dd>{stats.total}</dd></div>
                <div><dt>不同内容</dt><dd>{stats.distinct}</dd></div>
                <div><dt>单词</dt><dd>{stats.words}</dd></div>
                <div><dt>短语/句子</dt><dd>{stats.phrases}</dd></div>
              </dl>
              <p className="hint">去重时忽略大小写与首尾标点；单词、短语按去重后的内容计数。</p>
            </div>
            <div className="mark-panel">
              <h3>反复标记<span className="tab-count">{stats.repeated.length}</span></h3>
              {stats.repeated.length ? <ol className="mark-rank">{stats.repeated.slice(0, 10).map(i => <li key={i.key}><span className="mark-rank-text" title={i.text}>{i.text}</span><b>×{i.count}</b></li>)}</ol> : <p className="muted small">同一单词或句子被标记两次及以上时会出现在这里。</p>}
              {stats.repeated.length > 10 && <p className="hint">另有 {stats.repeated.length - 10} 项，可在下方搜索查看。</p>}
            </div>
            {/* Collapsed on narrow screens so the list and export buttons are not pushed two screens down. */}
            <details className="mark-dist" open={wide || distOpen} onToggle={e => { if (!wide) setDistOpen(e.currentTarget.open) }}>
              <summary><Icon name="chevron" size={16}/>题型与年份分布</summary>
              <div className="mark-dist-body">
                <div className="mark-panel"><h3>题型分布</h3><Bars rows={stats.bySection}/></div>
                <div className="mark-panel"><h3>年份分布</h3><Bars rows={stats.byYear}/></div>
              </div>
            </details>
          </section>
          <div className="review-toolbar mark-toolbar">
            <div className="segmented" role="group" aria-label="标记分组方式">{([['paper', '按试卷'], ['section', '按题型']] as const).map(([value, label]) => <button key={value} className={markGroup === value ? 'active' : ''} aria-pressed={markGroup === value} onClick={() => setMarkGroup(value)}>{label}</button>)}</div>
            <label className="search-field"><Icon name="search" size={18}/><input ref={searchRef} enterKeyHint="search" aria-label="搜索标记" placeholder="搜索单词、句子、试卷或题型" value={markQuery} onChange={e => setMarkQuery(e.target.value)}/>{markQuery && <button onClick={() => setMarkQuery('')} aria-label="清空搜索"><Icon name="close" size={14}/></button>}</label>
            <div className="mark-export">
              <button className="sm" disabled={!marksFiltered.length} onClick={() => exportMarks('copy')}><Icon name="file" size={14}/>复制生词表</button>
              <button className="sm" disabled={!marksFiltered.length} onClick={() => exportMarks('txt')}><Icon name="download" size={14}/>下载 TXT</button>
              <button className="sm" disabled={!marksFiltered.length} onClick={() => exportMarks('csv')}><Icon name="download" size={14}/>下载 CSV</button>
            </div>
            {exportMsg && <span className={`mark-export-status${exportMsg.error ? ' error' : ''}`} role={exportMsg.error ? 'alert' : 'status'}>{exportMsg.text}</span>}
          </div>
          {markQuery.trim() && <p className="muted small mark-scope">找到 {marksFiltered.length} 条匹配的标记，导出范围为当前筛选结果。</p>}
          {!markGroups.length ? <div className="empty-state"><Icon name="search" size={32}/><h3>没有匹配的标记</h3><p>换个关键词试试，或清空搜索查看全部标记。</p></div> : markGroups.map(g => (
            <section key={g.key} className="mark-group" aria-label={`${g.label}，${g.items.length} 条标记`}>
              <h3 className="mark-group-head"><span>{g.label}</span><span className="tab-count">{g.items.length}</span></h3>
              <ul className="item-list">
                {g.items.map((m: any) => {
                  const text = m.text.trim(), count = markCounts.get(keyOf(m.text)) || 1, failed = deleteErr && deleteErr.id === m.id ? deleteErr.msg : ''
                  return <li key={m.id} data-mark-id={m.id} className={`item-card mark-card${confirmId === m.id ? ' selected' : ''}`}>
                    <div className="item-body">
                      <MarkText text={text} className={kind(m.text)}/>
                      <div className="mark-tags">
                        {markGroup === 'section' ? <span className="tag">{paperLabel(m)}</span> : <span className="tag info">{sectionLabel(m)}</span>}
                        <span className="tag">{locationLabel(m.passage_index, m)}</span>
                        <span className="tag">{KIND_CN[kind(m.text)]}</span>
                        {count > 1 && <span className="tag warn">已标记 {count} 次</span>}
                        {m.paper_missing && <span className="tag err">试卷已不在题库</span>}
                      </div>
                      <div className="item-meta"><span>标记于 {formatTime(m.created_at)}</span></div>
                    </div>
                    <div className="mark-actions" onKeyDown={e => { if (e.key === 'Escape' && confirmId === m.id && deletingId !== m.id) { e.stopPropagation(); cancelConfirm(m.id) } }}>{confirmId === m.id
                      ? <><button className="danger sm" autoFocus aria-label={`确认删除标记 ${text.slice(0, 40)}`} aria-disabled={deletingId === m.id} onClick={() => removeMark(m)}>{deletingId === m.id ? '删除中…' : failed ? '重试删除' : '确认删除'}</button><button className="ghost sm" disabled={deletingId === m.id} onClick={() => cancelConfirm(m.id)}>取消</button>{failed && <span className="mark-action-error" role="alert" title={failed}>删除失败，请重试</span>}</>
                      : <button className="ghost sm mark-delete" aria-label={`删除标记 ${text.slice(0, 40)}`} onClick={() => { setConfirmId(m.id); setDeleteErr(null) }}><Icon name="close" size={14}/>删除</button>}</div>
                  </li>
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {detailUid && <QuestionDetailModal uid={detailUid} onClose={() => setDetailUid(null)} />}
    </div>
  )
}
