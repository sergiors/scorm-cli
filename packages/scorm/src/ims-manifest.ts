import { create } from 'xmlbuilder2'
import type { PackageMetadata } from '@scorm-cli/core'

function identifier(value: string): string {
  const safe = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || 'scorm-package'
}

export function createManifest(metadata: PackageMetadata, files: string[]): string {
  const id = identifier(metadata.title)
  const manifest = create({ version: '1.0', encoding: 'UTF-8' }).ele('manifest', {
    identifier: id,
    version: '1.0',
    xmlns: 'http://www.imsproject.org/xsd/imscp_rootv1p1p2',
    'xmlns:adlcp': 'http://www.adlnet.org/xsd/adlcp_rootv1p2',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation':
      'http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd'
  })

  const manifestMetadata = manifest.ele('metadata')
  manifestMetadata.ele('schema').txt('ADL SCORM')
  manifestMetadata.ele('schemaversion').txt('1.2')
  manifestMetadata
    .ele('lom:lom', { 'xmlns:lom': 'http://ltsc.ieee.org/xsd/LOM' })
    .ele('lom:general')
    .ele('lom:language')
    .txt(metadata.lang ?? 'en')

  const organization = manifest
    .ele('organizations', { default: `ORG-${id}` })
    .ele('organization', { identifier: `ORG-${id}` })
  organization.ele('title').txt(metadata.title)
  organization
    .ele('item', {
      identifier: `ITEM-${id}`,
      identifierref: `RES-${id}`
    })
    .ele('title')
    .txt(metadata.title)

  const resource = manifest.ele('resources').ele('resource', {
    identifier: `RES-${id}`,
    type: 'webcontent',
    'adlcp:scormtype': 'sco',
    href: 'index.html'
  })
  for (const file of [...new Set(files)].sort()) {
    resource.ele('file', { href: file })
  }

  return `${manifest.doc().end({
    prettyPrint: true,
    indent: '  ',
    newline: '\n',
    width: 100
  })}\n`
}
