import { describe, it, expect } from 'vitest';
import {
	ENGINEERED_BY,
	PRODUCT_CREDIT_LINE,
	PRODUCT_NAME,
	PRODUCT_OWNER,
	PRODUCT_PARTNERS,
} from '$lib/credits';

describe('credits SSOT', () => {
	it('names Zyeta as product owner and rdtect as engineer', () => {
		expect(PRODUCT_OWNER).toBe('Zyeta');
		expect(ENGINEERED_BY).toBe('rdtect');
		expect(PRODUCT_NAME).toMatch(/Aero/);
		expect(PRODUCT_CREDIT_LINE).toContain('rdtect');
		expect(PRODUCT_CREDIT_LINE).toContain('Zyeta');
	});

	it('keeps boot partner order Zyeta × SWA', () => {
		expect(PRODUCT_PARTNERS[0]).toBe('Zyeta');
		expect(PRODUCT_PARTNERS[1]).toBe('SWA');
	});
});
