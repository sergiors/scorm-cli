import { parsePackageWithPaths, type ParsedPackageLocation } from '@scorm-cli/parser'

export type LoadedPackage = ParsedPackageLocation

/** Parse authored content once and resolve the root used for local asset serving. */
export function loadPackage(contentPath: string): Promise<LoadedPackage> {
  return parsePackageWithPaths(contentPath)
}
