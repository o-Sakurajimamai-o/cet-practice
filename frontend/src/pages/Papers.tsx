import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPapers, createSession, answerCheckEntries, answerCheckLabel } from '../api'
import Icon from '../components/Icon'
import { CET_SECTION_CN, EXAMS, EXAM_CODE, EXAM_NAME, KAOYAN_SECTION_CN, KAOYAN_SECTION_ORDER, TRACK_NAME, TRACK_ORDER, TRACK_SHORT, paperTitle, readExam, saveExam, trackOf, type Exam, type Track } from '../exam'
const SECTIONS = CET_SECTION_CN
const STATUS: Record<string, string> = { not_started: '未开始', in_progress: '进行中', done: '已完成' }

// 考研 board: the 卷别 filter (英语一 / 英语二 / 1998–2009 统考) is remembered across visits.
const TRACK_KEY = 'kaoyan-track'
const TRACK_FILTER: Record<Track, string> = { one: '英语一', two: '英语二', historical: '统考' }
const TRACK_TITLE: Record<Track, string> = { ...TRACK_NAME, historical: '英语（统考）' }
const isTrack = (value: unknown): value is Track => value === 'one' || value === 'two' || value === 'historical'
function readTrack(): Track | '' {
  try { const value = localStorage.getItem(TRACK_KEY); return isTrack(value) ? value : '' } catch { return '' }
}
function saveTrack(track: Track | '') {
  try { if (track) localStorage.setItem(TRACK_KEY, track); else localStorage.removeItem(TRACK_KEY) } catch { /* The filter still applies for this visit. */ }
}
const trackOfPaper = (p: any): Track => (isTrack(p.track) ? p.track : trackOf(p)) || 'historical'
const trackRank = (p: any) => TRACK_ORDER.indexOf(trackOfPaper(p))
// Every way a learner names a track; NFKC folds full-width brackets and digits before matching.
const TRACK_ALIASES: Record<Track, string> = {
  one: '英一 英语一 英语(一) 英语1 英一卷', two: '英二 英语二 英语(二) 英语2 英二卷', historical: '统考 统考卷 旧卷 全国统考 英语(统考)',
}
const fold = (text: string) => text.normalize('NFKC').toLowerCase()
/** Short chip for the 1998–2004 coverage note; the whole note stays in the tooltip and for screen readers. */
const coverageShort = (note: string) => /语法|词汇/.test(note) ? '未收录语法与词汇' : /听力/.test(note) ? '未收录听力' : '来源不完整'
/** 答案核对 x/y: objective answers matched against located external sources (agreeing, or a dispute resolved). Never "official". */
function answerCheck(p: any) {
  const counts: Record<string, number> = p.answer_check_counts || {}
  const verified = (counts.external_agree || 0) + (counts.disputed_resolved || 0), open = counts.disputed_unresolved || 0
  const lines = answerCheckEntries(counts).map(([s, n]) => `${answerCheckLabel(s)}：${n} 题`)
  const tip = ['客观题参考答案核对（参考答案整理自懒笔记，非官方答案）', ...lines,
    '外部资料一致：能逐题定位到本地存档的外部资料，且答案相同；有分歧：外部资料给出的答案不同；仅来源答案：尚未找到可定位的外部资料。'].join('\n')
  return { verified, open, total: p.objective_total, tip, summary: lines.join('，') }
}

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}

export default function Papers() {
  const nav = useNavigate()
  const [papers, setPapers] = useState<any[] | null>(null)
  const [papersExam, setPapersExam] = useState<Exam | ''>('')
  const [exam, setExam] = useState<Exam>(() => readExam())
  const [date, setDate] = useState(''), [section, setSection] = useState(''), [status, setStatus] = useState('')
  const [search, setSearch] = useState(''), [sort, setSort] = useState('newest')
  const [track, setTrack] = useState<Track | ''>(readTrack)
  const [err, setErr] = useState(''), [busy, setBusy] = useState('')
  const [reload, setReload] = useState(0)
  // The previous list stays visible (dimmed) while the other exam loads, so the switch never jumps away.
  useEffect(() => { let live = true; saveExam(exam); setErr(''); listPapers(new URLSearchParams({ exam })).then(d => { if (live) { setPapers(d.papers); setPapersExam(exam) } }).catch(e => { if (live) { setPapers(null); setErr(e.message || String(e)) } }); return () => { live = false } }, [exam, reload])
  const switching = papersExam !== exam
  // The list on screen belongs to papersExam (still the previous board while the next one loads), so it decides titles and filters.
  const listExam: Exam = papersExam || exam
  const kaoyan = listExam === 'kaoyan'
  // 考研 has one sitting a year (its month is meaningless); CET sittings are year-month.
  const sitting = (p: any) => kaoyan ? String(p.year) : `${p.year}-${String(p.month).padStart(2, '0')}`
  const trackPapers = useMemo(() => (papers || []).filter(p => !kaoyan || !track || trackOfPaper(p) === track), [papers, kaoyan, track])
  const dates = useMemo(() => [...new Set(trackPapers.map(sitting))].sort().reverse(), [trackPapers, kaoyan])
  const newest = (a: any, b: any) => kaoyan ? b.year - a.year || trackRank(a) - trackRank(b) : b.year - a.year || b.month - a.month || a.set_no - b.set_no
  const shown = useMemo(() => {
    const terms = (kaoyan ? fold(search) : search.toLowerCase()).trim().split(/\s+/)
    return trackPapers.filter(p => {
      const text = kaoyan ? fold(`${p.paper_key} ${p.year} ${p.year}年 ${p.year}年考研 考研 ${TRACK_ALIASES[trackOfPaper(p)]} ${paperTitle(p)}`) : `${p.paper_key} ${p.year}年${p.month}月 第${p.set_no}套`.toLowerCase()
      return (!date || sitting(p) === date) && (!section || p.question_counts?.[section]?.n > 0) && (!status || p.status === status) && terms.every(s => text.includes(s))
    }).sort(kaoyan ? (a, b) => (sort === 'newest' ? b.year - a.year : a.year - b.year) || trackRank(a) - trackRank(b)
      : (a, b) => (sort === 'newest' ? b.year - a.year || b.month - a.month : a.year - b.year || a.month - b.month) || a.set_no - b.set_no)
  }, [trackPapers, kaoyan, date, section, status, search, sort])
  // One card per exam sitting (考研: per year); the sets of the same sitting stay together.
  const groups = useMemo(() => {
    const out: { key: string; year: number; month: number; papers: any[] }[] = []
    for (const p of shown) {
      const key = kaoyan ? String(p.year) : `${p.year}-${p.month}`
      const last = out[out.length - 1]
      if (last?.key === key) last.papers.push(p)
      else out.push({ key, year: p.year, month: p.month, papers: [p] })
    }
    return out
  }, [shown, kaoyan])
  // On the 考研 board the suggestion stays inside the chosen 卷别.
  const active = trackPapers.filter(p => p.status === 'in_progress').sort((a, b) =>
    String(b.active_updated_at || '').localeCompare(String(a.active_updated_at || '')) || (b.active_session_id || 0) - (a.active_session_id || 0)
  )[0]
  const suggested = active || trackPapers.slice().sort(newest).find(p => p.status === 'not_started')
  function reset() { setDate(''); setSection(''); setStatus(''); setSearch('') }
  // 重置筛选 also clears the remembered 卷别, so nothing stays hidden.
  function clearFilters() { reset(); if (kaoyan) chooseTrack('') }
  function chooseTrack(next: Track | '') {
    setTrack(next); saveTrack(next)
    // A year the chosen track never had would leave an empty list that the year select can no longer show.
    if (date && next && !(papers || []).some(p => String(p.year) === date && trackOfPaper(p) === next)) setDate('')
  }
  async function start(p: any, restart = false) {
    if (busy || switching) return
    setBusy(p.paper_key); setErr('')
    try { const r = await createSession(p.paper_key, restart); nav(`/practice/${r.session_id}`) }
    catch (e: any) { setErr(e.message || String(e)) }
    finally { setBusy('') }
  }
  // Keep the exam switch usable after a failed request, including a failure on the stored board.
  const examSwitch = <div className="exam-switch" role="group" aria-label="选择考试">
          {EXAMS.map(e => <button key={e.value} className={exam === e.value ? 'active' : ''} aria-pressed={exam === e.value} onClick={() => { if (exam !== e.value) { reset(); setExam(e.value) } }}>
            <span className="exam-num" aria-hidden="true">{e.num}</span><span className="exam-label"><b>{e.name}</b><small>{e.code}</small></span>
          </button>)}
        </div>
  if (!papers) return <div className="loading" role="status">{err ? <>
    {examSwitch}<p role="alert">试卷库加载失败：{err}</p><button onClick={() => setReload(value => value + 1)}>重新加载</button>
  </> : <><span className="spinner"/>正在整理你的试卷库…</>}</div>
  const objectiveTotal = papers.reduce((n, p) => n + p.objective_total, 0)
  const inProgress = papers.filter(p => p.status === 'in_progress').length
  const finished = papers.filter(p => p.last_submitted_at).length
  const statusCounts: Record<string, number> = { '': trackPapers.length }
  for (const p of trackPapers) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1
  const trackCounts: Record<string, number> = { '': papers.length }
  if (kaoyan) for (const p of papers) trackCounts[trackOfPaper(p)] = (trackCounts[trackOfPaper(p)] || 0) + 1
  const years = papers.map(p => Number(p.year)).filter(Boolean)
  const examName = EXAM_NAME[listExam], examCode = EXAM_CODE[listExam]
  const sectionOptions: [string, string][] = kaoyan ? KAOYAN_SECTION_ORDER.map((s): [string, string] => [s, KAOYAN_SECTION_CN[s]]) : Object.entries(SECTIONS)
  const progress = (p: any) => p.status === 'in_progress' && <div className="set-progress"><div className="progress-track"><span style={{ width: `${Math.min(100, (p.active_answered / Math.max(1, p.objective_total)) * 100)}%` }}/></div><span>{p.active_answered}/{p.objective_total}</span></div>
  const actions = (p: any) => <div className="set-actions">
    <button className={`paper-action${p.status === 'in_progress' ? ' primary' : ''}`} disabled={!!busy || switching} onClick={() => start(p)} aria-label={`${p.status === 'in_progress' ? '继续练习' : p.status === 'done' ? '复盘已完成练习' : '开始练习'}：${paperTitle(p)}`}>{busy === p.paper_key ? '打开中' : p.status === 'in_progress' ? '继续' : p.status === 'done' ? '复盘' : '开始'}<Icon name="arrow" size={15}/></button>
    {p.active_session_id && p.last_submitted_session_id && <button className="restart-link" disabled={!!busy || switching} onClick={() => nav(`/practice/${p.last_submitted_session_id}`)}>查看上次交卷</button>}
    {(p.active_session_id || p.last_submitted_session_id) && <button className="restart-link" title="新建空白练习，保留之前的作答" disabled={!!busy || switching} onClick={() => start(p, true)}>重新开始</button>}
  </div>
  // A 考研 row: 卷别 badge, objective count, translation and writing load, the source coverage note and the answer-check state.
  const kaoyanRow = (p: any) => {
    const t = trackOfPaper(p), counts = p.question_counts || {}
    const translation = counts.translation?.n || 0, writing = counts.writing?.n || 0, noKey = p.objective_total - p.objective_keyed
    const check = answerCheck(p), note: string | null = p.coverage_note || null
    const detail = KAOYAN_SECTION_ORDER.filter(s => counts[s]?.n).map(s => `${KAOYAN_SECTION_CN[s]}：${counts[s].n} 题`).join('\n')
    return <li key={p.paper_key} className={`set-row ${p.status}`}>
      <span className={`set-no track ${t}`} aria-hidden="true">{TRACK_SHORT[t]}</span>
      <div className="set-info">
        <div className="set-title"><b>{TRACK_TITLE[t]}</b><span className={`status-pill ${p.status}`}>{STATUS[p.status] || '未开始'}</span></div>
        <div className="set-meta" title={detail}>
          <span>{p.objective_total} 道客观题</span>
          {translation > 0 && <span>{t === 'two' && translation === 1 ? '翻译 整篇' : `翻译 ${translation} 句`}</span>}
          {writing > 0 && <span>写作 {writing} 篇</span>}
          {note && <span className="missing-chip" title={note}>{coverageShort(note)}<span className="visually-hidden">：{note}</span></span>}
          {check.total > 0 && <span className={`check-chip${check.open ? ' warn' : check.verified >= check.total ? ' ok' : ''}`} title={check.tip}>答案核对 {check.verified}/{check.total}{check.open > 0 && ` · ${check.open} 待裁定`}<span className="visually-hidden">（{check.summary}；参考答案非官方）</span></span>}
          {noKey > 0 && <span className="missing-chip" title="没有参考答案的题可练习，但不参与判分">{noKey} 题无参考答案</span>}
        </div>
        {progress(p)}
      </div>
      {actions(p)}
    </li>
  }
  return <div className={`library-page${switching ? ' switching' : ''}`} aria-busy={switching}>
    <section className={`hero ${exam}`}>
      <span className="hero-watermark" aria-hidden="true">{EXAM_CODE[exam]}</span>
      <div className="hero-top">
        {examSwitch}
        <span className="hero-kicker"><Icon name="sparkle" size={15}/>{greeting()} · {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
      </div>
      <div className="hero-main">
        <h1>每一次专注，<br/>都离目标更近一步。</h1>
        {kaoyan
          ? <p><b>{examName}</b> · {papers.length} 套历年真题、{objectiveTotal.toLocaleString()} 道客观题。客观题按参考答案自动判分，翻译与写作对照参考自评，进度随时保存在本机。</p>
          : <p><b>{examName}</b> · {papers.length} 套历年真题、{objectiveTotal.toLocaleString()} 道客观题。点击作答、自动判分，进度随时保存在本机。</p>}
      </div>
      {suggested && <div className="hero-card">
        <span className="hero-card-label">{active ? <><Icon name="clock" size={15}/>继续上次练习</> : <><Icon name="target" size={15}/>推荐从这里开始</>}</span>
        <b className="hero-card-title">{paperTitle(suggested)}</b>
        <span className="hero-card-meta">{kaoyan ? `${TRACK_NAME[trackOfPaper(suggested)]} · ${suggested.objective_total} 道客观题 · 翻译与写作自评` : <>{examCode} · {suggested.objective_total} 道客观题 · {suggested.has_audio ? '含听力音频' : '无听力音频'}</>}</span>
        {active && <div className="hero-progress" aria-label={`已答 ${active.active_answered} / ${active.objective_total} 题`}>
          <div className="progress-track"><span style={{ width: `${Math.min(100, (active.active_answered / Math.max(1, active.objective_total)) * 100)}%` }}/></div>
          <span>已答 {active.active_answered} / {active.objective_total}</span>
        </div>}
        <button className="hero-cta" disabled={!!busy || switching} onClick={() => start(suggested)}>{busy === suggested.paper_key ? '正在打开…' : active ? '继续练习' : '开始练习'}<Icon name="arrow" size={17}/></button>
      </div>}
    </section>

    <section className="stat-row" aria-label="学习概览">
      <div className="stat-tile"><span className="stat-icon indigo"><Icon name="book" size={19}/></span><div><span className="stat-label">历年真题</span><strong>{papers.length}<small>套</small></strong><span className="stat-caption">{kaoyan ? (years.length ? `${Math.min(...years)} — ${Math.max(...years)}` : '等待导入') : dates.length ? `${dates[dates.length - 1].replace('-', '.')} — ${dates[0].replace('-', '.')}` : '等待导入'}</span></div></div>
      <div className="stat-tile"><span className="stat-icon violet"><Icon name="layers" size={19}/></span><div><span className="stat-label">客观题目</span><strong>{objectiveTotal.toLocaleString()}<small>道</small></strong><span className="stat-caption">{kaoyan ? <><span className="nowrap">完形</span> · <span className="nowrap">阅读</span> · <span className="nowrap">新题型</span></> : '听力 · 选词 · 匹配 · 阅读'}</span></div></div>
      <div className="stat-tile"><span className="stat-icon amber"><Icon name="clock" size={19}/></span><div><span className="stat-label">进行中</span><strong>{inProgress}<small>套</small></strong><span className="stat-caption">随时继续，进度自动保存</span></div></div>
      <div className="stat-tile"><span className="stat-icon green"><Icon name="check" size={19}/></span><div><span className="stat-label">已完成</span><strong>{finished}<small>套</small></strong><span className="stat-caption">每一份积累都有迹可循</span></div></div>
    </section>

    <section className="papers-section">
      <div className={kaoyan ? 'section-heading has-tracks' : 'section-heading'}>
        <div><h2>历年试卷</h2><p>{kaoyan ? '按年份整理，英语一、英语二并列；1998–2009 年为分卷前的全国统考卷。' : '按考次整理，同一次考试的各套试卷放在一起。'}</p></div>
        {kaoyan && <div className="segmented track-filter" role="group" aria-label="卷别">
          {(['', ...TRACK_ORDER] as (Track | '')[]).map(t => <button key={t || 'all'} className={track === t ? 'active' : ''} aria-pressed={track === t} title={t === 'historical' ? '1998–2009 年全国统考卷（2010 年起分为英语一、英语二）' : undefined} onClick={() => chooseTrack(t)}>
            {t ? TRACK_FILTER[t] : '全部'}{t === 'historical' && <small className="track-years">1998–2009</small>}<span>{trackCounts[t] || 0}</span>
          </button>)}
        </div>}
      </div>
      {err && <div className="notice error" role="alert">{err}<button onClick={() => setErr('')} aria-label="关闭错误提示"><Icon name="close" size={16}/></button></div>}
      <div className="library-toolbar">
        <label className="search-field"><Icon name="search" size={18}/><input aria-label="搜索试卷" placeholder={kaoyan ? '搜索年份或卷别，如 2024 英一' : '搜索年份、月份或套次，如 2024 12'} value={search} onChange={e => setSearch(e.target.value)}/>{search && <button onClick={() => setSearch('')} aria-label="清空搜索"><Icon name="close" size={14}/></button>}</label>
        <div className="segmented" role="group" aria-label="练习状态">
          {[['', '全部'], ...Object.entries(STATUS)].map(([s, cn]) => <button key={s} className={status === s ? 'active' : ''} aria-pressed={status === s} onClick={() => setStatus(s)}>{cn}<span>{statusCounts[s] || 0}</span></button>)}
        </div>
        <div className="filter-selects">
          {kaoyan
            ? <select aria-label="考试年份" value={date} onChange={e => setDate(e.target.value)}><option value="">全部年份</option>{dates.map(d => <option key={d} value={d}>{d} 年</option>)}</select>
            : <select aria-label="考试日期" value={date} onChange={e => setDate(e.target.value)}><option value="">全部日期</option>{dates.map(d => <option key={d} value={d}>{d.replace('-', ' 年 ')} 月</option>)}</select>}
          <select aria-label="题型" value={section} onChange={e => setSection(e.target.value)}><option value="">全部题型</option>{sectionOptions.map(([s, cn]) => <option key={s} value={s}>{cn}</option>)}</select>
          <select aria-label="试卷排序" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">最新优先</option><option value="oldest">最早优先</option></select>
        </div>
      </div>
      <div className="library-meta"><span>共 <b>{groups.length}</b> {kaoyan ? '个年份' : '次考试'} · <b>{shown.length}</b> 套试卷{(date || section || status || search || (kaoyan && track)) && <button className="text-button" onClick={clearFilters}>重置筛选</button>}</span></div>

      {!shown.length ? <div className="empty-state card"><Icon name="search" size={32}/><h3>没有找到符合条件的试卷</h3><p>换个关键词，或清除筛选条件后再试。</p><button onClick={clearFilters}>清除筛选</button></div>
        : <div className="exam-grid">{groups.map(g => <article className={kaoyan ? 'exam-card kaoyan' : 'exam-card'} key={g.key}>
          <header className="exam-head">
            <div className="exam-date"><span className="exam-year">{g.year}</span><span className="exam-month">{kaoyan ? '考研' : `${g.month} 月`}</span></div>
            <span className="exam-count">{g.papers.length} 套</span>
          </header>
          <ul className="set-list">{g.papers.map(p => {
            if (kaoyan) return kaoyanRow(p)
            const noKey = p.objective_total - p.objective_keyed
            const missing = Object.entries(SECTIONS).filter(([s]) => !p.question_counts?.[s]?.n).map(([, cn]) => cn)
            const present = Object.entries(SECTIONS).filter(([s]) => p.question_counts?.[s]?.n).map(([, cn]) => cn)
            const detail = Object.entries(SECTIONS).map(([s, cn]) => `${cn}：${p.question_counts?.[s]?.n || 0} 题`).join('\n')
            return <li key={p.paper_key} className={`set-row ${p.status}`}>
              <span className="set-no" aria-hidden="true"><small>第</small>{p.set_no}<small>套</small></span>
              <div className="set-info">
                <div className="set-title"><b>第 {p.set_no} 套</b><span className={`status-pill ${p.status}`}>{STATUS[p.status] || '未开始'}</span></div>
                <div className="set-meta" title={detail}>
                  <span>{p.objective_total} 道客观题</span>
                  <span className={`audio-label${p.has_audio ? ' available' : ''}`}><Icon name="headphones" size={14}/>{p.has_audio ? '有音频' : p.audio_edition === 'NoAudio' ? '无音频版' : '无音频'}</span>
                  {Object.keys(p.shared_sources || {}).length > 0 && <span className="missing-chip" title={Object.entries(p.shared_sources).map(([sec, source]: any) => `${SECTIONS[sec] || sec}：与 ${source.source_slug} 共用（来源已标明）`).join('\n')}>部分材料共用</span>}
                  {missing.length > 0 && <span className="missing-chip">{missing.length > 2 ? `仅含${present.join('、') || '原卷'}` : `缺${missing.join('、')}`}</span>}
                  {noKey > 0 && <span className="missing-chip" title="缺少标准答案的题可练习，但不参与判分">{noKey} 题待核对</span>}
                </div>
                {progress(p)}
              </div>
              {actions(p)}
            </li>
          })}</ul>
        </article>)}</div>}
    </section>
    <div className="library-footnote"><Icon name="shield" size={16}/><span>{kaoyan ? '练习进度自动保存在本机。参考答案、译文与范文整理自懒笔记，非官方；写作与翻译可记录草稿，由你自行评阅。' : '练习进度自动保存在本机。写作与翻译可记录草稿、查看参考解析，由你自行评阅。'}</span></div>
  </div>
}
