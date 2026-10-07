import type { Renderer } from '@scorm-cli/core';

/** Load the renderer package as an object so build and dev share one contract. */
export async function loadRenderer(): Promise<Renderer> {
  const rendererPackage = '@scorm-cli/renderer-react';
  const renderer = (await import(rendererPackage)) as {
    reactRenderer?: Renderer;
  };
  if (
    !renderer.reactRenderer ||
    typeof renderer.reactRenderer.build !== 'function'
  )
    throw new Error(
      '@scorm-cli/renderer-react does not export a valid reactRenderer',
    );
  return renderer.reactRenderer;
}
