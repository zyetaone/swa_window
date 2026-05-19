/**
 * Browser-side peer URL helper. Both DeviceClient (publishV2 to peer
 * /api/command) and RestAdminStore (poll peer /api/status, push to
 * /api/command + /api/config) hit the same protocol://host:port shape —
 * this is the SSOT.
 *
 * Self-peers use window.location.origin so same-origin fetches stay on
 * whatever scheme + port the page was loaded under, including non-default
 * dev ports.
 */

export interface PeerLike {
	host: string;
	port: number;
	self?: boolean;
}

/** Build the base URL for a discovered peer. Prefers same-origin for self. */
export function urlFor(peer: PeerLike): string {
	if (peer.self && typeof window !== 'undefined') return window.location.origin;
	const proto = typeof window !== 'undefined' ? window.location.protocol : 'http:';
	return `${proto}//${peer.host}:${peer.port}`;
}
