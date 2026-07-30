export interface TaskCall {
  callID: string
  sessionID: string
  args: Record<string, unknown>
}

export interface ModelSelection {
  providerID: string
  modelID: string
  variant?: string
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
  dispatched: boolean
}

interface ActiveCallState {
  count: number
  ambiguous: boolean
}

const AMBIGUOUS_CALL_ID_REASON = "invalid or duplicate call ID"

export class TaskBatcher {
  private readonly batches = new Map<string, PendingBatch[]>()
  private readonly activeCalls = new Map<string, Map<string, ActiveCallState>>()
  private batchMs: number
  private readonly schedule: (fn: () => void, delayMs: number) => void
  private readonly onReady?: (batch: ReadyBatch) => void

  constructor(options: { batchMs: number; schedule?: (fn: () => void, delayMs: number) => void; onReady?: (batch: ReadyBatch) => void }) {
    this.batchMs = options.batchMs
    this.schedule = options.schedule ?? ((fn, delayMs) => setTimeout(fn, delayMs))
    this.onReady = options.onReady
  }

  enqueue(call: TaskCall): Promise<BatchResult> {
    let queue = this.batches.get(call.sessionID)
    if (!queue) {
      queue = []
      this.batches.set(call.sessionID, queue)
    }

    let batch = queue[queue.length - 1]
    if (!batch || batch.ready) {
      batch = { sessionID: call.sessionID, waiters: [], ready: false, dispatched: false }
      queue.push(batch)
      this.schedule(() => this.markReady(call.sessionID, batch!), this.batchMs)
    }

    this.trackCall(call)
    return new Promise((resolve, reject) => {
      batch.waiters.push({ call, resolve, reject })
    })
  }

  pendingBatchCount(): number {
    let count = 0
    for (const queue of this.batches.values()) count += queue.length
    return count
  }

  setBatchMs(batchMs: number): void {
    this.batchMs = batchMs
  }

  resolveBatch(sessionID: string, selections: BatchSelection[]): void {
    const byCallID = new Map(selections.map((selection) => [selection.callID, selection.model]))
    this.finishDispatchedBatch(sessionID, (waiter, ambiguous) => {
      if (ambiguous) {
        waiter.resolve({
          kind: "fallback",
          callID: waiter.call.callID,
          reason: AMBIGUOUS_CALL_ID_REASON,
          args: waiter.call.args,
        })
        return
      }
      const model = byCallID.get(waiter.call.callID)
      if (model) {
        waiter.resolve({ kind: "selected", callID: waiter.call.callID, model })
      } else {
        waiter.resolve({ kind: "fallback", callID: waiter.call.callID, reason: "missing selection", args: waiter.call.args })
      }
    })
  }

  cancelBatch(sessionID: string): void {
    this.finishDispatchedBatch(sessionID, (waiter) => {
      waiter.reject(new Error("Model selection cancelled"))
    })
  }

  failBatch(sessionID: string, reason: string): void {
    this.finishDispatchedBatch(sessionID, (waiter) => {
      waiter.resolve({ kind: "fallback", callID: waiter.call.callID, reason, args: waiter.call.args })
    })
  }

  private markReady(sessionID: string, batch: PendingBatch): void {
    const queue = this.batches.get(sessionID)
    if (!queue?.includes(batch) || batch.ready) return
    batch.ready = true
    this.dispatchNext(sessionID)
  }

  private dispatchNext(sessionID: string): void {
    const queue = this.batches.get(sessionID)
    if (!queue || queue.some((batch) => batch.dispatched)) return
    const batch = queue[0]
    if (!batch?.ready) return
    batch.dispatched = true
    this.onReady?.({ sessionID, calls: batch.waiters.map((waiter) => waiter.call) })
  }

  private finishDispatchedBatch(
    sessionID: string,
    settle: (waiter: WaitingCall, ambiguous: boolean) => void,
  ): void {
    const queue = this.batches.get(sessionID)
    if (!queue) return
    const index = queue.findIndex((batch) => batch.dispatched)
    if (index < 0) return
    const [batch] = queue.splice(index, 1)
    if (!batch) return
    if (queue.length === 0) this.batches.delete(sessionID)

    for (const waiter of batch.waiters) {
      try {
        settle(waiter, this.callIsAmbiguous(waiter.call))
      } finally {
        this.releaseCall(waiter.call)
      }
    }
    this.dispatchNext(sessionID)
  }

  private trackCall(call: TaskCall): void {
    let sessionCalls = this.activeCalls.get(call.sessionID)
    if (!sessionCalls) {
      sessionCalls = new Map()
      this.activeCalls.set(call.sessionID, sessionCalls)
    }
    const active = sessionCalls.get(call.callID) ?? {
      count: 0,
      ambiguous: call.callID.length === 0,
    }
    active.count++
    if (active.count > 1) active.ambiguous = true
    sessionCalls.set(call.callID, active)
  }

  private callIsAmbiguous(call: TaskCall): boolean {
    return this.activeCalls.get(call.sessionID)?.get(call.callID)?.ambiguous === true
  }

  private releaseCall(call: TaskCall): void {
    const sessionCalls = this.activeCalls.get(call.sessionID)
    const active = sessionCalls?.get(call.callID)
    if (!sessionCalls || !active) return
    active.count--
    if (active.count === 0) sessionCalls.delete(call.callID)
    if (sessionCalls.size === 0) this.activeCalls.delete(call.sessionID)
  }
}
