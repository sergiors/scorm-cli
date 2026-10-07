import type { ContentPackage } from './types';
import { PackageView } from './components/PackageView';
import { PreviewErrorOverlay } from './components/PreviewErrorOverlay';
import { usePreviewError } from './lib/use-preview-error';

export interface PackageAppProps {
  contentPackage: ContentPackage;
}

export function PackageApp({ contentPackage }: PackageAppProps) {
  const previewError = usePreviewError();

  return (
    <>
      <PackageView contentPackage={contentPackage} />
      {previewError ? <PreviewErrorOverlay message={previewError} /> : null}
    </>
  );
}
