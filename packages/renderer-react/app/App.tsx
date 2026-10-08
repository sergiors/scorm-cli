import type { ContentPackage } from './types';
import { PackageView } from './components/PackageView';
import { PreviewErrorOverlay } from './components/PreviewErrorOverlay';
import { I18nProvider } from './lib/use-i18n';
import { usePreviewError } from './lib/use-preview-error';

export interface PackageAppProps {
  contentPackage: ContentPackage;
}

export function PackageApp({ contentPackage }: PackageAppProps) {
  const previewError = usePreviewError();

  return (
    <I18nProvider lang={contentPackage.metadata.lang}>
      <PackageView contentPackage={contentPackage} />
      {previewError ? <PreviewErrorOverlay message={previewError} /> : null}
    </I18nProvider>
  );
}
