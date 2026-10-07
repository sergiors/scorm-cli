import { BookOpen, ChevronLeft, ChevronRight, ListTree } from 'lucide-react';
import { useState } from 'react';
import type { ContentPackage, ItemNode } from '../types';
import {
  addVisited,
  findItem,
  getAdjacentItems,
  getPackageItems,
  isPackageComplete,
} from '../lib/content-helpers';
import { useScormBridge } from '../lib/use-scorm-bridge';
import { CompletionNotice } from './CompletionNotice';
import { ContentRenderer } from './ContentRenderer';
import { PackageOutline } from './PackageOutline';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Modal } from './ui/modal';

export interface PackageViewProps {
  contentPackage: ContentPackage;
}

export function PackageView({ contentPackage }: PackageViewProps) {
  const items = getPackageItems(contentPackage);
  const firstItemId = items[0]?.id;
  const [currentItemId, setCurrentItemId] = useState<string | undefined>(
    firstItemId,
  );
  const [modalItemId, setModalItemId] = useState<string | undefined>(undefined);
  const [visited, setVisited] = useState<Set<string>>(() =>
    firstItemId ? new Set([firstItemId]) : new Set(),
  );

  const adjacent = getAdjacentItems(items, currentItemId);
  const currentItem = adjacent.index >= 0 ? items[adjacent.index] : undefined;
  const modalItem = findItem(items, modalItemId);
  const activeItemId = modalItemId ?? currentItemId;
  const complete = isPackageComplete(contentPackage, visited);

  useScormBridge(complete);

  /**
   * Selecting from the outline or a card honours the item's `presentation.open`:
   * modal items open a dialog and leave the primary content item untouched.
   */
  const selectItem = (item: ItemNode) => {
    setVisited((previous) => addVisited(previous, item.id));
    if (item.presentation.open === 'modal') {
      setModalItemId(item.id);
      return;
    }
    setModalItemId(undefined);
    setCurrentItemId(item.id);
  };

  /**
   * Linear previous/next always advance the primary content item in document
   * order so traversal can reach every item without stalling; open mode only
   * governs selection from the outline and cards.
   */
  const navigateTo = (itemId: string) => {
    setVisited((previous) => addVisited(previous, itemId));
    setModalItemId(undefined);
    setCurrentItemId(itemId);
  };

  const closeModal = () => setModalItemId(undefined);

  return (
    <div className='min-h-screen bg-background text-foreground'>
      <a
        href='#package-content'
        className='sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground'
      >
        Skip to content
      </a>

      <header className='border-b border-border bg-card'>
        <div className='mx-auto flex max-w-6xl flex-col gap-3 p-4 sm:p-6'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='flex items-center gap-3'>
              <BookOpen aria-hidden='true' className='size-6 text-primary' />
              <h1 className='text-xl font-semibold tracking-tight sm:text-2xl'>
                {contentPackage.metadata.title}
              </h1>
            </div>
            {complete ? <Badge variant='success'>Completed</Badge> : null}
          </div>
          {contentPackage.metadata.description ? (
            <p className='max-w-3xl text-sm text-muted-foreground'>
              {contentPackage.metadata.description}
            </p>
          ) : null}
        </div>
      </header>

      <div className='mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[300px_1fr]'>
        <details className='rounded-lg border border-border bg-card p-4 lg:hidden'>
          <summary className='flex cursor-pointer items-center gap-2 font-medium'>
            <ListTree aria-hidden='true' className='size-4' />
            Package contents
          </summary>
          <nav aria-label='Package navigation' className='mt-4'>
            <PackageOutline
              nodes={contentPackage.children}
              currentItemId={activeItemId}
              visited={visited}
              onSelect={selectItem}
            />
          </nav>
        </details>

        <aside className='hidden lg:block'>
          <nav aria-label='Package navigation' className='sticky top-6'>
            <PackageOutline
              nodes={contentPackage.children}
              currentItemId={activeItemId}
              visited={visited}
              onSelect={selectItem}
            />
          </nav>
        </aside>

        <main id='package-content' tabIndex={-1} className='min-w-0 space-y-6'>
          {currentItem ? (
            <article className='space-y-4'>
              <header className='space-y-1'>
                <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  Item {adjacent.index + 1} of {items.length}
                </p>
                <h2 className='text-2xl font-semibold tracking-tight'>
                  {currentItem.metadata.title}
                </h2>
                {currentItem.metadata.description ? (
                  <p className='text-sm text-muted-foreground'>
                    {currentItem.metadata.description}
                  </p>
                ) : null}
              </header>

              <ContentRenderer nodes={currentItem.content} headingOffset={2} />
            </article>
          ) : (
            <p className='text-sm text-muted-foreground'>
              This package does not contain any items.
            </p>
          )}

          {complete ? <CompletionNotice complete={complete} /> : null}

          <div className='flex items-center justify-between gap-3 border-t border-border pt-4'>
            <Button
              type='button'
              variant='outline'
              onClick={() =>
                adjacent.previous && navigateTo(adjacent.previous.id)
              }
              disabled={!adjacent.previous}
            >
              <ChevronLeft aria-hidden='true' />
              Previous
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => adjacent.next && navigateTo(adjacent.next.id)}
              disabled={!adjacent.next}
            >
              Next
              <ChevronRight aria-hidden='true' />
            </Button>
          </div>
        </main>
      </div>

      <Modal
        open={modalItem !== undefined}
        onClose={closeModal}
        title={modalItem?.metadata.title ?? ''}
        description={modalItem?.metadata.description}
      >
        {modalItem ? (
          <ContentRenderer nodes={modalItem.content} headingOffset={2} />
        ) : null}
      </Modal>
    </div>
  );
}
