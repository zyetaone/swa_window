/**
 * Stream-limited body readers.
 *
 * Bytes are counted as they arrive and the read is abandoned the moment the cap
 * is exceeded, so an oversized payload is rejected mid-stream and never fully
 * buffered into process memory. Counting actual bytes rather than trusting
 * `Content-Length` also covers chunked transfer encoding, where the header is
 * absent or a lie.
 *
 * Returns a discriminated result rather than throwing, for the same reason as
 * `auth.ts`: a handler is callable from a test with a bare `Request`.
 */

export type BodyResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Read up to `maxBytes` from a stream. Fails with 413 the moment the cap is passed. */
export async function readLimited(
	stream: ReadableStream<Uint8Array> | null,
	maxBytes: number
): Promise<BodyResult<Uint8Array>> {
	if (!stream) return fail(400, 'missing request body');

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) {
				// Cancel rather than drain, so the sender is told to stop instead of
				// being read to completion. Peak memory is maxBytes plus the one chunk
				// that crossed it — that chunk is already in hand, and is not kept.
				await reader.cancel();
				return fail(413, `request body too large: >${received} bytes, limit is ${maxBytes}`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const out = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { ok: true, value: out };
}

/** Read up to `maxBytes` from `request.body` and parse as JSON. */
export async function readLimitedJson<T>(
	request: Request,
	maxBytes: number
): Promise<BodyResult<T>> {
	const bytes = await readLimited(request.body, maxBytes);
	if (!bytes.ok) return bytes;

	try {
		return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes.value)) as T };
	} catch {
		return fail(400, 'invalid JSON');
	}
}

function fail(status: number, message: string): { ok: false; response: Response } {
	return {
		ok: false,
		response: new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'content-type': 'application/json' }
		})
	};
}
