// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContentRenderer } from '../../app/components/ContentRenderer'
import { QuestionnaireView } from '../../app/components/views/QuestionnaireView'
import { readingAnchorsForPage } from '../../app/lib/reading-anchors'
import type { QuestionnaireNode } from '../../app/types'
import { questionnaireNode } from './fixtures'

/** An authored questionnaire whose questions were all removed by the parser. */
const emptyQuestionnaire: QuestionnaireNode = {
  ...questionnaireNode,
  id: 'questionnaire:empty.mdx:1:1',
  questions: []
}

describe('an empty questionnaire', () => {
  it('renders nothing when mounted directly outside authored content', () => {
    // Given a direct consumer mounting the questionnaire alone — the way a
    // custom presentation or a preview harness composes blocks — when it has no
    // questions, then the view renders null instead of an empty shell.
    expect(renderToStaticMarkup(<QuestionnaireView node={emptyQuestionnaire} />)).toBe('')
  })

  it('keeps the block wrapper with its reading anchor when dispatched from the registry', () => {
    // Given authored content holding only the empty questionnaire, when the
    // block registry dispatches it on a page with reading anchors, then the
    // questionnaire's block wrapper stays in place: the page's anchor map
    // reserves the block as an anchorable surface even though the
    // questionnaire's body itself stays empty.
    const pageId = 'page:empty-questionnaire.mdx'
    const html = renderToStaticMarkup(
      <ContentRenderer nodes={[emptyQuestionnaire]} readingAnchorPageId={pageId} />
    )

    const anchors = readingAnchorsForPage(pageId, [emptyQuestionnaire])
    const anchorId = anchors.get('0')?.id
    expect(anchorId).toBeDefined()
    expect(html).toContain(`data-reading-anchor="${anchorId}"`)
    expect(html).toContain(`data-reading-anchor-page="${pageId}"`)
    // The spacing wrapper survives so siblings keep their block rhythm...
    expect(html).toMatch(/<div[^>]*space-y-4 sm:space-y-6/)
    // ...and the questionnaire itself contributes no chrome.
    expect(html).not.toContain('data-slot="questionnaire"')
    expect(html).not.toContain('Submit questionnaire')
  })
})