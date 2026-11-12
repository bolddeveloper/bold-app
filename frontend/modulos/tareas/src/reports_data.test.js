import test from 'node:test';
import assert from 'node:assert/strict';
import {chartRows,reportNumber,metricDefaults} from './reports_data.js';
test('date charts preserve missing calendar buckets without inventing duration values',()=>{
    const definition={from:'2026-11-01',to:'2026-11-03',group_by:'day'};
    const groups=[{key:'2026-11-01',label:'2026-11-01',value:3},{key:'2026-11-03',label:'2026-11-03',value:2}];
    assert.deepEqual(chartRows({definition,groups,unit:'count'}).map(row=>row.value),[3,0,2]);
    assert.deepEqual(chartRows({definition,groups,unit:'hours'}).map(row=>row.value),[3,null,2]);
});
test('duration and unknown values remain distinguishable from real zero',()=>{
    assert.equal(reportNumber(null),'Sin datos');assert.equal(reportNumber(0),'0');assert.match(reportNumber(1.5,'hours'),/h$/);
});
test('switching to meetings removes unsupported employee filters and preserves project choices',()=>{
    const result=metricDefaults('meetings.total',{scope:'team',group_by:'employee',filters:{assignments:['person'],projects:['p']}});
    assert.equal(result.scope,'accessible');assert.equal(result.group_by,'week');assert.equal(result.date_basis,'start');assert.deepEqual(result.filters,{projects:['p']});
});
