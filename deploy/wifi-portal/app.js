/* Sky Portal — WiFi setup client.
 *
 * Talks to wifi-connect's built-in REST API (when wifi-connect serves this
 * directory via --ui-directory):
 *   GET  /networks       → [{ ssid, security, signal }]
 *   POST /connect        → { ssid, identity?, passphrase? }
 *
 * On successful POST, wifi-connect tears down the AP, joins the chosen
 * network, then exits — the Pi reboots into normal kiosk mode.
 */

const ssidSelect = document.getElementById('ssid');
const passInput = document.getElementById('passphrase');
const togglePw = document.getElementById('toggle-pw');
const form = document.getElementById('setup-form');
const submitBtn = document.getElementById('connect');
const status = document.getElementById('status');

function setStatus(msg, kind) {
	status.textContent = msg;
	status.className = 'hint' + (kind ? ' ' + kind : '');
}

togglePw.addEventListener('click', () => {
	const showing = passInput.type === 'text';
	passInput.type = showing ? 'password' : 'text';
	togglePw.textContent = showing ? 'show' : 'hide';
});

async function loadNetworks() {
	try {
		const res = await fetch('/networks');
		if (!res.ok) throw new Error('HTTP ' + res.status);
		const networks = await res.json();
		ssidSelect.innerHTML = '';
		if (!networks.length) {
			ssidSelect.innerHTML = '<option value="" disabled selected>No networks found</option>';
			setStatus('No Wi-Fi networks visible. Move closer to your router.', 'error');
			return;
		}
		// Sort by signal strength (descending)
		networks.sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0));
		const placeholder = document.createElement('option');
		placeholder.value = '';
		placeholder.disabled = true;
		placeholder.selected = true;
		placeholder.textContent = 'Select a network…';
		ssidSelect.appendChild(placeholder);
		for (const n of networks) {
			const opt = document.createElement('option');
			opt.value = n.ssid;
			opt.dataset.security = n.security ?? '';
			const lock = (n.security && n.security !== 'none') ? '🔒 ' : '';
			const bars = signalToBars(n.signal);
			opt.textContent = `${lock}${n.ssid}  ${bars}`;
			ssidSelect.appendChild(opt);
		}
	} catch (e) {
		setStatus('Could not list networks: ' + e.message, 'error');
	}
}

function signalToBars(signal) {
	if (signal == null) return '';
	if (signal >= 75) return '▮▮▮▮';
	if (signal >= 55) return '▮▮▮▯';
	if (signal >= 35) return '▮▮▯▯';
	return '▮▯▯▯';
}

ssidSelect.addEventListener('change', () => {
	const opt = ssidSelect.selectedOptions[0];
	const open = !opt?.dataset.security || opt.dataset.security === 'none';
	passInput.required = !open;
	passInput.placeholder = open ? 'No password needed' : 'Wi-Fi password';
	passInput.disabled = open;
	if (open) passInput.value = '';
});

form.addEventListener('submit', async (e) => {
	e.preventDefault();
	const ssid = ssidSelect.value;
	if (!ssid) {
		setStatus('Pick a network first.', 'error');
		return;
	}
	const passphrase = passInput.value;
	submitBtn.disabled = true;
	setStatus('Connecting to ' + ssid + '…');
	try {
		const res = await fetch('/connect', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ssid, passphrase }),
		});
		if (!res.ok) throw new Error('HTTP ' + res.status);
		setStatus('Connected. The display will restart in a few seconds.', 'success');
	} catch (e) {
		setStatus('Failed: ' + e.message + '. Check the password and try again.', 'error');
		submitBtn.disabled = false;
	}
});

loadNetworks();
