/**
 * lan-peers mDNS ingestion hardening.
 *
 * mDNS answers are untrusted LAN input: the extracted deviceId becomes the
 * peer-map key and is rendered in the admin UI, so it must pass the same
 * hostname-shaped allowlist as the heartbeat store (DEVICE_ID_PATTERN), and
 * the peer map is capped so a flood of bogus SRV records cannot grow it
 * without bound.
 *
 * handleResponse is exercised directly — no real mDNS socket needed.
 * stopLanProxy() clears the peer map between tests.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleResponse, listPeers, stopLanProxy } from '$lib/server/fleet/lan-peers';

function srvAnswer(deviceLabel: string, port = 3000): { answers: Array<{ name: string; type: string; data: unknown }> } {
	return {
		answers: [
			{
				name: `${deviceLabel}._aero-bundle._tcp.local`,
				type: 'SRV',
				data: { port, target: `${deviceLabel}.local` },
			},
		],
	};
}

afterEach(() => {
	stopLanProxy();
	vi.unstubAllEnvs();
});

describe('handleResponse ingestion', () => {
	it('registers a well-formed peer announcement', () => {
		handleResponse(srvAnswer('aero-display-01'));
		const peers = listPeers();
		expect(peers).toHaveLength(1);
		expect(peers[0]).toMatchObject({ deviceId: 'aero-display-01', host: 'aero-display-01.local', port: 3000 });
	});

	it('rejects device ids that are not hostname-shaped', () => {
		handleResponse(srvAnswer('bad host'));
		handleResponse(srvAnswer('<script>alert(1)</script>'));
		handleResponse(srvAnswer('a/b'));
		handleResponse(srvAnswer('x'.repeat(65)));
		expect(listPeers()).toHaveLength(0);
	});

	it('ignores our own announcement', () => {
		vi.stubEnv('AERO_DEVICE_ID', 'aero-display-00');
		handleResponse(srvAnswer('aero-display-00'));
		expect(listPeers()).toHaveLength(0);
	});

	it('caps the peer map and drops new ids beyond the cap', () => {
		for (let i = 0; i < 70; i++) {
			handleResponse(srvAnswer(`pi-${String(i).padStart(3, '0')}`));
		}
		const peers = listPeers();
		expect(peers).toHaveLength(64);
		// First-come entries win; late arrivals are dropped.
		expect(peers.some((p) => p.deviceId === 'pi-000')).toBe(true);
		expect(peers.some((p) => p.deviceId === 'pi-069')).toBe(false);
	});

	it('still refreshes a known peer when the map is full', () => {
		for (let i = 0; i < 70; i++) {
			handleResponse(srvAnswer(`pi-${String(i).padStart(3, '0')}`));
		}
		handleResponse(srvAnswer('pi-000', 4000));
		const pi = listPeers().find((p) => p.deviceId === 'pi-000');
		expect(pi?.port).toBe(4000);
	});
});
