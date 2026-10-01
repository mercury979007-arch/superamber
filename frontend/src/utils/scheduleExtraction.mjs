// Format-independent extraction contract. Spreadsheet readers only supply cells;
// the browser and Agent both use this module to interpret and validate them.
export const EXTRACTION_VERSION = 'schedule-extraction-v2';
const DAY_MS = 86400000;
const DAYS = ['周日','周一','周二','周三','周四','周五','周六'];
const text = value => String(value ?? '').normalize('NFKC').replace(/\s+/g,' ').trim();
const key = value => text(value).toLowerCase().replace(/[\s()【】\[\]_:：-]/g,'');
const emptySlot = () => ({day:'',time:'',end_time:'',teacher:'',campus:'',room:''});
const dateAt = value => Date.parse(`${value}T12:00:00Z`);
const dateKey = value => new Date(value).toISOString().slice(0,10);
const addDays = (value, n) => dateKey(dateAt(value) + n * DAY_MS);
const dateDay = value => DAYS[new Date(dateAt(value)).getUTCDay()];
export const scheduleWeek = (value, start) => Math.floor((dateAt(value)-dateAt(start))/ (7*DAY_MS))+1;

const ALIASES = {
  class_code:['班级','班号','班级号','班级编号','班级编码','class','classcode','classid'],
  stage:['学段','所属学段','stage','level'],
  batch:['批次','开班批次','入学时间','统一命名'],
  type:['类型','类型细分','班级类型','课程类型'],
  grade:['年级','主体年级','所属年级','学生年级','grade'],
  head_teacher:['班主任','现班主任','班主任匹配','headteacher'],
  student_count:['人数','班级人数','学生数','人数权威'],
  teacher:['教师','老师','任课教师','任课老师','授课老师','授课教师','teacher'],
  day:['星期','周几','上课星期','上课日','day','weekday'],
  time:['时间','上课时间','课程时间','开始时间','上课时刻','time','starttime'],
  end_time:['下课时间','结束时间','endtime'],
  campus:['校区','上课校区','campus'],
  room:['教室','地点','上课地点','上课教室','room','location'],
  date:['日期','上课日期','授课日期','date'],
  week:['周次','教学周','周数','week'],
  lesson:['进度','课程进度','教学进度','授课内容','教学内容','课次内容','课次','内容','课程内容','课名','lesson','progress'],
  course_info:['课程信息','课程详情'],
};

function fieldFor(label) {
  let normalized=key(label);
  const mode=/周中|周内|weekday/.test(normalized) && normalized!=='weekday' ? 'weekday'
    : /周末|weekend/.test(normalized) ? 'weekend' : '';
  normalized=normalized.replace(/周中|周内|周末|weekday|weekend/g,'');
  if (!normalized && key(label)==='weekday') normalized='day';
  const field=Object.entries(ALIASES).find(([,values])=>values.includes(normalized))?.[0];
  return field ? (mode && ['teacher','day','time','end_time','room','campus','date','head_teacher'].includes(field) ? `${mode}.${field}` : field) : '';
}

function dayIn(value) {
  const short=({'一':'周一','二':'周二','三':'周三','四':'周四','五':'周五','六':'周六','日':'周日','天':'周日','1':'周一','2':'周二','3':'周三','4':'周四','5':'周五','6':'周六','7':'周日',mon:'周一',tue:'周二',wed:'周三',thu:'周四',fri:'周五',sat:'周六',sun:'周日',monday:'周一',tuesday:'周二',wednesday:'周三',thursday:'周四',friday:'周五',saturday:'周六',sunday:'周日'})[text(value).toLowerCase()];
  if(short) return short;
  const found=[...text(value).matchAll(/(?:周|星期|礼拜)([一二三四五六日天1-7])/g)]
    .map(m=>`周${({'1':'一','2':'二','3':'三','4':'四','5':'五','6':'六','7':'日','天':'日'})[m[1]]||m[1]}`);
  return [...new Set(found)].length===1 ? found[0] : '';
}

function clockIn(value) {
  if(/^0\.\d+$/.test(text(value))) {
    const minutes=Math.round(Number(value)*24*60);
    return minutes<1440?{time:`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`,end_time:'',invalid:false}:{time:'',end_time:'',invalid:true};
  }
  const matches=[...text(value).matchAll(/(?<!\d)(\d{1,2})[:：](\d{2})(?::\d{2})?(?!\d)/g)];
  if (!matches.length) return {time:'',end_time:'',invalid:!!text(value) && !dayIn(value)};
  const values=matches.map(m=>Number(m[1])<24 && Number(m[2])<60 ? `${m[1].padStart(2,'0')}:${m[2]}` : '');
  return {time:values[0]||'',end_time:values[1]||'',invalid:values.some(v=>!v)||values.length>2 || (values.length===2 && values[1]<=values[0])};
}

function checkedDate(year, month, day) {
  const value=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const stamp=dateAt(value);
  return Number.isFinite(stamp) && dateKey(stamp)===value ? value : '';
}

function weekIn(value) {
  const match=text(value).match(/(?:\bW(?:eek)?\s*|第\s*)(\d+)\s*周?/i);
  if(match) return Number(match[1]);
  const chinese=text(value).match(/第\s*([一二三四五六七八九十]+)\s*周/);
  if(!chinese) return null;
  const digits={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  const parts=chinese[1].split('十');
  return parts.length===2?(digits[parts[0]]||1)*10+(digits[parts[1]]||0):digits[parts[0]]||null;
}

function rangeIn(value, calendar) {
  const raw=text(value);
  const first=raw.match(/(?:(20\d{2})[年/.-])?(\d{1,2})[月/.\-](\d{1,2})日?/);
  if (!first) {
    const week=weekIn(raw);
    if (!week) return null;
    const start=addDays(calendar.week1Start,(week-1)*7);
    return {start,end:addDays(start,6),explicitWeek:week,basis:'week+calendar',raw};
  }
  const baseYear=Number(calendar.academicYear);
  // The configured term, not today's date or a filename's year, owns the year.
  const startMonth=Number(calendar.week1Start.slice(5,7));
  const year=first[1]?Number(first[1]):baseYear+(Number(first[2])<startMonth && startMonth>=7 ? 1:0);
  const start=checkedDate(year,Number(first[2]),Number(first[3]));
  const tail=raw.slice(first.index+first[0].length);
  const second=tail.match(/^\s*[-—–~～至到]\s*(?:(20\d{2})[年/.-])?(?:(\d{1,2})[月/.\-])?(\d{1,2})日?/);
  const endMonth=second?.[2]?Number(second[2]):Number(first[2]);
  const endYear=second?.[1]?Number(second[1]):year+(endMonth<Number(first[2])?1:0);
  const end=second?checkedDate(endYear,endMonth,Number(second[3])):start;
  if (!start||!end||end<start||dateAt(end)-dateAt(start)>31*DAY_MS) return {invalid:true,raw};
  return {start,end,explicitWeek:weekIn(raw),basis:first[1]?'explicit-date':'month-day+calendar',raw};
}

function materialStatus(value) {
  const raw=text(value);
  if (!raw || /^(\/|\\|[-—]|无|暂无)$/.test(raw)) return 'empty';
  if (/放假|停课|不上课|休课/.test(raw)) return 'cancelled';
  if (/升段|预计.*升\s*[LS]\d*|转段/.test(raw)) return 'stage-change';
  if (/补班.*课程|另行通知|待定|待确认/.test(raw)) return 'notice';
  return 'lesson';
}

function cell(sheet, row, col, raw) {
  let c=col+1, letters='';
  while(c>0){letters=String.fromCharCode(65+(c-1)%26)+letters;c=Math.floor((c-1)/26);}
  return {sheet,row:row+1,column:col+1,cell:`${letters}${row+1}`,raw:text(raw)};
}

function expandMerges(sheet) {
  const rows=(sheet.rows||[]).map(r=>[...r]);
  for(const merge of sheet.merges||[]) for(let r=merge.s.r;r<=merge.e.r;r++) for(let c=merge.s.c;c<=merge.e.c;c++) {
    rows[r]??=[];
    if(!text(rows[r][c])) rows[r][c]=rows[merge.s.r]?.[merge.s.c];
  }
  return rows;
}

// Header discovery accepts reordered columns and nested mode headers. Unknown
// columns remain visible in the extraction report rather than being guessed.
function discoverHeaders(sheet, calendar, columnMap) {
  const rows=expandMerges(sheet), blocks=[];
  for(let r=0;r<rows.length;r++) {
    const row=rows[r]||[];
    if(!row.some(v=>fieldFor(v)==='class_code') && !(columnMap && r===(sheet.headerRow??0) && Object.values(columnMap).includes('class_code'))) continue;
    if(blocks.some(b=>r<=b.endRow)) continue;
    let endRow=r;
    // Continue while the next row is header-like, not a class-data row.
    for(let n=r+1;n<=Math.min(r+2,rows.length-1);n++) {
      const next=rows[n]||[];
      if(next.some(v=>/^(?!W\d+$)[A-Za-z]{1,2}\d{1,6}$/.test(text(v)))) break;
      if(next.some(v=>fieldFor(v) || rangeIn(v,calendar))) endRow=n; else break;
    }
    const count=Math.max(...rows.slice(r,endRow+1).map(v=>v.length));
    const columns=[];
    for(let c=0;c<count;c++) {
      const pieces=[...new Set(rows.slice(r,endRow+1).map(v=>text(v[c])).filter(Boolean))];
      const label=pieces.join(' ');
      const mapped=columnMap?.[c] || fieldFor(label) || (pieces.length===1?fieldFor(pieces[0]):'');
      columns.push({index:c,label,field:mapped,period:mapped?null:rangeIn(label,calendar)});
    }
    blocks.push({startRow:r,endRow,columns});
  }
  return {rows,blocks};
}

export function extractScheduleWorkbook(workbook, options={}) {
  const calendar=options.calendar;
  if(!calendar?.week1Start||!Number.isInteger(Number(calendar.academicYear))||!Number.isFinite(dateAt(calendar.week1Start))) {
    throw new Error('提取课程表需要明确的学年和第一周起始日期，不能猜测年份。');
  }
  const selectedStage=text(options.stage).toUpperCase();
  const classMap=new Map(), candidates=[], review=[], skipped=[], tables=[];
  const issue=(code,message,source,details={})=>review.push({code,message,source,...details});
  for(const sheet of workbook.sheets||[]) {
    const {rows,blocks}=discoverHeaders(sheet,calendar,options.columnMappings?.[sheet.name]);
    if(!blocks.length) {skipped.push({sheet:sheet.name,reason:'未发现班号表头'});continue;}
    for(let b=0;b<blocks.length;b++) {
      const block=blocks[b],end=blocks[b+1]?.startRow??rows.length;
      tables.push({sheet:sheet.name,headerRow:block.startRow+1,columns:block.columns});
      const idx=field=>block.columns.filter(c=>c.field===field);
      const get=(row,field)=>idx(field).map(c=>text(row[c.index])).find(Boolean)||'';
      const proof=(row,r,field)=>idx(field).map(c=>cell(sheet.name,r,c.index,row[c.index])).filter(p=>p.raw);
      for(let r=block.endRow+1;r<end;r++) {
        const row=rows[r]||[],code=get(row,'class_code').toUpperCase();
        if(!code) {
          const content=block.columns.find(c=>(c.period||c.field==='lesson')&&materialStatus(row[c.index])==='lesson');
          if(content) issue('missing_class','课次有内容但缺少班号，未自动继承上一行',cell(sheet.name,r,content.index,row[content.index]));
          continue;
        }
        const classSource=proof(row,r,'class_code')[0];
        const ambiguousFields=[...new Set(block.columns.map(c=>c.field).filter(Boolean))].filter(f=>new Set(idx(f).map(c=>text(row[c.index])).filter(Boolean)).size>1);
        if(ambiguousFields.length) {issue('conflicting_columns',`${code} 同义字段列内容不一致`,classSource,{fields:ambiguousFields});continue;}
        if(!/^[A-Z]{1,2}\d{1,6}$/.test(code)) {issue('invalid_class','班号格式待核实',classSource);continue;}
        const rowStage=get(row,'stage').toUpperCase()||selectedStage;
        if(selectedStage&&rowStage!==selectedStage) {issue('stage_mismatch',`${code} 所属${rowStage}与当前${selectedStage}不一致`,classSource);continue;}
        const info=get(row,'course_info').split('|').map(text);
        const base={day:get(row,'day')||info[0]||'',time:get(row,'time')||info[2]||'',
          end_time:get(row,'end_time'),teacher:get(row,'teacher')||info[6]||'',
          campus:get(row,'campus'),room:get(row,'room')||info[1]||''};
        const meta={class_code:code,stage:rowStage,batch:get(row,'batch'),type:get(row,'type'),grade:get(row,'grade'),
          head_teacher:get(row,'head_teacher')||info[7]||'',student_count:get(row,'student_count'),weekday:emptySlot(),weekend:emptySlot()};
        const slots={};
        for(const mode of ['weekday','weekend']) {
          const scoped={};
          for(const f of Object.keys(base)) scoped[f]=get(row,`${mode}.${f}`)||base[f];
          // Some time columns contain a weekday; others combine weekday and clock.
          const rawClock=clockIn(scoped.time),rawEnd=clockIn(scoped.end_time);
          const day=dayIn(scoped.day)||dayIn(scoped.time);
          slots[mode]={...scoped,day,time:rawClock.invalid?'':rawClock.time,end_time:rawEnd.time||rawClock.end_time};
          if(rawClock.invalid|| (scoped.end_time&&rawEnd.invalid)) issue('invalid_time',`${code} 上课时间无法确认`,proof(row,r,`${mode}.time`)[0]||proof(row,r,'time')[0]||classSource);
          meta[mode]=slots[mode];
        }
        if(!classMap.has(code)) classMap.set(code,meta);
        const periodColumns=block.columns.filter(c=>c.period);
        const longDate=get(row,'date'),longWeek=get(row,'week');
        const lessonCol=idx('lesson')[0];
        const records=periodColumns.map(c=>({column:c.index,period:c.period,label:c.label,lesson:text(row[c.index])}));
        if(lessonCol) {
          const weekLabel=/^\d+$/.test(longWeek)?`W${longWeek}`:longWeek;
          const period=rangeIn(longDate || weekLabel,calendar);
          if(period&&longWeek) period.explicitWeek=weekIn(weekLabel);
          records.push({column:lessonCol.index,period,label:longDate||weekLabel,lesson:text(row[lessonCol.index])});
        }
        if(!records.length) issue('no_progress_columns',`${code} 已识别基础信息，未识别日期/周次与课程进度的对应关系`,classSource);
        for(const record of records) {
          const source=cell(sheet.name,r,record.column,row[record.column]);
          if(/上学期|历史|去年/.test(record.label)) {skipped.push({status:'historical',class_code:code,source});continue;}
          const status=materialStatus(record.lesson);
          if(status!=='lesson') {if(status!=='empty') skipped.push({status,class_code:code,source});continue;}
          const period=record.period;
          if(!period||period.invalid) {issue('invalid_period',`${code} 课次缺少有效日期/周次`,source);continue;}
          const header=record.label;
          const replacement=header.match(/补[【\[]?(?:周|星期)([一二三四五六日天])/);
          let mode=/周中|周内/.test(header)?'weekday':/周末/.test(header)?'weekend':'';
          let date='',slot;
          if(replacement) {
            const originalDay=`周${replacement[1].replace('天','日')}`;
            if(period.start!==period.end) {
              // A single cell cannot identify which lesson belongs to a combined
              // ordinary/shifted date range. Only an unaffected Saturday is clear.
              if(slots.weekend.day==='周六' && dateDay(period.start)==='周六') {mode='weekend';date=period.start;}
              else {issue('ambiguous_reschedule',`${code} 合并调课列需核实实际日期与课次`,source,{header});continue;}
            } else {
              mode=['周六','周日'].includes(originalDay)?'weekend':'weekday';
              if(slots[mode].day!==originalDay) {issue('reschedule_day_mismatch',`${code} 补班对应星期与原课表不一致`,source,{header});continue;}
              date=period.start;
            }
          }
          if(!mode) {
            const d=dayIn(base.day)||dayIn(base.time);
            if(d) mode=['周六','周日'].includes(d)?'weekend':'weekday';
            else if(period.start===period.end) mode=['周六','周日'].includes(dateDay(period.start))?'weekend':'weekday';
            else {
              const possible=['weekday','weekend'].filter(m=>slots[m].day && Array.from({length:Math.round((dateAt(period.end)-dateAt(period.start))/DAY_MS)+1},(_,i)=>dateDay(addDays(period.start,i))).includes(slots[m].day));
              if(possible.length===1) mode=possible[0];
            }
          }
          if(!mode) {issue('ambiguous_mode',`${code} 无法确定该列对应哪次上课`,source);continue;}
          slot=slots[mode];
          if(!date && period.start===period.end) {
            date=period.start;
            if(slot.day && slot.day!==dateDay(date)) {issue('weekday_date_conflict',`${code} 日期与星期冲突`,source);continue;}
          }
          if(!date) {
            const dates=[];
            for(let d=period.start;d<=period.end;d=addDays(d,1)) if(dateDay(d)===slot.day) dates.push(d);
            if(dates.length!==1) {issue('ambiguous_date',`${code} 日期区间不能唯一定位上课日`,source);continue;}
            date=dates[0];
          }
          const week=scheduleWeek(date,calendar.week1Start);
          if(period.explicitWeek && period.explicitWeek!==week) {issue('week_date_conflict',`${code} 标注W${period.explicitWeek}与学期日历W${week}不一致`,source);continue;}
          // A cancellation annotation covering this exact day overrides content.
          if(/放假|停课/.test(header) && (period.start===period.end || /周末.*放假/.test(header)
            || (dateDay(date)==='周五'&&/周五.*放假/.test(header))
            || (['周四','周五'].includes(dateDay(date))&&/周四五.*放假/.test(header))
            || (['周一','周二','周三'].includes(dateDay(date))&&/周\s*1\s*2\s*3.*放假/.test(header)))) {
            skipped.push({status:'cancelled-by-header',class_code:code,source});continue;
          }
          const evidence={class_code:proof(row,r,'class_code'),lesson:[source],date:lessonCol?.index===record.column
            ? [...proof(row,r,'date'),...proof(row,r,'week')].map(p=>({...p,basis:period.basis}))
            : [{...cell(sheet.name,block.startRow,record.column,header),basis:period.basis}],
            teacher:[...proof(row,r,`${mode}.teacher`),...proof(row,r,'teacher')],time:[...proof(row,r,`${mode}.time`),...proof(row,r,'time')],
            campus:[...proof(row,r,`${mode}.campus`),...proof(row,r,'campus')],room:[...proof(row,r,`${mode}.room`),...proof(row,r,'room')]};
          for(const field of ['teacher','time','room']) if(slot[field]&&!evidence[field].length) {
            evidence[field]=proof(row,r,'course_info').map(p=>({...p,basis:'course-info-parts'}));
          }
          candidates.push({id:`${code}__${date}__${slot.time||'unknown'}`,class_code:code,stage:rowStage,date,week,
            week_label:`W${week} ${mode==='weekday'?'周中':'周末'} [${date}]`,week_col:record.column+1,
            mode:mode==='weekday'?'周中':'周末',lesson:record.lesson,day:dateDay(date),original_day:slot.day,
            time:slot.time,end_time:slot.end_time,teacher:slot.teacher,campus:slot.campus,room:slot.room,
            grade:meta.grade,type:meta.type,head_teacher:meta.head_teacher,student_count:meta.student_count,
            missing_fields:['time','teacher','room','campus'].filter(f=>!slot[f]),evidence,sources:[source]});
        }
      }
    }
  }
  if(!tables.length) throw new Error('未识别到含班号的课程表。请保留班号表头，或提供明确的列映射后重新提取。');
  const groups=new Map();
  for(const record of candidates) {const list=groups.get(record.id)||[];list.push(record);groups.set(record.id,list);}
  const occurrences=[];
  for(const list of groups.values()) {
    const fields=['lesson','teacher','time','end_time','campus','room','stage','grade','type'];
    const conflicts=fields.filter(f=>new Set(list.map(r=>text(r[f])).filter(Boolean)).size>1);
    if(conflicts.length) {issue('conflicting_records',`${list[0].class_code} 同一课次在多处记录不一致，暂停推荐`,list[0].sources[0],{fields:conflicts,sources:list.flatMap(r=>r.sources)});continue;}
    const merged={...list[0],evidence:{...list[0].evidence},sources:list.flatMap(r=>r.sources)};
    for(const field of fields) merged[field]=list.map(r=>r[field]).find(Boolean)||'';
    for(const field of Object.keys(merged.evidence)) merged.evidence[field]=list.flatMap(r=>r.evidence[field]||[]);
    merged.missing_fields=['time','teacher','room','campus'].filter(f=>!merged[f]);
    occurrences.push(merged);
  }
  const classes=[...classMap.values()],times=occurrences.filter(o=>o.time).length;
  return {classes,occurrences,slots:[...new Map(occurrences.filter(o=>o.time).map(o=>[`${o.day}|${o.time}`,{day:o.day,time:o.time}])).values()],
    meta:{active_stage:selectedStage,supported_stages:[],source_name:workbook.filename||'',source_kind:'file',imported_at:new Date().toISOString(),
      data_format_version:8,schedule_revision:EXTRACTION_VERSION,has_grade:classes.some(c=>!!c.grade),invalid_week_labels:[],
      calendar:{...calendar},time_status:times===0?'missing':times===occurrences.length?'complete':'partial',warnings:review.map(r=>r.message),
      extraction:{version:EXTRACTION_VERSION,tables,review_items:review,skipped_records:skipped,recognized_records:occurrences.length,
        missing_field_counts:Object.fromEntries(['time','teacher','campus','room'].map(f=>[f,occurrences.filter(o=>!o[f]).length]))}}};
}

export function unavailableStageMessage(stage='', available=['L1','L2']) {
  const label=available.length?available.join('、'):'任何学段';
  return `目前只收到${label}的进度表，暂未收到${stage?stage+'学段的':'该学段的'}课程表，暂时无法匹配补课。收到后再为您匹配。`;
}
