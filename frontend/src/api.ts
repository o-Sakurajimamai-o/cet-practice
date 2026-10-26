/** API 访问层：全部后端接口的薄封装。 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const r = await fetch(path, {
    ...init,
    headers,
  })
  if (!r.ok) {
    let msg = `${r.status}`
    try {
      const detail = (await r.json()).detail
      if (typeof detail === 'string') msg = detail
      else if (Array.isArray(detail)) msg = detail.map(d => [d.loc?.join('.'), d.msg].filter(Boolean).join('：')).join('；') || msg
    } catch { /* The HTTP status still identifies non-JSON failures. */ }
    throw new ApiError(msg, r.status)
  }
  return r.json()
}

export const listPapers = (params: URLSearchParams = new URLSearchParams()) =>
  api(`/api/papers?${params}`)
export const paperDetail = (key: string) => api(`/api/papers/${key}`)
export const createSession = (paperKey: string, restart = false) =>
  api(`/api/sessions?paper_key=${encodeURIComponent(paperKey)}&restart=${restart}`, { method: 'POST' })
export const restartSession = (sid: number) =>
  api(`/api/sessions/${sid}/restart`, { method: 'POST' })
export const createRedo = (uids: string[]) =>
  api('/api/sessions/redo', { method: 'POST', body: JSON.stringify({ uids }) })
export const getSession = (sid: number) => api(`/api/sessions/${sid}`)
export const saveState = (sid: number, body: object) =>
  api(`/api/sessions/${sid}`, { method: 'PUT', body: JSON.stringify(body) })
export const markRevealed = (sid: number, uid: string) =>
  api(`/api/sessions/${sid}/reveal`, { method: 'POST', body: JSON.stringify({ uid }) })
export const submitSession = (sid: number) =>
  api(`/api/sessions/${sid}/submit`, { method: 'POST' })
export const questionDetail = (uid: string) => api(`/api/questions/${encodeURIComponent(uid)}`)
export const addFavorite = (uid: string) =>
  api(`/api/favorites/${encodeURIComponent(uid)}`, { method: 'POST' })
export const delFavorite = (uid: string) =>
  api(`/api/favorites/${encodeURIComponent(uid)}`, { method: 'DELETE' })
export const saveNote = (uid: string, text: string) =>
  api(`/api/notes/${encodeURIComponent(uid)}`, { method: 'PUT', body: JSON.stringify({ text }) })
export const fixQuestion = (uid: string, field: string, value: any) =>
  api(`/api/questions/${encodeURIComponent(uid)}/fix`, { method: 'POST', body: JSON.stringify({ field, value }) })
export const wrongBook = () => api('/api/review/wrong')
export const favoritesList = () => api('/api/review/favorites')
export const historyList = () => api('/api/history')
export const reportApi = (exam?: string) => api(`/api/report${exam ? `?exam=${encodeURIComponent(exam)}` : ''}`)
export const backupImport = (data: object, merge: boolean) =>
  api(`/api/backup/import?merge=${merge}`, { method: 'POST', body: JSON.stringify({ data }) })
