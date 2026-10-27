import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ContentNode,
  ContentPackage,
  InlineContentNode,
  ItemNode,
  PageNode
} from '@scorm-cli/core'
import type { Plugin } from 'vite'
import {
  declaredDocumentLanguage,
  hasPlayerDictionary,
  setDocumentLanguage,
  setDocumentTitle
} from './html'

/** HTML template shipped with the package and used by both build and dev. */
export const ENTRYPOINT = 'index.html'

/** Public virtual module id consumed by the app as `virtual:package-data`. */
export const PACKAGE_DATA_ID = 'virtual:package-data'

/**
 * Resolved id Vite stores in its module graph. Kept here so dev mode can
 * invalidate the virtual module when the authored content changes.
 */
export const RESOLVED_PACKAGE_DATA_ID = `\0${PACKAGE_DATA_ID}`

/**
 * Public prefix of the per-node content virtual modules. Each authored page
 * (Scroll and Slides) and each authored item (Tiles) is emitted as its own
 * module so Rollup can split it into an independent, lazily loaded chunk; the
 * node id is URL-encoded after the prefix so any authored id (which may itself
 * contain `:` or `/`) stays a valid import specifier.
 */
export const PACKAGE_NODE_ID_PREFIX = 'virtual:package-node/'

/** Resolved id prefix Vite stores in its module graph for page/item content modules. */
export const RESOLVED_PACKAGE_NODE_ID_PREFIX = `\0${PACKAGE_NODE_ID_PREFIX}`

/** Whether a resolved module id belongs to a lazily loaded Page/Item content module. */
export function isPackageNodeModuleId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(RESOLVED_PACKAGE_NODE_ID_PREFIX)
}

/** The ordered leaf nodes of a package, a page (Scroll/Slides) or an item (Tiles). */
function presentationNodes(contentPackage: ContentPackage): Array<PageNode | ItemNode> {
  const { presentation } = contentPackage
  return presentation.type === 'tiles' ? presentation.items : presentation.pages
}

/**
 * Reduces one authored node's content to the minimal, semantic AST the session
 * layer needs. The player's scoring, resume sanitisation and completion gating
 * only ever inspect questionnaires (ids, attempt cap, question types, option
 * values and correctness) and video ids; everything else is presentation and
 * travels with the node's lazily loaded module. Keeping this summary in the
 * initial package
 * means no page or item body lands in the entry chunk, while the shared core
 * helpers keep operating on ordinary content nodes.
 *
 * Prompt and option strings are omitted from this semantic summary because
 * they remain part of the lazily loaded page or item module.
 */
function semanticNodeContent(content: readonly ContentNode[]): ContentNode[] {
  const summary: ContentNode[] = []
  const visit = (nodes: ReadonlyArray<ContentNode | InlineContentNode>) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'questionnaire':
          summary.push({
            type: 'questionnaire',
            id: node.id,
            contributesToScore: node.contributesToScore,
            maxAttempts: node.maxAttempts,
            questions: node.questions.map((question) => ({
              type: 'question',
              id: question.id,
              questionType: question.questionType,
              prompt: '',
              options: question.options.map((option) => ({
                value: option.value,
                correct: option.correct,
                content: ''
              }))
            }))
          })
          break
        case 'video':
          summary.push({ type: 'video', id: node.id, provider: node.provider, src: node.src })
          break
        case 'list':
          for (const item of node.items) {
            visit(item.children)
          }
          break
        case 'quote':
          visit(node.children)
          break
        default:
          break
      }
    }
  }
  visit(content)
  return summary
}

/**
 * The virtual `virtual:package-data` module body. Every presentation keeps each
 * authored node's metadata and source, but replaces its content with
 * {@link semanticNodeContent}; the full content is served by a per-node module
 * the exported `contentProvider` imports dynamically, at most once per node.
 *
 * The provider never embeds a node id in the runtime state it returns: the ids
 * are the canonical semantic page/item ids, and chunk and loading state stay out
 * of the learner's resume state.
 *
 * An id with no server-rendered module is a real inconsistency — a build or
 * manifest mismatch — not an empty node, so `load` rejects with the id rather
 * than resolving to `[]`, which would render a blank page as if it succeeded.
 */
function buildPackageDataModule(contentPackage: ContentPackage): string {
  const { presentation } = contentPackage
  const manifest: ContentPackage =
    presentation.type === 'tiles'
      ? {
          metadata: contentPackage.metadata,
          presentation: {
            type: 'tiles',
            ...(presentation.columns === undefined ? {} : { columns: presentation.columns }),
            items: presentation.items.map((item) => ({
              ...item,
              content: semanticNodeContent(item.content)
            }))
          }
        }
      : {
          metadata: contentPackage.metadata,
          presentation: {
            type: presentation.type,
            pages: presentation.pages.map((page) => ({
              ...page,
              content: semanticNodeContent(page.content)
            }))
          }
        }

  const cases = presentationNodes(contentPackage)
    .map((node) => {
      const specifier = `${PACKAGE_NODE_ID_PREFIX}${encodeURIComponent(node.id)}`
      return `      case ${JSON.stringify(node.id)}: return import(${JSON.stringify(specifier)}).then((module) => { const content = module.default; contentCache.set(id, content); return content; })`
    })
    .join('\n')

  return `const contentCache = new Map();
const contentPackage = ${JSON.stringify(manifest)};
export default contentPackage;
export const contentProvider = {
  get(id) {
    return contentCache.get(id);
  },
  load(id) {
    const cached = contentCache.get(id);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    switch (id) {
${cases}${cases ? '\n' : ''}      default: return Promise.reject(new Error('No content module for node id: ' + id));
    }
  }
};
`
}

/**
 * The virtual content module body, holding exactly one authored node's AST.
 *
 * A node id with no matching authored page/item is a build or manifest mismatch,
 * not an empty node, so this throws instead of emitting `export default []` — the
 * dev server surfaces the failure as a load error, which the app renders as a
 * visible load error with retry rather than a blank page.
 */
function buildNodeContentModule(contentPackage: ContentPackage, encodedId: string): string {
  let nodeId: string
  try {
    nodeId = decodeURIComponent(encodedId)
  } catch {
    throw new Error(`Invalid encoded content node id: ${encodedId}`)
  }

  const content = presentationNodes(contentPackage).find((node) => node.id === nodeId)?.content
  if (content === undefined) {
    throw new Error(`No content module for node id: ${nodeId}`)
  }

  return `export default ${JSON.stringify(content)};
`
}

function findPackageRoot(startDirectory: string): string {
  let directory = startDirectory
  for (;;) {
    if (existsSync(path.join(directory, 'package.json'))) {
      return directory
    }
    const parent = path.dirname(directory)
    if (parent === directory) {
      throw new Error('Could not locate the renderer-react package root (no package.json found).')
    }
    directory = parent
  }
}

/** Whether `file` is inside `directory` (and not the directory itself). */
function isInside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/**
 * Whether the calling module belongs to the renderer's TypeScript source tree.
 *
 * The dev entry can run from `<package>/src` (workspace source previews and
 * tests) or from the bundled `<cli>/dist/index.js`. Source runs must load the
 * workspace app directly, while a bundled run must use the app copy shipped
 * next to the executable.
 */
export function isSourceModule(moduleUrl: string): boolean {
  const modulePath = fileURLToPath(moduleUrl)
  const packageRoot = findPackageRoot(path.dirname(modulePath))
  return isInside(path.join(packageRoot, 'src'), modulePath)
}

/**
 * Resolves the `app` directory from the calling module URL, validating that the
 * HTML template exists so failures surface early with a clear message.
 *
 * The app source is owned by this package and lives in its `app` directory, so
 * a source run (workspace preview or tests) must use that directory even when a
 * stale `dist/app` copy is present. The published CLI bundles this renderer and
 * ships a copy of the app next to its executable, so a bundled run resolves the
 * sibling `<cli>/dist/app` first.
 */
export function resolveAppRoot(moduleUrl: string): string {
  const modulePath = fileURLToPath(moduleUrl)
  const packageRoot = findPackageRoot(path.dirname(modulePath))
  const sourceApp = path.join(packageRoot, 'app')
  const builtApp = path.join(packageRoot, 'dist', 'app')
  const candidates = isInside(path.join(packageRoot, 'src'), modulePath)
    ? [sourceApp, builtApp]
    : [builtApp, sourceApp]
  const appRoot = candidates.find((candidate) => existsSync(path.join(candidate, ENTRYPOINT)))

  if (!appRoot) {
    throw new Error(
      `Renderer app template not found. Looked for ${ENTRYPOINT} in ${candidates.join(', ')}. ` +
        "Run 'pnpm build' so the app is emitted with the CLI package."
    )
  }

  return appRoot
}

/**
 * Browser-safe copy of the private `@scorm-cli/core` module, emitted next to the
 * CLI executable by `pnpm build` (a normal `tsup` entry, not an assembly step).
 *
 * The shipped app is compiled by Vite in a consumer where the private
 * `@scorm-cli/core` specifier does not exist, so the app's runtime import is
 * aliased to this built artifact. When the renderer runs from its own workspace
 * (tests and `scorm preview` against the workspace package) the copy does not exist,
 * so the app's `@scorm-cli/core` import resolves to the workspace package
 * normally and no alias is needed.
 */
const CORE_ENTRY = path.join('internal', 'core.js')

/** Resolves {@link CORE_ENTRY} from the app directory, which sits under `dist`. */
export function resolveCoreEntry(appRoot: string): string | undefined {
  const entry = path.resolve(appRoot, '..', CORE_ENTRY)
  return existsSync(entry) ? entry : undefined
}

/**
 * Workspace source entry for the browser-safe `@scorm-cli/core` module.
 *
 * Source previews must start without a `tsup` build, so the renderer app's
 * `@scorm-cli/core` import is aliased to the dependency-free core source and
 * Vite compiles it like any other module. This is only used by the source dev
 * server; the bundled CLI keeps resolving the emitted `internal/core.js`
 * through {@link resolveCoreEntry}, so shipped output is unchanged.
 */
export function resolveSourceCore(appRoot: string): string | undefined {
  const packageRoot = findPackageRoot(appRoot)
  const entry = path.resolve(packageRoot, '..', 'core', 'src', 'index.ts')
  return existsSync(entry) ? entry : undefined
}

/**
 * Mutable holder for the current package. Dev mode replaces `current` in place
 * so the plugin always serves the latest authored content without re-creating
 * the Vite server.
 */
export interface PackageDataHandle {
  current: ContentPackage
}

/**
 * Inlines the already-parsed content package as a virtual module so the
 * generated application ships with deterministic, self-contained data. No
 * network request is ever made to load the package.
 */
export function createPackageDataPlugin(handle: PackageDataHandle): Plugin {
  // Dedupe warnings per declared language so a dev server does not warn on
  // every request (and every reload) for the same unsupported package.
  const warnedLanguages = new Set<string>()

  return {
    name: 'scorm-cli:package-data',
    resolveId(id) {
      if (id === PACKAGE_DATA_ID) {
        return RESOLVED_PACKAGE_DATA_ID
      }
      if (id.startsWith(PACKAGE_NODE_ID_PREFIX)) {
        return `\0${id}`
      }
      return null
    },
    load(id) {
      if (id === RESOLVED_PACKAGE_DATA_ID) {
        return buildPackageDataModule(handle.current)
      }
      if (id.startsWith(RESOLVED_PACKAGE_NODE_ID_PREFIX)) {
        return buildNodeContentModule(
          handle.current,
          id.slice(RESOLVED_PACKAGE_NODE_ID_PREFIX.length)
        )
      }
      return null
    },
    transformIndexHtml(html) {
      const { metadata } = handle.current
      const language = declaredDocumentLanguage(metadata.lang)

      if (!hasPlayerDictionary(language) && !warnedLanguages.has(language)) {
        warnedLanguages.add(language)
        console.warn(
          `[scorm-cli] Unsupported content language "${language}". ` +
            `Rendering the player in English; supported languages are en, pt-BR.`
        )
      }

      const withTitle = setDocumentTitle(html, metadata.title || 'Content')
      return setDocumentLanguage(withTitle, language)
    }
  }
}
