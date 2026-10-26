import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wrongBook, favoritesList, historyList, createRedo } from '../api'
import QuestionDetailModal from '../components/QuestionDetailModal'
import Icon from '../components/Icon'

export default function Review() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'wrong' | 'fav' | 'history'>('wrong')
  const [wrong, setWrong] = useState<any[] | null>(null)
  const [favs, setFavs] = useState<any[]>([])
  const [hist, setHist] = useState<any[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [onlyUnresolved, setOnlyUnresolved] = useState(true)
  const [msg, setMsg] = useState('')
  const [detailUid, setDetailUid] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exam, setExam] = useState(() => localStorage.getItem('cet-exam') === 'cet4' ? 'cet4' : 'cet6')
  const belongs = (row: any) => String(row.paper_key || row.uid || '').startsWith('cet4-') === (exam === 'cet4')
  const favsShown = favs.filter(belongs), histShown = hist.filter(belongs), wrongInExam = wrong?.filter(belongs)

  useEffect(() => {
    Promise.all([wrongBook(), favoritesList(), historyList()]).then(([w, f, h]) => {
      setWrong(w.wrong); setFavs(f.favorites); setHist(h.history)
    }).catch(e => setLoadError('学习记录加载失败：' + String(e.message || e)))
  }, [])

  const wrongShown = (wrongInExam || []).filter((w) => (onlyUnresolved ? !w.resolved : true))
  const unresolved = wrongInExam?.filter((w) => !w.resolved).length
  const selectedCount = wrongShown.filter(w => sel.has(w.uid)).length
  const allSelected = wrongShown.length > 0 && selectedCount === wrongShown.length

  async function redo(uids: string[]) {
    if (busy) return
    if (!uids.length) { setMsg('请先勾选要重做的题'); return }
    setBusy(true)
    try {
      const r = await createRedo(uids)
      nav(`/practice/${r.session_id}`)
    } catch (e: any) { setMsg(String(e.message || e)) }
    finally { setBusy(false) }
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
      <div className="exam-switch-row"><h2>{exam === 'cet4' ? '英语四级' : '英语六级'}</h2><div className="segmented" role="group" aria-label="考试类型">{[['cet4', '英语四级 CET-4'], ['cet6', '英语六级 CET-6']].map(([value, label]) => <button key={value} className={exam === value ? 'active' : ''} aria-pressed={exam === value} onClick={() => { setExam(value); localStorage.setItem('cet-exam', value) }}>{label}</button>)}</div></div>
      <div className="review-summary">
        <div className="mini-stat danger"><Icon name="target" size={18}/><div><b>{unresolved ?? '…'}</b><span>未掌握错题</span></div></div>
        <div className="mini-stat amber"><Icon name="star" size={18}/><div><b>{favsShown.length}</b><span>收藏题目</span></div></div>
        <div className="mini-stat indigo"><Icon name="clock" size={18}/><div><b>{histShown.length}</b><span>完成练习</span></div></div>
      </div>
      <div className="tabs" role="tablist" aria-label="复习内容">
        <button role="tab" aria-selected={tab === 'wrong'} className={tab === 'wrong' ? 'active' : ''} onClick={() => setTab('wrong')}>
          错题本<span className="tab-count">{unresolved ?? '…'} / {wrongInExam?.length ?? '…'}</span>
        </button>
        <button role="tab" aria-selected={tab === 'fav'} className={tab === 'fav' ? 'active' : ''} onClick={() => setTab('fav')}>收藏<span className="tab-count">{favsShown.length}</span></button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>练习历史<span className="tab-count">{histShown.length}</span></button>
      </div>
      {msg && <div className="notice"><span>{msg}</span><button onClick={() => setMsg('')} aria-label="关闭提示"><Icon name="close" size={14}/></button></div>}
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
                      <span className="clamp">{w.stem || '（听力题，题干由录音念出；点击查看材料）'}</span>
                    </button>
                    {w.options?.length > 0 && <div className="item-options">
                      {w.options.slice(0, 4).map((o: any) => <span key={o.key}><b>{o.key}</b>{o.text?.slice(0, 40)}</span>)}
                    </div>}
                    <div className="item-meta">
                      <span>{w.paper_key}</span><span>{w.section_cn}</span><span>错 {w.wrong_count} 次</span><span>最近 {w.last_wrong_at}</span>
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
                  <span className="qno sm">{f.q_no}</span><span className="clamp">{f.stem || '（听力题）'}</span>
                </button>
                <div className="item-meta"><span>{f.paper_key}</span><span>{f.section_cn}</span><span>收藏于 {f.created_at}</span></div>
              </div>
              <button className="ghost" onClick={() => setDetailUid(f.uid)}>查看</button>
            </li>
          ))}
          {!favsShown.length && <li className="empty-state"><Icon name="star" size={32}/><h3>暂无收藏</h3><p>做题时点击题目右上角的星标即可收藏。</p></li>}
        </ul>
      )}

      {tab === 'history' && (
        <div className="table-wrap"><table className="list">
          <thead><tr><th>交卷时间</th><th>试卷</th><th>模式</th><th>正确</th><th>错误</th><th>正确率</th><th aria-label="操作"></th></tr></thead>
          <tbody>
            {histShown.map((h) => (
              <tr key={h.id}>
                <td className="nowrap">{h.submitted_at}</td>
                <td className="nowrap"><b>{h.paper_key}</b></td>
                <td><span className="tag">{h.mode === 'full' ? '整卷' : '重做'}</span></td>
                <td className="num ok-text">{h.correct}</td>
                <td className="num bad-text">{h.wrong}</td>
                <td>{h.accuracy != null ? <div className="acc"><div className="progress-track"><span style={{ width: `${h.accuracy * 100}%` }}/></div><span>{(h.accuracy * 100).toFixed(1)}%</span></div> : '—'}</td>
                <td><button className="ghost sm" onClick={() => nav(`/practice/${h.id}`)}>查看<Icon name="chevron" size={14}/></button></td>
              </tr>
            ))}
            {!histShown.length && <tr><td colSpan={7}><div className="empty-state"><Icon name="clock" size={32}/><h3>暂无已完成练习</h3><p>交卷后的练习会记录在这里。</p></div></td></tr>}
          </tbody>
        </table></div>
      )}

      {detailUid && <QuestionDetailModal uid={detailUid} onClose={() => setDetailUid(null)} />}
    </div>
  )
}
