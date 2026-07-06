export type JsonRpcID = string | number

export interface JsonRpcMessage {
  jsonrpc: "2.0"
  id?: JsonRpcID
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export function encodeJsonRpc(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`
}

export function decodeNdjson(input: string): JsonRpcMessage[] {
  return input
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const value = JSON.parse(line) as JsonRpcMessage
      if (value.jsonrpc !== "2.0") throw new Error("Invalid JSON-RPC message")
      return value
    })
}

export function createPickerContractFixture() {
  let pluginOut = ""
  let pickerOut = ""
  const pluginMessages: JsonRpcMessage[] = []
  const pickerMessages: JsonRpcMessage[] = []

  return {
    get pluginOut() {
      return pluginOut
    },
    get pickerOut() {
      return pickerOut
    },
    pluginMessages,
    pickerMessages,
    fromPlugin(chunk: string) {
      pickerOut += chunk
      pickerMessages.push(...decodeNdjson(chunk))
    },
    fromPicker(chunk: string) {
      pluginOut += chunk
      pluginMessages.push(...decodeNdjson(chunk))
    },
  }
}
