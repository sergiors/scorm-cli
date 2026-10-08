import { Check, Circle, Lock } from 'lucide-react';
import type { PageNode, PathNode, PlayerPageState } from '../types';
import { cn } from '../lib/utils';

/**
 * The state of a single Path entry, derived from the visited flags of the
 * referenced pages in Path order. A visited entry stays open; the first entry
 * and the entry immediately after the visited prefix are available; everything
 * else is locked, so a learner can revisit and advance one step, but never skip
 * ahead.
 */
export type PathPageStatus = 'visited' | 'available' | 'locked';

/**
 * Whether the Path entry at `index` may be opened, given the `visited` flags of
 * the referenced pages in Path order. The first entry is always available, an
 * already visited entry stays open, and otherwise an unvisited entry is
 * available only when the previous referenced entry is visited.
 *
 * This exactly permits the visited pages plus the next page after the visited
 * sequence while blocking a learner from skipping ahead. It is a pure lookup:
 * callers supply the flags already resolved from `PlayerPageState.visited`, so
 * the decision reuses the existing per-page state without adding any of its own.
 */
export function canOpenPathPage(
  index: number,
  visited: readonly boolean[],
): boolean {
  if (index <= 0) {
    return true;
  }
  if (visited[index]) {
    return true;
  }
  return visited[index - 1] === true;
}

function pathPageStatus(
  index: number,
  visited: readonly boolean[],
): PathPageStatus {
  if (visited[index]) {
    return 'visited';
  }
  return canOpenPathPage(index, visited) ? 'available' : 'locked';
}

const STATUS_LABELS: Record<PathPageStatus, string> = {
  visited: 'Visited',
  available: 'Available',
  locked: 'Locked',
};

const STATUS_ICONS = {
  visited: Check,
  available: Circle,
  locked: Lock,
} as const;

export interface PathViewProps {
  node: PathNode;
  /**
   * The root presentation's pages, used to resolve each referenced id to its
   * display metadata. A Path only references root Scroll pages; unresolved ids
   * fall back to the raw id so a malformed reference is still visible.
   */
  pathPages?: readonly PageNode[];
  /**
   * Persisted state per page id. Only `visited` is consulted, so Path adds no
   * state of its own and never persists anything.
   */
  pageStates?: Record<string, PlayerPageState>;
  /**
   * Opens a referenced page through the presentation's existing page switching.
   * When absent the whole Path renders inert, without offering dead controls;
   * this is the case whenever the surrounding presentation cannot switch pages.
   */
  onNavigatePathPage?: (pageId: string) => void;
}

/**
 * Renders an ordered Path as a compact list of references to existing root
 * pages. Each entry shows the page title, its optional description and its
 * visited/available/locked status. Visited and available entries are buttons
 * that switch to the page; locked entries are visible but disabled. No page
 * content is rendered here — only the reference list.
 */
export function PathView({
  node,
  pathPages = [],
  pageStates = {},
  onNavigatePathPage,
}: PathViewProps) {
  const pagesById = new Map(pathPages.map((page) => [page.id, page]));
  const visited = node.pageIds.map((id) => pageStates[id]?.visited === true);

  return (
    <nav aria-label='Path' data-slot='path' className='not-prose my-4'>
      <ol className='flex flex-col gap-2'>
        {node.pageIds.map((id, index) => {
          const page = pagesById.get(id);
          const status = pathPageStatus(index, visited);
          return (
            <li key={id}>
              <PathEntry
                title={page?.metadata.title ?? id}
                description={page?.metadata.description}
                status={status}
                disabled={
                  status === 'locked' || onNavigatePathPage === undefined
                }
                onOpen={
                  onNavigatePathPage ? () => onNavigatePathPage(id) : undefined
                }
              />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function PathEntry({
  title,
  description,
  status,
  disabled,
  onOpen,
}: {
  title: string;
  description?: string;
  status: PathPageStatus;
  disabled: boolean;
  onOpen?: () => void;
}) {
  const Icon = STATUS_ICONS[status];

  return (
    <button
      type='button'
      data-path-entry
      data-path-status={status}
      disabled={disabled}
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm transition-colors outline-none',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:border-primary/50 hover:bg-muted',
      )}
    >
      <Icon
        aria-hidden='true'
        className='size-4 shrink-0 text-muted-foreground'
      />
      <span className='flex min-w-0 flex-col'>
        <span className='font-medium text-card-foreground'>{title}</span>
        {description ? (
          <span data-path-description className='text-sm text-muted-foreground'>
            {description}
          </span>
        ) : null}
      </span>
      <span className='ml-auto shrink-0 text-xs font-medium text-muted-foreground'>
        {STATUS_LABELS[status]}
      </span>
    </button>
  );
}
