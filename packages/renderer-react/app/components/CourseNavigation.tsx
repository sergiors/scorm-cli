import { Check, Circle } from 'lucide-react';
import type { CourseStructureNode, ItemNode, SectionNode } from '../types';
import { cn } from '../lib/utils';

const GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

function gridClass(columns: number | undefined): string {
  const safe = Math.min(4, Math.max(1, Math.trunc(columns ?? 2)));
  return `grid ${GRID_COLUMNS[safe]}`;
}

export interface CourseNavigationProps {
  nodes: CourseStructureNode[];
  currentItemId: string | undefined;
  visited: ReadonlySet<string>;
  onSelect: (itemId: string) => void;
}

type OutlineContext = Omit<CourseNavigationProps, 'nodes'>;

export function CourseNavigation({
  nodes,
  currentItemId,
  visited,
  onSelect,
}: CourseNavigationProps) {
  return (
    <ul role='list' className='space-y-4'>
      {nodes.map((node) => (
        <OutlineNode
          key={node.id}
          node={node}
          currentItemId={currentItemId}
          visited={visited}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function OutlineNode({
  node,
  ...ctx
}: { node: CourseStructureNode } & OutlineContext) {
  if (node.type === 'item') {
    return (
      <li>
        <ItemButton item={node} variant='list' {...ctx} />
      </li>
    );
  }
  return (
    <li>
      <SectionGroup section={node} {...ctx} />
    </li>
  );
}

function SectionGroup({
  section,
  ...ctx
}: { section: SectionNode } & OutlineContext) {
  const isGrid = section.presentation.layout === 'grid';
  const variant = isGrid ? 'grid' : 'list';

  return (
    <section aria-label={section.title ?? 'Section'}>
      {section.title ? (
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          {section.title}
        </h3>
      ) : null}
      <ul
        role='list'
        className={cn(
          'gap-1',
          isGrid ? gridClass(section.presentation.columns) : 'flex flex-col',
        )}
      >
        {section.children.map((child) => (
          <li key={child.id}>
            {child.type === 'item' ? (
              <ItemButton item={child} variant={variant} {...ctx} />
            ) : (
              <SectionGroup section={child} {...ctx} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemButton({
  item,
  variant,
  currentItemId,
  visited,
  onSelect,
}: { item: ItemNode; variant: 'list' | 'grid' } & OutlineContext) {
  const isCurrent = item.id === currentItemId;
  const isVisited = visited.has(item.id);

  return (
    <button
      type='button'
      onClick={() => onSelect(item.id)}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isCurrent
          ? 'border-border bg-accent text-accent-foreground'
          : 'hover:bg-accent/60 hover:text-accent-foreground',
      )}
    >
      {variant === 'grid' && item.metadata.thumbnail ? (
        <img
          src={item.metadata.thumbnail}
          alt=''
          loading='lazy'
          className='size-10 shrink-0 rounded object-cover'
        />
      ) : (
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
      )}
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
      <span className='sr-only'>
        {isCurrent ? 'Current item' : isVisited ? 'Visited' : 'Not visited'}
      </span>
    </button>
  );
}
