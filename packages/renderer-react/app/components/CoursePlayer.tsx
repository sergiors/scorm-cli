import { BookOpen, ChevronLeft, ChevronRight, ListTree } from 'lucide-react';
import { useState } from 'react';
import type { Course } from '../types';
import {
  addVisited,
  getAdjacentItems,
  getCourseItems,
  isCourseComplete,
} from '../lib/course-helpers';
import { useCourseRuntime } from '../lib/use-course-runtime';
import { CompletionNotice } from './CompletionNotice';
import { ContentRenderer } from './ContentRenderer';
import { CourseNavigation } from './CourseNavigation';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

export interface CoursePlayerProps {
  course: Course;
}

export function CoursePlayer({ course }: CoursePlayerProps) {
  const items = getCourseItems(course);
  const firstItemId = items[0]?.id;
  const [currentItemId, setCurrentItemId] = useState<string | undefined>(
    firstItemId,
  );
  const [visited, setVisited] = useState<Set<string>>(() =>
    firstItemId ? new Set([firstItemId]) : new Set(),
  );

  const adjacent = getAdjacentItems(items, currentItemId);
  const currentItem = adjacent.index >= 0 ? items[adjacent.index] : undefined;
  const complete = isCourseComplete(course, visited);

  useCourseRuntime(complete);

  const selectItem = (itemId: string) => {
    setCurrentItemId(itemId);
    setVisited((previous) => addVisited(previous, itemId));
  };

  return (
    <div className='min-h-screen bg-background text-foreground'>
      <a
        href='#course-content'
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
                {course.metadata.title}
              </h1>
            </div>
            {complete ? <Badge variant='success'>Completed</Badge> : null}
          </div>
          {course.metadata.description ? (
            <p className='max-w-3xl text-sm text-muted-foreground'>
              {course.metadata.description}
            </p>
          ) : null}
        </div>
      </header>

      <div className='mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[300px_1fr]'>
        <details className='rounded-lg border border-border bg-card p-4 lg:hidden'>
          <summary className='flex cursor-pointer items-center gap-2 font-medium'>
            <ListTree aria-hidden='true' className='size-4' />
            Course contents
          </summary>
          <nav aria-label='Course navigation' className='mt-4'>
            <CourseNavigation
              nodes={course.children}
              currentItemId={currentItemId}
              visited={visited}
              onSelect={selectItem}
            />
          </nav>
        </details>

        <aside className='hidden lg:block'>
          <nav aria-label='Course navigation' className='sticky top-6'>
            <CourseNavigation
              nodes={course.children}
              currentItemId={currentItemId}
              visited={visited}
              onSelect={selectItem}
            />
          </nav>
        </aside>

        <main id='course-content' tabIndex={-1} className='min-w-0 space-y-6'>
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
              This course does not contain any items.
            </p>
          )}

          {complete ? <CompletionNotice complete={complete} /> : null}

          <div className='flex items-center justify-between gap-3 border-t border-border pt-4'>
            <Button
              type='button'
              variant='outline'
              onClick={() =>
                adjacent.previous && selectItem(adjacent.previous.id)
              }
              disabled={!adjacent.previous}
            >
              <ChevronLeft aria-hidden='true' />
              Previous
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => adjacent.next && selectItem(adjacent.next.id)}
              disabled={!adjacent.next}
            >
              Next
              <ChevronRight aria-hidden='true' />
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
