import { useRef, useState } from 'react'
import { api, backupImport } from '../api'
import { discardRestoredNoteDrafts, persistAllNoteDrafts, waitForNoteSaves } from '../noteDrafts'
import Icon from '../components/Icon'

export default function Backup() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [result, setResult] = useState<any | null>(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [fileName, setFileName] = useState('')
  const busyRef = useRef(false)
  const [exporting, setExporting] = useState(false)
  async function doExport() {
    if (exporting || busyRef.current) return
    setExporting(true)
    setErr('')
    try {
      await persistAllNoteDrafts()
      const data = await api('/api/backup/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `cet6-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e: any) { setErr('备份导出失败：' + String(e.message || e)) }
    finally { setExporting(false) }
  }
  async function doImport(confirmed = false) {
    if (busyRef.current || exporting) return
    const f = fileRef.current?.files?.[0]
    if (!f) { setErr('请先选择备份 JSON 文件'); return }
    if (mode === 'replace' && !confirmed) { setConfirming(true); return }
    busyRef.current = true
    setErr(''); setResult(null); setBusy(true); setConfirming(false)
    try {
      const data = JSON.parse(await f.text())
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== 'cet6-backup') throw new Error('请选择六级研习室导出的备份文件（缺少 cet6-backup 标识）。')
      await waitForNoteSaves()
      const restored = await backupImport(data, mode === 'merge')
      if (mode === 'replace') discardRestoredNoteDrafts()
      setResult(restored)
    } catch (e: any) { setErr(e instanceof SyntaxError ? '文件不是有效的 JSON，请选择导出的备份文件。' : String(e.message || e)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <div>
    <div className="page-heading"><div className="eyebrow">KEEP YOUR PROGRESS</div><h1>备份与恢复</h1><p>让每一份练习都有留存。定期导出学习记录，换设备或恢复时也能从容继续。</p></div>
    <div className="backup-grid">
      <section className="card"><div className="feature-icon"><Icon name="download" size={23}/></div><h2>导出学习记录</h2><p>将此设备上的个人学习数据保存为 JSON 文件，建议另存一份到其他磁盘。</p><div className="backup-list">{['作答与草稿', '练习进度', '交卷结果', '错题与收藏', '学习笔记', '人工校正'].map(t => <span key={t}>{t}</span>)}</div><button className="primary" disabled={exporting || busy} onClick={doExport}><Icon name="download" size={16}/>{exporting ? '正在导出…' : '下载备份文件'}</button><div className="backup-hint">导出文件仅包含个人记录，题库本体由源 PDF 重新导入。</div></section>
      <section className="card"><div className="feature-icon"><Icon name="upload" size={23}/></div><h2>恢复学习记录</h2><p>选择之前导出的备份文件。合并模式会保留现有练习，并补充尚未存在的记录。</p><label className="upload-field"><Icon name="upload" size={20}/><span>{fileName || '点击选择备份文件'}<small>{fileName ? '点击可重新选择' : '支持六级研习室导出的 JSON 文件'}</small></span><input className="visually-hidden" aria-label="选择备份文件" type="file" accept=".json,application/json" ref={fileRef} disabled={busy} onChange={() => { setFileName(fileRef.current?.files?.[0]?.name || ''); setResult(null); setErr(''); setConfirming(false) }}/></label><div className="filters"><select aria-label="恢复模式" value={mode} disabled={busy} onChange={e => { setMode(e.target.value as 'merge' | 'replace'); setConfirming(false); setResult(null); setErr('') }}><option value="merge">合并记录 · 推荐</option><option value="replace">替换学习记录（保留题目校正）</option></select><button disabled={busy || exporting} onClick={() => doImport()}>{busy ? '正在恢复…' : '导入备份'}</button></div><p className="backup-hint">合并时，笔记按更新时间保留较新内容；来源不同但编号相同的练习会另建记录，重复导入同一份备份不会重复创建。替换时，备份未覆盖的题目校正仍会保留，避免把已修正的答案还原。</p></section>
    </div>
    {confirming && <div className="notice error" role="alert"><div><b>确认用「{fileName}」替换学习记录？</b><div>当前的作答、错题、收藏和笔记将被备份中的记录替换。备份未覆盖的题目校正会保留，避免把已修正的答案还原。建议先下载一份当前备份。</div></div><button className="danger" disabled={busy || exporting} onClick={() => doImport(true)}>确认替换</button><button disabled={busy} onClick={() => setConfirming(false)}>取消</button></div>}
    {err && <div className="notice error" role="alert">{err}</div>}
    {result?.imported && <div className="card" role="status"><h3 style={{color:'var(--green)'}}>记录已恢复</h3><div className="stats-grid">{Object.entries({sessions:'新增会话',wrong_book:'错题',favorites:'收藏',notes:'笔记',manual_fixes:'人工校正'}).map(([k,v]) => <div className="stat" key={k}><b>{result.imported[k]}</b>{v}</div>)}</div>{result.retained_manual_fixes > 0 && <p className="muted small">另保留了本地 {result.retained_manual_fixes} 条题目校正。</p>}<p className="muted small" style={{marginTop:20,marginBottom:0}}>可以在「复习空间 → 练习历史」核对恢复结果。</p></div>}
  </div>
}
