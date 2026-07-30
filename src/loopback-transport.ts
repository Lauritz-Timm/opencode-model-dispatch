export function isLoopbackHttpUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  if (url.username || url.password) return false
  const hostname = url.hostname.toLowerCase()
  return hostname === "localhost"
    || hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

export function createLoopbackOnlyTransport(
  transport: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const requestInput = input instanceof URL ? input.toString() : input
    const request = typeof requestInput === "string"
      ? new Request(requestInput, { ...init, redirect: "manual" })
      : new Request(requestInput, { ...init, redirect: "manual" })
    if (!isLoopbackHttpUrl(new URL(request.url))) {
      throw new Error("Refusing a non-loopback OpenCode server request")
    }

    const response = await transport(request)
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Refusing an OpenCode server redirect")
    }
    if (response.url && !isLoopbackHttpUrl(new URL(response.url))) {
      throw new Error("Refusing a non-loopback OpenCode server response")
    }
    return response
  }) as typeof globalThis.fetch
}
