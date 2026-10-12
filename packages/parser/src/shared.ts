import path from 'node:path'
import { isJsx, type AstNode } from './ast'

export function sourceLocation(file: string, node?: AstNode): string {
  const line = node?.position?.start?.line
  const column = node?.position?.start?.column
  return `${file}${line ? `:${line}${column ? `:${column}` : ''}` : ''}`
}

type AttributeValue = string | number | boolean

type Attributes = Record<string, AttributeValue>

export function attrs(node: AstNode, file: string): Attributes {
  const entries = (isJsx(node) ? (node.attributes ?? []) : []).map((attribute) => {
    if (attribute.type !== 'mdxJsxAttribute' || !attribute.name) {
      throw new Error(
        `${sourceLocation(file, node)}: ` + 'spread/dynamic component attributes are not supported'
      )
    }

    return [
      attribute.name,
      parseStaticAttributeValue(attribute.name, attribute.value, file, node)
    ] as const
  })

  return Object.fromEntries(entries)
}

function parseStaticAttributeValue(
  name: string,
  value: unknown,
  file: string,
  node: AstNode
): AttributeValue {
  if (value === null) {
    return true
  }

  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value !== 'object' ||
    !value ||
    !('value' in value) ||
    typeof value.value !== 'string'
  ) {
    throw new Error(
      `${sourceLocation(file, node)}: ` + `dynamic value for attribute "${name}" is not supported`
    )
  }

  if (value.value === 'true') {
    return true
  }

  if (value.value === 'false') {
    return false
  }

  if (/^\d+$/.test(value.value)) {
    return Number(value.value)
  }

  throw new Error(
    `${sourceLocation(file, node)}: ` + `dynamic value for attribute "${name}" is not supported`
  )
}

export function requiredString(value: unknown, name: string, file: string, node: AstNode): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${sourceLocation(file, node)}: "${name}" must be a non-empty string`)
  }

  return value.trim()
}

export function optionalString(
  value: unknown,
  name: string,
  file: string,
  node: AstNode
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requiredString(value, name, file, node)
}

export function canonicalLanguage(value: string | undefined, file: string): string {
  if (value === undefined) {
    return 'en'
  }

  try {
    return Intl.getCanonicalLocales(value)[0]!
  } catch {
    throw new Error(
      `${file}: "lang" must be a valid BCP-47 language tag (for example, "en" or "pt-BR"); received "${value}"`
    )
  }
}

export function assertAttributes(
  values: Record<string, unknown>,
  allowed: string[],
  file: string,
  node: AstNode
) {
  for (const key of Object.keys(values))
    if (!allowed.includes(key))
      throw new Error(`${sourceLocation(file, node)}: unknown attribute "${key}"`)
}

export function assertFrontmatterKeys(
  data: Record<string, unknown>,
  allowed: string[],
  file: string
): void {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      throw new Error(`${sourceLocation(file)}: unknown frontmatter field "${key}"`)
    }
  }
}

/** Whether a path.relative result escapes its root directory. */
export function isOutsideRelativePath(relative: string): boolean {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

export function normalizedRelative(
  root: string,
  absolute: string,
  file: string,
  node: AstNode,
  label: string
): string {
  const rel = path.relative(root, absolute)
  if (!rel || rel === '.') {
    throw new Error(
      `${sourceLocation(file, node)}: ${label} must refer to a file inside the content package directory`
    )
  }

  if (isOutsideRelativePath(rel)) {
    throw new Error(
      `${sourceLocation(file, node)}: ${label} resolves outside the content package directory`
    )
  }

  return rel.split(path.sep).join('/')
}
