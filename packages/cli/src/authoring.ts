/**
 * Public authoring surface for the `scorm-cli/authoring` subpath.
 *
 * The marker vocabulary lives in the private `@scorm-cli/authoring` workspace
 * package; this module is the only place the public package re-exports it, and
 * the CLI bundles it here so consumers never resolve a workspace package.
 */
export * from '@scorm-cli/authoring';
