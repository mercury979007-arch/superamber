import { describe,it,expect } from 'vitest';
import { defaultRotationConfig,rotateCircularLayoutForWeek,rotateCircularGroupOrderForWeek,rotateCircularGroupLabelsForWeek } from './layouts';
describe('six-table physical cross rotation',()=>{
 const config={...defaultRotationConfig('circular'),groupRotation:'front-back-swap' as const,internalRotation:'none' as const};
 it('moves students, group identity and labels through 1→5→3→4→2→6 and returns after six rounds',()=>{
  let groups=Array.from({length:6},(_,i)=>[`Student-${i+1}`,...Array(7).fill('')]);
  const original=JSON.stringify(groups);let order=[1,2,3,4,5,6],labels=['A','B','C','D','E','F'];
  for(const target of [4,2,3,1,5,0]){
   groups=rotateCircularLayoutForWeek(groups,config);order=rotateCircularGroupOrderForWeek(order,6,config);labels=rotateCircularGroupLabelsForWeek(labels,6,config);
   expect(groups[target][0]).toBe('Student-1');expect(order[target]).toBe(1);expect(labels[target]).toBe('A');expect(groups.flat().filter(Boolean).sort()).toEqual(['Student-1','Student-2','Student-3','Student-4','Student-5','Student-6']);
  }
  expect(JSON.stringify(groups)).toBe(original);
 });
 it('skips empty physical positions and preserves a 45-person roster',()=>{
  const groups=Array.from({length:6},(_,i)=>Array.from({length:8},(_,j)=>i*8+j<45?`Student-${i*8+j}`:''));
  expect(rotateCircularLayoutForWeek(groups,config).flat().filter(Boolean).sort()).toEqual(groups.flat().filter(Boolean).sort());
  const sparse=[['A'],[],['C'],[],['E'],[]];expect(rotateCircularLayoutForWeek(sparse,config).flat().filter(Boolean).sort()).toEqual(['A','C','E']);
 });
});
