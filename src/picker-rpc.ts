export type JsonRpcID = string | number

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: JsonRpcID
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: JsonRpcID
  result?: unknown
  error?: unknown
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse

export interface TechnicalParseFailure {
  kind: "technical_failure"
  reason: string
  raw: string
}

const RESERVED_METHODS = new Set([
  "ready",
  "start",
  "validateModel",
  "refreshModels",
  "submit",
  "cancel",
  "log",
  "resize",
  "themeChanged",
  "focusChanged",
])

export function encodeJsonRpcMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`
}

export function parseJsonRpcMessage(line: string): JsonRpcMessage {
  const value = JSON.parse(line) as unknown
  if (!isRecord(value) || value.jsonrpc !== "2.0") {
    throw new Error("Invalid JSON-RPC message")
  }

  if (typeof value.method === "string") {
    if (!RESERVED_METHODS.has(value.method)) {
      throw new Error(`Unsupported JSON-RPC method: ${value.method}`)
    }
    return value as unknown as JsonRpcRequest
  }

  if (typeof value.id === "string" || typeof value.id === "number") {
    return value as unknown as JsonRpcResponse
  }

  throw new Error("Invalid JSON-RPC message")
}

export function decodeNdjsonChunk() {
  let buffer = ""

  return {
    push(chunk: string): { messages: JsonRpcMessage[]; buffer: string } {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      return {
        messages: lines.filter((line) => line.length > 0).map(parseJsonRpcMessage),
        buffer,
      }
    },
  }
}

export class JsonRpcMatcher {
  private readonly pending = new Set<JsonRpcID>()

  register(id: JsonRpcID): void {
    this.pending.add(id)
  }

  resolve(response: JsonRpcResponse): JsonRpcResponse | undefined {
    if (!this.pending.has(response.id)) return undefined
    this.pending.delete(response.id)
    return response
  }

  pendingIds(): JsonRpcID[] {
    return Array.from(this.pending)
  }
}

export function technicalFailureFromParseError(raw: string, error: Error): TechnicalParseFailure {
  return {
    kind: "technical_failure",
    reason: `Invalid picker JSON-RPC payload: ${error.message}`,
    raw,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
