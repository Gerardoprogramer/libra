/**
 * Reads a request body as UTF-8 text, holding at most `maxBytes` bytes in memory.
 *
 * Returns null as soon as the body is known to exceed the limit: from a declared Content-Length when there is one,
 * otherwise from the bytes actually received, so a missing or understated header cannot get a larger body through.
 * The rest of the stream is cancelled rather than read. Throws when the stream fails or the bytes are not valid
 * UTF-8; an absent body reads as the empty string.
 */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  const body = request.body;
  if (!body) return "";

  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > maxBytes) {
    await body.cancel().catch(() => {});
    return null;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
