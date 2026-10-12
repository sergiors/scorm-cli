import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { isRemoteReference } from '@scorm-cli/core';
import { AstNode, sourceLocation, normalizedRelative } from './shared';

export async function assetReference(
  value: string,
  sourceFile: string,
  root: string,
  file: string,
  node: AstNode,
): Promise<string> {
  if (isRemoteReference(value) || value.startsWith('data:')) return value;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    throw new Error(
      `${sourceLocation(file, node)}: asset reference "${value}" has invalid URL encoding`,
    );
  }
  const absolute = path.resolve(path.dirname(sourceFile), decoded);
  const relative = normalizedRelative(root, absolute, file, node, 'asset reference');
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    throw new Error(`${sourceLocation(file, node)}: asset "${value}" does not exist`);
  }

  if (!stat.isFile()) {
    throw new Error(`${sourceLocation(file, node)}: asset "${value}" is not a file`);
  }

  const realRoot = await fs.realpath(root);
  const realAsset = await fs.realpath(absolute);
  const realRelative = path.relative(realRoot, realAsset);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error(
      `${sourceLocation(file, node)}: asset "${value}" resolves outside the content package directory`,
    );
  }

  return relative;
}

export async function sourceNodeId(
  kind: 'question' | 'questionnaire',
  node: AstNode,
  file: string,
  root: string,
): Promise<string> {
  const relativeFile = normalizedRelative(
    root,
    path.resolve(file),
    file,
    node,
    `${kind === 'question' ? 'Question' : 'Questionnaire'} source`,
  );
  const raw = await fs.readFile(file, 'utf8');
  const bodyStart = raw.indexOf(matter(raw).content);
  const lineOffset = raw.slice(0, Math.max(0, bodyStart)).split('\n').length - 1;
  const line = lineOffset + (node.position?.start?.line ?? 1);
  const column = node.position?.start?.column ?? 1;
  return `${kind}:${relativeFile}:${line}:${column}`;
}
