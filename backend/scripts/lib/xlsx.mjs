import fs from 'fs';
import zlib from 'zlib';

// ---- reading the workbook (a zip of xml files; nothing in it is executed) --------------------------------------------------
function unzip(path) {
  const buf = fs.readFileSync(path);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an xlsx file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26); const lelen = buf.readUInt16LE(off + 28);
    const start = off + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, () => (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export function readWorkbook(path) {
  const files = unzip(path);
  const get = (n) => { const f = files.get(n); if (!f) throw new Error(`Missing ${n} in the file`); return f(); };
  const strings = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = {};
  for (const m of get('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"[^>]*?r:id="([^"]+)"/g)) {
    const target = rels.get(m[2]).replace(/^\/?(xl\/)?/, 'xl/');
    const xml = get(target);
    const rows = [];
    for (const rm of xml.matchAll(/<row [^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const cm of (rm[1] || '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(cm[1])?.[1];
        const t = /t="(\w+)"/.exec(cm[1])?.[1];
        const body = cm[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = v;
        if (t === 's') val = strings[Number(v)];
        else if (t === 'inlineStr') val = dec(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] || '');
        else if (t === 'str') val = dec(v || '');
        if (ref && val !== undefined && val !== '') cells[colIndex(ref)] = String(val).trim();
      }
      if (cells.length) rows.push(cells);
    }
    sheets[dec(m[1]).trim().toLowerCase()] = rows;
  }
  return sheets;
}
