/**
 * Test cop_mip/uploadGrant with the correct format discovered from Vue source code
 *
 * uploadGrant expects $.post (form-encoded), NOT file upload:
 * - squad_id, squad_type, _token
 * - number: totalMP * 10 (MP stored as CP internally, 1 MP = 10 CP)
 * - tag_id: tag ID (category)
 * - tag_name: tag name
 * - student_arr: array of {id, number, ...} per student
 */
const EducationSystemScraper = require('../../scraper/scraper');
const BASE = 'https://school.example.invalid';

async function test() {
  const scraper = new EducationSystemScraper({ baseUrl: BASE, username: process.env.CNF_USER, password: process.env.CNF_PASS });
  await scraper.login();
  console.log('✅ Login OK');

  const classMap = await scraper.getClassMap();
  const squadId = classMap.find(c => c.classCode === 'J342').squadId;

  // Get student list
  const listResp = await scraper.request(
    `/admin/squad/cop_mip/getStudentList?squad_id=${squadId}&squad_type=offline`,
    { headers: { accept: 'application/json' } }
  );
  const listData = await listResp.json();
  const firstStudent = listData.data[0]; // Belinda
  console.log(`Student: ${firstStudent.en_name} (${firstStudent.ch_name}), id=${firstStudent.id}`);

  // Get CSRF token
  const { text: consolePage } = await scraper.requestText(
    `/admin/squad_console?id=${squadId}&type=offline`,
    { headers: { accept: 'text/html' } }
  );
  const csrfToken = scraper.extractLoginToken(consolePage);
  const xsrfCookie = scraper.getDecodedCookieValue('XSRF-TOKEN');

  // Get tag list (发放 tags)
  console.log('\n--- Getting tag list ---');
  // Try with correct pagination format
  const tagResp = await scraper.request(
    `/admin/squad/cop_mip/getTableDataTag?squad_id=${squadId}&squad_type=offline&type=1&page%5BpageNumber%5D=1&page%5BpageSize%5D=100`,
    { headers: { accept: 'application/json' } }
  );
  const tagData = await tagResp.json().catch(() => ({}));
  console.log('Tag response:', JSON.stringify(tagData).slice(0, 500));

  // If that doesn't work, try other formats
  if (tagData.code !== 1) {
    const tagResp2 = await scraper.request(
      `/admin/squad/cop_mip/getTableDataTag?squad_id=${squadId}&squad_type=offline&type=1`,
      { headers: { accept: 'application/json' } }
    );
    const tagData2 = await tagResp2.json().catch(() => ({}));
    console.log('Tag response (no pagination):', JSON.stringify(tagData2).slice(0, 500));
  }

  // Also check the actual tag form from Vue data
  // tagForm: { name:'', type:1, squad_id, squad_type, page:{current:1, size:20, total:0} }
  const tagResp3 = await scraper.request(
    `/admin/squad/cop_mip/getTableDataTag?squad_id=${squadId}&squad_type=offline&type=1&page[current]=1&page[size]=100`,
    { headers: { accept: 'application/json' } }
  );
  const tagData3 = await tagResp3.json().catch(() => ({}));
  console.log('Tag response (page[current]):', JSON.stringify(tagData3).slice(0, 500));

  // Use first available tag or hardcode a common one
  let tagId = null;
  let tagName = null;
  for (const td of [tagData, tagData3]) {
    if (td?.code === 1 && td?.data?.rows?.length > 0) {
      const firstTag = td.data.rows[0];
      tagId = firstTag.id;
      tagName = firstTag.name;
      console.log(`Using tag: id=${tagId}, name=${tagName}`);
      break;
    }
  }

  if (!tagId) {
    console.log('\n⚠️ No tags found. Trying uploadGrant without tag...');
  }

  // Test uploadGrant with form-encoded POST (not file upload!)
  console.log('\n--- Testing uploadGrant (form POST) ---');
  // student_arr format: array of objects with id and number (amount in MP)
  const studentArr = [
    { id: firstStudent.id, number: 1, en_name: firstStudent.en_name, ch_name: firstStudent.ch_name, no: firstStudent.no },
  ];

  const params = new URLSearchParams();
  params.append('squad_id', squadId);
  params.append('squad_type', 'offline');
  params.append('_token', csrfToken);
  params.append('number', String(1 * 10)); // 1 MP * 10 = 10 (internal unit)
  if (tagId) {
    params.append('tag_id', tagId);
    params.append('tag_name', tagName);
  }
  // Send student_arr as indexed form fields (jQuery $.post serialization)
  studentArr.forEach((stu, i) => {
    Object.entries(stu).forEach(([key, val]) => {
      params.append(`student_arr[${i}][${key}]`, String(val));
    });
  });

  console.log('Params:', params.toString().slice(0, 500));

  const grantResp = await scraper.request('/admin/squad/cop_mip/uploadGrant', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...(xsrfCookie ? { 'x-xsrf-token': xsrfCookie } : {}),
    },
    body: params.toString(),
    redirect: 'manual',
  });
  const status = grantResp.status;
  const body = await grantResp.text();
  console.log(`\nuploadGrant: ${status}`);
  console.log(`Body: ${body.slice(0, 500)}`);

  if (status === 200) {
    try {
      const data = JSON.parse(body);
      if (data.code === 1) {
        console.log('\n🎉 SUCCESS! MP distributed!');
      } else {
        console.log(`\n❌ Failed: ${data.msg}`);
      }
    } catch {}
  }

  await scraper.close();
}

test().catch(console.error);
