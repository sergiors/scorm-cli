import { ExpandedQuestionnaire } from './ExpandedQuestionnaire'
import { StepperQuestionnaire } from './StepperQuestionnaire'

import type { QuestionnaireNode } from '../types'
export type { QuestionNode } from '../types'

export function QuestionnaireView({ node }: { node: QuestionnaireNode }) {
  if (node.questions.length === 0) {
    return null
  }

  if (node.expanded === true) {
    return <ExpandedQuestionnaire node={node} />
  }

  return <StepperQuestionnaire node={node} />
}
