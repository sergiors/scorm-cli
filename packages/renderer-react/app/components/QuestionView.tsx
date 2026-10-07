import { useId, useState } from 'react';
import type { ContentNode } from '../types';

export type QuestionNode = Extract<ContentNode, { type: 'question' }>;

/**
 * Renders a self-study question. Answers are selectable locally so the learner
 * can reflect on them, but nothing is graded, scored or reported; correctness
 * is intentionally not surfaced, and no LMS tracking is implied.
 */
export function QuestionView({ node }: { node: QuestionNode }) {
  const groupId = useId();
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
    <fieldset className='space-y-3 rounded-lg border border-border bg-card p-4'>
      <legend className='px-1 text-base font-medium text-foreground'>
        {node.question}
      </legend>
      <div className='space-y-2'>
        {node.answers.map((answer, index) => {
          const value = String(index);
          const inputId = `${groupId}-${index}`;
          return (
            <div key={inputId} className='flex items-start gap-2'>
              <input
                id={inputId}
                name={groupId}
                type={multiple ? 'checkbox' : 'radio'}
                value={value}
                checked={selected.includes(value)}
                onChange={() => toggle(value)}
                className='mt-0.5 size-4 accent-primary'
              />
              <label htmlFor={inputId} className='text-sm text-foreground'>
                {answer.text}
              </label>
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
