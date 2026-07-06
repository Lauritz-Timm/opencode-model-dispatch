import { describe, expect, test } from "bun:test"

import { TaskBatcher } from "../src/batcher"

describe("batch coordinator", () => {
  test("groups task calls by session and debounce window", async () => {
    const scheduled: Array<() => void> = []
    const batcher = new TaskBatcher({ batchMs: 500, schedule: (fn) => scheduled.push(fn) })

    const first = batcher.enqueue({ callID: "c1", sessionID: "s1", args: { subagent_type: "build" } })
    const second = batcher.enqueue({ callID: "c2", sessionID: "s1", args: { subagent_type: "review" } })
    const otherSession = batcher.enqueue({ callID: "c3", sessionID: "s2", args: { subagent_type: "test" } })

    expect(batcher.pendingBatchCount()).toBe(2)
    expect(scheduled).toHaveLength(2)

    scheduled[0]!()
    batcher.resolveBatch("s1", [
      { callID: "c1", model: { providerID: "anthropic", modelID: "claude" } },
      { callID: "c2", model: { providerID: "openai", modelID: "gpt" } },
    ])
    scheduled[1]!()
    batcher.resolveBatch("s2", [{ callID: "c3", model: { providerID: "anthropic", modelID: "haiku" } }])

    await expect(first).resolves.toEqual({ kind: "selected", callID: "c1", model: { providerID: "anthropic", modelID: "claude" } })
    await expect(second).resolves.toEqual({ kind: "selected", callID: "c2", model: { providerID: "openai", modelID: "gpt" } })
    await expect(otherSession).resolves.toEqual({ kind: "selected", callID: "c3", model: { providerID: "anthropic", modelID: "haiku" } })
  })

  test("cancels all waiters in a batch", async () => {
    const scheduled: Array<() => void> = []
    const batcher = new TaskBatcher({ batchMs: 500, schedule: (fn) => scheduled.push(fn) })

    const first = batcher.enqueue({ callID: "c1", sessionID: "s1", args: {} })
    const second = batcher.enqueue({ callID: "c2", sessionID: "s1", args: {} })

    scheduled[0]!()
    batcher.cancelBatch("s1")

    await expect(first).rejects.toThrow("Model selection cancelled")
    await expect(second).rejects.toThrow("Model selection cancelled")
  })

  test("technical failure marks fallback and preserves original args", async () => {
    const scheduled: Array<() => void> = []
    const originalArgs = { subagent_type: "build", prompt: "secret" }
    const batcher = new TaskBatcher({ batchMs: 500, schedule: (fn) => scheduled.push(fn) })

    const result = batcher.enqueue({ callID: "c1", sessionID: "s1", args: originalArgs })

    scheduled[0]!()
    batcher.failBatch("s1", "picker crashed")

    await expect(result).resolves.toEqual({ kind: "fallback", callID: "c1", reason: "picker crashed", args: originalArgs })
  })
})
