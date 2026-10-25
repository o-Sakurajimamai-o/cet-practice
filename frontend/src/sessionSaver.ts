export type SessionProgress = {
  answers: Record<string, any>
  current_uid: string | null
  elapsed_sec: number
  audio_pos: number
  audio_paper_key: string | null
}

type Snapshot = { progress: SessionProgress; revision: number }
type SaveResponse = { state_revision?: number; ignored?: boolean }
export type SavePayload = SessionProgress & {
  client_id: string
  client_revision: number
  base_revision: number
}

function createClientId(): string {
  // Keep optional method calls out of constructor default parameters: the
  // production browser-target transform must not leak a temporary variable.
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Keep queued writes and the final beacon on the same ordered stream. */
export class SessionSaver {
  progress: SessionProgress = { answers: {}, current_uid: null, elapsed_sec: 0, audio_pos: 0, audio_paper_key: null }
  dirty = false
  conflict: Error | null = null
  private revision = 0
  private acknowledged = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly transport: (payload: SavePayload) => Promise<SaveResponse>,
    private readonly clientId = createClientId(),
  ) {}

  initialize(progress: SessionProgress, serverRevision = 0) {
    this.progress = progress
    this.acknowledged = serverRevision
    this.revision = 1
    this.dirty = false
    this.conflict = null
  }

  update(patch: Partial<SessionProgress>, track = true) {
    if (!Object.entries(patch).some(([key, value]) => this.progress[key as keyof SessionProgress] !== value)) return
    this.progress = { ...this.progress, ...patch }
    if (track) {
      this.revision += 1
      this.dirty = true
    }
  }

  private payload(snapshot: Snapshot): SavePayload {
    return {
      ...snapshot.progress,
      client_id: this.clientId,
      client_revision: snapshot.revision,
      base_revision: this.acknowledged,
    }
  }

  latestPayload(): SavePayload | null {
    if (this.conflict) return null
    return this.payload({ progress: this.progress, revision: this.revision })
  }

  save(): Promise<void> {
    // Capture before queuing, so a newer beacon remains newer than a late PUT.
    const snapshot = { progress: this.progress, revision: this.revision }
    const pending = this.queue.catch(() => {}).then(async () => {
      if (this.conflict) throw this.conflict
      try {
        const response = await this.transport(this.payload(snapshot))
        this.acknowledged = Math.max(this.acknowledged, response.state_revision || 0)
        if (this.revision === snapshot.revision) this.dirty = false
      } catch (error) {
        if ((error as { status?: number })?.status === 409) this.conflict = error as Error
        throw error
      }
    })
    this.queue = pending
    return pending
  }
}
