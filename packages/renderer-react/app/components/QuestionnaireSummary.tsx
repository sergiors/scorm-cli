import { useId } from 'react'
import type { ReactNode } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { Card, CardContent } from './ui/card'

export interface QuestionnaireSummaryProps {
  correct: number
  total: number
  children?: ReactNode
}

function QuestionnaireProgressCircle({ percentage }: { percentage: number }) {
  const intl = useIntl()
  const radius = 42
  const circumference = 2 * Math.PI * radius

  return (
    <div className="relative grid size-28 shrink-0 place-items-center">
      <svg
        viewBox="0 0 100 100"
        role="progressbar"
        aria-label={intl.formatMessage({
          id: 'questionnaire.summaryProgressLabel'
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        className="size-full -rotate-90"
      >
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />

        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percentage / 100)}
          className="stroke-primary"
        />
      </svg>

      <span
        aria-hidden="true"
        className="absolute text-2xl font-semibold tracking-tight tabular-nums"
      >
        {intl.formatNumber(percentage / 100, { style: 'percent' })}
      </span>
    </div>
  )
}

export function QuestionnaireSummary({ correct, total, children }: QuestionnaireSummaryProps) {
  const titleId = useId()
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0

  return (
    <Card data-slot="questionnaire-summary" aria-labelledby={titleId} className="not-prose">
      <CardContent className="flex flex-col gap-4 items-center justify-center">
        <QuestionnaireProgressCircle percentage={percentage} />

        <div className="space-y-1.5 text-center">
          <h2 id={titleId} className="text-sm font-semibold">
            <FormattedMessage id="questionnaire.summaryTitle" />
          </h2>

          <p className="text-sm text-muted-foreground">
            <FormattedMessage id="questionnaire.summaryCorrect" values={{ correct, total }} />
          </p>
        </div>

        {children}
      </CardContent>
    </Card>
  )
}
