import {describe,expect,it} from 'vitest';
import {protectedRebalanceMinimum} from './rebalanceController';

describe('protectedRebalanceMinimum',()=>{
  it('rounds the 97% execution floor upward',()=>{
    expect(protectedRebalanceMinimum(100n)).toBe(97n);
    expect(protectedRebalanceMinimum(101n)).toBe(98n);
    expect(protectedRebalanceMinimum(1n)).toBe(1n);
  });
});
