import { Check, Circle, Lock, type LucideIcon } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { PageNode, PathNode, PlayerPageState } from '../types'
import type { MessageId } from '../lib/messages'
import { getSequentialAccess } from '../lib/content-helpers'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from './ui/item'

/**
 * The state of a single Path entry, derived from the shared sequential access
 * policy applied to the root page order. A visited entry is `visited`, the
 * first not-done entry after the done prefix is `available`, and everything
 * beyond it is `locked`, so a learner can revisit or advance one step but never
 * skip ahead.
 */
export type PathPageStatus = 'visited' | 'available' | 'locked'

/**
 * The icon and localized message id for each entry status. Kept as a single
 * exhaustively-typed record so the two mappings can never drift apart and a new
 * status cannot be added without providing both.
 */
const PATH_PAGE_STATUS = {
  visited: { icon: Check, message: 'path.visited' },
  available: { icon: Circle, message: 'path.available' },
  locked: { icon: Lock, message: 'path.locked' }
} as const satisfies Record<PathPageStatus, { icon: LucideIcon; message: MessageId }>

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

  // Status is derived from the shared sequential access policy over the root
  // page order, so a Path entry is only available once the presentation itself
  // would allow reaching it.
  const pageIds = pathPages.map((page) => page.id)
  const done = new Set(pageIds.filter((id) => pageStates[id]?.completed === true))
  const reached = new Set(
    pageIds.filter((id) => pageStates[id]?.completed === true || pageStates[id]?.visited === true)
  )
  const { accessible } = getSequentialAccess(pageIds, done, reached)

  const statusOf = (id: string): PathPageStatus => {
    if (pageStates[id]?.visited === true) {
      return 'visited'
    }
    return accessible.has(id) ? 'available' : 'locked'
  }

  return (
    <nav
      aria-label={intl.formatMessage({ id: 'path.label' })}
      data-slot="path"
      className="not-prose space-y-2.5"
    >
      {node.pageIds.map((id) => {
        const page = pagesById.get(id)
        const status = statusOf(id)

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
  const { icon: Icon, message } = PATH_PAGE_STATUS[status]
  const intl = useIntl()
  const label = intl.formatMessage({ id: message })

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
