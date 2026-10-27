export interface PackageMetadata {
  title: string
  /** BCP-47 language tag. Optional for compatibility with existing packages. */
  lang?: string
}

export interface ContentPackage {
  metadata: PackageMetadata
  presentation: RootPresentation
}

export type RootPresentation = ScrollNode | SlidesNode | TilesNode

/** A continuous presentation: pages flow in one virtualized document. */
export interface ScrollNode {
  type: 'scroll'
  pages: PageNode[]
}

/** A slide presentation: exactly one page is shown at a time. */
export interface SlidesNode {
  type: 'slides'
  pages: PageNode[]
}

export interface PageNode {
  type: 'page'
  id: string
  source: string
  metadata: { title: string; description?: string }
  content: ContentNode[]
}

/** A tiled presentation: items unlock one at a time in reading order. */
export interface TilesNode {
  type: 'tiles'
  columns?: number
  items: ItemNode[]
}

export interface ItemNode {
  type: 'item'
  id: string
  source: string
  metadata: { title: string }
  content: ContentNode[]
}

export type InlineNode =
  TextNode | EmphasisNode | StrongNode | InlineCodeNode | LinkNode | ImageNode | BreakNode

export interface TextNode {
  type: 'text'
  value: string
}

export interface EmphasisNode {
  type: 'emphasis'
  children: InlineNode[]
}

export interface StrongNode {
  type: 'strong'
  children: InlineNode[]
}

export interface InlineCodeNode {
  type: 'inlineCode'
  value: string
}

export interface LinkNode {
  type: 'link'
  href: string
  children: InlineNode[]
}

export interface ImageNode {
  type: 'image'
  src: string
  alt: string
  caption?: string
}

export interface BreakNode {
  type: 'break'
}

export type QuestionType = 'single-choice' | 'multiple-choice' | 'true-false'

export type ContentNode =
  | HeadingNode
  | ParagraphNode
  | ThematicBreakNode
  | ListNode
  | CodeNode
  | QuoteNode
  | ImageNode
  | VideoNode
  | PathNode
  | QuestionnaireNode

/** An ordered reference to existing root Scroll pages, keyed by stable page ID. */
export interface PathNode {
  type: 'path'
  pageIds: string[]
}

export interface HeadingNode {
  type: 'heading'
  depth: number
  children: InlineNode[]
}

export interface ParagraphNode {
  type: 'paragraph'
  children: InlineNode[]
}

export interface ThematicBreakNode {
  type: 'thematicBreak'
}

export interface ListNode {
  type: 'list'
  ordered: boolean
  start?: number
  /**
   * Markdown list tightness as reported by the source parser. A tight list
   * (`false`) normalizes its items' inline runs into {@link InlineContentNode}
   * runs so they render without a `<p>` wrapper; a loose list (`true`) keeps
   * paragraphs. Optional for backward compatibility: absent metadata is treated
   * as loose rather than inferred.
   */
  spread?: boolean
  items: ListItemNode[]
}

/**
 * A run of inline content that a list item renders without a block wrapper.
 * Tight list items carry this in place of a `paragraph` so the AST itself
 * records the inline-vs-block distinction: `ImageNode` and friends are
 * otherwise ambiguous between their inline and block forms.
 */
export interface InlineContentNode {
  type: 'inlineContent'
  children: InlineNode[]
}

export interface ListItemNode {
  children: Array<ContentNode | InlineContentNode>
}

export interface CodeNode {
  type: 'code'
  value: string
  language?: string
}

export interface QuoteNode {
  type: 'quote'
  children: ContentNode[]
}

export interface VideoNode {
  type: 'video'
  id: string
  provider: VideoProvider
  src: string
  title?: string
  poster?: string
  captions?: string
}

export type VideoProvider = 'native' | 'youtube' | 'vimeo'

export interface QuestionNode {
  type: 'question'
  id: string
  questionType: QuestionType
  prompt: string
  options: QuestionOption[]
}

export interface QuestionnaireNode {
  type: 'questionnaire'
  id: string
  contributesToScore: boolean
  /** Maximum number of submission attempts. Defaults to 1 for older ASTs. */
  maxAttempts?: number
  /**
   * Whether the questionnaire presents every question at once instead of one
   * at a time. Authoring may omit the prop; parser output always normalizes it
   * to a boolean, with omitted meaning `false`. Expanded presentation changes
   * navigation and layout only, not answers, validation, persistence, or
   * scoring.
   */
  expanded?: boolean
  questions: QuestionNode[]
}

export type AnswerValue = string | string[]

/** Serializable learner progress, independent of renderer and SCORM details. */
export interface PlayerPageState {
  visited?: boolean
  completed?: boolean
  answers?: Record<string, AnswerValue>
  submittedQuestionnaires?: string[]
  /** Correct-question counts for each completed submission, keyed by stable questionnaire ID. */
  questionnaireAttempts?: Record<string, number[]>
  /** Questionnaires currently being retried after an unsuccessful submission. */
  activeQuestionnaireRetries?: string[]
  /** Playback positions in semantic seconds, keyed by stable video node ID. */
  videos?: Record<string, number>
}

export interface PlayerState {
  location?: string
  pages: Record<string, PlayerPageState>
}

export interface QuestionOption {
  value: string
  correct: boolean
  content: string
}

export interface RenderOptions {
  outputDirectory: string
  assets?: Array<{ sourcePath: string; targetPath: string }>
}

export interface RenderResult {
  directory: string
  entrypoint: string
}

export interface RendererDevScript {
  id: string
  source: string
}

export interface RendererDevOptions {
  contentRoot: string
  port?: number
  host?: string
  scripts?: RendererDevScript[]
}

export interface RendererDevServer {
  url: string
  update(content: ContentPackage, scripts?: RendererDevScript[]): Promise<void>
  reportError(message: string): void
  close(): Promise<void>
}

export interface Renderer {
  build(content: ContentPackage, options: RenderOptions): Promise<RenderResult>
  dev?(content: ContentPackage, options: RendererDevOptions): Promise<RendererDevServer>
}

/** A leaf presentation node: a page (Scroll/Slides) or an item (Tiles). */
export type PresentationNode = PageNode | ItemNode

/** The ordered leaf nodes of a presentation, in authored reading order. */
export function getPresentationNodes(contentPackage: ContentPackage): PresentationNode[] {
  const { presentation } = contentPackage
  return presentation.type === 'tiles' ? presentation.items : presentation.pages
}

/**
 * Whether a saved node counts as done for its presentation. Done nodes count
 * toward progress; sequential access advances through the contiguous done
 * prefix. Page presentations (Scroll and Slides) complete a page when its own
 * completion rule has been met and every questionnaire on it has been
 * submitted; an item is done once it has been opened. The rule is
 * presentation-owned, but it lives here so every caller agrees on one
 * definition.
 */
export function isPresentationNodeDone(
  contentPackage: ContentPackage,
  nodeId: string,
  playerState: PlayerState
): boolean {
  const state = playerState.pages[nodeId]
  return contentPackage.presentation.type === 'tiles'
    ? state?.visited === true
    : state?.completed === true
}

/**
 * The shared sequential progression policy, expressed purely over ordered ids
 * and the set of already-done ids. It exposes the completed prefix and its
 * immediate first not-done successor; every later node is locked, even if its
 * state inconsistently says it is done. Presentations apply the result to
 * control *how* they expose nodes.
 */
export interface SequentialAccess {
  accessible: ReadonlySet<string>
  locked: ReadonlySet<string>
}

export function getSequentialAccess(
  ids: readonly string[],
  doneNodeIds: ReadonlySet<string>
): SequentialAccess {
  const accessible = new Set<string>()
  const locked = new Set<string>()
  let firstNotDoneFound = false

  for (const id of ids) {
    if (!firstNotDoneFound) {
      accessible.add(id)
      if (!doneNodeIds.has(id)) {
        firstNotDoneFound = true
      }
    } else {
      locked.add(id)
    }
  }

  return { accessible, locked }
}

/** Returns presentation-node IDs considered done by the package's progress semantics. */
export function getDoneNodeIds(contentPackage: ContentPackage, playerState: PlayerState): string[] {
  return getPresentationNodes(contentPackage)
    .filter((node) => isPresentationNodeDone(contentPackage, node.id, playerState))
    .map((node) => node.id)
}

/** Presentation-node IDs accessible under the shared sequential progression policy. */
export function getAccessibleNodeIds(
  contentPackage: ContentPackage,
  playerState: PlayerState
): string[] {
  const ids = getPresentationNodes(contentPackage).map((node) => node.id)
  const access = getSequentialAccess(ids, new Set(getDoneNodeIds(contentPackage, playerState)))
  return ids.filter((id) => access.accessible.has(id))
}

/** Whether `nodeId` is accessible under the shared sequential progression policy. */
export function isNodeAccessible(
  contentPackage: ContentPackage,
  playerState: PlayerState,
  nodeId: string
): boolean {
  return getAccessibleNodeIds(contentPackage, playerState).includes(nodeId)
}

/** Completion is renderer-agnostic: a package is complete after every node is done. */
export function isPackageComplete(
  contentPackage: ContentPackage,
  doneNodeIds: Iterable<string>
): boolean {
  const done = doneNodeIds instanceof Set ? doneNodeIds : new Set(doneNodeIds)
  const ids = getPresentationNodes(contentPackage).map((node) => node.id)
  return ids.length > 0 && ids.every((id) => done.has(id))
}

/** Returns integer package progress, independently of any SCORM encoding. */
export function getPackageProgress(
  contentPackage: ContentPackage,
  playerState: PlayerState
): number {
  const nodes = getPresentationNodes(contentPackage)
  if (nodes.length === 0) {
    return 0
  }

  const count = getDoneNodeIds(contentPackage, playerState).length

  return Math.max(0, Math.min(100, Math.round((count / nodes.length) * 100)))
}

export interface AggregateScore {
  earned: number
  possible: number
}

interface QuestionnaireScore {
  earned: number
  possible: number
}

/**
 * Scores retry-enabled questionnaires by their best recorded submission when
 * history exists; otherwise scores currently saved answers.
 */
function scoreQuestionnaire(
  questionnaire: QuestionnaireNode,
  answers: PlayerPageState['answers'],
  attempts: PlayerPageState['questionnaireAttempts']
): QuestionnaireScore {
  if (!questionnaire.contributesToScore) return { earned: 0, possible: 0 }

  const history = attempts?.[questionnaire.id]
  const maxAttempts = questionnaire.maxAttempts ?? 1
  if (
    Number.isSafeInteger(maxAttempts) &&
    maxAttempts > 1 &&
    Array.isArray(history) &&
    history.length > 0 &&
    history.length <= maxAttempts
  ) {
    const validCounts = history.filter(
      (count) => Number.isInteger(count) && count >= 0 && count <= questionnaire.questions.length
    )
    if (validCounts.length > 0) {
      return {
        earned: Math.max(...validCounts),
        possible: questionnaire.questions.length
      }
    }
  }

  let earned = 0
  for (const question of questionnaire.questions) {
    const answer = answers?.[question.id]
    const correctValues = question.options
      .filter((option) => option.correct)
      .map((option) => option.value)

    if (question.questionType === 'multiple-choice') {
      // An empty selection must not earn credit for malformed zero-answer questions.
      if (correctValues.length > 0 && Array.isArray(answer)) {
        const selected = new Set(answer)
        const correct = new Set(correctValues)
        if (selected.size === correct.size && [...selected].every((value) => correct.has(value))) {
          earned += 1
        }
      }
    } else if (typeof answer === 'string' && correctValues.includes(answer)) {
      earned += 1
    }
  }

  return { earned, possible: questionnaire.questions.length }
}

/**
 * Calculates the aggregate one-point-per-question score across all eligible
 * questionnaires in every page or item. Retry-enabled questionnaires with
 * submitted-attempt history use their best recorded correct count; without
 * history (and for single-attempt questionnaires), currently saved answers are
 * scored. Submission status does not affect the possible-question count.
 */
export function getAggregateQuestionnaireScore(
  contentPackage: ContentPackage,
  playerState: PlayerState
): AggregateScore | undefined {
  let earned = 0
  let possible = 0

  const visit = (
    nodes: Array<ContentNode | InlineContentNode>,
    pageState: PlayerPageState | undefined
  ) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'list':
          for (const item of node.items) visit(item.children, pageState)
          break
        case 'quote':
          visit(node.children, pageState)
          break
        case 'questionnaire':
          const questionnaireScore = scoreQuestionnaire(
            node,
            pageState?.answers,
            pageState?.questionnaireAttempts
          )
          earned += questionnaireScore.earned
          possible += questionnaireScore.possible
          break
        case 'heading':
        case 'paragraph':
        case 'inlineContent':
        case 'image':
        case 'video':
        case 'path':
        case 'code':
        case 'thematicBreak':
          break
      }
    }
  }

  for (const presentationNode of getPresentationNodes(contentPackage)) {
    visit(presentationNode.content, playerState.pages[presentationNode.id])
  }

  return possible === 0 ? undefined : { earned, possible }
}

/** Local references in the content AST are normalized relative to the package root. */
export function collectAssetReferences(contentPackage: ContentPackage): string[] {
  const refs = new Set<string>()
  const nodes = getPresentationNodes(contentPackage)

  const addLocal = (value: string | undefined) => {
    if (value && !isRemoteReference(value)) {
      const file = value.split(/[?#]/, 1)[0] ?? ''
      if (file) refs.add(file)
    }
  }

  const visitInline = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'image') {
        addLocal(node.src)
      } else if (node.type === 'link') {
        addLocal(node.href)
        visitInline(node.children)
      } else if (node.type === 'emphasis' || node.type === 'strong') {
        visitInline(node.children)
      }
    }
  }

  const visitContent = (nodes: Array<ContentNode | InlineContentNode>) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
        case 'inlineContent':
          visitInline(node.children)
          break
        case 'image':
          addLocal(node.src)
          break
        case 'video':
          addLocal(node.src)
          addLocal(node.poster)
          addLocal(node.captions)
          break
        case 'list':
          for (const item of node.items) {
            visitContent(item.children)
          }
          break
        case 'quote':
          visitContent(node.children)
          break
        case 'questionnaire':
          break
        case 'path':
        case 'code':
        case 'thematicBreak':
          break
      }
    }
  }

  for (const node of nodes) {
    visitContent(node.content)
  }

  return [...refs].sort()
}

/** Collects video nodes in source traversal order, including nested content. */
export function collectVideoNodes(
  nodes: readonly (ContentNode | InlineContentNode)[]
): VideoNode[] {
  const videos: VideoNode[] = []
  const visit = (nodes: readonly (ContentNode | InlineContentNode)[]) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'video':
          videos.push(node)
          break
        case 'list':
          for (const item of node.items) visit(item.children)
          break
        case 'quote':
          visit(node.children)
          break
        case 'questionnaire':
          break
        case 'heading':
        case 'paragraph':
        case 'inlineContent':
        case 'image':
        case 'path':
        case 'code':
        case 'thematicBreak':
          break
      }
    }
  }

  visit(nodes)
  return videos
}

export function isRemoteReference(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)
}
