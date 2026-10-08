export interface PackageMetadata {
  title: string;
}

export interface ContentPackage {
  metadata: PackageMetadata;
  presentation: RootPresentation;
}

export type RootPresentation = ScrollNode | GridNode;

export interface ScrollNode {
  type: 'scroll';
  pages: PageNode[];
}

export interface PageNode {
  type: 'page';
  id: string;
  source: string;
  metadata: { title: string };
  content: ContentNode[];
}

export interface GridNode {
  type: 'grid';
  columns?: number;
  items: ItemNode[];
}

export interface ItemNode {
  type: 'item';
  id: string;
  source: string;
  metadata: { title: string };
  content: ContentNode[];
}

export type InlineNode =
  | TextNode
  | EmphasisNode
  | StrongNode
  | InlineCodeNode
  | LinkNode
  | ImageNode
  | BreakNode;

export interface TextNode {
  type: 'text';
  value: string;
}

export interface EmphasisNode {
  type: 'emphasis';
  children: InlineNode[];
}

export interface StrongNode {
  type: 'strong';
  children: InlineNode[];
}

export interface InlineCodeNode {
  type: 'inlineCode';
  value: string;
}

export interface LinkNode {
  type: 'link';
  href: string;
  children: InlineNode[];
}

export interface ImageNode {
  type: 'image';
  src: string;
  alt: string;
  caption?: string;
}

export interface BreakNode {
  type: 'break';
}

export type QuestionType = 'single-choice' | 'multiple-choice' | 'true-false';

export type ContentNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | CodeNode
  | QuoteNode
  | ImageNode
  | VideoNode
  | QuestionnaireNode;

export interface HeadingNode {
  type: 'heading';
  depth: number;
  children: InlineNode[];
}

export interface ParagraphNode {
  type: 'paragraph';
  children: InlineNode[];
}

export interface ListNode {
  type: 'list';
  ordered: boolean;
  start?: number;
  /**
   * Markdown list tightness as reported by the source parser. A tight list
   * (`false`) normalizes its items' inline runs into {@link InlineContentNode}
   * runs so they render without a `<p>` wrapper; a loose list (`true`) keeps
   * paragraphs. Optional for backward compatibility: absent metadata is treated
   * as loose rather than inferred.
   */
  spread?: boolean;
  items: ListItemNode[];
}

/**
 * A run of inline content that a list item renders without a block wrapper.
 * Tight list items carry this in place of a `paragraph` so the AST itself
 * records the inline-vs-block distinction: `ImageNode` and friends are
 * otherwise ambiguous between their inline and block forms.
 */
export interface InlineContentNode {
  type: 'inlineContent';
  children: InlineNode[];
}

export interface ListItemNode {
  children: Array<ContentNode | InlineContentNode>;
}

export interface CodeNode {
  type: 'code';
  value: string;
  language?: string;
}

export interface QuoteNode {
  type: 'quote';
  children: ContentNode[];
}

export interface VideoNode {
  type: 'video';
  src: string;
  title?: string;
  poster?: string;
  captions?: string;
}

export interface QuestionNode {
  type: 'question';
  id: string;
  questionType: QuestionType;
  prompt: ContentNode[];
  options: QuestionOption[];
}

export interface QuestionnaireNode {
  type: 'questionnaire';
  id: string;
  questions: QuestionNode[];
}

export type AnswerValue = string | string[];

/** Serializable learner progress, independent of renderer and SCORM details. */
export interface PlayerPageState {
  visited?: boolean;
  completed?: boolean;
  answers?: Record<string, AnswerValue>;
  submittedQuestionnaires?: string[];
}

export interface PlayerState {
  location?: string;
  pages: Record<string, PlayerPageState>;
}

export interface QuestionOption {
  value: string;
  correct: boolean;
  content: ContentNode[];
}

export interface RenderOptions {
  outputDirectory: string;
  assets?: Array<{ sourcePath: string; targetPath: string }>;
}

export interface RenderResult {
  directory: string;
  entrypoint: string;
}

export interface RendererDevScript {
  id: string;
  source: string;
}

export interface RendererDevOptions {
  contentRoot: string;
  port?: number;
  host?: string;
  scripts?: RendererDevScript[];
}

export interface RendererDevServer {
  url: string;
  update(content: ContentPackage, scripts?: RendererDevScript[]): Promise<void>;
  reportError(message: string): void;
  close(): Promise<void>;
}

export interface Renderer {
  build(content: ContentPackage, options: RenderOptions): Promise<RenderResult>;
  dev?(
    content: ContentPackage,
    options: RendererDevOptions,
  ): Promise<RendererDevServer>;
}

/** Completion is renderer-agnostic: a package is complete after every page/item is visited. */
export function isPackageComplete(
  contentPackage: ContentPackage,
  visitedItemIds: Iterable<string>,
): boolean {
  const visited =
    visitedItemIds instanceof Set ? visitedItemIds : new Set(visitedItemIds);
  const ids =
    contentPackage.presentation.type === 'scroll'
      ? contentPackage.presentation.pages.map((page) => page.id)
      : contentPackage.presentation.items.map((item) => item.id);
  return ids.length > 0 && ids.every((id) => visited.has(id));
}

/** Returns integer package progress, independently of any SCORM encoding. */
export function getPackageProgress(
  contentPackage: ContentPackage,
  playerState: PlayerState,
): number {
  const nodes =
    contentPackage.presentation.type === 'scroll'
      ? contentPackage.presentation.pages
      : contentPackage.presentation.items;
  if (nodes.length === 0) return 0;
  const count = nodes.reduce((total, node) => {
    const state = playerState.pages[node.id];
    const done =
      contentPackage.presentation.type === 'scroll'
        ? state?.completed === true
        : state?.visited === true;
    return total + (done ? 1 : 0);
  }, 0);
  return Math.max(0, Math.min(100, Math.round((count / nodes.length) * 100)));
}

/** Local references in the content AST are normalized relative to the package root. */
export function collectAssetReferences(
  contentPackage: ContentPackage,
): string[] {
  const refs = new Set<string>();
  const nodes =
    contentPackage.presentation.type === 'scroll'
      ? contentPackage.presentation.pages
      : contentPackage.presentation.items;
  const addLocal = (value: string | undefined) => {
    if (value && !isRemoteReference(value)) refs.add(value);
  };
  const visitInline = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'image') addLocal(node.src);
      else if (
        node.type === 'emphasis' ||
        node.type === 'strong' ||
        node.type === 'link'
      ) {
        visitInline(node.children);
      }
    }
  };
  const visitContent = (nodes: Array<ContentNode | InlineContentNode>) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
          visitInline(node.children);
          break;
        case 'inlineContent':
          visitInline(node.children);
          break;
        case 'image':
          addLocal(node.src);
          break;
        case 'video':
          addLocal(node.src);
          addLocal(node.poster);
          addLocal(node.captions);
          break;
        case 'list':
          for (const item of node.items) visitContent(item.children);
          break;
        case 'quote':
          visitContent(node.children);
          break;
        case 'questionnaire':
          for (const question of node.questions) {
            visitContent(question.prompt);
            for (const option of question.options) visitContent(option.content);
          }
          break;
        case 'code':
          break;
      }
    }
  };
  for (const node of nodes) visitContent(node.content);
  return [...refs].sort();
}

export function isRemoteReference(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}
