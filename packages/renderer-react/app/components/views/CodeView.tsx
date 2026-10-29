import { CodeIcon } from 'lucide-react'
import { readingAnchorAttributes } from '../../lib/reading-anchors'
import { useHighlightedCode } from '@/hooks/use-highlighted-code'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle
} from '../ui/code-block'
import type { ContentNodeViewProps } from './types'

const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Bash',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown'
}

export function CodeView({ node, anchor }: ContentNodeViewProps<'code'>) {
  const language = node.language?.toLowerCase() ?? ''
  const lines = useHighlightedCode(node.value, language)
  const title = LANGUAGE_LABELS[language] ?? (language || 'Plain text')

  return (
    <div {...readingAnchorAttributes(anchor)}>
      <CodeBlock className="not-prose">
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeIcon /> {title}
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={node.value} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent lineNumbers>
          {lines.map((line, index) => (
            <CodeBlockLine key={index}>{line}</CodeBlockLine>
          ))}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}
