import { useId, useState } from 'react';
import type { ContentNode } from '../types';
import { ContentRenderer } from './ContentRenderer';

export type QuestionNode = Extract<ContentNode, { type: 'question' }>;

export interface QuestionViewProps {
  node: QuestionNode;
  /** Forwarded to nested rich content so headings stay nested correctly. */
  headingOffset?: number;
}

/**
 * Renders a self-study question. Answers are selectable locally so the learner
 * can reflect on them, but nothing is graded, scored or reported; correctness
 * is intentionally not surfaced, and no LMS tracking is implied.
 *
 * The prompt and every option are rich content, so the group's accessible name
 * is provided via `aria-labelledby` referencing the rendered prompt rather than
 * a `<legend>` (which may only contain phrasing content and would be invalid
 * for block prompts).
 */
export function QuestionView({ node, headingOffset = 0 }: QuestionViewProps) {
  const groupId = useId();
  const promptId = useId();
  const multiple = node.questionType === 'multiple-choice';
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (value: string) => {
    setSelected((previous) => {
      if (multiple) {
        return previous.includes(value)
          ? previous.filter((entry) => entry !== value)
          : [...previous, value];
      }
      return [value];
    });
  };

  return (
    <fieldset
      aria-labelledby={promptId}
      className='space-y-3 rounded-lg border border-border bg-card p-4'
    >
      <div
        id={promptId}
        className='space-y-1 text-base font-medium text-foreground'
      >
        <ContentRenderer nodes={node.prompt} headingOffset={headingOffset} />
      </div>

      <div className='space-y-2'>
        {node.options.map((option, index) => {
          const inputId = `${groupId}-${index}`;
          const contentId = `${inputId}-content`;
          return (
            <div key={inputId} className='flex items-start gap-2'>
              <input
                id={inputId}
                name={groupId}
                type={multiple ? 'checkbox' : 'radio'}
                value={option.value}
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                aria-labelledby={contentId}
                className='mt-0.5 size-4 accent-primary'
              />
              <div id={contentId} className='min-w-0 text-sm text-foreground'>
                <ContentRenderer
                  nodes={option.content}
                  headingOffset={headingOffset}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className='text-xs text-muted-foreground'>
        {multiple
          ? 'Select all that apply. This activity is not graded.'
          : 'Select one option. This activity is not graded.'}
      </p>
    </fieldset>
  );
}
