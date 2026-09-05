/**
 * /wiki is static stakeholder documentation — render it on the
 * server (ssr=true overrides the app-wide ssr=false) and ship ZERO client
 * JS for it (csr=false). Originally load-bearing: under the old
 * bundleStrategy:'single' this page's ~50 KB of markup+scoped-CSS was inlined
 * into the one bundle the Pi kiosk parsed on '/' (Jul-13 council: keep the
 * page, get it off the kiosk's cold-start path). The build has since moved to
 * route-split output, so that specific cost is gone — but csr=false is still
 * correct on its own terms: static prose needs no client JS at all.
 * Prerendering is not an option — app.html carries a
 * %sveltekit.nonce% CSP placeholder, which prerender rejects.
 */
export const ssr = true;
// Load-bearing SvelteKit page option, not a dead export — the framework
// consumes it (keeps wiki markup out of the kiosk bundle; see header).
export const csr = false;
