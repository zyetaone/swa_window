/** Runtime params passed to video-bg effect component. */
export interface VideoBgParams {
	asset: string;
	fit?: 'cover' | 'contain' | 'fill';
	opacity?: number;
	blend?: 'normal' | 'screen' | 'multiply' | 'overlay';
}
