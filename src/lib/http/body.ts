/**
 * Stream-limited body readers.
 *
 * Both helpers count bytes as they arrive and throw 413 the moment the cap is
 * exceeded, so an oversized payload is rejected mid-stream — never fully
 * buffered into process memory first.
 *
 * Content-Length bypass (chunked transfer encoding) is covered because we
 * count the actual bytes received, not the header value.
 */

import { error } from '@sveltejs/kit';

/**
 * Read up to `maxBytes` from `request.body`, parse as JSON, and return the
 * typed result. Throws 413 if the stream exceeds the cap before it ends.
 */
export async function readLimitedJson<T>(request: Request, maxBytes: number): Promise<T> {
	const reader = request.body?.getReader();
	if (!reader) {
		error(400, 'missing request body');
	}

	const chunks: Uint8Array[] = [];
	let received = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) {
				error(
					413,
					`request body too large: received >${received} bytes, limit is ${maxBytes} bytes`
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const raw = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		raw.set(chunk, offset);
		offset += chunk.byteLength;
	}

	const text = new TextDecoder().decode(raw);
	try {
		return JSON.parse(text) as T;
	} catch {
		error(400, 'invalid JSON');
	}
}

/**
 * Read up to `maxBytes` from `request.body` and return the raw bytes.
 * Throws 413 if the stream exceeds the cap before it ends.
 *
 * For multipart uploads, pass the already-extracted `File` blob's stream
 * instead of the raw request body so multipart framing bytes are excluded.
 */
export async function readLimitedBlob(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) {
				error(
					413,
					`upload too large: received >${received} bytes, limit is ${maxBytes} bytes`
				);
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
	return out;
}
