// 文件预览：图片 / PDF / 文本 / Word(.docx)。不依赖任何外部库。
//   .docx 在浏览器里直接解压并渲染正文、标题、表格、图片（公式显示为文本），用于快速浏览；
//   精确排版请下载后用 Word 打开。

const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const TEXT = ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yaml', 'yml', 'tex', 'py', 'js', 'c', 'cpp', 'h', 'java'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf' };

export const extOf = (name = '') => (/\.([^.]+)$/.exec(name)?.[1] || '').toLowerCase();

export function previewKind(name) {
  const e = extOf(name);
  if (IMG.includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (e === 'docx') return 'docx';
  if (TEXT.includes(e)) return 'text';
  return null;
}

const cache = new Map(); // fileId -> { node builder data }

export function clearPreviewCache() {
  for (const v of cache.values()) v.urls?.forEach((u) => URL.revokeObjectURL(u));
  cache.clear();
}

// 生成预览 DOM。getBlob: async () => Blob
export async function buildPreview(file, getBlob) {
  const kind = previewKind(file.name);
  if (!kind) return msg('该格式暂不支持在线预览，请下载后查看');
  let c = cache.get(file.id);
  if (!c) {
    const blob = await getBlob();
    c = { urls: [] };
    if (kind === 'image' || kind === 'pdf') {
      const typed = new Blob([blob], { type: MIME[extOf(file.name)] || blob.type });
      c.url = URL.createObjectURL(typed);
      c.urls.push(c.url);
    } else if (kind === 'text') {
      const t = await blob.text();
      c.text = t.length > 400000 ? t.slice(0, 400000) + '\n\n…（内容过长，仅显示前一部分，完整内容请下载）' : t;
    } else if (kind === 'docx') {
      c.docx = await renderDocx(await blob.arrayBuffer(), c.urls);
    }
    cache.set(file.id, c);
  }
  if (kind === 'image') {
    const img = document.createElement('img');
    img.src = c.url; img.alt = file.name; img.className = 'pv-img';
    return wrap(img, 'pv-center');
  }
  if (kind === 'pdf') {
    const f = document.createElement('iframe');
    f.src = c.url; f.className = 'pv-frame'; f.title = file.name;
    return f;
  }
  if (kind === 'text') {
    const pre = document.createElement('pre');
    pre.className = 'pv-text'; pre.textContent = c.text;
    return pre;
  }
  return c.docx.cloneNode(true);
}

function msg(text) {
  const d = document.createElement('div');
  d.className = 'pv-msg'; d.textContent = text;
  return d;
}
function wrap(node, cls) {
  const d = document.createElement('div');
  d.className = cls; d.appendChild(node);
  return d;
}

// ---------------- docx ----------------
async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readZip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 .docx 文件');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true);
    const xl = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    entries[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { method, csize, off };
    p += 46 + nl + xl + cl;
  }
  return {
    async get(name) {
      const e = entries[name];
      if (!e) return null;
      const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data);
      throw new Error('不支持的压缩方式');
    },
  };
}

const kids = (el) => Array.from(el?.childNodes || []).filter((n) => n.nodeType === 1);
const ln = (el) => el.localName;
const attr = (el, name) => {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
};
const child = (el, name) => kids(el).find((c) => ln(c) === name);
const find = (el, name) => {
  const out = [];
  const walk = (n) => { for (const c of kids(n)) { if (ln(c) === name) out.push(c); walk(c); } };
  walk(el);
  return out;
};

async function renderDocx(buf, urls) {
  const zip = readZip(buf);
  const docXml = await zip.get('word/document.xml');
  if (!docXml) throw new Error('文件里没有正文（word/document.xml）');
  const parse = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  const doc = parse(docXml);

  const rels = {};
  const relXml = await zip.get('word/_rels/document.xml.rels');
  if (relXml) for (const r of find(parse(relXml), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');

  const imgCache = {};
  async function image(rid) {
    const target = rels[rid];
    if (!target) return null;
    if (imgCache[target] !== undefined) return imgCache[target];
    const path = target.startsWith('/') ? target.slice(1) : 'word/' + target.replace(/^\.\//, '');
    const ext = extOf(path);
    let url = null;
    if (MIME[ext] && ext !== 'pdf') {
      const bytes = await zip.get(path);
      if (bytes) { url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] })); urls.push(url); }
    }
    imgCache[target] = url;
    return url;
  }

  const root = document.createElement('div');
  root.className = 'pv-docx';
  const body = find(doc, 'body')[0];

  async function runs(container, parent) {
    for (const c of kids(parent)) {
      const n = ln(c);
      if (n === 'r') {
        const rPr = child(c, 'rPr');
        const bold = rPr && child(rPr, 'b') && attr(child(rPr, 'b'), 'val') !== '0';
        const ital = rPr && child(rPr, 'i') && attr(child(rPr, 'i'), 'val') !== '0';
        const va = rPr && attr(child(rPr, 'vertAlign'), 'val');
        for (const x of kids(c)) {
          const xn = ln(x);
          if (xn === 't') {
            let el = document.createTextNode(x.textContent);
            if (bold || ital || va === 'superscript' || va === 'subscript') {
              const tag = va === 'superscript' ? 'sup' : va === 'subscript' ? 'sub' : bold ? 'b' : 'i';
              const s = document.createElement(tag);
              if (bold && tag !== 'b') s.style.fontWeight = '600';
              if (ital) s.style.fontStyle = 'italic';
              s.appendChild(el); el = s;
            }
            container.appendChild(el);
          } else if (xn === 'tab') container.appendChild(document.createTextNode(' '));
          else if (xn === 'br' || xn === 'cr') container.appendChild(document.createElement('br'));
          else if (xn === 'drawing' || xn === 'pict' || xn === 'object') {
            const blip = find(x, 'blip')[0] || find(x, 'imagedata')[0];
            const rid = blip && (attr(blip, 'embed') || attr(blip, 'id'));
            const url = rid ? await image(rid) : null;
            if (url) {
              const img = document.createElement('img');
              img.src = url; img.className = 'pv-docx-img';
              container.appendChild(img);
            } else {
              const s = document.createElement('span');
              s.className = 'pv-ph'; s.textContent = xn === 'object' ? '[对象/公式]' : '[图片]';
              container.appendChild(s);
            }
          }
        }
      } else if (n === 'hyperlink' || n === 'smartTag' || n === 'ins' || n === 'sdtContent' || n === 'fldSimple') {
        await runs(container, c);
      } else if (n === 'sdt') {
        const sc = child(c, 'sdtContent');
        if (sc) await runs(container, sc);
      } else if (n === 'oMath' || n === 'oMathPara') {
        const s = document.createElement('span');
        s.className = 'pv-math';
        s.textContent = find(c, 't').map((t) => t.textContent).join('');
        container.appendChild(s);
      }
    }
  }

  async function para(p) {
    const pPr = child(p, 'pPr');
    const style = (pPr && attr(child(pPr, 'pStyle'), 'val')) || '';
    const m = /^(?:heading|标题)\s*(\d)$/i.exec(style) || /^(\d)$/.exec(style);
    let el;
    if (/^title$/i.test(style)) el = document.createElement('h1');
    else if (m) el = document.createElement('h' + Math.min(4, Math.max(1, +m[1] + 1)));
    else el = document.createElement('p');
    const jc = pPr && attr(child(pPr, 'jc'), 'val');
    if (jc === 'center') el.style.textAlign = 'center';
    else if (jc === 'right' || jc === 'end') el.style.textAlign = 'right';
    if (pPr && child(pPr, 'numPr')) el.classList.add('pv-li');
    await runs(el, p);
    if (!el.textContent.trim() && !el.querySelector('img')) el.innerHTML = '&nbsp;';
    return el;
  }

  async function block(parent, target) {
    for (const c of kids(parent)) {
      const n = ln(c);
      if (n === 'p') target.appendChild(await para(c));
      else if (n === 'tbl') {
        const t = document.createElement('table');
        for (const tr of kids(c).filter((x) => ln(x) === 'tr')) {
          const row = document.createElement('tr');
          for (const tc of kids(tr).filter((x) => ln(x) === 'tc')) {
            const td = document.createElement('td');
            const span = attr(find(tc, 'gridSpan')[0], 'val');
            if (span) td.colSpan = +span;
            await block(tc, td);
            row.appendChild(td);
          }
          t.appendChild(row);
        }
        target.appendChild(t);
      } else if (n === 'sdt') {
        const sc = child(c, 'sdtContent');
        if (sc) await block(sc, target);
      }
    }
  }

  await block(body, root);
  if (!root.textContent.trim() && !root.querySelector('img')) root.appendChild(msg('文档没有可显示的文字内容'));
  return root;
}
