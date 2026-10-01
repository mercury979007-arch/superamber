const fs = require('node:fs');
const { ScraperBrowserRuntime } = require('../lib/scraperBrowserRuntime');

function launchExportBrowser() {
  const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim()
    || (fs.existsSync('/snap/bin/chromium') ? '/snap/bin/chromium' : undefined);
  return require('puppeteer').launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

// Export uses the same bounded queue and cleanup as scraping. Login state
// remains in HTTP sessions; no idle browser is retained after an image job.
function createSeatingImageRenderer({ launch = launchExportBrowser, ...runtimeOptions } = {}) {
  return function renderSeatingExportToPng({ html, cssText, stylesheetHrefs, width, height }) {
    const runtime = new ScraperBrowserRuntime({}, launch, runtimeOptions);
    return runtime.run('seating-export', async () => {
      const page = await runtime.replacePage();
      await page.setJavaScriptEnabled(false);
      const stylesheetLinks = Array.isArray(stylesheetHrefs)
        ? stylesheetHrefs
            .map((href) => String(href || '').trim())
            .filter(Boolean)
            .map((href) => `<link rel="stylesheet" href="${href}">`)
            .join('\n')
        : '';

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
    });
  };
}

module.exports = { createSeatingImageRenderer };
