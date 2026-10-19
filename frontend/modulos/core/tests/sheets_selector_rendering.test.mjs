import test from 'node:test';
import assert from 'node:assert/strict';
import {patchSheetSelectorRendering} from '../tools/sheets_selector_rendering.mjs';

test('managed multi selectors reuse the single capsule, including empty values and its full hit area',()=>{
  const source=`let DropdownMultipleWidget = class {};
    let DropdownWidget = class {};
    const DataValidationRenderMode={CUSTOM:2};
    const getCellValueOrigin=data=>data?.v;
    for (const method of ['drawWith','calcCellAutoHeight','calcCellAutoWidth','isHit']) {
      DropdownMultipleWidget.prototype[method]=function(...args){return {legacy:true,args};};
      DropdownWidget.prototype[method]=function(...args){return {capsule:true,args};};
    }`;
  const patched=patchSheetSelectorRendering(source);
  assert.equal(patchSheetSelectorRendering(patched),patched);
  assert.throws(()=>patchSheetSelectorRendering('changed SDK'),/Revisar/);
  const Widget=new Function(patched+'\nreturn DropdownMultipleWidget;')();
  let rule={uid:'bold-validation-tasks-collaborators',renderMode:2,type:'listMultiple'};
  const widget=new Widget();
  widget._dataValidationModel={getRuleByLocation:()=>rule,getValidator:()=>({parseCellValue:value=>value?JSON.parse(value):[]})};
  for (const value of ['',JSON.stringify(['Samuel','David Urbina'])]) {
    const info={unitId:'book',subUnitId:'sheet',row:1,col:2,data:{v:value}};
    const draw=widget.drawWith('context',info,'skeleton');
    assert.equal(draw.capsule,true);
    assert.equal(draw.args[1].data.v,value?'Samuel, David Urbina':'');
    assert.equal(info.data.v,value,'rendering must never modify the saved selection');
    assert.equal(widget.isHit({x:5,y:5},info).capsule,true);
    assert.equal(widget.calcCellAutoHeight(info).capsule,true);
    assert.equal(widget.calcCellAutoWidth(info).capsule,true);
  }
  rule={uid:'imported-excel-rule',renderMode:2};
  assert.equal(widget.drawWith('context',{data:{v:''}}).legacy,true);
});
