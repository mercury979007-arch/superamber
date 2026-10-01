/**
 * Test the actual cop_mip/grant API with a real student
 * Give 1 MP to first student of J342 to verify the API works
 */
const EducationSystemScraper = require('../../scraper/scraper');
const BASE = 'https://school.example.invalid';

async function test() {
  const scraper = new EducationSystemScraper({ baseUrl: BASE, username: process.env.CNF_USER, password: process.env.CNF_PASS });
  await scraper.login();
  console.log('✅ Login OK');

  const classMap = await scraper.getClassMap();
  const j342 = classMap.find(c => c.classCode === 'J342');
  const squadId = j342.squadId;
  console.log(`J342 squadId: ${squadId}`);

  // Get student list
  const listResp = await scraper.request(
    `/admin/squad/cop_mip/getStudentList?squad_id=${squadId}&squad_type=offline`,
    { headers: { accept: 'application/json' } }
  );
  const listData = await listResp.json();
  const firstStudent = listData.data[0];
  console.log(`First student: id=${firstStudent.id}, no=${firstStudent.no}, en=${firstStudent.en_name}, ch=${firstStudent.ch_name}`);

  // Get CSRF token from squad_console page
  const { text: consolePage } = await scraper.requestText(
    `/admin/squad_console?id=${squadId}&type=offline`,
    { headers: { accept: 'text/html' } }
  );
  const csrfToken = scraper.extractLoginToken(consolePage);
  const xsrfCookie = scraper.getDecodedCookieValue('XSRF-TOKEN');
  console.log(`CSRF token: ${csrfToken ? csrfToken.slice(0, 10) + '...' : '(none)'}`);

  // Get tag list first (need to know what tags are available)
  console.log('\n--- Getting tag types ---');
  const typeResp = await scraper.request('/admin/squad/cop_mip/getTypeArr', { headers: { accept: 'application/json' } });
  const typeData = await typeResp.json().catch(() => ({}));
  console.log('Type data:', JSON.stringify(typeData?.data || {}).slice(0, 300));

  // Try grant API
  console.log('\n--- Testing cop_mip/grant (single student, 1 MP) ---');
  const grantParam = {
    squad_type: 'offline',
    squad_id: squadId,
    student_id: firstStudent.id,
    type: '2',        // 2 = MP (from grantType: 1=CP, 2=MP)
    tag: '',           // tag can be empty for simple grant
    number: '1',       // amount
    remark: 'test',
    _token: csrfToken,
  };
  console.log('Grant params:', JSON.stringify(grantParam));

  const grantResp = await scraper.request('/admin/squad/cop_mip/grant', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...(xsrfCookie ? { 'x-xsrf-token': xsrfCookie } : {}),
    },
    body: new URLSearchParams(grantParam).toString(),
    redirect: 'manual',
  });
  const grantStatus = grantResp.status;
  const grantBody = await grantResp.text();
  console.log(`Grant response: ${grantStatus}`);
  console.log(`Grant body: ${grantBody.slice(0, 500)}`);

  await scraper.close();
}

test().catch(console.error);
