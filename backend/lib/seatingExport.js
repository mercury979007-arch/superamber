let puppeteerModule = null;
let exportBrowserPromise = null;

function getPuppeteer() {
  if (!puppeteerModule) {
    puppeteerModule = require('puppeteer');
  }
  return puppeteerModule;
}

async function getExportBrowser() {
  if (!exportBrowserPromise) {
    const puppeteer = getPuppeteer();
    exportBrowserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }).catch((error) => {
      exportBrowserPromise = null;
      throw error;
    });
  }
  return exportBrowserPromise;
}

async function renderSeatingExportToPng({ html, cssText, stylesheetHrefs, width, height }) {
  const browser = await getExportBrowser();
  const page = await browser.newPage();
  const stylesheetLinks = Array.isArray(stylesheetHrefs)
    ? stylesheetHrefs
        .map((href) => String(href || '').trim())
        .filter(Boolean)
        .map((href) => `<link rel="stylesheet" href="${href}">`)
        .join('\n')
    : '';

  try {
    await page.setViewport({
      width: Math.max(1, Math.min(4096, Number(width) || 1)),
      height: Math.max(1, Math.min(4096, Number(height) || 1)),
      deviceScaleFactor: 2,
    });

    await page.setContent(
      `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          ${stylesheetLinks}
          <style>
            html, body {
              margin: 0;
              padding: 0;
              background: #ffffff;
            }
            ${String(cssText || '')}
          </style>
        </head>
        <body>${html}</body>
      </html>`,
      { waitUntil: 'networkidle0' }
    );

    const handle = await page.$('[data-export-root="1"]');
    if (!handle) {
      throw new Error('未找到导出节点');
    }

    return await handle.screenshot({ type: 'png' });
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  getPuppeteer,
  getExportBrowser,
  renderSeatingExportToPng,
};
