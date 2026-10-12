import { Check, Circle, Lock } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { PageNode, PathNode, PlayerPageState } from '../types'
import type { MessageId } from '../lib/messages'
import { cn } from '../lib/utils'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from './ui/item'

/**
 * The state of a single Path entry, derived from the visited flags of the
 * referenced pages in Path order. A Path uses contiguous-prefix progression:
 * any visited entry stays open, and exactly the first entry after the longest
 * run of visited entries from the start is available. Everything beyond that
 * next entry is locked, so a learner can revisit or advance one step, but never
 * skip ahead — and a gap in the visited prefix gates the rest of the Path.
 */
export type PathPageStatus = 'visited' | 'available' | 'locked'

/**
 * Whether the Path entry at `index` may be opened, given the `visited` flags of
 * the referenced pages in Path order. The policy is contiguous-prefix
 * progression: every visited entry stays open, and the only unvisited entry
 * that opens is the first one after the longest visited run from the start
 * (which makes the first entry available on a fresh package). A gap in that
 * prefix locks everything after it.
 *
 * It is a pure lookup: callers supply the flags already resolved from
 * `PlayerPageState.visited`, so the decision reuses the existing per-page state
 * without adding any of its own.
 */
export function canOpenPathPage(index: number, visited: readonly boolean[]): boolean {
  if (visited[index]) {
    return true
  }

  let prefix = 0
  while (visited[prefix]) {
    prefix += 1
  }
  return index === prefix
}

function pathPageStatus(index: number, visited: readonly boolean[]): PathPageStatus {
  if (visited[index]) {
    return 'visited'
  }

  return canOpenPathPage(index, visited) ? 'available' : 'locked'
}

const STATUS_ICONS = {
  visited: Check,
  available: Circle,
  locked: Lock
} as const

/** Message id for each entry status, kept in sync with the icon registry. */
const STATUS_MESSAGES = {
  visited: 'path.visited',
  available: 'path.available',
  locked: 'path.locked'
} as const satisfies Record<PathPageStatus, MessageId>

export interface PathViewProps {
  node: PathNode

  /**
   * The root presentation's pages, used to resolve each referenced id to its
   * display metadata. A Path only references root Scroll pages; unresolved ids
   * fall back to the raw id so a malformed reference is still visible.
   */
  pathPages?: readonly PageNode[]

  /**
   * Persisted state per page id. Only `visited` is consulted, so Path adds no
   * state of its own and never persists anything.
   */
  pageStates?: Record<string, PlayerPageState>

  /**
   * Opens a referenced page through the presentation's existing page switching.
   * When absent the whole Path renders inert, without offering dead controls;
   * this is the case whenever the surrounding presentation cannot switch pages.
   */
  onNavigatePathPage?: (pageId: string) => void
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
  onNavigatePathPage
}: PathViewProps) {
  const intl = useIntl()
  const pagesById = new Map(pathPages.map((page) => [page.id, page]))
  const visited = node.pageIds.map((id) => pageStates[id]?.visited === true)

  return (
    <nav
      aria-label={intl.formatMessage({ id: 'path.label' })}
      data-slot="path"
      className="not-prose space-y-2.5"
    >
      {node.pageIds.map((id, index) => {
        const page = pagesById.get(id)
        const status = pathPageStatus(index, visited)

        return (
          <PathEntry
            key={id}
            title={page?.metadata.title ?? id}
            description={page?.metadata.description}
            status={status}
            disabled={status === 'locked' || onNavigatePathPage === undefined}
            onOpen={onNavigatePathPage ? () => onNavigatePathPage(id) : undefined}
          />
        )
      })}
    </nav>
  )
}

function PathEntry({
  title,
  description,
  status,
  disabled,
  onOpen
}: {
  title: string
  description?: string
  status: PathPageStatus
  disabled: boolean
  onOpen?: () => void
}) {
  const Icon = STATUS_ICONS[status]
  const intl = useIntl()
  const label = intl.formatMessage({ id: STATUS_MESSAGES[status] })

  return (
    <Item data-path-entry data-path-status={status} variant="outline" asChild>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="cursor-pointer not-disabled:hover:border-foreground/20 not-disabled:hover:bg-muted/50 disabled:cursor-not-allowed"
      >
        <ItemMedia>
          <Icon aria-hidden="true" className="size-4" />
        </ItemMedia>

        <ItemContent>
          <ItemTitle>{title}</ItemTitle>

          {description ? <ItemDescription>{description}</ItemDescription> : null}
        </ItemContent>

        <ItemActions>{label}</ItemActions>
      </button>
    </Item>
  )
}
