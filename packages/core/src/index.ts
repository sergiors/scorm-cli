export interface PackageMetadata {
  title: string;
  description?: string;
}

export interface ContentPackage {
  metadata: PackageMetadata;
  children: StructureNode[];
}

export type StructureNode = SectionNode | ItemNode;

export type SectionLayout = 'list' | 'grid' | 'sequence';

export type ItemOpenMode = 'page' | 'modal';

export interface SectionNode {
  type: 'section';
  id: string;
  title?: string;
  presentation: { layout: SectionLayout; columns?: number };
  children: ItemNode[];
}

export interface ItemNode {
  type: 'item';
  id: string;
  source: string;
  presentation: { open: ItemOpenMode };
  metadata: { title: string; description?: string; thumbnail?: string };
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
  | CalloutNode
  | ExampleNode
  | QuestionNode
  | StepsNode;

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
  items: ListItemNode[];
}

export interface ListItemNode {
  children: ContentNode[];
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

export interface CalloutNode {
  type: 'callout';
  variant: 'info' | 'tip' | 'warning' | 'important';
  children: ContentNode[];
}

export interface ExampleNode {
  type: 'example';
  title?: string;
  children: ContentNode[];
}

export interface QuestionNode {
  type: 'question';
  questionType: QuestionType;
  prompt: ContentNode[];
  options: QuestionOption[];
}

export interface QuestionOption {
  value: string;
  correct: boolean;
  content: ContentNode[];
}

export interface StepsNode {
  type: 'steps';
  steps: StepNode[];
}

export interface StepNode {
  title?: string;
  children: ContentNode[];
}

export interface RenderOptions {
  outputDirectory: string;
  assets?: Array<{ sourcePath: string; targetPath: string }>;
}

export interface RenderResult {
  directory: string;
  entrypoint: string;
}

export interface RendererDevOptions {
  contentRoot: string;
  port?: number;
  host?: string;
}

export interface RendererDevServer {
  url: string;
  update(content: ContentPackage): Promise<void>;
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

/** Completion is renderer-agnostic: a package is complete after every item is visited. */
export function isPackageComplete(
  contentPackage: ContentPackage,
  visitedItemIds: Iterable<string>,
): boolean {
  const visited =
    visitedItemIds instanceof Set ? visitedItemIds : new Set(visitedItemIds);
  const itemIds: string[] = [];
  const walk = (nodes: StructureNode[]) => {
    for (const node of nodes) {
      if (node.type === 'item') itemIds.push(node.id);
      else walk(node.children);
    }
  };
  walk(contentPackage.children);
  return itemIds.length > 0 && itemIds.every((id) => visited.has(id));
}

/** Local references in the content AST are normalized relative to the package root. */
export function collectAssetReferences(
  contentPackage: ContentPackage,
): string[] {
  const refs = new Set<string>();
  const visit = (nodes: StructureNode[]) => {
    for (const node of nodes) {
      if (node.type === 'section') {
        visit(node.children);
        continue;
      }
      if (
        node.metadata.thumbnail &&
        !isRemoteReference(node.metadata.thumbnail)
      )
        refs.add(node.metadata.thumbnail);
      visitContent(node.content);
    }
  };
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
  const visitContent = (nodes: ContentNode[]) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
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
        case 'callout':
        case 'example':
          visitContent(node.children);
          break;
        case 'question':
          visitContent(node.prompt);
          for (const option of node.options) visitContent(option.content);
          break;
        case 'steps':
          for (const step of node.steps) visitContent(step.children);
          break;
        case 'code':
          break;
      }
    }
  };
  visit(contentPackage.children);
  return [...refs].sort();
}

export function isRemoteReference(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}
