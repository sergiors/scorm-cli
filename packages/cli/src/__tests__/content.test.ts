import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPackage } from '../content'

let temp = ''
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true })
})

describe('CLI package loading', () => {
  it('resolves both package directories and direct entrypoint files centrally', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-cli-content-'))
    const entrypoint = path.join(temp, 'index.mdx')
    await writeFile(
      entrypoint,
      '---\ntitle: Package\n---\n<Scroll><Page src="lesson.mdx" /></Scroll>'
    )
    await writeFile(path.join(temp, 'lesson.mdx'), '---\ntitle: Lesson\n---')

    for (const input of [temp, entrypoint]) {
      const loaded = await loadPackage(input)
      expect(loaded.contentRoot).toBe(temp)
      expect(loaded.entrypoint).toBe(entrypoint)
      expect(loaded.content.presentation.type).toBe('scroll')
    }
  })

  it('normalizes missing and invalid package diagnostics with the resolved path', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-cli-content-'))
    const missing = path.join(temp, 'missing')
    await expect(loadPackage(missing)).rejects.toThrow(
      `${missing}: content package path does not exist`
    )

    const emptyDirectory = path.join(temp, 'empty')
    await mkdir(emptyDirectory)
    await expect(loadPackage(emptyDirectory)).rejects.toThrow(
      `${path.join(emptyDirectory, 'index.mdx')}: content package entry does not exist`
    )

    const invalid = path.join(temp, 'invalid.mdx')
    await writeFile(invalid, '---\ntitle: Broken\n---\n<Scroll />')
    await expect(loadPackage(invalid)).rejects.toThrow(
      new RegExp(
        `${invalid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+(?::\\d+)?: <Scroll> must contain at least one <Page>; found 0`
      )
    )
  })
})
