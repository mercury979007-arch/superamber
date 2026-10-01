// Vendored identically in the website's utils/exportFontGuard.mjs. Both use the
// same full WOFF2, never the UI subset or a machine-installed font.
export async function prepareExportFont(options = {}) {
  const doc = options.document || document;
  const win = doc.defaultView;
  const family = options.family || 'ReportSmiley';
  const source = options.source || '/fonts/SmileySans-Oblique.ttf.woff2?v=f9f3ce3b';
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(family)) throw new Error('Invalid export font family');
  const controller = new win.AbortController();
  let timer;
  const fail = () => Object.assign(new Error('得意黑字体未就绪，未生成图片。请检查网络后重试。'), { code: 'EXPORT_FONT_UNAVAILABLE' });
  const work = (async () => {
    const key = family + ':' + source;
    const cache = win.__amberExportFonts ||= new Map();
    let entry = cache.get(key);
    if (!entry || entry.face.status !== 'loaded' || !doc.fonts.has(entry.face)) {
      const response = await win.fetch(source, { signal: controller.signal });
      if (!response.ok) throw fail();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 100000 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'wOF2') throw fail();
      const face = new win.FontFace(family, bytes, { weight: '100 900', style: 'normal' });
      await face.load();
      if (controller.signal.aborted) throw fail();
      doc.fonts.add(face);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const dataUrl = 'data:font/woff2;base64,' + win.btoa(binary);
      entry = { face, dataUrl };
      cache.set(key, entry);
    }
    const sample = '学习方法小步渐进持续向前 Amber NBC abc XYZ 0123456789.5';
    for (const weight of [400, 700, 900]) {
      const faces = await doc.fonts.load(`${weight} 32px "${family}"`, sample);
      if (!faces.length || faces.some(face => face.status !== 'loaded')) throw fail();
    }
    // Check actual canvas rasterization for each character group, not just
    // fonts.check (which also returns true for a nonexistent font family).
    const canvas = doc.createElement('canvas'); canvas.width = 1100; canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw fail();
    const raster = (font, text) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '32px ' + font; ctx.fillText(text, 3, 48);
      return canvas.toDataURL();
    };
    for (const text of ['学习方法小步渐进持续向前', 'Amber NBC abc XYZ', '0123456789.5']) {
      const actual = raster(`"${family}"`, text);
      if (actual === raster('sans-serif', text) || actual === raster('monospace', text)) throw fail();
    }
    const css = `@font-face{font-family:"${family}";src:url("${entry.dataUrl}") format("woff2");font-weight:100 900;font-style:normal;font-display:block;}`;
    let style = doc.getElementById('amber-export-face-' + family);
    if (!style) { style = doc.createElement('style'); style.id = 'amber-export-face-' + family; doc.head.appendChild(style); }
    style.textContent = css;
    const target = options.target || (options.selector ? doc.querySelector(options.selector) : null);
    if (options.selector && !target) throw fail();
    if (target) {
      for (const node of [target, ...target.querySelectorAll('*')]) {
        if (node instanceof win.HTMLElement) node.style.setProperty('font-family', `"${family}", "Noto Color Emoji", sans-serif`, 'important');
      }
      let last = '', stable = 0;
      for (let i = 0; i < 20 && stable < 3; i++) {
        await new Promise(resolve => win.requestAnimationFrame(resolve));
        const rect = target.getBoundingClientRect();
        const next = [rect.width, rect.height, target.scrollWidth, target.scrollHeight].join(':');
        stable = next === last ? stable + 1 : 0; last = next;
      }
      if (stable < 3) throw fail();
    }
    return { family, css, dataUrl: entry.dataUrl, verified: true };
  })();
  try {
    return await Promise.race([work, new Promise((_, reject) => { timer = win.setTimeout(() => { controller.abort(); reject(fail()); }, timeoutMs); })]);
  } catch { throw fail(); }
  finally { win.clearTimeout(timer); }
}
