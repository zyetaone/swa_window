/**
 * /wiki is static stakeholder documentation — render it on the
 * server (ssr=true overrides the app-wide ssr=false) and ship ZERO client
 * JS for it (csr=false). Without this, the global bundleStrategy:'single'
 * inlined its ~50 KB of markup+scoped-CSS into the one bundle the Pi kiosk
 * parses on '/' (Jul-13 council: keep the page, get it off the kiosk's
 * cold-start path). Prerendering is not an option — app.html carries a
 * %sveltekit.nonce% CSP placeholder, which prerender rejects.
 */
export const ssr = true;
export const csr = false;
