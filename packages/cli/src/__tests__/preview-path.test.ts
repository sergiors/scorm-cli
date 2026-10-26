import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePreviewContentPath } from '../preview-path'

let workDir: string | undefined

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
    workDir = undefined
  }
})

describe('preview content path resolution', () => {
  it('prefers repository-root paths over same-named cwd paths', async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'preview-path-'))
    const repositoryRoot = path.join(workDir, 'repository')
    const cwd = path.join(workDir, 'packages', 'cli')
    await mkdir(path.join(repositoryRoot, 'examples'), { recursive: true })
    await mkdir(path.join(cwd, 'examples'), { recursive: true })
    await writeFile(path.join(repositoryRoot, 'examples', 'content.mdx'), '')
    await writeFile(path.join(cwd, 'examples', 'content.mdx'), '')

    expect(resolvePreviewContentPath('examples/content.mdx', repositoryRoot, cwd)).toBe(
      path.join(repositoryRoot, 'examples', 'content.mdx')
    )
  })

  it('falls back to an existing cwd path when no repository-root path exists', async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'preview-path-'))
    const repositoryRoot = path.join(workDir, 'repository')
    const cwd = path.join(workDir, 'packages', 'cli')
    await mkdir(repositoryRoot, { recursive: true })
    await mkdir(path.join(cwd, 'local-content'), { recursive: true })

    expect(resolvePreviewContentPath('local-content', repositoryRoot, cwd)).toBe(
      path.join(cwd, 'local-content')
    )
  })

  it('returns an absolute content path untouched', async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'preview-path-'))
    const repositoryRoot = path.join(workDir, 'repository')
    const cwd = path.join(workDir, 'packages', 'cli')
    const absoluteContent = path.join(workDir, 'elsewhere', 'content')
    await mkdir(absoluteContent, { recursive: true })

    // Absolute paths are authored explicitly by the caller, so repository-root
    // and cwd resolution never rewrite them.
    expect(resolvePreviewContentPath(absoluteContent, repositoryRoot, cwd)).toBe(absoluteContent)
  })
})
