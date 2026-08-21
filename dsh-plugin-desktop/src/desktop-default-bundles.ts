/** AWiki bundles owned by the Desktop distribution and enabled in its default profile. */
export const DESKTOP_AWIKI_BUNDLES = Object.freeze([
  '@awiki/dsh-plugin',
  '@awiki/dsh-model-proxy',
] as const)

/** Compose the upstream Web template with the Desktop distribution defaults. */
export function desktopDefaultBundles(webBundles: readonly string[]): string[] {
  return [...webBundles, ...DESKTOP_AWIKI_BUNDLES]
}
