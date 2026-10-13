import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { create } from 'xmlbuilder2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentPackage } from '@scorm-cli/core'
import {
  createContentManifest,
  createManifest,
  decodeSuspendData,
  encodeSuspendData,
  packageScorm,
  scormDevMock
} from '../index'

let temp: string
afterEach(async () => {
  vi.restoreAllMocks()
  if (temp) await rm(temp, { recursive: true, force: true })
})

const content: ContentPackage = {
  metadata: { title: 'Package title' },
  presentation: {
    type: 'tiles',
    items: [
      {
        type: 'item',
        id: 'item-one',
        source: 'one.mdx',
        metadata: { title: 'Lesson' },
        content: [
          {
            type: 'questionnaire',
            id: 'wrapper-id',
            contributesToScore: true,
            questions: [
              {
                type: 'question',
                id: 'question-id',
                questionType: 'single-choice',
                prompt: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Do not persist prompt' }]
                  }
                ],
                options: [
                  {
                    value: 'known-answer',
                    correct: true,
                    content: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'text', value: 'Known' }]
                      }
                    ]
                  },
                  {
                    value: 'other-answer',
                    correct: false,
                    content: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'text', value: 'Other' }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}

describe('SCORM 1.2 package', () => {
  it('creates a manifest with metadata and a single SCO resource', () => {
    const xml = createManifest({ title: 'A <Course>' }, ['index.html', 'index.html'])
    const root = create(xml).root().node as any
    const namespace = 'http://www.imsproject.org/xsd/imscp_rootv1p1p2'
    const resources = root.getElementsByTagNameNS(namespace, 'resource')
    expect(resources).toHaveLength(1)
    expect(resources[0].getAttribute('href')).toBe('index.html')
    expect(root.getElementsByTagNameNS(namespace, 'title')[0].textContent).toBe('A <Course>')
  })

  it('writes package language in IEEE LOM metadata, defaulting to English', () => {
    const namespace = 'http://ltsc.ieee.org/xsd/LOM'
    for (const [metadata, expected] of [
      [{ title: 'Portuguese package', lang: 'pt-BR' }, 'pt-BR'],
      [{ title: 'English package' }, 'en']
    ] as const) {
      const root = create(createManifest(metadata, [])).root().node as any
      const languages = root.getElementsByTagNameNS(namespace, 'language')
      expect(languages).toHaveLength(1)
      expect(languages[0].textContent).toBe(expected)
    }
  })

  it('writes the exact content dictionary to the ZIP and references it in imsmanifest', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-test-'))
    const renderDir = path.join(temp, 'render')
    await mkdir(renderDir)
    await writeFile(
      path.join(renderDir, 'index.html'),
      '<!doctype html><html><head></head><body></body></html>'
    )
    await writeFile(path.join(renderDir, 'app.js'), 'window.booted = true;')
    const contentManifest = createContentManifest(content)
    const output = await packageScorm({
      metadata: content.metadata,
      contentManifest,
      renderResult: { directory: renderDir, entrypoint: 'index.html' },
      outputPath: path.join(temp, 'content-package.zip')
    })
    const zip = await JSZip.loadAsync(await readFile(output))
    expect(Object.keys(zip.files)).toContain('content-manifest.json')
    expect(Object.keys(zip.files)).toContain('scorm-runtime.js')
    expect(Object.keys(zip.files)).not.toContain('scorm-dev-mock.js')

    const manifestContents = await zip.file('content-manifest.json')!.async('string')
    expect(JSON.parse(manifestContents)).toEqual(contentManifest)
    const xml = create(await zip.file('imsmanifest.xml')!.async('string')).root().node as any
    const namespace = 'http://www.imsproject.org/xsd/imscp_rootv1p1p2'
    const files = xml.getElementsByTagNameNS(namespace, 'file')
    expect([...files].map((file: any) => file.getAttribute('href'))).toContain(
      'content-manifest.json'
    )
    const runtime = await zip.file('scorm-runtime.js')!.async('string')
    expect(runtime).toContain(JSON.stringify(contentManifest))
    expect(await zip.file('index.html')!.async('string')).toContain('scorm-runtime.js')

    // The serialized selection can be restored with precisely the shipped dictionary.
    const state = {
      pages: {
        'item-one': {
          visited: true,
          answers: { 'question-id': 'known-answer' }
        }
      }
    }
    const saved = encodeSuspendData(contentManifest, state, 100)
    expect(decodeSuspendData(contentManifest, JSON.stringify(saved))).toEqual({
      pages: {
        'item-one': {
          visited: true,
          answers: { 'question-id': 'known-answer' }
        }
      }
    })
  })

  it('rejects invalid entrypoints before creating staging or output paths', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-test-'))
    const renderDir = path.join(temp, 'render')
    await mkdir(renderDir)
    const outputParent = path.join(temp, 'not-created')
    const mkdirSpy = vi.spyOn(fs, 'mkdir')
    const mkdtempSpy = vi.spyOn(fs, 'mkdtemp')
    const copySpy = vi.spyOn(fs, 'cp')
    const writeFileSpy = vi.spyOn(fs, 'writeFile')

    for (const [entrypoint, message] of [
      ['../outside.html', 'renderer entrypoint must be inside its output directory'],
      ['nested/index.html', 'renderer entrypoint must be at the root of its output directory']
    ]) {
      await expect(
        packageScorm({
          metadata: content.metadata,
          contentManifest: createContentManifest(content),
          renderResult: { directory: renderDir, entrypoint },
          outputPath: path.join(outputParent, 'content-package.zip')
        })
      ).rejects.toThrow(message)
    }

    expect(mkdirSpy).not.toHaveBeenCalled()
    expect(mkdtempSpy).not.toHaveBeenCalled()
    expect(copySpy).not.toHaveBeenCalled()
    expect(writeFileSpy).not.toHaveBeenCalled()
    await expect(readFile(path.join(outputParent, 'content-package.zip'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('rejects renderer output containing a reserved SCORM filename', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-test-'))
    const renderDir = path.join(temp, 'render')
    await mkdir(renderDir)
    await writeFile(path.join(renderDir, 'index.html'), '<html><head></head><body></body></html>')
    await writeFile(path.join(renderDir, 'scorm-runtime.js'), 'renderer-owned file')
    const outputPath = path.join(temp, 'content-package.zip')

    await expect(
      packageScorm({
        metadata: content.metadata,
        contentManifest: createContentManifest(content),
        renderResult: { directory: renderDir, entrypoint: 'index.html' },
        outputPath
      })
    ).rejects.toThrow('renderer output uses a reserved SCORM package filename')

    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the dev mock isolated from production packaging', () => {
    expect(scormDevMock).toContain('scorm-cli:preview:')
  })
})

describe('SCORM 2004 4th Edition package', () => {
  it('packages rendered output with a 2004 runtime and manifest', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-2004-test-'))
    const renderDir = path.join(temp, 'render')
    await mkdir(renderDir)
    await writeFile(
      path.join(renderDir, 'index.html'),
      '<!doctype html><html><head></head><body></body></html>'
    )
    await writeFile(path.join(renderDir, 'app.js'), 'window.booted = true;')

    const output = await packageScorm({
      metadata: { title: '2004 content package', lang: 'en-GB' },
      contentManifest: createContentManifest(content),
      renderResult: { directory: renderDir, entrypoint: 'index.html' },
      outputPath: path.join(temp, 'scorm-2004.zip'),
      version: '2004'
    })
    const zip = await JSZip.loadAsync(await readFile(output))
    expect(Object.keys(zip.files)).toContain('index.html')
    expect(Object.keys(zip.files)).toContain('app.js')

    const runtime = await zip.file('scorm-runtime.js')!.async('string')
    expect(runtime).toContain('API_1484_11')
    expect(runtime).toContain('cmi.completion_status')
    expect(runtime).not.toContain('cmi.success_status')
    expect(await zip.file('index.html')!.async('string')).toContain('scorm-runtime.js')

    const xml = await zip.file('imsmanifest.xml')!.async('string')
    const root = create(xml).root().node as any
    const imsNamespace = 'http://www.imsglobal.org/xsd/imscp_v1p1'
    const resources = root.getElementsByTagNameNS(imsNamespace, 'resource')
    const organizations = root.getElementsByTagNameNS(imsNamespace, 'organization')
    const items = root.getElementsByTagNameNS(imsNamespace, 'item')
    expect(organizations).toHaveLength(1)
    expect(items).toHaveLength(1)
    expect(resources).toHaveLength(1)
    expect(resources[0].getAttribute('adlcp:scormType')).toBe('sco')
    expect(resources[0].getAttribute('href')).toBe('index.html')
    expect(xml).toContain('http://www.adlnet.org/xsd/adlcp_v1p3')
    expect(xml).toContain('adlcp_v1p3.xsd')
    expect(xml).toContain('ADL SCORM')
    expect(xml).toContain('2004 4th Edition')
    expect(xml).toContain('en-GB')
    expect(xml).not.toContain('sequencing')
  })
})
