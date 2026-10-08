import { Fragment } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { AnswerValue, ContentNode } from '../types';
import { cn } from '../lib/utils';
import { InlineContent } from './InlineContent';
import { QuestionnaireView } from './QuestionnaireView';

const HEADING_TAGS = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
} as const;

function clampHeading(
  depth: number,
  offset: number,
): keyof typeof HEADING_TAGS {
  const level = Math.min(6, Math.max(1, Math.trunc(depth) + offset));
  return level as keyof typeof HEADING_TAGS;
}

export interface ContentRendererProps {
  nodes: ContentNode[];
  /**
   * Shifts every heading down so item content nests under the surrounding
   * authored headings. Defaults to 0, keeping the source depth untouched.
   */
  headingOffset?: number;
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
}

/**
 * Everything a block view needs beyond its own node. It is exactly the public
 * props minus `nodes`, with the heading offset already defaulted, so the same
 * object can be spread straight back into a recursive {@link ContentRenderer}.
 */
type ContentNodeRenderContext = Omit<
  ContentRendererProps,
  'nodes' | 'headingOffset'
> & { headingOffset: number };

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

function HeadingView({ node, context }: ContentNodeViewProps<'heading'>) {
  const Tag = HEADING_TAGS[clampHeading(node.depth, context.headingOffset)];
  return (
    <Tag className='mt-6 mb-2 scroll-mt-24 text-xl font-semibold text-foreground first:mt-0'>
      <InlineContent nodes={node.children} />
    </Tag>
  );
}

function ParagraphView({ node }: ContentNodeViewProps<'paragraph'>) {
  return (
    <p className='my-3 leading-7 text-foreground/90'>
      <InlineContent nodes={node.children} />
    </p>
  );
}

function ListView({ node, context }: ContentNodeViewProps<'list'>) {
  const ListTag = node.ordered ? 'ol' : 'ul';
  return (
    <ListTag
      start={node.ordered ? node.start : undefined}
      className={cn(
        'my-3 space-y-1 pl-6 text-foreground/90',
        node.ordered ? 'list-decimal' : 'list-disc',
      )}
    >
      {node.items.map((item, index) => (
        <li key={index} className='leading-7'>
          <ContentRenderer nodes={item.children} {...context} />
        </li>
      ))}
    </ListTag>
  );
}

function CodeView({ node }: ContentNodeViewProps<'code'>) {
  return (
    <pre className='my-4 overflow-x-auto rounded-lg border border-border bg-secondary p-4 text-sm'>
      <code
        className={cn(
          'font-mono',
          node.language ? `language-${node.language}` : undefined,
        )}
      >
        {node.value}
      </code>
    </pre>
  );
}

function QuoteView({ node, context }: ContentNodeViewProps<'quote'>) {
  return (
    <blockquote className='my-4 border-l-4 border-primary/50 bg-secondary/50 px-4 py-3 italic text-foreground/90'>
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
        node.caption ? undefined : 'my-4',
      )}
    />
  );
  if (!node.caption) {
    return image;
  }
  return (
    <figure className='my-4 space-y-2'>
      {image}
      <figcaption className='text-sm text-muted-foreground'>
        {node.caption}
      </figcaption>
    </figure>
  );
}

function VideoView({ node }: ContentNodeViewProps<'video'>) {
  return (
    <figure className='my-4 space-y-2'>
      <video
        controls
        preload='metadata'
        poster={node.poster}
        aria-label={node.title ?? 'Video'}
        className='w-full rounded-lg border border-border'
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
 * threaded context into its props.
 */
function QuestionnaireBlockView({
  node,
  context,
}: ContentNodeViewProps<'questionnaire'>) {
  return (
    <div className='my-4'>
      <QuestionnaireView
        node={node}
        headingOffset={context.headingOffset}
        answers={context.answers}
        submitted={context.submittedQuestionnaires?.includes(node.id) ?? false}
        onAnswer={context.onAnswer}
        onSubmitted={context.onQuestionnaireSubmitted}
      />
    </div>
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
} satisfies ContentNodeRenderers;

export function ContentRenderer({
  nodes,
  headingOffset = 0,
  ...context
}: ContentRendererProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={`${node.type}-${index}`}>
          {renderContentNode(node, { ...context, headingOffset })}
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
