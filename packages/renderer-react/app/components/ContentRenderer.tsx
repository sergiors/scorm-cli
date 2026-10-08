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

export function ContentRenderer({
  nodes,
  headingOffset = 0,
  onQuestionnaireSubmitted,
  answers,
  submittedQuestionnaires,
  onAnswer,
}: ContentRendererProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <ContentNodeView
          key={`${node.type}-${index}`}
          node={node}
          headingOffset={headingOffset}
          onQuestionnaireSubmitted={onQuestionnaireSubmitted}
          answers={answers}
          submittedQuestionnaires={submittedQuestionnaires}
          onAnswer={onAnswer}
        />
      ))}
    </>
  );
}

function ContentNodeView({
  node,
  headingOffset,
  onQuestionnaireSubmitted,
  answers,
  submittedQuestionnaires,
  onAnswer,
}: {
  node: ContentNode;
  headingOffset: number;
  onQuestionnaireSubmitted?: (id: string) => void;
  answers?: Record<string, AnswerValue>;
  submittedQuestionnaires?: readonly string[];
  onAnswer?: (questionId: string, value: AnswerValue) => void;
}) {
  switch (node.type) {
    case 'heading': {
      const Tag = HEADING_TAGS[clampHeading(node.depth, headingOffset)];
      return (
        <Tag className='mt-6 mb-2 scroll-mt-24 text-xl font-semibold text-foreground first:mt-0'>
          <InlineContent nodes={node.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className='my-3 leading-7 text-foreground/90'>
          <InlineContent nodes={node.children} />
        </p>
      );
    case 'list': {
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
              <ContentRenderer
                nodes={item.children}
                headingOffset={headingOffset}
                onQuestionnaireSubmitted={onQuestionnaireSubmitted}
                answers={answers}
                submittedQuestionnaires={submittedQuestionnaires}
                onAnswer={onAnswer}
              />
            </li>
          ))}
        </ListTag>
      );
    }
    case 'code':
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
    case 'quote':
      return (
        <blockquote className='my-4 border-l-4 border-primary/50 bg-secondary/50 px-4 py-3 italic text-foreground/90'>
          <ContentRenderer
            nodes={node.children}
            headingOffset={headingOffset}
            onQuestionnaireSubmitted={onQuestionnaireSubmitted}
            answers={answers}
            submittedQuestionnaires={submittedQuestionnaires}
            onAnswer={onAnswer}
          />
        </blockquote>
      );
    case 'image':
      if (!node.caption) {
        return (
          <img
            src={node.src}
            alt={node.alt}
            loading='lazy'
            className='my-4 h-auto max-w-full rounded-lg border border-border'
          />
        );
      }
      return (
        <figure className='my-4 space-y-2'>
          <img
            src={node.src}
            alt={node.alt}
            loading='lazy'
            className='h-auto max-w-full rounded-lg border border-border'
          />
          <figcaption className='text-sm text-muted-foreground'>
            {node.caption}
          </figcaption>
        </figure>
      );
    case 'video':
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
    case 'questionnaire':
      return (
        <div className='my-4'>
          <QuestionnaireView
            node={node}
            headingOffset={headingOffset}
            answers={answers}
            submitted={submittedQuestionnaires?.includes(node.id) ?? false}
            onAnswer={onAnswer}
            onSubmitted={onQuestionnaireSubmitted}
          />
        </div>
      );
    default: {
      // Runtime guard for malformed content: never silently drop a node.
      const unknown = node as { type?: unknown };
      throw new Error(
        `Unsupported content node type: ${String(unknown.type ?? 'unknown')}`,
      );
    }
  }
}
