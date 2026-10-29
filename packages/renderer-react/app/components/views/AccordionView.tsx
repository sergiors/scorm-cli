import { InlineContent } from '../InlineContent'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion'
import type { ContentNodeViewProps } from './types'

/**
 * A block accordion. Its open state is presentation-only, so the component is
 * deliberately uncontrolled: the authored `defaultOpen` flags become the
 * primitive's default values, and the learner's toggles never reach the player
 * state. Single-open and multiple-open modes are separate Root variants because
 * the wrapper accepts a different value shape for each; `collapsible` is
 * meaningful only for a single-open accordion and is translated to Base UI's
 * always-collapsible behavior.
 *
 * Section bodies recurse through the renderer's nested-list callback with the
 * item index appended to the reading-anchor path, matching the anchor traversal
 * so nested questionnaires, videos, paths and other blocks behave exactly as
 * they do at the page level.
 */
export function AccordionView({ node, path, renderNodes }: ContentNodeViewProps<'accordion'>) {
  const values = node.items.map((_, index) => `item-${index}`)
  const openValues = values.filter((_, index) => node.items[index].defaultOpen)

  const items = node.items.map((item, index) => (
    <AccordionItem key={values[index]} value={values[index]} className="[&>h3]:my-0">
      <AccordionTrigger>
        <InlineContent nodes={item.title} />
      </AccordionTrigger>
      <AccordionContent className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {renderNodes(item.content, [...path, index])}
      </AccordionContent>
    </AccordionItem>
  ))

  if (node.multiple) {
    return (
      <Accordion type="multiple" defaultValue={openValues}>
        {items}
      </Accordion>
    )
  }

  return (
    <Accordion type="single" collapsible={node.collapsible} defaultValue={openValues[0]}>
      {items}
    </Accordion>
  )
}
