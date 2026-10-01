/**
 * Test cop_mip/uploadGrant — the actual Excel upload endpoint for MP distribution
 */
const EducationSystemScraper = require('../../scraper/scraper');
const XLSX = require('xlsx');
const BASE = 'https://school.example.invalid';

async function test() {
  const scraper = new EducationSystemScraper({ baseUrl: BASE, username: process.env.CNF_USER, password: process.env.CNF_PASS });
  await scraper.login();
  console.log('✅ Login OK');

  const classMap = await scraper.getClassMap();
  const j342 = classMap.find(c => c.classCode === 'J342');
  const squadId = j342.squadId;

  // Get student list — pick first student for test
  const listResp = await scraper.request(
    `/admin/squad/cop_mip/getStudentList?squad_id=${squadId}&squad_type=offline`,
    { headers: { accept: 'application/json' } }
  );
  const listData = await listResp.json();
  const stu = listData.data[0];
  console.log(`Test student: ${stu.en_name} (${stu.ch_name}), no=${stu.no}, id=${stu.id}`);

  // Get CSRF
  const { text: consolePage } = await scraper.requestText(
    `/admin/squad_console?id=${squadId}&type=offline`,
    { headers: { accept: 'text/html' } }
  );
  const csrfToken = scraper.extractLoginToken(consolePage);
  const xsrfCookie = scraper.getDecodedCookieValue('XSRF-TOKEN');

  // Generate Excel with 4 columns
  const wsData = [
    ['英文名', '中文名', '学号', '发放MP数量'],
    [stu.en_name, stu.ch_name, stu.no, 1],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '学生列表');
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  console.log(`Excel size: ${xlsxBuffer.length} bytes`);

  // Try uploadGrant with multipart/form-data
  const boundary = `----AmberMP${Date.now()}`;

  // Try different field names for the file
  for (const fileField of ['file', 'import', 'excel', 'upload']) {
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="_token"\r\n\r\n${csrfToken}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="squad_id"\r\n\r\n${squadId}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="squad_type"\r\n\r\noffline\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n2\r\n`,  // 2=MP
    ];
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="mp.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;
    const body = Buffer.concat([
      Buffer.from(parts.join(''), 'utf8'),
      Buffer.from(fileHeader, 'utf8'),
      xlsxBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);

    const resp = await scraper.request('/admin/squad/cop_mip/uploadGrant', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        accept: 'application/json',
        ...(xsrfCookie ? { 'x-xsrf-token': xsrfCookie } : {}),
      },
      body,
      redirect: 'manual',
    });
    const status = resp.status;
    const respBody = await resp.text();
    console.log(`\nuploadGrant (field=${fileField}): ${status}`);
    console.log(`  Body: ${respBody.slice(0, 500)}`);

    if (status >= 200 && status < 400) {
      try {
        const data = JSON.parse(respBody);
        if (data.code === 1) {
          console.log(`\n🎉 SUCCESS! Field name="${fileField}" works!`);
          break;
        }
      } catch {}
    }
  }

  // Also try with form-encoded (non-file) approach via grantBatch
  console.log('\n--- Also testing grantBatch ---');
  // From Vue code: students is an array, each with stuTagAry containing id, tag list, number
  const batchParam = {
    squad_type: 'offline',
    squad_id: squadId,
    type: '2',  // MP
    'students[0][id]': stu.id,
    'students[0][number]': '1',
    'students[0][tag]': '[]',
    _token: csrfToken,
  };

  const batchResp = await scraper.request('/admin/squad/cop_mip/grantBatch', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...(xsrfCookie ? { 'x-xsrf-token': xsrfCookie } : {}),
    },
    body: new URLSearchParams(batchParam).toString(),
    redirect: 'manual',
  });
  const batchStatus = batchResp.status;
  const batchBody = await batchResp.text();
  console.log(`grantBatch: ${batchStatus}`);
  console.log(`  Body: ${batchBody.slice(0, 500)}`);

  await scraper.close();
}

test().catch(console.error);
