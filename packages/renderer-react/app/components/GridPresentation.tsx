import { useState, type CSSProperties } from 'react';
import type { AnswerValue, ItemNode, PlayerPageState } from '../types';
import { cn } from '../lib/utils';
import { ContentRenderer } from './ContentRenderer';
import { Card, CardHeader, CardTitle } from './ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/**
 * Grid column counts are authored (1-12), so the count travels as a CSS custom
 * property and a single static class carries the responsive rule. On narrow
 * viewports the grid collapses to a single column.
 */
const GRID_COLUMNS_CLASS =
  'sm:grid-cols-[repeat(var(--grid-columns),minmax(0,1fr))]';

function gridStyle(columns: number | undefined): CSSProperties {
  const safe = Math.min(12, Math.max(1, Math.trunc(columns ?? 2)));
  return { '--grid-columns': safe } as CSSProperties;
}

export interface GridPresentationProps {
  items: ItemNode[];
  /** Authored column count; a layout intent, not a hard constraint. */
  columns?: number;
  /** Persisted state per item id, for restoring answers and submitted state. */
  pageStates: Record<string, PlayerPageState>;
  /**
   * Item id named by the saved lesson location. When it matches an item, that
   * item's dialog reopens on mount so a refresh resumes in the same place.
   */
  initialItemId?: string;
  /** Stores an item as the current location and marks it visited. */
  onItemOpened: (id: string) => void;
  /** Persists a question answer for the opened item. */
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void;
  /** Marks a questionnaire on the opened item as submitted. */
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void;
}

/**
 * Renders the authored items as cards in a responsive grid. Selecting a card
 * opens that item's content in a dialog; there is no inline item content and,
 * as with the scroll presentation, no package chrome.
 */
export function GridPresentation({
  items,
  columns,
  pageStates,
  initialItemId,
  onItemOpened,
  onAnswer,
  onQuestionnaireSubmitted,
}: GridPresentationProps) {
  const [selected, setSelected] = useState<ItemNode | undefined>(() =>
    items.find((item) => item.id === initialItemId),
  );
  const [open, setOpen] = useState(() =>
    items.some((item) => item.id === initialItemId),
  );

  const openItem = (item: ItemNode) => {
    setSelected(item);
    setOpen(true);
    onItemOpened(item.id);
  };

  const pageState = selected ? pageStates[selected.id] : undefined;

  return (
    <>
      <div
        role='list'
        style={gridStyle(columns)}
        className={cn('grid grid-cols-1 gap-4 p-6', GRID_COLUMNS_CLASS)}
      >
        {items.map((item) => (
          <ItemCard key={item.id} item={item} onOpen={() => openItem(item)} />
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className='max-h-[85dvh] overflow-y-auto sm:max-w-2xl'
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{selected?.metadata.title}</DialogTitle>
            {selected ? (
              <DialogDescription className='sr-only'>
                Content for {selected.metadata.title}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {selected ? (
            <ContentRenderer
              nodes={selected.content}
              headingOffset={2}
              answers={pageState?.answers}
              submittedQuestionnaires={pageState?.submittedQuestionnaires}
              onAnswer={(questionId, value) =>
                onAnswer(selected.id, questionId, value)
              }
              onQuestionnaireSubmitted={(id) =>
                onQuestionnaireSubmitted(selected.id, id)
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ItemCard({ item, onOpen }: { item: ItemNode; onOpen: () => void }) {
  return (
    <Card
      role='listitem'
      className='group/card relative h-full transition-colors hover:border-primary/50 has-[button:focus-visible]:border-primary/50 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring/40'
    >
      <CardHeader>
        <CardTitle className='text-base'>
          <button
            type='button'
            onClick={onOpen}
            className="text-start outline-none after:absolute after:inset-0 after:content-['']"
          >
            {item.metadata.title}
          </button>
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
