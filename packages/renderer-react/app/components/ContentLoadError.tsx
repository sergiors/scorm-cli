import { FormattedMessage } from 'react-intl'
import { Button } from './ui/button'

/**
 * The shared retry affordance for a page or item whose lazily loaded module
 * failed to load. Each presentation supplies its own layout container; this owns
 * only the localized message and the retry action, so a failed module is never
 * silently rendered as empty content and the wording stays consistent across
 * presentations.
 */
export function ContentLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <FormattedMessage id="content.loadError" />
      </p>
      <Button type="button" variant="outline" onClick={onRetry}>
        <FormattedMessage id="content.retry" />
      </Button>
    </>
  )
}
