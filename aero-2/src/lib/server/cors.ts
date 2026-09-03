/**
 * LAN CORS for the multi-Pi fleet.
 *
 * The only cross-origin readers aero-2 ever wants are the other panes on the
 * same wall, so the allowlist is an enumeration of private address space rather
 * than anything that trusts a hostname's shape.
 */

/**
 * Origins allowed to read tiles cross-origin: the other panes on the wall.
 *
 * mDNS names and `localhost` only, until now -- which excluded the addresses
 * the fleet actually uses. `/api/status` advertises `lanIps` and
 * `primaryLanIp`, and those are IPv4 literals, so the one deployment this
 * allowlist exists for (one Pi serving 3.7 GB of tiles to its two neighbours)
 * was the one it rejected. Avahi is also not guaranteed on a kiosk image.
 *
 * Private ranges only, enumerated rather than pattern-matched on "looks
 * local": 10/8, 172.16-31/12, 192.168/16, 127/8 loopback, 169.254/16
 * link-local, and 100.64/10 -- the CGNAT block Tailscale assigns, which is how
 * these machines reach each other when they are not on the same switch. A
 * public address must never match: this header is what lets another origin
 * read a response.
 */
const LAN_HOST =
	/^(?:[a-zA-Z0-9-]+\.local|localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})$/;

const LAN_ORIGIN = new RegExp(`^https?://${LAN_HOST.source.slice(1, -1)}(?::[0-9]{1,5})?$`);

export function lanCorsHeaders(requestOrigin: string | null | undefined): Record<string, string> {
	if (!requestOrigin || !LAN_ORIGIN.test(requestOrigin)) {
		return {};
	}
	return {
		'Access-Control-Allow-Origin': requestOrigin,
		'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
		Vary: 'Origin'
	};
}

export function corsPreflight(methods: string): (event: { request: Request }) => Response {
	return ({ request }) => {
		const cors = lanCorsHeaders(request.headers.get('origin'));
		return new Response(null, {
			status: 204,
			headers:
				Object.keys(cors).length === 0
					? {}
					: {
							...cors,
							'Access-Control-Allow-Methods': methods,
							/**
							 * Without this a preflight passes for a bare GET and fails for any
							 * request carrying Authorization or a JSON content-type — so the
							 * gap only appears once a route is gated, and never in curl, which
							 * does not preflight at all.
							 */
							'Access-Control-Allow-Headers': 'Content-Type, Authorization'
						}
		});
	};
}
