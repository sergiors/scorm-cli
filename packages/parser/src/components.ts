import type { ContentNode, ImageNode, InlineNode } from '@scorm-cli/core'
import type { AstNode, ContentSource } from './ast'
import { parseImageComponent, parseVideo } from './media'
import { parsePath } from './path'
import { parseQuestionnaire } from './question'

/**
 * The single source of truth for the authoring component vocabulary: each
 * component's canonical identity, where it may be authored, and (for components
 * that appear as top-level content) the parser that converts it.
 *
 * Import resolution, content dispatch, the presentation grammar and the nested
 * question grammar all read placement from this registry instead of keeping
 * their own name lists, so adding or moving a component is a one-place change
 * and the flow/inline parser records below stay exhaustive.
 */

/**
 * A context a component may be authored in. A component is accepted only where
 * its definition lists the context; anything else is a placement error.
 */
export type ComponentContext =
  /** Inside a paragraph, among text runs. */
  | 'inline'
  /** As a top-level content block. */
  | 'flow'
  /** The single root presentation element. */
  | 'root'
  /** A direct child of `<Scroll>`, `<Slides>`, or `<Tiles>`. */
  | 'presentation'
  /** A direct child of `<Path>`. */
  | 'path'
  /** A direct child of `<Questionnaire>`. */
  | 'questionnaire'
  /** A direct child of `<Question>`. */
  | 'question'

/**
 * Canonical component names and their placement, in the same order as the
 * `scorm-cli/authoring` marker exports. The keys are the only list of component
 * names in the parser: every derived set below reads them back.
 */
const componentRegistry = {
  Scroll: { contexts: ['root'] },
  Slides: { contexts: ['root'] },
  Tiles: { contexts: ['root'] },
  Page: { contexts: ['presentation', 'path'] },
  Item: { contexts: ['presentation'] },
  Path: { contexts: ['flow'] },
  Image: { contexts: ['inline', 'flow'] },
  Video: { contexts: ['flow'] },
  Questionnaire: { contexts: ['flow'] },
  Question: { contexts: ['questionnaire'] },
  Prompt: { contexts: ['question'] },
  Option: { contexts: ['question'] }
} as const satisfies Record<string, { contexts: readonly ComponentContext[] }>

type ComponentRegistry = typeof componentRegistry

export type AuthoringComponentName = keyof ComponentRegistry

export const authoringComponentNames = Object.keys(componentRegistry) as AuthoringComponentName[]

type ComponentNamesIn<C extends ComponentContext> = {
  [K in AuthoringComponentName]: C extends ComponentRegistry[K]['contexts'][number] ? K : never
}[AuthoringComponentName]

export type FlowComponentName = ComponentNamesIn<'flow'>

export type InlineComponentName = ComponentNamesIn<'inline'>

/**
 * The source context and callbacks a component parser needs. Only the
 * questionnaire grammar reads raw prompt/option text from the source context.
 */
export interface ComponentParseContext {
  source: ContentSource
}

export type FlowComponentParser = (
  node: AstNode,
  context: ComponentParseContext
) => Promise<ContentNode> | ContentNode

export type InlineComponentParser = (
  node: AstNode,
  context: ComponentParseContext
) => Promise<InlineNode>

/**
 * `<Image>` is the only component authored both inline and as a block, so its
 * parser is shared by both records. Its narrow `ImageNode` result satisfies both
 * the content and inline handler contracts.
 */
const imageComponent = (node: AstNode, context: ComponentParseContext): Promise<ImageNode> =>
  parseImageComponent(node, context.source.sourceFile, context.source.root)

/**
 * Parsers for every component accepted as a top-level content block. The record
 * is exhaustive over {@link FlowComponentName}, derived from placement, so
 * adding a flow component without a parser is a compile error.
 */
export const flowComponentHandlers = {
  Image: imageComponent,
  Video: (node, context) =>
    parseVideo(
      node,
      context.source.sourceFile,
      context.source.root,
      context.source.sourceLineOffset
    ),
  Questionnaire: (node, context) => parseQuestionnaire(node, context.source),
  Path: (node, context) => parsePath(node, context.source)
} satisfies Record<FlowComponentName, FlowComponentParser>

/**
 * Parsers for every component accepted inside a paragraph. The record is
 * exhaustive over {@link InlineComponentName}, so an inline-capable component
 * cannot bypass the dispatch by being handled ad hoc in the content converter.
 */
export const inlineComponentHandlers = {
  Image: imageComponent
} satisfies Record<InlineComponentName, InlineComponentParser>

const authoringComponentSet: ReadonlySet<string> = new Set(authoringComponentNames)

export function isAuthoringComponent(name: string): name is AuthoringComponentName {
  return authoringComponentSet.has(name)
}

export function hasComponentContext(name: string, context: ComponentContext): boolean {
  return (
    isAuthoringComponent(name) &&
    componentRegistry[name].contexts.some((candidate) => candidate === context)
  )
}

const flowComponentSet: ReadonlySet<string> = new Set(
  authoringComponentNames.filter((name) => hasComponentContext(name, 'flow'))
)

export function isFlowComponent(name: string): name is FlowComponentName {
  return flowComponentSet.has(name)
}

const inlineComponentSet: ReadonlySet<string> = new Set(
  authoringComponentNames.filter((name) => hasComponentContext(name, 'inline'))
)

export function isInlineComponent(name: string): name is InlineComponentName {
  return inlineComponentSet.has(name)
}

const blockOnlyComponentSet: ReadonlySet<string> = new Set(
  authoringComponentNames.filter(
    (name) => hasComponentContext(name, 'flow') && !hasComponentContext(name, 'inline')
  )
)

/**
 * Whether a component is accepted as a block but never inline. Such components
 * are hoisted out of paragraphs and reported when written inline.
 */
export function isBlockOnlyComponent(name: string): boolean {
  return blockOnlyComponentSet.has(name)
}
