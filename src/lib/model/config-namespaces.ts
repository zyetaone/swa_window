/**
 * The five config namespaces — THE single copy of the key list.
 *
 * Two consumers that must never share more than these strings:
 *   - config-tree.svelte.ts builds its NAMESPACES map of live $state
 *     objects from these keys (compile-checked via the satisfies below).
 *   - routes/api/config/+server.ts derives its wire allowlist from them.
 *     That route must stay a PLAIN-DATA check — it deliberately does not
 *     import config-tree (rune-bearing module in a server bundle would
 *     instantiate a dead shadow $state tree), and the allowlist guards
 *     __proto__/constructor-style path writes at the wire regardless of
 *     what the client tree looks like.
 *
 * Framework-free on purpose. Keep it that way.
 */
export const CONFIG_NAMESPACE_KEYS = ['atmosphere', 'camera', 'director', 'world', 'shell'] as const;
export type ConfigNamespace = (typeof CONFIG_NAMESPACE_KEYS)[number];
