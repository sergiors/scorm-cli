import type { CalloutNode, CalloutVariant } from '@scorm-cli/core'
import type { AstNode } from './ast'
import type { ComponentParseContext } from './components'
import { attrs, assertAttributes, optionalString, sourceLocation } from './shared'

const calloutVariants: readonly CalloutVariant[] = ['note', 'info', 'tip', 'warning', 'danger']

function isCalloutVariant(value: unknown): value is CalloutVariant {
  return typeof value === 'string' && calloutVariants.includes(value as CalloutVariant)
}

export async function parseCallout(
  node: AstNode,
  context: ComponentParseContext
): Promise<CalloutNode> {
  const file = context.source.sourceFile
  const values = attrs(node, file)
  assertAttributes(values, ['variant', 'title'], file, node)

  const variant = values.variant ?? 'note'
  if (!isCalloutVariant(variant)) {
    throw new Error(
      `${sourceLocation(file, node)}: Callout "variant" must be "note", "info", "tip", "warning", or "danger"`
    )
  }

  const title = optionalString(values.title, 'title', file, node)

  return {
    type: 'callout',
    variant,
    ...(title === undefined ? {} : { title }),
    children: await context.convertContent(node.children ?? [])
  }
}
