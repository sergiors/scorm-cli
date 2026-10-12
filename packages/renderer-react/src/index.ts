import type { Renderer } from '@scorm-cli/core'
import { renderReactPackage } from './build'
import { renderReactDevServer } from './dev'

export { renderReactPackage } from './build'
export { renderReactDevServer } from './dev'

/**
 * Production build plus the live `scorm preview` server behind the shared renderer
 * contract. `renderReactPackage` remains available as a named export for
 * callers that only need a static build.
 */
export const reactRenderer: Renderer = {
  build: renderReactPackage,
  dev: renderReactDevServer
}

export type {
  RenderAsset,
  Renderer,
  RendererDevOptions,
  RendererDevServer,
  RenderOptions,
  RenderResult
} from './types'
