/**
 * 用 Puppeteer 登录 cnfadmin，进入 cop_mip 页面，拦截所有 XHR/fetch 请求
 * 找出实际的 MP 发放 API 端点和参数格式
 *
 * 需要通过 staging 的活跃 session 运行（不需要凭据）
 * Usage: node tools/probes/intercept-copmip.js
 */

const EducationSystemScraper = require('../../scraper/scraper');

async function run() {
  // Connect to staging server to get scraper session
  // We'll use the scraper's request method to fetch and analyze pages
  const BASE = 'https://school.example.invalid';

  // Instead of logging in ourselves, let's analyze the HTML and JS of the cop_mip page
  // by fetching the squad_console page's JS bundles

  // First, let's check what JS files are loaded on the squad_console page
  console.log('Fetching cnfadmin login page to find JS bundles...');
  const loginResp = await fetch(`${BASE}/admin/auth/login`);
  const loginHtml = await loginResp.text();

  // Extract all JS file URLs
  const jsUrls = [];
  const scriptMatches = loginHtml.matchAll(/src="([^"]*\.js[^"]*)"/g);
  for (const match of scriptMatches) {
    jsUrls.push(match[1]);
  }
  console.log('JS files found:', jsUrls);

  // Fetch each JS file and search for cop_mip API endpoints
  for (const jsUrl of jsUrls) {
    const fullUrl = jsUrl.startsWith('http') ? jsUrl : `${BASE}${jsUrl}`;
    console.log(`\nFetching ${fullUrl}...`);
    try {
      const resp = await fetch(fullUrl);
      const js = await resp.text();

      // Search for cop_mip, sendMip, study_mark, minipin related strings
      const patterns = [
        /cop_mip[^'"}\s]{0,80}/g,
        /sendMip[^'"}\s]{0,80}/g,
        /study_mark[^'"}\s]{0,80}/g,
        /minipin[^'"}\s]{0,60}/gi,
        /发放[^'"}\s]{0,40}/g,
        /store[^'"}\s]{0,40}/g,
      ];

      const found = new Set();
      for (const pattern of patterns) {
        let m;
        while ((m = pattern.exec(js)) !== null) {
          found.add(m[0]);
        }
      }

      if (found.size > 0) {
        console.log(`  Matches (${found.size}):`);
        for (const f of found) {
          console.log(`    ${f}`);
        }
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
}

run().catch(console.error);
