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

/** Build an IMS Content Packaging 1.1 manifest for SCORM 2004 4th Edition. */
export function createManifest2004(metadata: PackageMetadata, files: string[]): string {
  const id = identifier(metadata.title)
  const manifest = create({ version: '1.0', encoding: 'UTF-8' }).ele('manifest', {
    identifier: id,
    version: '1.0',
    xmlns: 'http://www.imsglobal.org/xsd/imscp_v1p1',
    'xmlns:adlcp': 'http://www.adlnet.org/xsd/adlcp_v1p3',
    'xmlns:adlseq': 'http://www.adlnet.org/xsd/adlseq_v1p3',
    'xmlns:adlnav': 'http://www.adlnet.org/xsd/adlnav_v1p3',
    'xmlns:imsss': 'http://www.imsglobal.org/xsd/imsss',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation':
      'http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd'
  })

  const manifestMetadata = manifest.ele('metadata')
  manifestMetadata.ele('schema').txt('ADL SCORM')
  manifestMetadata.ele('schemaversion').txt('2004 4th Edition')
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
    'adlcp:scormType': 'sco',
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
