import type { ContentPackage } from './types';
import { PackageView } from './components/PackageView';

export interface PackageAppProps {
  contentPackage: ContentPackage;
}

export function PackageApp({ contentPackage }: PackageAppProps) {
  return <PackageView contentPackage={contentPackage} />;
}
