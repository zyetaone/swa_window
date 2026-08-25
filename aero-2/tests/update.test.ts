import { describe, it, expect, vi } from 'vitest';
import { schedulePrivileged, triggerOtaUpdate, getAppCommit } from '#lib/server/update.js';

describe('server/update', () => {
	it('schedulePrivileged returns true on non-linux systems', () => {
		const res = schedulePrivileged(['echo', 'test'], 10, '[test]');
		expect(res).toBe(true);
	});

	it('triggerOtaUpdate is a no-op off Linux, and reports it', () => {
		// Deliberately NOT calling this unguarded. On a Pi this function really
		// does schedule `sudo systemctl start aero-updater.service`, so a test
		// suite run on the target would restart the service it is testing.
		// Forcing the non-Linux branch keeps the assertion honest anywhere.
		const platform = process.platform;
		Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
		try {
			expect(triggerOtaUpdate()).toBe(true);
		} finally {
			Object.defineProperty(process, 'platform', { value: platform, configurable: true });
		}
	});

	it('getAppCommit returns a non-empty string', () => {
		const commit = getAppCommit();
		expect(typeof commit).toBe('string');
		expect(commit.length).toBeGreaterThan(0);
	});
});
