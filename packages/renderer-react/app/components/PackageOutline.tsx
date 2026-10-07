import { Check, Circle } from 'lucide-react';
import type { ItemNode, SectionNode, StructureNode } from '../types';
import { cn } from '../lib/utils';

const GRID_COLUMNS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

/**
 * Full class names live in the map so Tailwind's scanner can see them; a
 * template literal such as `sm:${...}` would be invisible to the compiler.
 */
function gridClass(columns: number | undefined): string {
  const safe = Math.min(4, Math.max(1, Math.trunc(columns ?? 2)));
  return `grid grid-cols-1 gap-3 ${GRID_COLUMNS[safe]}`;
}

export interface PackageOutlineProps {
  nodes: StructureNode[];
  currentItemId: string | undefined;
  visited: ReadonlySet<string>;
  onSelect: (item: ItemNode) => void;
}

type OutlineContext = Omit<PackageOutlineProps, 'nodes'>;

export function PackageOutline({ nodes, ...ctx }: PackageOutlineProps) {
  return (
    <ul role='list' className='space-y-4'>
      {nodes.map((node) =>
        node.type === 'item' ? (
          <li key={node.id}>
            <OutlineItem item={node} variant='list' {...ctx} />
          </li>
        ) : (
          <li key={node.id}>
            <OutlineSection section={node} {...ctx} />
          </li>
        ),
      )}
    </ul>
  );
}

function OutlineSection({
  section,
  ...ctx
}: { section: SectionNode } & OutlineContext) {
  const { layout, columns } = section.presentation;

  return (
    <section aria-label={section.title ?? 'Section'}>
      {section.title ? (
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          {section.title}
        </h3>
      ) : null}

      {layout === 'sequence' ? (
        // A sequence section never renders the list/grid group-selection
        // presentation: items are reached through linear previous/next, and the
        // outline only offers a compact ordered reference.
        <ol
          role='list'
          className='flex flex-col gap-0.5 border-l border-border pl-3'
        >
          {section.children.map((child) => (
            <li key={child.id}>
              <OutlineItem item={child} variant='sequence' {...ctx} />
            </li>
          ))}
        </ol>
      ) : (
        <ul
          role='list'
          className={cn(
            'gap-1',
            layout === 'grid' ? gridClass(columns) : 'flex flex-col',
          )}
        >
          {section.children.map((child) => (
            <li key={child.id}>
              <OutlineItem
                item={child}
                variant={layout === 'grid' ? 'grid' : 'list'}
                {...ctx}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OutlineItem({
  item,
  variant,
  currentItemId,
  visited,
  onSelect,
}: { item: ItemNode; variant: 'list' | 'grid' | 'sequence' } & OutlineContext) {
  const isCurrent = item.id === currentItemId;
  const isVisited = visited.has(item.id);
  const state = isCurrent
    ? 'Current item'
    : isVisited
      ? 'Visited'
      : 'Not visited';

  if (variant === 'sequence') {
    return (
      <button
        type='button'
        onClick={() => onSelect(item)}
        aria-current={isCurrent ? 'page' : undefined}
        className={cn(
          'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCurrent
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
        )}
      >
        {item.metadata.title}
        <span className='sr-only'> — {state}</span>
      </button>
    );
  }

  if (variant === 'grid') {
    return (
      <button
        type='button'
        onClick={() => onSelect(item)}
        aria-current={isCurrent ? 'page' : undefined}
        className={cn(
          'group flex h-full w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCurrent
            ? 'border-primary'
            : 'border-border hover:border-primary/50 hover:bg-accent/40',
        )}
      >
        {item.metadata.thumbnail ? (
          <img
            src={item.metadata.thumbnail}
            alt=''
            loading='lazy'
            className='h-24 w-full rounded object-cover'
          />
        ) : null}
        <span className='block text-sm font-medium leading-snug'>
          {item.metadata.title}
        </span>
        {item.metadata.description ? (
          <span className='block text-xs text-muted-foreground'>
            {item.metadata.description}
          </span>
        ) : null}
        <span className='mt-auto flex items-center gap-1 text-xs text-muted-foreground'>
          {isVisited ? (
            <Check className='size-3.5 text-emerald-600 dark:text-emerald-400' />
          ) : (
            <Circle className='size-3.5' />
          )}
          <span className='sr-only'>{state}</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type='button'
      onClick={() => onSelect(item)}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isCurrent
          ? 'border-border bg-accent text-accent-foreground'
          : 'hover:bg-accent/60 hover:text-accent-foreground',
      )}
    >
      <span
        aria-hidden='true'
        className='mt-0.5 shrink-0 text-muted-foreground'
      >
        {isVisited ? (
          <Check className='size-4 text-emerald-600 dark:text-emerald-400' />
        ) : (
          <Circle className='size-4' />
        )}
      </span>
      <span className='flex-1'>
        <span className='block font-medium leading-snug'>
          {item.metadata.title}
        </span>
        {item.metadata.description ? (
          <span className='mt-0.5 block text-xs text-muted-foreground'>
            {item.metadata.description}
          </span>
        ) : null}
      </span>
      <span className='sr-only'>{state}</span>
    </button>
  );
}
