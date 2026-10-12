import path from 'node:path';
import type { QuestionType } from '@scorm-cli/core';

export type AstNode = {
  type: string;
  name?: string | null;
  value?: unknown;
  alt?: string | null;
  url?: string;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  lang?: string | null;
  children?: AstNode[];
  position?: { start?: { line?: number; column?: number } };
  attributes?: Array<{
    type: string;
    name?: string;
    value?: unknown;
    position?: unknown;
  }>;
  data?: {
    estree?: {
      body?: Array<{
        type?: string;
        source?: { value?: unknown };
        specifiers?: Array<{
          type?: string;
          local?: { name?: unknown };
          imported?: { name?: unknown } | null;
        }>;
      }>;
    };
  };
};

function location(file: string, node?: AstNode): string {
  const line = node?.position?.start?.line;
  return `${file}${line ? `:${line}` : ''}`;
}

export function fail(file: string, message: string, node?: AstNode): never {
  throw new Error(`${location(file, node)}: ${message}`);
}

export function attrs(node: AstNode, file: string): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const attr of node.attributes ?? []) {
    if (attr.type !== 'mdxJsxAttribute' || !attr.name) {
      fail(file, 'spread/dynamic component attributes are not supported', node);
    }
    const raw = attr.value;
    if (raw === null) output[attr.name] = true;
    else if (typeof raw === 'string') output[attr.name] = raw;
    else if (raw && typeof raw === 'object' && 'value' in raw) {
      const value = raw.value;
      if (typeof value === 'string' && /^(?:true|false)$/.test(value))
        output[attr.name] = value === 'true';
      else if (typeof value === 'string' && /^\d+$/.test(value)) output[attr.name] = Number(value);
      else fail(file, `dynamic value for attribute "${attr.name}" is not supported`, node);
    } else fail(file, `dynamic value for attribute "${attr.name}" is not supported`, node);
  }
  return output;
}

export function requiredString(value: unknown, name: string, file: string, node: AstNode): string {
  if (typeof value !== 'string' || !value.trim())
    fail(file, `"${name}" must be a non-empty string`, node);
  return value.trim();
}

export function isQuestionType(value: unknown): value is QuestionType {
  return value === 'single-choice' || value === 'multiple-choice' || value === 'true-false';
}

export function optionalString(
  value: unknown,
  name: string,
  file: string,
  node: AstNode,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name, file, node);
}

export function canonicalLanguage(value: string | undefined, file: string): string {
  if (value === undefined) return 'en';
  try {
    return Intl.getCanonicalLocales(value)[0]!;
  } catch {
    throw new Error(
      `${file}: "lang" must be a valid BCP-47 language tag (for example, "en" or "pt-BR"); received "${value}"`,
    );
  }
}

export function assertAttributes(
  values: Record<string, unknown>,
  allowed: string[],
  file: string,
  node: AstNode,
) {
  for (const key of Object.keys(values))
    if (!allowed.includes(key)) fail(file, `unknown attribute "${key}"`, node);
}

export function assertFrontmatterKeys(
  data: Record<string, unknown>,
  allowed: string[],
  file: string,
): void {
  for (const key of Object.keys(data))
    if (!allowed.includes(key)) fail(file, `unknown frontmatter field "${key}"`);
}

export function normalizedRelative(
  root: string,
  absolute: string,
  file: string,
  node: AstNode,
  label: string,
): string {
  const rel = path.relative(root, absolute);
  if (!rel || rel === '.')
    fail(file, `${label} must refer to a file inside the content package directory`, node);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    fail(file, `${label} resolves outside the content package directory`, node);
  }
  return rel.split(path.sep).join('/');
}

export function isJsx(node: AstNode): boolean {
  return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
}

export function whitespace(node: AstNode): boolean {
  return node.type === 'text' && !String(node.value ?? '').trim();
}

export function meaningfulChildren(nodes: AstNode[]): AstNode[] {
  return nodes.filter((node) => !whitespace(node));
}
