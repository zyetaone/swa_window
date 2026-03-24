import { loadPersistedState } from '../src/lib/core/persistence';

const STORAGE_KEY = 'aero-window-v2';

// Mock window and localStorage
const mockStorage: Record<string, string> = {};
global.window = {
	localStorage: {
		getItem: (key: string) => {
            return mockStorage[key] || null;
        },
		setItem: (key: string, value: string) => { mockStorage[key] = value; },
		removeItem: (key: string) => { delete mockStorage[key]; },
		clear: () => { for (const key in mockStorage) delete mockStorage[key]; },
		length: 0,
		key: (index: number) => null,
	}
} as any;

function testRaw(input: string, description: string) {
	console.log(`Testing: ${description}`);
	mockStorage[STORAGE_KEY] = input;
	try {
		const result = loadPersistedState();
		console.log('  Result:', JSON.stringify(result));
	} catch (e: any) {
		console.error('  FAILED with error:', e.message);
	}
	console.log('---');
}

testRaw('{"location": "dubai"}', 'dubai');
testRaw('null', 'null');
testRaw('[1,2,3]', 'array');
