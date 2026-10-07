import type { RenderOptions } from '@scorm-cli/core';

export type { Renderer, RenderOptions, RenderResult } from '@scorm-cli/core';

/**
 * A single asset to copy into the generated output directory.
 *
 * `sourcePath` is an absolute or relative path resolved by the caller.
 * `targetPath` is relative to `outputDirectory` and must not escape it.
 */
export type RenderAsset = NonNullable<RenderOptions['assets']>[number];
