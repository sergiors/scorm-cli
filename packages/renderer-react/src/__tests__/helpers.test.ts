import { describe, expect, it } from 'vitest';
import {
  collectQuestionnaireIds,
  collectQuestionnaires,
  getPresentationNodes,
  isPackageComplete,
} from '../../app/lib/content-helpers';
import type { ContentNode, QuestionnaireNode } from '../../app/types';
import {
  gridPackage,
  makeEmptyGridPackage,
  makeEmptyPackage,
  questionnaireNode,
  scrollPackage,
} from './fixtures';

describe('getPresentationNodes', () => {
  it('returns the pages of a scroll presentation in document order', () => {
    expect(getPresentationNodes(scrollPackage).map((node) => node.id)).toEqual([
      'page:intro.mdx',
      'page:setup.mdx',
    ]);
  });

  it('returns the items of a grid presentation in document order', () => {
    expect(getPresentationNodes(gridPackage).map((node) => node.id)).toEqual([
      'item:functions.mdx',
      'item:types.mdx',
      'item:details.mdx',
    ]);
  });

  it('returns an empty list for an empty presentation', () => {
    expect(getPresentationNodes(makeEmptyPackage())).toEqual([]);
    expect(getPresentationNodes(makeEmptyGridPackage())).toEqual([]);
  });
});

describe('isPackageComplete', () => {
  it('is false until every page has been visited', () => {
    expect(isPackageComplete(scrollPackage, ['page:intro.mdx'])).toBe(false);
  });

  it('is true once every page has been visited', () => {
    expect(
      isPackageComplete(scrollPackage, ['page:intro.mdx', 'page:setup.mdx']),
    ).toBe(true);
  });

  it('tracks grid items the same way', () => {
    expect(isPackageComplete(gridPackage, ['item:functions.mdx'])).toBe(false);
    expect(
      isPackageComplete(gridPackage, [
        'item:functions.mdx',
        'item:types.mdx',
        'item:details.mdx',
      ]),
    ).toBe(true);
  });

  it('is false for an empty package', () => {
    expect(isPackageComplete(makeEmptyPackage(), [])).toBe(false);
    expect(isPackageComplete(makeEmptyGridPackage(), [])).toBe(false);
  });
});

describe('collectQuestionnaireIds', () => {
  it('returns no ids when no questionnaire is present', () => {
    expect(
      collectQuestionnaireIds([
        { type: 'paragraph', children: [{ type: 'text', value: 'Plain' }] },
      ]),
    ).toEqual([]);
  });

  it('collects the id of a top-level questionnaire', () => {
    const nodes: ContentNode[] = [questionnaireNode];
    expect(collectQuestionnaireIds(nodes)).toEqual([questionnaireNode.id]);
  });

  it('skips tight inline runs but still traverses sibling blocks', () => {
    const nodes: ContentNode[] = [
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'Before' }],
              },
              questionnaireNode,
            ],
          },
        ],
      },
    ];
    expect(collectQuestionnaireIds(nodes)).toEqual([questionnaireNode.id]);
  });

  it('recurses through lists and quotes in document order', () => {
    const nested: QuestionnaireNode = {
      type: 'questionnaire',
      id: 'questionnaire:nested.mdx:1:1',
      questions: [questionnaireNode.questions[0]],
    };
    const nodes: ContentNode[] = [
      {
        type: 'list',
        ordered: false,
        items: [{ children: [questionnaireNode] }],
      },
      {
        type: 'quote',
        children: [nested],
      },
    ];
    expect(collectQuestionnaireIds(nodes)).toEqual([
      questionnaireNode.id,
      nested.id,
    ]);
  });
});

describe('collectQuestionnaires', () => {
  it('returns the questionnaire nodes themselves, not just their ids', () => {
    const nodes: ContentNode[] = [questionnaireNode];
    expect(collectQuestionnaires(nodes)).toEqual([questionnaireNode]);
  });

  it('returns an empty list for content without questionnaires', () => {
    expect(
      collectQuestionnaires([
        { type: 'paragraph', children: [{ type: 'text', value: 'Plain' }] },
      ]),
    ).toEqual([]);
  });
});
