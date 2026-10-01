#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createUserFeedbackStore } = require('../lib/userFeedbackStore');
const args=process.argv.slice(2), command=args[0];
const arg=(name)=>args[args.indexOf(name)+1];
const option=(name,fallback='')=>args.includes(name)?arg(name):fallback;
const root=option('--root',process.env.SESSION_STORE_DIR ? path.join(process.env.SESSION_STORE_DIR,`user-feedback-${process.env.APP_ENV||'staging'}`) : '');
const labels={new:'待检查',diagnosing:'检查中','needs-info':'需补充','ready-for-review':'修复待验收',released:'已更新',closed:'已处理'};
const dateKey=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
function digest(items,date) {
  const today=items.filter(item=>dateKey(new Date(item.createdAt))===date);
  const pending=items.filter(item=>!['released','closed'].includes(item.status));
  const changed=items.filter(item=>dateKey(new Date(item.updatedAt))===date);
  const report=[`Super Amber 用户反馈 · ${date}`,`今日新增 ${today.length} 条；待处理 ${pending.length} 条；修复待验收 ${pending.filter(x=>x.status==='ready-for-review').length} 条。`];
  const active=[...new Map([...changed,...pending].map(item=>[item.id,item])).values()];
  for(const item of active.slice(0,12)) {
    report.push(`\n[${labels[item.status]||item.status}] ${item.id}\n${item.text.slice(0,160)}`);
    if(item.diagnosis)report.push(`检查：${item.diagnosis.slice(0,220)}`);
    if(item.validation)report.push(`自测：${item.validation.slice(0,220)}`);
    if(item.candidateCommit)report.push(`待验收版本：${item.candidateCommit}`);
    if(item.reviewSession)report.push(`验收记录：${item.reviewSession}`);
    if(item.publicNote)report.push(item.publicNote.slice(0,180));
  }
  if(active.length>12)report.push(`另有 ${active.length-12} 条已保留在反馈队列。`);
  if(!active.length) report.push('暂无需要处理的新反馈。');
  return report.join('\n');
}
async function main() {
  if(!root||!path.isAbsolute(root))throw new Error('必须通过 --root 指定实例反馈目录绝对路径');
  const store=createUserFeedbackStore(root);
  if(command==='list') { console.log(JSON.stringify(await store.list(),null,2)); return; }
  if(command==='review') {
    const patch=JSON.parse(await fs.readFile(option('--file'),'utf8'));
    console.log(JSON.stringify(await store.update(option('--id'),patch),null,2)); return;
  }
  const date=option('--date',dateKey());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日期格式应为 YYYY-MM-DD');
  const text=digest(await store.list(),date);
  if(command==='digest') { if(option('--output'))await fs.writeFile(option('--output'),text,{mode:0o600});else console.log(text); return; }
  if(command!=='send')throw new Error('用法：list | review --id <id> --file <json> | digest [--output <file>] | send [--date YYYY-MM-DD]，均需 --root <目录>');
  const reports=path.join(root,'.daily'); await fs.mkdir(reports,{recursive:true,mode:0o700});
  const receipt=path.join(reports,`${date}.json`), lock=path.join(reports,`${date}.lock`);
  try { const sent=JSON.parse(await fs.readFile(receipt,'utf8')); console.log(JSON.stringify({alreadySent:true,...sent}));return; }catch(error){if(error.code!=='ENOENT')throw error;}
  let handle;
  try {handle=await fs.open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw new Error('今日发送已有执行记录，请先核实回执；为避免重复推送，不自动重发。');throw error;}
  const taskFile=path.join(reports,`${date}.txt`);
  await fs.writeFile(taskFile,text,{mode:0o600});
  await handle.writeFile(JSON.stringify({startedAt:new Date().toISOString(),pid:process.pid})); await handle.close();
  const cliRoot=process.env.REMOTELAB_PROJECT_ROOT;if(!cliRoot)throw new Error('未找到实例 RemoteLab 连接器，发送记录已保留，需核查后重试');
  const result=spawnSync(process.execPath,[path.join(cliRoot,'cli.js'),'connector','call','wechat:send_text','--text',text,'--json'],{encoding:'utf8',timeout:120000});
  if(result.status!==0)throw new Error('微信发送未确认成功，请检查连接器回执和当日发送记录；队列与报告已保留');
  let delivery;try{delivery=JSON.parse(result.stdout);}catch{throw new Error('连接器未返回可识别回执，需核实送达后再处理');}
  if(delivery.error || delivery.success===false || delivery.ok===false)throw new Error('连接器报告发送失败，需核实送达状态');
  const record={date,sentAt:new Date().toISOString(),delivery};
  await fs.writeFile(receipt,JSON.stringify(record,null,2),{mode:0o600}); await fs.unlink(lock);
  console.log(JSON.stringify({sent:true,date}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={digest};
