import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wrongBook, favoritesList, historyList, createRedo } from '../api'
import QuestionDetailModal from '../components/QuestionDetailModal'

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

  useEffect(() => {
    Promise.all([wrongBook(), favoritesList(), historyList()]).then(([w, f, h]) => {
      setWrong(w.wrong); setFavs(f.favorites); setHist(h.history)
    }).catch(e => setLoadError('学习记录加载失败：' + String(e.message || e)))
  }, [])

  const wrongShown = (wrong || []).filter((w) => (onlyUnresolved ? !w.resolved : true))

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

  return (
    <div className="review-page">
      <div className="page-heading review-header">
        <div className="eyebrow">REFLECT & REFINE</div>
        <h1>复习空间</h1>
        <p>重访每一个疑问，让做过的题真正成为自己的积累。</p>
        <div className="section-tabs">
          <button className={tab === 'wrong' ? 'active' : ''} onClick={() => setTab('wrong')}>
            错题本（未掌握 {wrong?.filter((w) => !w.resolved).length ?? '…'} / 共 {wrong?.length ?? '…'}）
          </button>
          <button className={tab === 'fav' ? 'active' : ''} onClick={() => setTab('fav')}>收藏（{favs.length}）</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>练习历史（{hist.length}）</button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>
      {loadError && <div className="notice error" role="alert">{loadError}<button onClick={() => window.location.reload()}>重新加载</button></div>}

      {tab === 'wrong' && (
        <>
          <div className="filters">
            <label><input type="checkbox" checked={onlyUnresolved} onChange={(e) => setOnlyUnresolved(e.target.checked)} /> 只看未掌握</label>
            <button className="primary" disabled={busy || !wrongShown.length} onClick={() => redo(wrongShown.map((w) => w.uid))}>重做全部错题</button>
            <button disabled={busy || !wrongShown.some(w => sel.has(w.uid))} onClick={() => redo(wrongShown.filter(w => sel.has(w.uid)).map(w => w.uid))}>重做勾选（{wrongShown.filter(w => sel.has(w.uid)).length}）</button>
            <span className="muted small">重做生成新记录，不覆盖旧记录；答对后标记为已掌握。</span>
          </div>
          {wrong === null ? <div className="loading">{loadError ? '请重新加载学习记录。' : '加载错题本…'}</div> : (
            <div className="review-table-wrap"><table className="list">
              <thead><tr><th></th><th>题目</th><th>套次</th><th>题型</th><th>错误次数</th><th>最近错误</th><th>状态</th></tr></thead>
              <tbody>
                {wrongShown.map((w) => (
                  <tr key={w.uid}>
                    <td><input type="checkbox" checked={sel.has(w.uid)} onChange={(e) => {
                      const n = new Set(sel)
                      if (e.target.checked) n.add(w.uid); else n.delete(w.uid)
                      setSel(n)
                    }} /></td>
                    <td style={{ maxWidth: 480 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); setDetailUid(w.uid) }}>
                        {w.q_no}. {w.stem || '（听力题，题干由录音念出；点击查看材料）'}
                      </a>
                      <div>
                        {w.options.slice(0, 4).map((o: any) => (
                          <span key={o.key} className="tag" style={{ margin: 1 }}>{o.key}) {o.text?.slice(0, 40)}</span>
                        ))}
                      </div>
                    </td>
                    <td>{w.paper_key}</td>
                    <td>{w.section_cn}</td>
                    <td>{w.wrong_count}</td>
                    <td className="muted small">{w.last_wrong_at}</td>
                    <td>{w.resolved ? <span className="tag ok">已掌握</span> : <span className="tag err">未掌握</span>}</td>
                  </tr>
                ))}
                {!wrongShown.length && <tr><td colSpan={7} className="muted">暂无错题。</td></tr>}
              </tbody>
            </table></div>
          )}
        </>
      )}

      {tab === 'fav' && (
        <div className="review-table-wrap"><table className="list">
          <thead><tr><th>题目</th><th>套次</th><th>题型</th><th>收藏时间</th></tr></thead>
          <tbody>
            {favs.map((f) => (
              <tr key={f.uid}>
                <td style={{ maxWidth: 520 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); setDetailUid(f.uid) }}>{f.q_no}. {f.stem || '（听力题）'}</a>
                </td>
                <td>{f.paper_key}</td>
                <td>{f.section_cn}</td>
                <td className="muted small">{f.created_at}</td>
              </tr>
            ))}
            {!favs.length && <tr><td colSpan={4} className="muted">暂无收藏。</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'history' && (
        <div className="review-table-wrap"><table className="list">
          <thead><tr><th>时间</th><th>试卷</th><th>模式</th><th>正确</th><th>错误</th><th>正确率</th><th></th></tr></thead>
          <tbody>
            {hist.map((h) => (
              <tr key={h.id}>
                <td className="small">{h.submitted_at}</td>
                <td>{h.paper_key}</td>
                <td>{h.mode === 'full' ? '整卷' : '重做'}</td>
                <td>{h.correct}</td>
                <td>{h.wrong}</td>
                <td>{h.accuracy != null ? `${(h.accuracy * 100).toFixed(1)}%` : '—'}</td>
                <td><button onClick={() => nav(`/practice/${h.id}`)}>查看</button></td>
              </tr>
            ))}
            {!hist.length && <tr><td colSpan={7} className="muted">暂无已完成练习。</td></tr>}
          </tbody>
        </table></div>
      )}

      {detailUid && <QuestionDetailModal uid={detailUid} onClose={() => setDetailUid(null)} />}
    </div>
  )
}
