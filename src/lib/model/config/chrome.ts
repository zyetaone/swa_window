/**
 * ChromeConfig — the cabin window shell.
 *
 * Covers: window frame visibility (on/off toggle — Phase 5 feature), blind
 * state, HUD visibility, side-panel open/closed, location picker.
 *
 * All reversible UI state that isn't scene-rendering. Admin-push-mutable
 * so fleet operators can toggle "full-view" mode on select devices (useful
 * for the multi-Pi parallax case where the oval frame breaks the seam).
 */

export class ChromeConfig {
	/** Master toggle — false hides the oval frame + rivets + vignette + glass. */
	windowFrame = $state(true);

	/** Blind drag position — true = pulled up (open), false = closed. */
	blindOpen = $state(true);

	/** HUD telemetry overlay visibility. */
	hudVisible = $state(true);

	/** Side panel docked-open state. */
	sidePanelOpen = $state(false);

	/** Show the cabin-interior accent (wing silhouette in bottom-left). */
	showWing = $state(true);

	setPath(path: string, value: unknown): boolean {
		switch (path) {
			case 'windowFrame':   this.windowFrame   = value as boolean; return true;
			case 'blindOpen':     this.blindOpen     = value as boolean; return true;
			case 'hudVisible':    this.hudVisible    = value as boolean; return true;
			case 'sidePanelOpen': this.sidePanelOpen = value as boolean; return true;
			case 'showWing':      this.showWing      = value as boolean; return true;
			default: return false;
		}
	}

	toJSON() {
		return {
			windowFrame:   this.windowFrame,
			blindOpen:     this.blindOpen,
			hudVisible:    this.hudVisible,
			sidePanelOpen: this.sidePanelOpen,
			showWing:      this.showWing,
		};
	}
}
