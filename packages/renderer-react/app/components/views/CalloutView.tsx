import {
  Info,
  Lightbulb,
  OctagonAlert,
  StickyNote,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import type { CalloutVariant } from '../../types'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import type { ContentNodeViewProps } from './types'

const CALLOUT_VARIANTS = {
  note: {
    icon: StickyNote,
    surface: 'border-border bg-muted/40 text-muted-foreground'
  },
  info: {
    icon: Info,
    surface: 'border-sky-500/30 bg-sky-500/5 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400'
  },
  tip: {
    icon: Lightbulb,
    surface:
      'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
  },
  warning: {
    icon: TriangleAlert,
    surface:
      'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
  },
  danger: {
    icon: OctagonAlert,
    surface: 'border-destructive/30 bg-destructive/5 text-destructive dark:bg-destructive/10'
  }
} as const satisfies Record<CalloutVariant, { icon: LucideIcon; surface: string }>

export function CalloutView({ node, path, renderNodes }: ContentNodeViewProps<'callout'>) {
  const { icon: Icon, surface } = CALLOUT_VARIANTS[node.variant]

  return (
    <Alert role="note" data-slot="callout" data-variant={node.variant} className={surface}>
      <Icon aria-hidden="true" />
      {node.title ? <AlertTitle className="mb-2.5">{node.title}</AlertTitle> : null}
      <AlertDescription className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 overflow-x-auto">
        {renderNodes(node.children, path)}
      </AlertDescription>
    </Alert>
  )
}
