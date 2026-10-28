import * as React from 'react'
import { cn } from 'cn'
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

type AccordionValueInput = string | string[] | undefined

/** Normalizes the public single/multiple value API to Base UI's array value. */
function toValues(value: AccordionValueInput): string[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

/** Single mode keeps only one value, matching Radix's string value shape. */
function toSingleValues(value: AccordionValueInput): string[] | undefined {
  const single = Array.isArray(value) ? value[0] : value
  return single === undefined ? undefined : [single]
}

function Accordion({
  className,
  type = 'single',
  collapsible = false,
  value,
  defaultValue,
  onValueChange,
  ...props
}: Omit<
  AccordionPrimitive.Root.Props<string>,
  'value' | 'defaultValue' | 'multiple' | 'onValueChange'
> & {
  type?: 'single' | 'multiple'
  collapsible?: boolean
  value?: AccordionValueInput
  defaultValue?: AccordionValueInput
  onValueChange?: (value: string | string[]) => void
}) {
  const multiple = type === 'multiple'

  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('flex w-full flex-col overflow-hidden rounded-2xl border', className)}
      multiple={multiple}
      value={multiple ? toValues(value) : toSingleValues(value)}
      defaultValue={multiple ? toValues(defaultValue) : toSingleValues(defaultValue)}
      onValueChange={(nextValue, eventDetails) => {
        // Base UI accordions are always collapsible. Radix's non-collapsible
        // single mode instead keeps the open item open, so cancel the close and
        // leave the internal value unchanged.
        if (!multiple && !collapsible && nextValue.length === 0) {
          eventDetails.cancel()
          return
        }

        onValueChange?.(multiple ? nextValue : (nextValue[0] ?? ''))
      }}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('not-last:border-b data-open:bg-muted/50', className)}
      {...props}
    />
  )
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'group/accordion-trigger relative flex flex-1 items-start justify-between gap-6 border border-transparent p-4 text-left text-sm font-medium transition-all outline-none hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground',
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
        />
        <ChevronUpIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="overflow-hidden px-4 text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
      {...props}
    >
      <div
        className={cn(
          'h-(--accordion-panel-height) pt-0 pb-4 data-ending-style:h-0 data-starting-style:h-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
