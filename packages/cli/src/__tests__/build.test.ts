import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPackage } from '../build'

let temp: string
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true })
})

describe('CLI build orchestration', () => {
  it('parses, forwards assets to the renderer, and packages a SCORM ZIP', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-cli-test-'))
    const contentDir = path.join(temp, 'content')
    await mkdir(path.join(contentDir, 'media'), { recursive: true })
    await mkdir(path.join(contentDir, 'files'))
    await writeFile(
      path.join(contentDir, 'index.mdx'),
      `---\ntitle: Demo\n---\n<Tiles><Item src="lesson.mdx" /></Tiles>`
    )
    await writeFile(
      path.join(contentDir, 'lesson.mdx'),
      `---\ntitle: Lesson\n---\n<Image src="media/picture.svg" alt="Picture" />\n\n<Video src="https://youtu.be/M7lc1UVf-VE" />\n\n[Guide](files/guide.pdf?download=1#page-2)`
    )
    await writeFile(path.join(contentDir, 'media', 'picture.svg'), '<svg/>')
    await writeFile(path.join(contentDir, 'files', 'guide.pdf'), 'pdf')
    const output = path.join(temp, 'out.zip')
    let seenAssets: unknown
    const zipPath = await buildPackage(contentDir, output, async (_contentPackage, options) => {
      seenAssets = options.assets
      await mkdir(options.outputDirectory, { recursive: true })
      await writeFile(
        path.join(options.outputDirectory, 'index.html'),
        '<html><head></head><body></body></html>'
      )
      return { directory: options.outputDirectory, entrypoint: 'index.html' }
    })
    expect(seenAssets).toEqual([
      {
        sourcePath: path.join(contentDir, 'files', 'guide.pdf'),
        targetPath: 'files/guide.pdf'
      },
      {
        sourcePath: path.join(contentDir, 'media', 'picture.svg'),
        targetPath: 'media/picture.svg'
      }
    ])
    const archive = await readFile(zipPath)
    expect(archive.subarray(0, 2).toString()).toBe('PK')
    expect((await stat(zipPath)).size).toBeGreaterThan(100)
    const zip = await JSZip.loadAsync(archive)
    const contentManifest = JSON.parse(await zip.file('content-manifest.json')!.async('string'))
    expect(contentManifest).toMatchObject({
      schemaVersion: 1,
      title: 'Demo',
      presentation: 'tiles',
      pages: {
        '0': {
          id: expect.any(String),
          title: 'Lesson',
          questions: {}
        }
      }
    })
    const pageVideos = contentManifest.pages['0'].videos
    expect(Object.keys(pageVideos)).toEqual(['0'])
    expect(pageVideos['0']).toEqual({
      id: expect.any(String),
      src: 'https://youtu.be/M7lc1UVf-VE',
      provider: 'youtube'
    })
    expect(contentManifest).not.toHaveProperty('videos')
    expect(await zip.file('scorm-runtime.js')!.async('string')).toContain(
      JSON.stringify(contentManifest)
    )
    expect(await zip.file('imsmanifest.xml')!.async('string')).toContain(
      '<schemaversion>1.2</schemaversion>'
    )
    expect(await zip.file('scorm-runtime.js')!.async('string')).toContain('LMSInitialize')
  })

  it('builds a SCORM 2004 package when requested', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-cli-test-'))
    const contentDir = path.join(temp, 'content')
    await mkdir(contentDir)
    await writeFile(
      path.join(contentDir, 'index.mdx'),
      '---\ntitle: Demo\n---\n<Tiles><Item src="lesson.mdx" /></Tiles>'
    )
    await writeFile(path.join(contentDir, 'lesson.mdx'), '---\ntitle: Lesson\n---\nHello')
    const output = path.join(temp, 'out-2004.zip')
    const zipPath = await buildPackage(
      contentDir,
      output,
      async (_contentPackage, options) => {
        await mkdir(options.outputDirectory, { recursive: true })
        await writeFile(
          path.join(options.outputDirectory, 'index.html'),
          '<html><head></head></html>'
        )
        return { directory: options.outputDirectory, entrypoint: 'index.html' }
      },
      '2004'
    )

    const zip = await JSZip.loadAsync(await readFile(zipPath))
    const manifest = await zip.file('imsmanifest.xml')!.async('string')
    const runtime = await zip.file('scorm-runtime.js')!.async('string')
    expect(manifest).toContain('http://www.imsglobal.org/xsd/imscp_v1p1')
    expect(manifest).toContain('<schemaversion>2004 4th Edition</schemaversion>')
    expect(runtime).toContain('API_1484_11')
    expect(runtime).toContain('Initialize')
  })
})
