import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MakeupTool from './MakeupTool';
import { saveStageData } from '../utils/makeupData';
import { extractScheduleWorkbook } from '../utils/scheduleExtraction.mjs';

beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('new schedule extraction view',()=>{
  it('requires choosing a class before generating the original website messages',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-07T01:00:00Z'));
    const data=extractScheduleWorkbook({filename:'test.xlsx',sheets:[{name:'明细',rows:[
      ['班号','日期','进度','人数','班主任','上课教师','校区'],
      ['K218','2026-09-08','Weather 1','18','甲','A','东校区'],
      ['K219','2026-09-10','Weather 1','19','乙','B','西校区']
    ]}]},{stage:'L2',calendar:{academicYear:2026,week1Start:'2026-08-31'}});
    saveStageData('L2',data);
    render(<MakeupTool onBack={()=>{}}/>);
    fireEvent.change(screen.getByLabelText('补课需求'),{target:{value:'K218 W2周二请假，想周四补课'}});
    fireEvent.click(screen.getByRole('button',{name:'查找同进度候选'}));
    const confirm=screen.getByRole('button',{name:'确认选择，生成网站原版话术'}) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(confirm);
    expect(screen.getByText(/亲爱的家长，请查收/)).toBeTruthy();
    expect(screen.getByText(/调课请务必携带姓名牌哦/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('补课需求'),{target:{value:'K218 W3周二请假'}});
    expect(screen.queryByText(/亲爱的家长，请查收/)).toBeNull();
  });
  it('loads the new dataset then switches to an unavailable stage without hook-order errors',()=>{
    const data=extractScheduleWorkbook({filename:'test.xlsx',sheets:[{name:'明细',rows:[['班号','日期','进度'],['K218','2026-09-08','A1']]}]},
      {stage:'L2',calendar:{academicYear:2026,week1Start:'2026-08-31'}});
    saveStageData('L2',data);
    render(<MakeupTool onBack={()=>{}}/>);
    expect(screen.getByText(/1 条通过提取校验的课次/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'L3'}));
    expect(screen.getByText(/目前只收到L1、L2的进度表，暂未收到L3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'L2'}));
    expect(screen.getByLabelText('补课需求')).toBeTruthy();
  });
});
