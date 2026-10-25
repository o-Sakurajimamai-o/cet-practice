import { saveNote } from './api'

type Draft = { text: string; token: string }
const prefix = 'cet6-note-draft:'
const drafts = new Map<string, Draft>()
const pending = new Map<string, { token: string; promise: Promise<void> }>()
let sequence = 0

export function getNoteDraft(uid: string): Draft | null {
  if (drafts.has(uid)) return drafts.get(uid)!
  try {
    const stored = JSON.parse(localStorage.getItem(prefix + uid) || 'null')
    if (stored && typeof stored.text === 'string' && typeof stored.token === 'string') {
      drafts.set(uid, stored)
      return stored
    }
  } catch { /* A draft can still be held in memory if storage is unavailable. */ }
  return null
}

export function rememberNoteDraft(uid: string, text: string): Draft {
  const previous = getNoteDraft(uid)
  if (previous?.text === text) return previous
  const draft = { text, token: `${Date.now()}-${++sequence}` }
  drafts.set(uid, draft)
  try { localStorage.setItem(prefix + uid, JSON.stringify(draft)) } catch { /* Keep the in-memory draft. */ }
  return draft
}

export function persistNoteDraft(uid: string, text: string): Promise<void> {
  const draft = rememberNoteDraft(uid, text)
  const previous = pending.get(uid)
  if (previous?.token === draft.token) return previous.promise
  const promise = (previous?.promise || Promise.resolve()).catch(() => {}).then(async () => {
    await saveNote(uid, draft.text)
    // A response for an older edit must never erase the newer local draft.
    if (getNoteDraft(uid)?.token === draft.token) {
      drafts.delete(uid)
      try { localStorage.removeItem(prefix + uid) } catch { /* The remote note was saved. */ }
    }
  })
  pending.set(uid, { token: draft.token, promise })
  const cleanup = () => { if (pending.get(uid)?.promise === promise) pending.delete(uid) }
  promise.then(cleanup, cleanup)
  return promise
}

export function waitForNoteSaves() {
  return Promise.allSettled([...pending.values()].map(item => item.promise))
}

/** Include recovered and previously failed drafts before exporting a backup. */
export async function persistAllNoteDrafts() {
  const targets = new Set(drafts.keys())
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) targets.add(key.slice(prefix.length))
    }
  } catch { /* Any in-memory drafts are still retried. */ }
  const requests = [...targets].map(uid => {
    const draft = getNoteDraft(uid)
    return draft ? persistNoteDraft(uid, draft.text) : Promise.resolve()
  })
  const results = await Promise.allSettled([
    ...requests, ...[...pending.values()].map(item => item.promise),
  ])
  if (results.some(result => result.status === 'rejected')) {
    throw new Error('仍有笔记草稿未保存，草稿已保留在本机。请恢复本地服务后重试导出。')
  }
}

export function discardRestoredNoteDrafts(uids?: string[]) {
  const targets = new Set(uids || [...drafts.keys()])
  if (!uids) {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key?.startsWith(prefix)) targets.add(key.slice(prefix.length))
      }
    } catch { /* The in-memory drafts can still be cleared. */ }
  }
  for (const uid of targets) {
    drafts.delete(uid)
    try { localStorage.removeItem(prefix + uid) } catch { /* Storage is unavailable. */ }
  }
}
