// Picker hints and draft validation only. The server validates original bytes.
export const DOCUMENT_MIMES={pdf:'application/pdf',txt:'text/plain',csv:'text/csv',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
export const DOCUMENT_ACCEPT=Object.keys(DOCUMENT_MIMES).map(value=>'.'+value).join(',');
export const DOCUMENT_HINT='PDF, TXT/CSV UTF-8, DOCX, XLSX o PPTX sin macros. Hasta 10 MB; TXT/CSV hasta 2 MB. Un documento por mensaje.';
export const DOCUMENT_DOWNLOAD_WARNING='Archivo original sin análisis antivirus. Abre solo archivos de confianza.';
export function documentExtension(file){return /\.([^.]+)$/.exec(file?.name || '')?.[1]?.toLowerCase() || '';}
export function documentFileError(file){
    const extension=documentExtension(file),mime=DOCUMENT_MIMES[extension];
    if(!mime)return 'Selecciona PDF, TXT, CSV, DOCX, XLSX o PPTX. No se admiten ejecutables, ZIP ni Office con macros.';
    const allowed=['','application/octet-stream',mime,...(extension==='csv' ? ['application/vnd.ms-excel']:[])];
    if(!allowed.includes((file.type || '').toLowerCase()))return 'La extensión del documento no coincide con su tipo. Guarda una copia con su formato original.';
    const max=['txt','csv'].includes(extension) ? 2*1024*1024:10*1024*1024;
    if(!file.size || file.size>max)return `El documento no debe estar vacío ni superar ${max===2*1024*1024 ? '2':'10'} MB.`;
    return '';
}
export function prepareDocumentFile(file){
    const error=documentFileError(file);if(error)throw Error(error);
    const mime=DOCUMENT_MIMES[documentExtension(file)];
    return file.type===mime ? file:new File([file],file.name,{type:mime,lastModified:file.lastModified});
}
