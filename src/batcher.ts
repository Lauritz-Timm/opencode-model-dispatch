export interface TaskCall {
  callID: string
  sessionID: string
  args: Record<string, unknown>
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

export interface SelectedBatchResult {
  kind: "selected"
  callID: string
  model: ModelSelection
}

export interface FallbackBatchResult {
  kind: "fallback"
  callID: string
  reason: string
  args: Record<string, unknown>
}

export type BatchResult = SelectedBatchResult | FallbackBatchResult

export interface BatchSelection {
  callID: string
  model: ModelSelection
}

export interface ReadyBatch {
  sessionID: string
  calls: TaskCall[]
}

interface WaitingCall {
  call: TaskCall
  resolve: (result: BatchResult) => void
  reject: (error: Error) => void
}

interface PendingBatch {
  sessionID: string
  waiters: WaitingCall[]
  ready: boolean
}

export class TaskBatcher {
  private readonly batches = new Map<string, PendingBatch>()
  private readonly batchMs: number
  private readonly schedule: (fn: () => void, delayMs: number) => void
  private readonly onReady?: (batch: ReadyBatch) => void

  constructor(options: { batchMs: number; schedule?: (fn: () => void, delayMs: number) => void; onReady?: (batch: ReadyBatch) => void }) {
    this.batchMs = options.batchMs
    this.schedule = options.schedule ?? ((fn, delayMs) => setTimeout(fn, delayMs))
    this.onReady = options.onReady
  }

  enqueue(call: TaskCall): Promise<BatchResult> {
    let batch = this.batches.get(call.sessionID)
    if (!batch) {
      batch = { sessionID: call.sessionID, waiters: [], ready: false }
      this.batches.set(call.sessionID, batch)
      this.schedule(() => this.markReady(call.sessionID), this.batchMs)
    }

    return new Promise((resolve, reject) => {
      batch!.waiters.push({ call, resolve, reject })
    })
  }

  pendingBatchCount(): number {
    return this.batches.size
  }

  resolveBatch(sessionID: string, selections: BatchSelection[]): void {
    const batch = this.batches.get(sessionID)
    if (!batch) return
    this.batches.delete(sessionID)

    const byCallID = new Map(selections.map((selection) => [selection.callID, selection.model]))
    for (const waiter of batch.waiters) {
      const model = byCallID.get(waiter.call.callID)
      if (model) {
        waiter.resolve({ kind: "selected", callID: waiter.call.callID, model })
      } else {
        waiter.resolve({ kind: "fallback", callID: waiter.call.callID, reason: "missing selection", args: waiter.call.args })
      }
    }
  }

  cancelBatch(sessionID: string): void {
    const batch = this.batches.get(sessionID)
    if (!batch) return
    this.batches.delete(sessionID)

    for (const waiter of batch.waiters) {
      waiter.reject(new Error("Model selection cancelled"))
    }
  }

  failBatch(sessionID: string, reason: string): void {
    const batch = this.batches.get(sessionID)
    if (!batch) return
    this.batches.delete(sessionID)

    for (const waiter of batch.waiters) {
      waiter.resolve({ kind: "fallback", callID: waiter.call.callID, reason, args: waiter.call.args })
    }
  }

  private markReady(sessionID: string): void {
    const batch = this.batches.get(sessionID)
    if (!batch || batch.ready) return
    batch.ready = true
    this.onReady?.({ sessionID, calls: batch.waiters.map((waiter) => waiter.call) })
  }
}
