declare module 'virtual:package-data' {
  import type { ContentPackage } from '@scorm-cli/core'
  import type { ContentProvider } from './lib/content-loader'
  const contentPackage: ContentPackage
  export default contentPackage
  /**
   * The runtime content provider for the package. Each authored page (Scroll and
   * Slides) and item (Tiles) is emitted as an independent lazily loaded module,
   * resolved by the Vite plugin from the node's canonical `page:`/`item:` id.
   * `contentPackage` carries only authored metadata and the minimal semantic
   * summary, so no page or item body is embedded in the initial bundle.
   */
  export const contentProvider: ContentProvider
}
