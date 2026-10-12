import path from 'node:path';
import type { QuestionType } from '@scorm-cli/core';
import type { AstNode } from './ast';

export function sourceLocation(file: string, node?: AstNode): string {
  const line = node?.position?.start?.line;
  return `${file}${line ? `:${line}` : ''}`;
}

export function attrs(node: AstNode, file: string): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const attr of node.attributes ?? []) {
    if (attr.type !== 'mdxJsxAttribute' || !attr.name) {
      throw new Error(
        `${sourceLocation(file, node)}: spread/dynamic component attributes are not supported`,
      );
    }
    const raw = attr.value;
    if (raw === null) output[attr.name] = true;
    else if (typeof raw === 'string') output[attr.name] = raw;
    else if (raw && typeof raw === 'object' && 'value' in raw) {
      const value = raw.value;
      if (typeof value === 'string' && /^(?:true|false)$/.test(value))
        output[attr.name] = value === 'true';
      else if (typeof value === 'string' && /^\d+$/.test(value)) output[attr.name] = Number(value);
      else
        throw new Error(
          `${sourceLocation(file, node)}: dynamic value for attribute "${attr.name}" is not supported`,
        );
    } else
      throw new Error(
        `${sourceLocation(file, node)}: dynamic value for attribute "${attr.name}" is not supported`,
      );
  }
  return output;
}

export function requiredString(value: unknown, name: string, file: string, node: AstNode): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${sourceLocation(file, node)}: "${name}" must be a non-empty string`);
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
    if (!allowed.includes(key))
      throw new Error(`${sourceLocation(file, node)}: unknown attribute "${key}"`);
}

export function assertFrontmatterKeys(
  data: Record<string, unknown>,
  allowed: string[],
  file: string,
): void {
  for (const key of Object.keys(data))
    if (!allowed.includes(key))
      throw new Error(`${sourceLocation(file)}: unknown frontmatter field "${key}"`);
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
    throw new Error(
      `${sourceLocation(file, node)}: ${label} must refer to a file inside the content package directory`,
    );
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(
      `${sourceLocation(file, node)}: ${label} resolves outside the content package directory`,
    );
  }
  return rel.split(path.sep).join('/');
}
