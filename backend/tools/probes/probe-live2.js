const EducationSystemScraper = require('../../scraper/scraper');
const BASE = 'https://school.example.invalid';

async function probe() {
  const scraper = new EducationSystemScraper({ baseUrl: BASE, username: process.env.CNF_USER, password: process.env.CNF_PASS });
  await scraper.login();
  console.log('✅ Login OK');

  const classMap = await scraper.getClassMap();
  const j342 = classMap.find(c => c.classCode === 'J342');
  const squadId = j342.squadId;

  // Fetch full squad_console HTML and extract the coupon-minipin Vue component
  const { text: html } = await scraper.requestText(`/admin/squad_console?id=${squadId}&type=offline`, { headers: { accept: 'text/html' } });

  // Extract all inline scripts
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const script of scripts) {
    const content = script.replace(/<\/?script[^>]*>/gi, '');
    if (content.includes('counpon-minipin') || content.includes('cop_mip') || content.includes('sendMip') || content.includes('grant')) {
      // Extract URL patterns (API endpoints)
      const urlPatterns = content.match(/url\s*[:=]\s*['"][^'"]+['"]/g) || [];
      const fetchPatterns = content.match(/\$\.(?:post|get|ajax)\s*\(\s*['"][^'"]+['"]/g) || [];
      const axiosPatterns = content.match(/axios\.(?:post|get|put|delete)\s*\(\s*['"][^'"]+['"]/g) || [];
      const allUrls = [...urlPatterns, ...fetchPatterns, ...axiosPatterns];

      if (allUrls.length > 0) {
        console.log('\n=== API URLs in cop_mip component ===');
        allUrls.forEach(u => console.log(`  ${u}`));
      }

      // Extract method names that involve sending/granting
      const methods = content.match(/(?:send|grant|发放|回收|distribute|submit|batch)[A-Za-z_]*/g) || [];
      if (methods.length > 0) {
        console.log('\n=== Methods ===');
        [...new Set(methods)].forEach(m => console.log(`  ${m}`));
      }

      // Find the actual POST/AJAX calls with their full context
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes('$.post') || line.includes('$.ajax') || line.includes('axios.post') ||
            (line.includes('url') && (line.includes('cop_mip') || line.includes('grant') || line.includes('send')))) {
          // Print this line and next 5 lines for context
          console.log(`\n=== Line ${i}: ${line}`);
          for (let j = 1; j <= 8 && i + j < lines.length; j++) {
            console.log(`   +${j}: ${lines[i + j].trim()}`);
          }
        }
      }

      // Also find data objects being sent
      const dataBlocks = content.match(/data\s*:\s*\{[^}]+\}/g) || [];
      if (dataBlocks.length > 0) {
        console.log('\n=== Data payloads ===');
        dataBlocks.forEach(d => console.log(`  ${d}`));
      }
    }
  }

  await scraper.close();
}

probe().catch(console.error);
