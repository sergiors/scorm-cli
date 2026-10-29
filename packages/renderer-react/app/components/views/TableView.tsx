import { InlineContent } from '../InlineContent'
import { cn } from '../../lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { ContentNodeOf, ContentNodeViewProps } from './types'

const TABLE_CELL_ALIGNMENT = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right'
} as const

/** The prose table keeps semantic markup; only column alignment becomes a class. */
function tableCellAlignment(cell: ContentNodeOf<'table'>['header']['cells'][number]) {
  return cell.align ? TABLE_CELL_ALIGNMENT[cell.align] : undefined
}

/**
 * A Markdown table built from the shared shadcn table primitives. `Table` owns
 * the horizontal overflow wrapper, so a wide table scrolls inside its prose
 * column instead of widening the page; native table semantics and column
 * alignment are preserved, and every cell shares {@link InlineContent}.
 */
export function TableView({ node }: ContentNodeViewProps<'table'>) {
  return (
    <Table className="not-prose pointer-events-none">
      <TableHeader>
        <TableRow>
          {node.header.cells.map((cell, index) => (
            <TableHead
              key={index}
              scope="col"
              className={cn('whitespace-normal', tableCellAlignment(cell))}
            >
              <InlineContent nodes={cell.children} />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {node.rows.map((row, rowIndex) => (
          <TableRow key={rowIndex}>
            {row.cells.map((cell, cellIndex) => (
              <TableCell
                key={cellIndex}
                className={cn('whitespace-normal', tableCellAlignment(cell))}
              >
                <InlineContent nodes={cell.children} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
