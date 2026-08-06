/**
 * patchNum — oninput factory for numeric RangeSliders that write through the
 * config-patch gate. Collapses the repeated
 * `oninput={(e) => patch('path', parseFloat(e.currentTarget.value))}` lambda
 * into `oninput={patchNum(patch, 'path')}`.
 */
export function patchNum(patch: (path: string, value: unknown) => void, path: string) {
	return (e: Event) => patch(path, parseFloat((e.currentTarget as HTMLInputElement).value));
}
