export const MAX_CLIENT_DOCUMENT_SIZE = 1_048_576;
export const CLIENT_DOCUMENT_SIZE_ERROR = 'Maximum file size: 1 MB';

export function getClientDocumentSizeError(size: number) {
  return size > MAX_CLIENT_DOCUMENT_SIZE ? CLIENT_DOCUMENT_SIZE_ERROR : null;
}

export const CLIENT_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png',
]);
const extensionTypes: Record<string, string> = {pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'};
export function clientDocumentMimeType(file: {name: string; type: string}) {
  return CLIENT_DOCUMENT_MIME_TYPES.has(file.type) ? file.type : extensionTypes[file.name.toLowerCase().split('.').pop() || ''] || null;
}
export function safeStorageFilename(name: string) {
  const safe=name.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe && safe!=='.' && safe!=='..' ? safe : 'document';
}
export function isScopedClientDocumentPath(path: unknown, orgId: string, clientId: string, documentId: string): path is string {
  const prefix=`organizations/${orgId}/clients/${clientId}/documents/${documentId}/`;
  if(typeof path!=='string' || !path.startsWith(prefix)) return false;
  const name=path.slice(prefix.length);
  return name.length>0 && !/[\u0000-\u001f/]/.test(name) && name!=='.' && name!=='..';
}
