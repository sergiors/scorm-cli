import { ExpandedQuestionnaire } from './ExpandedQuestionnaire'
import { StepperQuestionnaire } from './StepperQuestionnaire'

import type { QuestionnaireViewProps } from './QuestionnaireShared'
export type { QuestionNode } from '../types'

export function QuestionnaireView(props: QuestionnaireViewProps) {
  if (props.node.questions.length === 0) {
    return null
  }

  if (props.node.expanded === true) {
    return <ExpandedQuestionnaire {...props} />
  }

  return <StepperQuestionnaire {...props} />
}
