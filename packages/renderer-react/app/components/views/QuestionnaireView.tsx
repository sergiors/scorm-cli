import { ExpandedQuestionnaire } from '../questionnaire/ExpandedQuestionnaire'
import { StepperQuestionnaire } from '../questionnaire/StepperQuestionnaire'
import { readingAnchorAttributes } from '../../lib/reading-anchors'
import type { ContentNodeRenderContext } from './types'

import type { QuestionnaireNode } from '../../types'
import type { ReadingAnchor } from '../../lib/reading-anchors'
export type { QuestionNode } from '../../types'

export function QuestionnaireView({
  node,
  anchor,
  context
}: {
  node: QuestionnaireNode
  /** @internal Supplied by the content renderer so the block can own an anchor. */
  anchor?: ReadingAnchor
  /**
   * @internal The surrounding content renderer's context. Present only when
   * the view is dispatched as a block from the registry, which owns the block
   * wrapper even for an empty questionnaire; a direct consumer renders the
   * questionnaire alone, or nothing when it has no questions.
   */
  context?: ContentNodeRenderContext
}) {
  const questionnaire =
    node.questions.length === 0 ? null : node.expanded === true ? (
      <ExpandedQuestionnaire node={node} />
    ) : (
      <StepperQuestionnaire node={node} />
    )

  if (context === undefined) {
    return questionnaire
  }

  return (
    <div {...readingAnchorAttributes(anchor)} className="space-y-4 sm:space-y-6">
      {questionnaire}
    </div>
  )
}
