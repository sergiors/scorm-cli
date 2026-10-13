import { useState, type CSSProperties } from 'react'
import { Lock } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { AnswerValue, PlayerPageState, ItemNode } from '../types'
import { getSequentialAccess } from '../lib/content-helpers'
import { cn } from '../lib/utils'
import { ContentRenderer } from './ContentRenderer'
import { Button } from './ui/button'
import { Card, CardHeader, CardTitle } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

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
function tileStatuses(
  items: readonly ItemNode[],
  pageStates: Record<string, PlayerPageState>
): TileStatus[] {
  const ids = items.map((item) => item.id)
  const opened = new Set(
    items.filter((item) => pageStates[item.id]?.visited === true).map((item) => item.id)
  )
  const { accessible } = getSequentialAccess(ids, opened)
  return ids.map((id) => (opened.has(id) ? 'opened' : accessible.has(id) ? 'available' : 'locked'))
}

export interface TilesPresentationProps {
  items: ItemNode[]
  /** Authored column count; a layout intent, not a hard constraint. */
  columns?: number
  /** Persisted state per item id, for restoring answers and submitted state. */
  pageStates: Record<string, PlayerPageState>
  /**
   * Item id named by the saved lesson location. When it matches an accessible
   * item, that item's dialog reopens on mount so a refresh resumes in place.
   */
  initialItemId?: string
  /** Stores an item as the current location and marks it opened. */
  onItemOpened: (id: string) => void
  /** Persists a question answer for the opened item. */
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void
  /** Marks a questionnaire on the opened item as submitted. */
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void
  /** Persists a video's semantic playback position in seconds, scoped to the item. */
  onVideoPosition?: (pageId: string, videoId: string, seconds: number) => void
}

/**
 * Renders the authored tiles as cards in a responsive grid. Only tiles the
 * shared sequential progression policy reports as accessible can be opened;
 * locked tiles are visible, marked and rendered as disabled buttons, so they
 * are behaviorally inaccessible (not clickable and not focusable). Selecting an
 * accessible tile opens its content in a dialog — there is no inline tile
 * content and, as with the other presentations, no package chrome.
 */
export function TilesPresentation({
  items,
  columns,
  pageStates,
  initialItemId,
  onItemOpened,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition
}: TilesPresentationProps) {
  const statuses = tileStatuses(items, pageStates)
  const initiallyOpened = items.some(
    (item, index) => item.id === initialItemId && statuses[index] !== 'locked'
  )

  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    initiallyOpened ? initialItemId : undefined
  )
  const [open, setOpen] = useState(initiallyOpened)
  const intl = useIntl()

  const selected = items.find((item) => item.id === selectedId)

  const openTile = (item: ItemNode) => {
    setSelectedId(item.id)
    setOpen(true)
    onItemOpened(item.id)
  }

  const pageState = selected ? pageStates[selected.id] : undefined

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
            <div className="prose">
              <ContentRenderer
                nodes={selected.content}
                answers={pageState?.answers}
                submittedQuestionnaires={pageState?.submittedQuestionnaires}
                onAnswer={(questionId, value) => onAnswer(selected.id, questionId, value)}
                onQuestionnaireSubmitted={(id) => onQuestionnaireSubmitted(selected.id, id)}
                videoPositions={pageState?.videos}
                onVideoPosition={(videoId, seconds) =>
                  onVideoPosition?.(selected.id, videoId, seconds)
                }
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
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
