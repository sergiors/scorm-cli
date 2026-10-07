import type { Course } from '@scorm-cli/core';

export const sampleCourse: Course = {
  metadata: {
    title: 'Rendering Fundamentals',
    description: 'A short course used by the renderer test suite.',
  },
  children: [
    {
      type: 'section',
      id: 'getting-started',
      title: 'Getting started',
      presentation: { layout: 'list' },
      children: [
        {
          type: 'item',
          id: 'intro',
          source: 'intro.mdx',
          metadata: {
            title: 'Introduction',
            description: 'What this course covers.',
            thumbnail: './assets/thumb.svg',
          },
          content: [
            { type: 'heading', depth: 2, text: 'Welcome' },
            { type: 'paragraph', text: 'This is an introduction paragraph.' },
            {
              type: 'list',
              ordered: false,
              items: ['First point', 'Second point'],
            },
            {
              type: 'link',
              href: 'https://example.com/docs',
              text: 'Read the docs',
            },
            {
              type: 'image',
              src: './assets/thumb.svg',
              alt: 'Course thumbnail',
            },
            {
              type: 'video',
              src: './assets/lesson.mp4',
              title: 'Lesson video',
            },
            {
              type: 'question',
              questionType: 'single-choice',
              question: 'Which option is correct?',
              answers: [
                { text: 'Option A', correct: true },
                { text: 'Option B', correct: false },
              ],
            },
            {
              type: 'question',
              questionType: 'multiple-choice',
              question: 'Which options apply?',
              answers: [
                { text: 'Choice 1', correct: true },
                { text: 'Choice 2', correct: true },
                { text: 'Choice 3', correct: false },
              ],
            },
            { type: 'code', value: 'const answer = 42;', language: 'ts' },
            { type: 'quote', text: 'Simplicity is the soul of efficiency.' },
          ],
        },
      ],
    },
    {
      type: 'section',
      id: 'media',
      title: 'Media',
      presentation: { layout: 'grid', columns: 2 },
      children: [
        {
          type: 'item',
          id: 'setup',
          source: 'setup.mdx',
          metadata: {
            title: 'Setting things up',
            thumbnail: './assets/setup.svg',
          },
          content: [{ type: 'paragraph', text: 'Setup instructions.' }],
        },
        {
          type: 'item',
          id: 'wrap-up',
          source: 'wrap-up.mdx',
          metadata: { title: 'Wrap up' },
          content: [{ type: 'paragraph', text: 'Final words.' }],
        },
      ],
    },
  ],
};

export function makeEmptyCourse(): Course {
  return {
    metadata: { title: 'Empty course' },
    children: [],
  };
}
