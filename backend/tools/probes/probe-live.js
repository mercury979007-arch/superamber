/**
 * Live probe: log into cnfadmin and discover the cop_mip distribution API
 * Reads credentials from stdin or env
 */
const EducationSystemScraper = require('../../scraper/scraper');
const cheerio = require('cheerio');

const BASE = 'https://school.example.invalid';

async function probe() {
  // Read credentials from environment
  const username = process.env.CNF_USER;
  const password = process.env.CNF_PASS;
  if (!username || !password) {
    console.log('Skipping live probe: CNF_USER / CNF_PASS not provided');
    return;
  }

  const scraper = new EducationSystemScraper({ baseUrl: BASE, username, password });

  try {
    console.log('1. Logging in...');
    await scraper.login();
    console.log('   ✅ Login OK');

    console.log('2. Getting class map via my_squad...');
    const classMap = await scraper.getClassMap();
    const j342 = classMap.find(c => c.classCode === 'J342');
    console.log('   Classes:', classMap.map(c => `${c.classCode}(${c.squadId})`).join(', '));
    if (!j342) { console.error('   ❌ J342 not found'); return; }
    const squadId = j342.squadId;

    console.log(`3. Fetching squad_console for J342 (id=${squadId})...`);
    const { text: consoleHtml } = await scraper.requestText(
      `/admin/squad_console?id=${squadId}&type=offline`,
      { headers: { accept: 'text/html' } }
    );

    // Find all cop_mip and minipin related URLs
    const $ = cheerio.load(consoleHtml);
    console.log('   cop_mip URLs in page:');
    const allHrefs = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('cop_mip') || href.includes('minipin') || href.includes('coupon') || href.includes('study_mark'))) {
        allHrefs.push(href);
      }
    });
    [...new Set(allHrefs)].forEach(h => console.log(`     ${h}`));

    // Find forms
    $('form').each((i, form) => {
      const action = $(form).attr('action') || '';
      if (action.includes('cop_mip') || action.includes('minipin') || action.includes('study_mark')) {
        const inputs = [];
        $(form).find('input, select, textarea').each((_, el) => {
          inputs.push({ name: $(el).attr('name'), type: $(el).attr('type'), value: $(el).attr('value')?.slice(0, 50) });
        });
        console.log(`   Form action: ${action}`, inputs);
      }
    });

    // Find Vue/JS data about cop_mip
    const scripts = consoleHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const script of scripts) {
      if (script.includes('cop_mip') || script.includes('minipin') || script.includes('sendMip') || script.includes('study_mark')) {
        // Extract the relevant part
        const content = script.replace(/<\/?script[^>]*>/gi, '');
        const lines = content.split('\n').filter(l =>
          l.includes('cop_mip') || l.includes('minipin') || l.includes('sendMip') ||
          l.includes('study_mark') || l.includes('发放') || l.includes('grant')
        );
        if (lines.length > 0) {
          console.log('   JS references:');
          lines.slice(0, 10).forEach(l => console.log(`     ${l.trim().slice(0, 200)}`));
        }
      }
    }

    // Try the cop_mip tab/section - look for AJAX data loading
    console.log('\n4. Probing cop_mip pages...');
    const pagesToTry = [
      `/admin/squad/cop_mip?squad_id=${squadId}`,
      `/admin/squad/cop_mip?squad_id=${squadId}&squad_type=offline`,
      `/admin/squad/cop_mip/index?squad_id=${squadId}`,
      `/admin/squad/cop_mip/create?squad_id=${squadId}`,
      `/admin/squad/cop_mip/manage?squad_id=${squadId}`,
      `/admin/squad/cop_mip/batch?squad_id=${squadId}`,
      `/admin/squad/cop_mip/sendMip`,
      `/admin/squad/cop_mip/batchSendMip`,
      `/admin/OnlineTest/study_mark?squad_id=${squadId}`,
      `/admin/OnlineTest/study_mark/create?squad_id=${squadId}`,
    ];

    for (const page of pagesToTry) {
      try {
        const resp = await scraper.request(page, {
          headers: { accept: 'text/html,application/json' },
          redirect: 'manual',
        });
        const status = resp.status;
        if (status === 404 || status === 405) continue;
        const body = await resp.text();
        const hasForm = body.includes('<form');
        const hasTable = body.includes('<table');

        // Extract form details if present
        if (hasForm && status < 400) {
          const $p = cheerio.load(body);
          const forms = [];
          $p('form').each((_, form) => {
            const action = $p(form).attr('action') || '';
            const method = $p(form).attr('method') || 'GET';
            const inputs = [];
            $p(form).find('input, select, textarea').each((_, el) => {
              const name = $p(el).attr('name');
              if (name && name !== '_token') inputs.push(name);
            });
            forms.push({ action, method, inputs });
          });
          console.log(`   ✅ ${page} → ${status} (forms: ${JSON.stringify(forms)})`);
        } else if (status < 400) {
          // Check for Vue/AJAX content
          const hasVue = body.includes('vue') || body.includes('Vue') || body.includes('axios');
          console.log(`   ✅ ${page} → ${status} (hasForm=${hasForm}, hasTable=${hasTable}, hasVue=${hasVue}, len=${body.length})`);

          // Look for API endpoints in the page
          const apiUrls = body.match(/['"]\/admin\/[^'"]+['"]/g) || [];
          const relevantApis = apiUrls.filter(u => u.includes('cop_mip') || u.includes('study_mark') || u.includes('send') || u.includes('store'));
          if (relevantApis.length > 0) {
            console.log(`     APIs: ${[...new Set(relevantApis)].join(', ')}`);
          }
        } else {
          const location = resp.headers.get('location') || '';
          console.log(`   ${page} → ${status} ${location ? `→ ${location}` : ''}`);
        }
      } catch (e) {
        // skip
      }
    }

    // 5. Get student list and try to find the actual send mechanism
    console.log('\n5. Checking cop_mip student list response...');
    const listResp = await scraper.request(
      `/admin/squad/cop_mip/getStudentList?squad_id=${squadId}&squad_type=offline`,
      { headers: { accept: 'application/json' } }
    );
    const listData = await listResp.json().catch(() => ({}));
    if (listData?.data?.[0]) {
      console.log('   First student (full):', JSON.stringify(listData.data[0]));
    }
    // Check if there are other fields that hint at distribution method
    const firstStudent = listData?.data?.[0] || {};
    console.log('   Available fields:', Object.keys(firstStudent).join(', '));

    // 6. Try study_mark/create to see the upload form
    console.log('\n6. Checking study_mark/create form...');
    const createResp = await scraper.request(
      `/admin/OnlineTest/study_mark/create?squad_id=${squadId}`,
      { headers: { accept: 'text/html' } }
    );
    if (createResp.ok) {
      const createHtml = await createResp.text();
      const $c = cheerio.load(createHtml);
      $c('form').each((_, form) => {
        const action = $c(form).attr('action') || '';
        const method = $c(form).attr('method') || 'GET';
        const enctype = $c(form).attr('enctype') || '';
        const inputs = [];
        $c(form).find('input, select, textarea').each((_, el) => {
          const name = $c(el).attr('name');
          const type = $c(el).attr('type') || 'text';
          if (name) inputs.push({ name, type });
        });
        console.log(`   Form: action=${action} method=${method} enctype=${enctype}`);
        console.log(`   Inputs:`, inputs);
      });
    } else {
      console.log(`   study_mark/create: ${createResp.status}`);
    }

  } catch (error) {
    console.error('Probe failed:', error.message);
  } finally {
    await scraper.close();
  }
}

probe();
