import { join } from 'path';
import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

export async function importXmlFromFile(absPath) {
  const raw = await readXmlContent(absPath);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    isArray: tagName => ['part', 'measure', 'note', 'direction', 'score-part', 'harmony', 'tie', 'direction-type', 'lyric', 'score-instrument', 'midi-instrument'].includes(tagName),
  });

  const doc = parser.parse(raw);
  const score = doc['score-partwise'];
  if (!score) throw new Error('Only score-partwise MusicXML is supported.');

  const { importXmlToSong } = await import('../lib/musicxml-import-adapter.js');
  return importXmlToSong(score, absPath);
}

async function readXmlContent(filePath) {
  const buffer = await readFile(filePath);
  if (!filePath.toLowerCase().endsWith('.mxl')) return buffer.toString('utf-8');

  const unzipped = unzipSync(new Uint8Array(buffer));
  const containerBytes = unzipped['META-INF/container.xml'];
  if (containerBytes) {
    const containerXml = new TextDecoder().decode(containerBytes);
    const match = containerXml.match(/full-path="([^"]+\.(?:xml|musicxml))"/);
    if (match) {
      const bytes = unzipped[match[1]];
      if (bytes) return new TextDecoder().decode(bytes);
    }
  }

  for (const [name, bytes] of Object.entries(unzipped)) {
    if ((name.endsWith('.xml') || name.endsWith('.musicxml')) && !name.startsWith('META-INF')) {
      return new TextDecoder().decode(bytes);
    }
  }

  throw new Error('No MusicXML score found inside the .mxl archive.');
}
