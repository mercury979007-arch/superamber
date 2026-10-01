const EducationSystemScraper = require('../../scraper/scraper');
const BASE = 'https://school.example.invalid';

async function probe() {
  const scraper = new EducationSystemScraper({ baseUrl: BASE, username: process.env.CNF_USER, password: process.env.CNF_PASS });
  await scraper.login();
  const classMap = await scraper.getClassMap();
  const squadId = classMap.find(c => c.classCode === 'J342').squadId;

  const { text: html } = await scraper.requestText(`/admin/squad_console?id=${squadId}&type=offline`, { headers: { accept: 'text/html' } });

  // Extract the FULL submitExcel / uploadGrant / grantBatch method bodies
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    const content = script.replace(/<\/?script[^>]*>/gi, '');
    if (!content.includes('counpon-minipin')) continue;

    // Find submitExcel method
    const submitExcelMatch = content.match(/submitExcel\s*(?:\([^)]*\))?\s*\{([\s\S]*?)(?:\n\s{16}\},|\n\s{20}\})/);
    if (submitExcelMatch) {
      console.log('=== submitExcel method ===');
      console.log(submitExcelMatch[0].slice(0, 1500));
    }

    // Find uploadGrant context (20 lines around it)
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('uploadGrant')) {
        console.log(`\n=== uploadGrant context (line ${i}) ===`);
        for (let j = Math.max(0, i - 15); j <= Math.min(lines.length - 1, i + 10); j++) {
          console.log(`${j}: ${lines[j]}`);
        }
      }
    }

    // Find grantBatch context
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('grantBatch') && !lines[i].includes('//')) {
        console.log(`\n=== grantBatch context (line ${i}) ===`);
        for (let j = Math.max(0, i - 10); j <= Math.min(lines.length - 1, i + 20); j++) {
          console.log(`${j}: ${lines[j]}`);
        }
      }
    }

    // Find batchSubmit method
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('batchSubmit') && lines[i].includes('function') || lines[i].match(/batchSubmit\s*\(/)) {
        console.log(`\n=== batchSubmit context (line ${i}) ===`);
        for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 30); j++) {
          console.log(`${j}: ${lines[j]}`);
        }
      }
    }
  }

  await scraper.close();
}

probe().catch(console.error);
