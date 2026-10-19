import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DateValidator}=require('@univerjs/sheets-data-validation');
const {mergeLocales}=require('@univerjs/core');
const rules=require('@univerjs/sheets-data-validation/locale/es-ES');
const ui=require('@univerjs/sheets-data-validation-ui/locale/es-ES');
const locale=mergeLocales(rules,ui)['sheets-data-validation'];
assert.equal(typeof locale.custom.error,'string');
const valid=DateValidator.prototype.isValidType;
assert.equal(await valid.call({}, {value:46213,interceptValue:'10/07/2026'}),true);
assert.equal(await valid.call({}, {value:'texto',interceptValue:'texto'}),false);


const {sheetLocales}=await import('../sheets_locales.js');
const spanish=sheetLocales[require('@univerjs/core').LocaleType.ES_ES]['sheets-ui'];
assert.equal(spanish.info.forceStringInfo,'Este valor está guardado como texto.');
assert.equal(spanish['data-validation'].alert.ok,'Aceptar','custom alerts must retain the calendar translations');

const calendar=sheetLocales[require('@univerjs/core').LocaleType.ES_ES].design.Calendar;
assert.deepEqual(calendar.months,['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']);
assert.deepEqual(calendar.weekDays,['Do','Lu','Ma','Mi','Ju','Vi','Sá']);
