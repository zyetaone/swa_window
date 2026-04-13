/**
 * resolveFleetUrl — shared endpoint resolver for fleet WS/API connections.
 *
 * - Selects secure protocol (wss/https) when page is served over https.
 * - Accepts ?server= override only in dev mode.
 * - Used by both DisplayWsClient and AdminStore.
 */

const FLEET_PORT = 3001;

export interface FleetEndpoint {
	wsUrl: string;
	apiBase: string;
}

/**
 * Resolve the fleet server WebSocket URL and REST API base for a given role.
 * @param role - 'display' | 'admin'
 * @param overrideUrl - explicit server URL (only honoured in dev mode)
 */
export function resolveFleetUrl(role: 'display' | 'admin', overrideUrl?: string | null): FleetEndpoint {
	// Allow override only in dev mode
	if (overrideUrl && (import.meta as any).env?.DEV) {
		const apiBase = overrideUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws.*$/, '');
		return { wsUrl: overrideUrl, apiBase };
	}

	const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
	const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
	const wsProto = isSecure ? 'wss' : 'ws';
	const httpProto = isSecure ? 'https' : 'http';

	const wsUrl = `${wsProto}://${hostname}:${FLEET_PORT}/ws?role=${role}`;
	const apiBase = `${httpProto}://${hostname}:${FLEET_PORT}`;

	return { wsUrl, apiBase };
}
