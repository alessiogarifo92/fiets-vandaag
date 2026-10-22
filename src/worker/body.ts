import { ERROR_CODES } from '../core/api';
import { errorResponse } from './http';

/** Request bodies are capped at 2 KB (docs/architecture.md §2). */
export const MAX_BODY_BYTES = 2048;

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

const tooLarge = (): BodyResult => ({
  ok: false,
  response: errorResponse(
    413,
    ERROR_CODES.bodyTooLarge,
    `Request body is larger than ${MAX_BODY_BYTES} bytes`,
  ),
});

/**
 * Reads a JSON body without ever buffering more than the cap: a declared Content-Length over the cap is
 * refused up front, and a chunked body is cut off as soon as it passes the cap.
 */
export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return tooLarge();

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: errorResponse(400, ERROR_CODES.invalidJson, 'Body must be JSON') };
  }
}
