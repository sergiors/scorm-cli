import {
  CircleAlert,
  Info,
  Lightbulb,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { CalloutNode, ContentNode } from '../types';
import { cn } from '../lib/utils';
import { InlineContent } from './InlineContent';
import { QuestionView } from './QuestionView';

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

const CALLOUT_VARIANTS: Record<
  CalloutNode['variant'],
  { icon: LucideIcon; label: string; className: string; iconClassName: string }
> = {
  info: {
    icon: Info,
    label: 'Info',
    className: 'border-sky-500/40 bg-sky-500/10',
    iconClassName: 'text-sky-600 dark:text-sky-400',
  },
  tip: {
    icon: Lightbulb,
    label: 'Tip',
    className: 'border-emerald-500/40 bg-emerald-500/10',
    iconClassName: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    icon: TriangleAlert,
    label: 'Warning',
    className: 'border-amber-500/40 bg-amber-500/10',
    iconClassName: 'text-amber-600 dark:text-amber-400',
  },
  important: {
    icon: CircleAlert,
    label: 'Important',
    className: 'border-destructive/40 bg-destructive/10',
    iconClassName: 'text-destructive',
  },
};

export interface ContentRendererProps {
  nodes: ContentNode[];
  /**
   * Shifts every heading down so item content nests under the package view's
   * headings. Defaults to 0, keeping the source depth untouched.
   */
  headingOffset?: number;
}

export function ContentRenderer({
  nodes,
  headingOffset = 0,
}: ContentRendererProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <ContentNodeView
          key={`${node.type}-${index}`}
          node={node}
          headingOffset={headingOffset}
        />
      ))}
    </>
  );
}

function ContentNodeView({
  node,
  headingOffset,
}: {
  node: ContentNode;
  headingOffset: number;
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
    case 'callout': {
      const variant = CALLOUT_VARIANTS[node.variant];
      const Icon = variant.icon;
      return (
        <div
          role='note'
          aria-label={variant.label}
          className={cn(
            'my-4 flex items-start gap-3 rounded-lg border p-4',
            variant.className,
          )}
        >
          <Icon
            aria-hidden='true'
            className={cn('mt-0.5 size-5 shrink-0', variant.iconClassName)}
          />
          <div className='min-w-0 flex-1'>
            <ContentRenderer
              nodes={node.children}
              headingOffset={headingOffset}
            />
          </div>
        </div>
      );
    }
    case 'example':
      return (
        <div className='my-4 rounded-lg border border-border bg-secondary/40 p-4'>
          <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            {node.title ?? 'Example'}
          </p>
          <ContentRenderer
            nodes={node.children}
            headingOffset={headingOffset}
          />
        </div>
      );
    case 'steps':
      return (
        <ol className='my-4 space-y-4'>
          {node.steps.map((step, index) => (
            <li key={index} className='flex items-start gap-3'>
              <span
                aria-hidden='true'
                className='mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground'
              >
                {index + 1}
              </span>
              <div className='min-w-0 flex-1 space-y-2'>
                {step.title ? (
                  <p className='font-medium text-foreground'>{step.title}</p>
                ) : null}
                <ContentRenderer
                  nodes={step.children}
                  headingOffset={headingOffset}
                />
              </div>
            </li>
          ))}
        </ol>
      );
    case 'question':
      return (
        <div className='my-4'>
          <QuestionView node={node} headingOffset={headingOffset} />
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
