export interface PackageMetadata {
  title: string
  /** BCP-47 language tag. Optional for compatibility with existing packages. */
  lang?: string
}

export interface ContentPackage {
  metadata: PackageMetadata
  presentation: RootPresentation
}

export type RootPresentation = ScrollNode | GridNode

export interface ScrollNode {
  type: 'scroll'
  pages: PageNode[]
}

export interface PageNode {
  type: 'page'
  id: string
  source: string
  metadata: { title: string; description?: string }
  content: ContentNode[]
}

export interface GridNode {
  type: 'grid'
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
  prompt: ContentNode[]
  options: QuestionOption[]
}

export interface QuestionnaireNode {
  type: 'questionnaire'
  id: string
  contributesToScore: boolean
  questions: QuestionNode[]
}

export type AnswerValue = string | string[]

/** Serializable learner progress, independent of renderer and SCORM details. */
export interface PlayerPageState {
  visited?: boolean
  completed?: boolean
  answers?: Record<string, AnswerValue>
  submittedQuestionnaires?: string[]
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
  content: ContentNode[]
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

function presentationNodes(contentPackage: ContentPackage): (PageNode | ItemNode)[] {
  return contentPackage.presentation.type === 'scroll'
    ? contentPackage.presentation.pages
    : contentPackage.presentation.items
}

/** Completion is renderer-agnostic: a package is complete after every page/item is visited. */
export function isPackageComplete(
  contentPackage: ContentPackage,
  visitedItemIds: Iterable<string>
): boolean {
  const visited = visitedItemIds instanceof Set ? visitedItemIds : new Set(visitedItemIds)
  const ids = presentationNodes(contentPackage).map((node) => node.id)
  return ids.length > 0 && ids.every((id) => visited.has(id))
}

/** Returns presentation-node IDs considered complete by the package's progress semantics. */
export function getDoneNodeIds(contentPackage: ContentPackage, playerState: PlayerState): string[] {
  return presentationNodes(contentPackage)
    .filter((node) => {
      const state = playerState.pages[node.id]
      return contentPackage.presentation.type === 'scroll'
        ? state?.completed === true
        : state?.visited === true
    })
    .map((node) => node.id)
}

/** Returns integer package progress, independently of any SCORM encoding. */
export function getPackageProgress(
  contentPackage: ContentPackage,
  playerState: PlayerState
): number {
  const nodes = presentationNodes(contentPackage)
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

/** Calculates the semantic score for one questionnaire from its current answers. */
function scoreQuestionnaire(
  questionnaire: QuestionnaireNode,
  answers: PlayerPageState['answers']
): QuestionnaireScore {
  if (!questionnaire.contributesToScore) return { earned: 0, possible: 0 }

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
 * questionnaires in every page or item. Answers are scored as currently saved;
 * submission status does not affect the score or its possible-question count.
 */
export function getAggregateQuestionnaireScore(
  contentPackage: ContentPackage,
  playerState: PlayerState
): AggregateScore | undefined {
  let earned = 0
  let possible = 0

  const visit = (
    nodes: Array<ContentNode | InlineContentNode>,
    answers: PlayerPageState['answers']
  ) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'list':
          for (const item of node.items) visit(item.children, answers)
          break
        case 'quote':
          visit(node.children, answers)
          break
        case 'questionnaire':
          const questionnaireScore = scoreQuestionnaire(node, answers)
          earned += questionnaireScore.earned
          possible += questionnaireScore.possible
          // The parser currently prohibits questionnaires in prompts/options,
          // but traverse them so hand-authored canonical ASTs remain complete.
          for (const question of node.questions) {
            visit(question.prompt, answers)
            for (const option of question.options) visit(option.content, answers)
          }
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

  for (const presentationNode of presentationNodes(contentPackage)) {
    visit(presentationNode.content, playerState.pages[presentationNode.id]?.answers)
  }

  return possible === 0 ? undefined : { earned, possible }
}

/** Local references in the content AST are normalized relative to the package root. */
export function collectAssetReferences(contentPackage: ContentPackage): string[] {
  const refs = new Set<string>()
  const nodes = presentationNodes(contentPackage)

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
          for (const question of node.questions) {
            visitContent(question.prompt)

            for (const option of question.options) {
              visitContent(option.content)
            }
          }
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
          for (const question of node.questions) {
            visit(question.prompt)
            for (const option of question.options) visit(option.content)
          }
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
