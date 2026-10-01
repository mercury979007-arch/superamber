const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const STATUSES = ['new', 'diagnosing', 'needs-info', 'ready-for-review', 'released', 'closed'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function decodeImage(image) {
  const match = String(image?.dataUrl || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw fail('图片只支持 PNG、JPG 或 WebP');
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > 2 * 1024 * 1024) throw fail('每张图片不能超过 2 MB');
  const type = match[1];
  const valid = type === 'png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === 'jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw fail('图片内容与文件格式不符，请重新选择图片');
  return { data, type };
}
function createUserFeedbackStore(root) {
  const itemDir = id => {
    if (!/^FB-[a-f0-9]{24}$/.test(String(id))) throw fail('反馈不存在', 404);
    return path.join(root, id);
  };
  async function get(id) {
    try { return JSON.parse(await fs.readFile(path.join(itemDir(id), 'feedback.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function list(owner) {
    let entries;
    try { entries = await fs.readdir(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const items = await Promise.all(entries.filter(id => /^FB-[a-f0-9]{24}$/.test(id)).map(get));
    return items.filter(item => item && (!owner || item.owner === owner)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function create(username, input = {}) {
    const owner = hash(username.trim().toLowerCase());
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(input.clientId || ''))) throw fail('提交标识无效，请刷新后重试');
    const id = `FB-${hash(`${owner}:${input.clientId}`).slice(0,24)}`;
    const text = String(input.text || '').trim();
    if (!text || text.length > 2000) throw fail('请填写 1–2000 字的问题描述');
    if (!Array.isArray(input.images) || input.images.length > 3) throw fail('最多上传 3 张图片');
    const images = input.images.map(decodeImage);
    const existing = await get(id);
    if (existing) return existing;
    if ((await list(owner)).filter(x => Date.now() - Date.parse(x.createdAt) < 86400000).length >= 20) throw fail('今天已提交 20 条反馈，请明天再试', 429);
    const context = {};
    for (const key of ['screen','classCode','version','viewport','browser']) context[key] = String(input.context?.[key] || '').slice(0, key === 'browser' ? 300 : 100);
    const item = { id, owner, reporter: username, text, context, status: 'new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), publicNote: '', images: images.map((image, index) => ({ name: `${index}.${image.type}`, type: `image/${image.type}`, bytes: image.data.length })) };
    await fs.mkdir(root, { recursive:true, mode:0o700 });
    const temp = await fs.mkdtemp(path.join(root, '.submit-'));
    try {
      await fs.writeFile(path.join(temp, 'feedback.json'), JSON.stringify(item, null, 2), { mode:0o600 });
      for (let i=0; i<images.length; i++) await fs.writeFile(path.join(temp, item.images[i].name), images[i].data, { mode:0o600 });
      try { await fs.rename(temp, itemDir(id)); }
      catch(error) { if (!['EEXIST','ENOTEMPTY'].includes(error.code)) throw error; return await get(id); }
      return item;
    } finally { await fs.rm(temp, { recursive:true, force:true }); }
  }
  async function update(id, patch) {
    const item = await get(id);
    if (!item) throw fail('反馈不存在',404);
    if (patch.status && !STATUSES.includes(patch.status)) throw fail('反馈状态无效');
    const next = { ...item, updatedAt: new Date().toISOString() };
    for (const key of ['status','publicNote','diagnosis','candidateCommit','validation','reviewSession']) if (patch[key] !== undefined) next[key] = String(patch[key]).slice(0,8000);
    const temp = path.join(itemDir(id), `feedback.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(next,null,2), { mode:0o600 });
    await fs.rename(temp, path.join(itemDir(id),'feedback.json'));
    return next;
  }
  return { get, list, create, update, imagePath:(id,name)=>path.join(itemDir(id),name), ownerHash:username=>hash(username.trim().toLowerCase()) };
}
module.exports = { createUserFeedbackStore, decodeImage, STATUSES };
