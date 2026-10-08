import { Fragment } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type {
  AnswerValue,
  ContentNode,
  PageNode,
  PlayerPageState,
} from '../types';
import { cn } from '../lib/utils';
import { InlineContent } from './InlineContent';
import { PathView } from './PathView';
import { QuestionnaireView } from './QuestionnaireView';

const HEADING_TAGS = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
} as const;

/**
 * Maps an authored Markdown heading depth straight to its HTML level: depth 1
 * is `<h1>`, depth 2 is `<h2>`, and so on. Malformed depths are clamped into
 * the valid 1-6 range so a bad AST can never emit an invalid tag.
 */
function clampHeading(depth: number): keyof typeof HEADING_TAGS {
  const level = Math.min(6, Math.max(1, Math.trunc(depth)));
  return level as keyof typeof HEADING_TAGS;
}

export interface ContentRendererProps {
  nodes: ContentNode[];
  /**
   * Invoked once when a questionnaire in this subtree is submitted. Threaded
   * recursively through nested lists, quotes and questionnaire content so the
   * owning presentation sees every submission, however deeply it is authored.
   */
  onQuestionnaireSubmitted?: (id: string) => void;
  /**
   * Saved answers for the owning page/item, keyed by question id. Threaded to
   * every questionnaire in the subtree so restored selections render.
   */
  answers?: Record<string, AnswerValue>;
  /**
   * Wrapper ids of the questionnaires already submitted on the owning
   * page/item. Submitted questionnaires render read-only.
   */
  submittedQuestionnaires?: readonly string[];
  /**
   * Persists a single question answer for the owning page/item. Threaded to
   * every questionnaire so nested answers are saved under the same namespace.
   */
  onAnswer?: (questionId: string, value: AnswerValue) => void;
  /**
   * The root presentation's pages, so a Path node can resolve its referenced
   * ids to display metadata. Threaded unchanged through nested blocks; only a
   * scroll presentation supplies it.
   */
  pathPages?: readonly PageNode[];
  /**
   * Persisted state per root page id, so Path entries can read which referenced
   * pages are already visited. Path reuses this state and persists none of its
   * own.
   */
  pageStates?: Record<string, PlayerPageState>;
  /**
   * Opens a referenced root page through the presentation's existing page
   * switching, without mounting a second copy of the page. Absent when the
   * surrounding presentation cannot switch pages, in which case Path entries
   * render inert.
   */
  onNavigatePathPage?: (pageId: string) => void;
}

/**
 * Everything a block view needs beyond its own node. It is exactly the public
 * props minus `nodes`, so the same object can be spread straight back into a
 * recursive {@link ContentRenderer}.
 */
type ContentNodeRenderContext = Omit<ContentRendererProps, 'nodes'>;

type ContentNodeType = ContentNode['type'];

/** The exact node interface behind a block discriminant, e.g. `ImageNode`. */
type ContentNodeOf<T extends ContentNodeType> = Extract<
  ContentNode,
  { type: T }
>;

/**
 * Props shared by every block view: the exact node interface behind its
 * discriminant plus the threaded render context.
 */
interface ContentNodeViewProps<T extends ContentNodeType> {
  node: ContentNodeOf<T>;
  context: ContentNodeRenderContext;
}

/**
 * One view per block node type. Mapping over the discriminant makes the
 * registry exhaustive: adding a member to `ContentNode` without providing a
 * view is a compile-time error.
 */
type ContentNodeRenderers = {
  [T in ContentNodeType]: ComponentType<ContentNodeViewProps<T>>;
};

function HeadingView({ node }: ContentNodeViewProps<'heading'>) {
  const Tag = HEADING_TAGS[clampHeading(node.depth)];
  return (
    <Tag className='scroll-mt-24'>
      <InlineContent nodes={node.children} />
    </Tag>
  );
}

function ParagraphView({ node }: ContentNodeViewProps<'paragraph'>) {
  return (
    <p>
      <InlineContent nodes={node.children} />
    </p>
  );
}

/**
 * A single `<li>`. The AST records the inline-vs-block distinction directly:
 * `inlineContent` runs render through {@link InlineContent} without a block
 * wrapper, while every other node recurses through the normal block dispatch,
 * preserving item order, nested blocks, context and keys.
 */
function ListItemView({
  item,
  context,
}: {
  item: ContentNodeOf<'list'>['items'][number];
  context: ContentNodeRenderContext;
}) {
  return (
    <li>
      {item.children.map((child, index) =>
        child.type === 'inlineContent' ? (
          <InlineContent
            key={`inlineContent-${index}`}
            nodes={child.children}
          />
        ) : (
          <Fragment key={`${child.type}-${index}`}>
            {renderContentNode(child, context)}
          </Fragment>
        ),
      )}
    </li>
  );
}

function ListView({ node, context }: ContentNodeViewProps<'list'>) {
  const ListTag = node.ordered ? 'ol' : 'ul';
  return (
    <ListTag
      start={node.ordered ? node.start : undefined}
      className={node.ordered ? 'list-decimal' : 'list-disc'}
    >
      {node.items.map((item, index) => (
        <ListItemView key={index} item={item} context={context} />
      ))}
    </ListTag>
  );
}

function CodeView({ node }: ContentNodeViewProps<'code'>) {
  return (
    <pre className='text-sm font-mono not-prose overflow-x-auto rounded-2xl border border-border bg-secondary p-6'>
      <code className={node.language ? `language-${node.language}` : undefined}>
        {node.value}
      </code>
    </pre>
  );
}

function QuoteView({ node, context }: ContentNodeViewProps<'quote'>) {
  return (
    <blockquote className='border-l-4 border-primary/50 bg-secondary/50 px-4 py-3 italic text-foreground/90'>
      <ContentRenderer nodes={node.children} {...context} />
    </blockquote>
  );
}

function BlockImageView({ node }: ContentNodeViewProps<'image'>) {
  const image = (
    <img
      src={node.src}
      alt={node.alt}
      loading='lazy'
      className={cn(
        'h-auto max-w-full rounded-lg border border-border',
        node.caption ? undefined : '',
      )}
    />
  );
  if (!node.caption) {
    return image;
  }
  return (
    <figure className='space-y-2'>
      {image}
      <figcaption className='text-sm text-muted-foreground'>
        {node.caption}
      </figcaption>
    </figure>
  );
}

function VideoView({ node }: ContentNodeViewProps<'video'>) {
  return (
    <figure className='space-y-2'>
      <video
        controls
        preload='metadata'
        poster={node.poster}
        aria-label={node.title ?? 'Video'}
        className='w-full rounded-2xl'
      >
        <source src={node.src} />
        {node.captions ? (
          // BCP 47 tag for an undetermined language: the AST only carries a
          // caption track path, so we must not invent a specific locale.
          <track
            kind='captions'
            src={node.captions}
            srcLang='und'
            label='Captions'
            default
          />
        ) : null}
      </video>
      {node.title ? (
        <figcaption className='text-sm text-muted-foreground'>
          {node.title}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Delegates a questionnaire block to {@link QuestionnaireView}, translating the
 * threaded context into its props. The Path context is forwarded too, because a
 * questionnaire prompt or option may itself contain a Path block, which then
 * resolves its references and navigation through the same presentation.
 */
function QuestionnaireBlockView({
  node,
  context,
}: ContentNodeViewProps<'questionnaire'>) {
  return (
    <QuestionnaireView
      node={node}
      answers={context.answers}
      submitted={context.submittedQuestionnaires?.includes(node.id) ?? false}
      onAnswer={context.onAnswer}
      onSubmitted={context.onQuestionnaireSubmitted}
      pathPages={context.pathPages}
      pageStates={context.pageStates}
      onNavigatePathPage={context.onNavigatePathPage}
    />
  );
}

/**
 * Delegates a Path block to {@link PathView}, translating the threaded context
 * into its props. Navigation stays owned by the presentation, so this only
 * forwards the callback it was given.
 */
function PathBlockView({ node, context }: ContentNodeViewProps<'path'>) {
  return (
    <PathView
      node={node}
      pathPages={context.pathPages}
      pageStates={context.pageStates}
      onNavigatePathPage={context.onNavigatePathPage}
    />
  );
}

/**
 * Maps every block discriminant to its named view. The registry owns only the
 * dispatch, never the rendering logic itself.
 */
const contentNodeRenderers = {
  heading: HeadingView,
  paragraph: ParagraphView,
  list: ListView,
  code: CodeView,
  quote: QuoteView,
  image: BlockImageView,
  video: VideoView,
  questionnaire: QuestionnaireBlockView,
  path: PathBlockView,
} satisfies ContentNodeRenderers;

export function ContentRenderer({ nodes, ...context }: ContentRendererProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={`${node.type}-${index}`}>
          {renderContentNode(node, context)}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Dispatches a block node to its view. The registry is exhaustive (see
 * {@link ContentNodeRenderers}), so the indexed lookup is total; the cast only
 * expresses the correlation TypeScript cannot follow through a union-indexed
 * lookup — the node's discriminant guarantees the resolved view matches it.
 */
function renderContentNode(
  node: ContentNode,
  context: ContentNodeRenderContext,
): ReactNode {
  if (!Object.hasOwn(contentNodeRenderers, node.type)) {
    // Runtime guard for malformed content: never silently drop a node.
    throw new Error(
      `Unsupported content node type: ${String(node.type ?? 'unknown')}`,
    );
  }
  const View = contentNodeRenderers[node.type] as ComponentType<{
    node: ContentNode;
    context: ContentNodeRenderContext;
  }>;
  return <View node={node} context={context} />;
}
