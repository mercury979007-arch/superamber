const EducationSystemScraper = require('../../scraper/scraper');
const BASE = 'https://school.example.invalid';

async function probe() {
  const scraper = new EducationSystemScraper({ baseUrl: BASE, username: process.env.CNF_USER, password: process.env.CNF_PASS });
  await scraper.login();
  const classMap = await scraper.getClassMap();
  const squadId = classMap.find(c => c.classCode === 'J342').squadId;

  const { text: html } = await scraper.requestText(`/admin/squad_console?id=${squadId}&type=offline`, { headers: { accept: 'text/html' } });

  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    const content = script.replace(/<\/?script[^>]*>/gi, '');
    if (!content.includes('counpon-minipin')) continue;

    const lines = content.split('\n');

    // Find submitExcel / excelBatchNum / student_arr / curTag construction
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('submitExcel') || lines[i].includes('excelBatchNum') ||
          lines[i].includes('excelTag') || lines[i].includes('curTag') ||
          lines[i].includes('student_arr') || lines[i].includes('发放excel')) {
        // Print context
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 5); j++) {
          const prefix = j === i ? '>>>' : '   ';
          console.log(`${prefix} ${j}: ${lines[j].trim()}`);
        }
        console.log('---');
      }
    }

    // Also find the grant method to see tag format
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('tag:me.tagSelected') || lines[i].includes('tagSelected')) {
        for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 5); j++) {
          const prefix = j === i ? '>>>' : '   ';
          console.log(`${prefix} ${j}: ${lines[j].trim()}`);
        }
        console.log('---');
      }
    }

    // Find the getTableDataTag response and tag data structure
    console.log('\n=== Fetching tags for squad ===');
  }

  // Get actual tag data
  const tagResp = await scraper.request(
    `/admin/squad/cop_mip/getTableDataTag?squad_id=${squadId}&squad_type=offline&type=2&page[current]=1&page[size]=100`,
    { headers: { accept: 'application/json' } }
  );
  const tagData = await tagResp.json().catch(() => ({}));
  console.log('Tag response:', JSON.stringify(tagData).slice(0, 1000));

  await scraper.close();
}

probe().catch(console.error);
