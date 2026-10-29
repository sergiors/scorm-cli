import { useEffect, useState, type CSSProperties } from 'react'
import { Lock } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { ItemNode } from '../../types'
import { getSequentialAccess } from '../../lib/content-helpers'
import { useContentLoader, type ContentProvider } from '../../lib/content-loader'
import { PageProvider, usePlayerActions, usePlayerState } from '../../lib/player-context'
import { cn } from '../../lib/utils'
import { ContentRenderer } from '../ContentRenderer'
import { ContentLoadError } from '../ContentLoadError'
import { Button } from '../ui/button'
import { Card, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Skeleton } from '../ui/skeleton'

/**
 * Column counts are authored (1-12), so the count travels as a CSS custom
 * property and a single static class carries the responsive rule. On narrow
 * viewports the grid collapses to a single column.
 */
const TILES_COLUMNS_CLASS = 'sm:grid-cols-[repeat(var(--tiles-columns),minmax(0,1fr))]'

function tilesStyle(columns: number | undefined): CSSProperties {
  const safe = Math.min(12, Math.max(1, Math.trunc(columns ?? 2)))
  return { '--tiles-columns': safe } as CSSProperties
}

export type TileStatus = 'opened' | 'available' | 'locked'

/** Derives each tile's status from the shared sequential access policy. */
function tileStatuses(items: readonly ItemNode[], pageStates: Record<string, { visited?: boolean }>): TileStatus[] {
  const ids = items.map((item) => item.id)
  const opened = new Set(
    items.filter((item) => pageStates[item.id]?.visited === true).map((item) => item.id)
  )
  const { accessible } = getSequentialAccess(ids, opened)
  return ids.map((id) => (opened.has(id) ? 'opened' : accessible.has(id) ? 'available' : 'locked'))
}

export interface TilesPresentationProps {
  items: ItemNode[]
  /**
   * The single runtime source of each item's authored content. An item's module
   * is loaded only when the item is opened (or restored as the saved location);
   * a locked item is never requested.
   */
  contentProvider: ContentProvider
  /** Authored column count; a layout intent, not a hard constraint. */
  columns?: number
}

/**
 * Renders the authored tiles as cards in a responsive grid. Only tiles the
 * shared sequential progression policy reports as accessible can be opened;
 * locked tiles are visible, marked and rendered as disabled buttons, so they
 * are behaviorally inaccessible (not clickable and not focusable). Selecting an
 * accessible tile opens its content in a dialog — there is no inline tile
 * content and, as with the other presentations, no package chrome.
 *
 * The card titles and statuses render from the package manifest, so the grid is
 * complete without any item body. An item's own module is loaded only once the
 * item is opened (or reopened from the saved location); while it resolves the
 * dialog keeps its shell and shows a stable skeleton, and a failed load offers a
 * retry rather than an empty dialog.
 */
export function TilesPresentation({
  items,
  contentProvider,
  columns
}: TilesPresentationProps) {
  const state = usePlayerState()
  const pageStates = state.pages
  const onItemOpened = usePlayerActions().markSeen
  const initialItemId = state.location
  const statuses = tileStatuses(items, pageStates)
  const initiallyOpened = items.some(
    (item, index) => item.id === initialItemId && statuses[index] !== 'locked'
  )

  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    initiallyOpened ? initialItemId : undefined
  )
  const [open, setOpen] = useState(initiallyOpened)
  const intl = useIntl()
  const { content, isLoaded, hasError, request, retry } = useContentLoader(contentProvider)

  const selected = items.find((item) => item.id === selectedId)

  // Load the selected item's body on demand — when a card is opened, or on mount
  // for a restored dialog. A locked tile can never become `selectedId`, so its
  // module is never requested.
  useEffect(() => {
    if (selectedId !== undefined) {
      request(selectedId)
    }
  }, [selectedId, request])

  const openTile = (item: ItemNode) => {
    setSelectedId(item.id)
    setOpen(true)
    onItemOpened(item.id)
  }

  return (
    <>
      <div
        role="list"
        style={tilesStyle(columns)}
        className={cn('grid grid-cols-1 gap-4 p-6', TILES_COLUMNS_CLASS)}
      >
        {items.map((item, index) => (
          <TileCard
            key={item.id}
            item={item}
            status={statuses[index] ?? 'locked'}
            onOpen={() => openTile(item)}
          />
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
          aria-describedby={undefined}
          closeLabel={intl.formatMessage({ id: 'dialog.close' })}
        >
          <DialogHeader>
            <DialogTitle>{selected?.metadata.title}</DialogTitle>
            {selected ? (
              <DialogDescription className="sr-only">
                {intl.formatMessage({ id: 'content.for' }, { title: selected.metadata.title })}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {selected ? (
            isLoaded(selected.id) ? (
              <div className="prose">
                <PageProvider pageId={selected.id}>
                  <ContentRenderer nodes={content(selected.id) ?? []} />
                </PageProvider>
              </div>
            ) : hasError(selected.id) ? (
              <ItemLoadError onRetry={() => retry(selected.id)} />
            ) : (
              <ItemSkeleton />
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The stable placeholder shown inside the dialog while an item's module
 * resolves. It is inert (`aria-hidden`) so the loading state is never announced
 * as content, and it keeps the dialog shell and its title unchanged.
 */
function ItemSkeleton() {
  return (
    <div data-item-loading aria-hidden="true" className="space-y-3">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
    </div>
  )
}

/**
 * An item whose module failed to load. The dialog keeps its shell and offers a
 * single retry action rather than presenting a silently empty body.
 */
function ItemLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-item-error className="flex flex-col items-start gap-3">
      <ContentLoadError onRetry={onRetry} />
    </div>
  )
}

function TileCard({
  item,
  status,
  onOpen
}: {
  item: ItemNode
  status: TileStatus
  onOpen: () => void
}) {
  const intl = useIntl()
  const locked = status === 'locked'

  return (
    <Card
      role="listitem"
      data-tile
      data-tile-status={status}
      className="group/card relative h-full transition-colors has-[button:not(:disabled):focus-visible]:border-primary/50 has-[button:not(:disabled):focus-visible]:ring-2 has-[button:not(:disabled):focus-visible]:ring-ring/40"
    >
      <CardHeader>
        <CardTitle className="text-base">
          <Button
            type="button"
            variant="ghost"
            onClick={onOpen}
            disabled={locked}
            aria-disabled={locked}
            className={cn(
              'h-auto w-full justify-start gap-0 rounded-none border-0 bg-transparent p-0 text-start text-base leading-none font-semibold tracking-tight whitespace-normal',
              locked
                ? 'cursor-not-allowed text-muted-foreground'
                : 'text-card-foreground hover:bg-transparent hover:text-card-foreground dark:hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 active:not-aria-[haspopup]:translate-y-0 after:absolute after:inset-0 after:content-[""]'
            )}
          >
            {locked ? (
              <>
                <Lock aria-hidden="true" className="me-2 size-4 shrink-0" />
                <span className="sr-only">{intl.formatMessage({ id: 'tiles.locked' })}</span>
              </>
            ) : null}
            {item.metadata.title}
          </Button>
        </CardTitle>
      </CardHeader>
    </Card>
  )
}
