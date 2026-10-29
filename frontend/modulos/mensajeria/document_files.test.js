import test from 'node:test';
import assert from 'node:assert/strict';
import {DOCUMENT_MIMES,documentFileError,prepareDocumentFile} from './document_files.js';
import {captureComposer,restoreComposer} from './composer_draft.js';
import {mediaDownloadName} from './resource_api.js';

test('document catalog is explicit, size bounded and canonicalizes Windows picker MIME without editing bytes',async()=>{
    for(const [extension,mime] of Object.entries(DOCUMENT_MIMES)){
        const file=new File(['original bytes'],'Entrega.'+extension,{type:'',lastModified:10});
        assert.equal(documentFileError(file),'');const result=prepareDocumentFile(file);
        assert.equal(result.type,mime);assert.equal(await result.text(),'original bytes');assert.equal(result.lastModified,10);
        assert.equal(mediaDownloadName({filename:'Entrega.'+extension,mime_type:mime}),file.name);
    }
    assert.equal(prepareDocumentFile(new File(['a,b'],'datos.csv',{type:'application/vnd.ms-excel'})).type,'text/csv');
    for(const [name,type] of [['run.exe','application/pdf'],['macros.docm','application/octet-stream'],['image.pdf','image/png'],['archive.zip','application/zip']])assert.ok(documentFileError(new File(['x'],name,{type})));
    assert.ok(documentFileError(new File([],'empty.txt',{type:'text/plain'})));
    assert.ok(documentFileError(new File([new Uint8Array(2*1024*1024+1)],'large.txt',{type:'text/plain'})));
});
test('documents and immutable failed attempts survive the existing encrypted composer envelope without conversion',async()=>{
    const file=new File(['%PDF-1.7 original'],'plan.pdf',{type:'application/pdf'});
    const saved=captureComposer({text:'Revisar',items:[{id:'doc',file,caption:'Plan',attempted:true}],attempt:{client_id:'same-send',body:'Plan',file}});
    const restored=restoreComposer(saved.payload,saved.files);
    assert.equal(restored.items[0].file,file);assert.equal(restored.attempt.file,file);assert.equal(restored.attempt.client_id,'same-send');
    assert.equal(await restored.items[0].file.text(),'%PDF-1.7 original');
    assert.throws(()=>restoreComposer(saved.payload,[new File(['x'],'plan.exe',{type:'application/octet-stream'})]),/Selecciona/);
});
