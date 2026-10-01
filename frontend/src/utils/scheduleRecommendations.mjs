import { scheduleWeek } from './scheduleExtraction.mjs';
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const signature = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g,'').replace(/lesson(?=\d)/g,'');

export function compareMakeupCandidates(origin, a, b) {
  const gradeRank = c => !origin.grade ? 0 : !c.grade ? 1 : clean(c.grade) === clean(origin.grade) ? 0 : 2;
  if (gradeRank(a) !== gradeRank(b)) return gradeRank(a) - gradeRank(b);
  if (!origin.grade || (!a.grade && !b.grade)) {
    const samePrefix = c => /^K/i.test(origin.class_code) && /^K/i.test(c.class_code);
    if (samePrefix(a) !== samePrefix(b)) return Number(samePrefix(b)) - Number(samePrefix(a));
    const number = c => Number(String(c.class_code).match(/\d+/)?.[0]);
    const distance = c => Number.isFinite(number(c)) ? Math.abs(number(c) - number(origin)) : Infinity;
    if (distance(a) !== distance(b)) return distance(a) - distance(b);
  }
  return b.score-a.score || a.date.localeCompare(b.date) || a.class_code.localeCompare(b.class_code);
}

export function makeupCandidateLine(c) {
  return [c.class_code, c.grade || '年级待核实', c.student_count == null || c.student_count === '' ? '人数待核实' : c.student_count+'人',
    '班主任：'+(c.head_teacher || '待核实'), '授课：'+(c.teacher || '待核实'),
    c.campus || '校区待核实', c.date+' '+c.day+' '+(c.time || '时间待核实')].join('｜');
}

export function recommendScheduleMakeup(dataset, text, now = new Date()) {
  const calendar=dataset.meta.calendar;
  if(!calendar?.week1Start) return {status:'clarify',message:'这份进度尚未通过新版提取校验，请重新导入。',candidates:[]};
  const weekOf=date=>scheduleWeek(date,calendar.week1Start);
  const iso=(m,d)=>`${calendar.academicYear+(Number(m)<Number(calendar.week1Start.slice(5,7))&&Number(calendar.week1Start.slice(5,7))>=7?1:0)}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const value=clean(text), code=[...value.matchAll(/(?<![A-Za-z0-9])([A-Za-z]{1,2}\d+)(?![A-Za-z0-9])/g)].map(m=>m[1].toUpperCase()).find(c=>!(/^(?:W\d+|L\d{1,2})$/.test(c)));
  if (!code) return {status:'clarify',message:'请补充班号、缺课日期或周中/周末，例如：K218 W2周二请假，想周四补课。',candidates:[]};
  const meta=dataset.classes.find(c=>c.class_code===code);
  if (!meta) return {status:'not_found',message:`${code} 不在当前 ${dataset.meta.active_stage} 进度表中，请核对班号或学段。`,candidates:[]};
  const missedPart=value.split(/请假|缺课|想|需要补课/)[0];
  const weekMatch=value.match(/W\s*(\d+)/i);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  let week=weekMatch ? Number(weekMatch[1]) : weekOf(today);
  if (!weekMatch && /下周/.test(value)) week++;
  if (!weekMatch && /上周/.test(value)) week--;
  const explicitDate=missedPart.match(/(?:(20\d{2})[-/.年])?(\d{1,2})[./月-](\d{1,2})/);
  const requestedDate=explicitDate ? (explicitDate[1]?`${explicitDate[1]}-${explicitDate[2].padStart(2,'0')}-${explicitDate[3].padStart(2,'0')}`:iso(explicitDate[2],explicitDate[3])) : '';
  const missingDay=missedPart.match(/(?:周|星期)([一二三四五六日天])/);
  const mode=/周末/.test(missedPart)?'周末':/周中|周内/.test(missedPart)?'周中':'';
  const origins=dataset.occurrences.filter(o=>o.class_code===code
    && (explicitDate ? o.date===requestedDate : weekOf(o.date)===week)
    && (!missingDay || o.day===`周${missingDay[1].replace('天','日')}`) && (!mode || o.mode===mode));
  if (origins.length!==1) return {status:'clarify',message:origins.length
    ? `${code} 有多节课，请明确缺课日期或周中/周末。`
    : `${code} 在指定日期/周次没有可确认课次（可能停课、调休或超出进度覆盖），请核对日期。`,candidates:[]};
  const origin=origins[0];
  const desired=value.match(/(?:想|希望|可以|能在|补到)(.*)/)?.[1] || '';
  const wantedDays=[...desired.matchAll(/(?:周|星期)([一二三四五六日天])/g)].map(m=>`周${m[1].replace('天','日')}`);
  const clocks=[...desired.normalize('NFKC').matchAll(/(\d{1,2})(?::(\d{2})|点)/g)].map(m=>{
    let hour=Number(m[1]),minute=Number(m[2]||0);
    if(/下午|晚上|傍晚/.test(desired)&&hour<12) hour+=12;
    return hour<24&&minute<60?hour*60+minute:NaN;
  });
  const validClocks=clocks.length>0 && clocks.length<=2 && clocks.every(n=>n>=0&&n<1440);
  const fitsTime=c=>{
    if(!c.time||!validClocks) return true;
    const [h,m]=c.time.split(':').map(Number),minutes=h*60+m;
    if(clocks.length===2 && /到|至|[-—～~]/.test(desired)) return minutes>=Math.min(...clocks)&&minutes<=Math.max(...clocks);
    if(/后|以后|之后/.test(desired)) return minutes>=clocks[0];
    if(/前|以前|之前/.test(desired)) return minutes<=clocks[0];
    return minutes===clocks[0];
  };
  const candidates=dataset.occurrences.filter(c=>c.class_code!==code && signature(c.lesson)===signature(origin.lesson)
    && c.date>=origin.date && c.date>=today && Math.abs(weekOf(c.date)-weekOf(origin.date))<=1
    && (!wantedDays.length || wantedDays.includes(c.day))
    && (!/周末/.test(desired) || ['周六','周日'].includes(c.day))
    && (!/周中|周内/.test(desired) || !['周六','周日'].includes(c.day)) && fitsTime(c))
    .map(c=>({...c,score:(weekOf(c.date)===weekOf(origin.date)?1000:0)+(c.type&&c.type===origin.type?25:0)+(c.grade&&c.grade===origin.grade?18:0)+(c.teacher&&c.teacher===origin.teacher?7:0)}))
    .sort((a,b)=>compareMakeupCandidates(origin,a,b));
  const missingTime=origin.time===''||candidates.some(c=>!c.time)||(/点|时|上午|下午|晚上|[:：]/.test(desired)&&!validClocks);
  const warning=missingTime?'进度表有课次未提供具体时刻；以下仅为同课次候选，时间条件尚未验证，地点与名额需核实，不能视为已安排补课。':'课次时间已从原表提取；以下是候选方案，可接收名额仍需老师确认，不能视为已安排补课。';
  return {status:'provisional',origin,candidates,message:[`${code} 缺课：${origin.date} ${origin.day} ${origin.lesson}`,warning,
    candidates.length?`找到 ${candidates.length} 个同进度候选，请在下方逐班选择。`:'当前覆盖范围与星期条件下没有同进度候选。',
    candidates.length?'请先选择具体班级和课次，再生成网站原版话术。':''].filter(Boolean).join('\n\n')};
}
