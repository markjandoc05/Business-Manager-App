import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { MAX_CLIENT_DOCUMENT_SIZE } from '@/lib/client-documents';
import { WorkspaceRecordError, recordId } from '@/lib/server/workspace-record-access';
import { changeClientDocumentArchive, deleteClientDocumentOnServer, readClientDocumentOnServer, refuseUnknownDocumentCleanup, uploadClientDocumentOnServer } from '@/lib/server/client-document-service';

export const runtime = 'nodejs';
type Context = { params: Promise<{ orgId: string; clientId: string; documentId: string }> };
async function boundedFile(request: NextRequest) {
  const declared=request.headers.get('content-length');
  if(declared && (!/^\d+$/.test(declared) || Number(declared)>MAX_CLIENT_DOCUMENT_SIZE)) throw new WorkspaceRecordError('Maximum file size: 1 MB',413);
  const reader=request.body?.getReader();
  if(!reader) throw new WorkspaceRecordError('Please select a file to upload.');
  const chunks: Uint8Array[]=[];let size=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_CLIENT_DOCUMENT_SIZE){await reader.cancel();throw new WorkspaceRecordError('Maximum file size: 1 MB',413);}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  if(declared && Number(declared)!==size) throw new WorkspaceRecordError('The uploaded file size did not match its request.');
  return Buffer.concat(chunks,size);
}
async function handle(request: NextRequest, context: Context, action: 'upload'|'download'|'archive'|'delete'|'cleanup') {
  const actor=await getAuthenticatedUser(request);
  if(!actor) return NextResponse.json({error:'Authentication is required.'},{status:401});
  const {orgId,clientId,documentId}=await context.params;
  if(![orgId,clientId,documentId].every(recordId))return NextResponse.json({error:'Invalid document request.'},{status:400});
  try {
    if(action==='upload') {
      let name:string;try{name=decodeURIComponent(request.headers.get('x-document-name') || '');}catch{throw new WorkspaceRecordError('Invalid document name.');}
      if(!name || name.length>1024) throw new WorkspaceRecordError('Invalid document name.');
      const data=await uploadClientDocumentOnServer(orgId,clientId,documentId,actor.uid,name,request.headers.get('content-type') || '',await boundedFile(request));
      return NextResponse.json({ok:true,document:{...data,uploadedAt:'uploadedAt' in data && data.uploadedAt instanceof Timestamp?data.uploadedAt.toDate().toISOString():undefined}});
    }
    if(action==='download') {
      const file=await readClientDocumentOnServer(orgId,clientId,documentId,actor.uid);
      const encoded=encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
      return new NextResponse(new Uint8Array(file.bytes),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${encoded}`,'Content-Length':String(file.bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
    }
    if(action==='delete') await deleteClientDocumentOnServer(orgId,clientId,documentId,actor.uid);
    else {
      let body;try{body=await request.json();}catch{throw new WorkspaceRecordError('Invalid document request.');}
      if(!body || typeof body!=='object' || Array.isArray(body))throw new WorkspaceRecordError('Invalid document request.');
      if(action==='archive') {
        if(Object.keys(body).length!==1 || typeof body.archived!=='boolean')throw new WorkspaceRecordError('Invalid document lifecycle request.');
        await changeClientDocumentArchive(orgId,clientId,documentId,actor.uid,body.archived);
      } else await refuseUnknownDocumentCleanup(orgId,clientId,documentId,actor.uid,body.storagePath);
    }
    return NextResponse.json({ok:true});
  } catch(error) {
    if(error instanceof WorkspaceRecordError) return NextResponse.json({error:error.message},{status:error.status});
    if(error && typeof error==='object' && 'code' in error && [404,'404'].includes(error.code as never))return NextResponse.json({error:'The stored file could not be found. Its document record has been retained.'},{status:404});
    console.error('Client document operation could not be confirmed',{action});
    return NextResponse.json({error:'The document operation could not be confirmed. Retry the same request; unconfirmed files have been retained.'},{status:503});
  }
}
export const PUT=(request:NextRequest,context:Context)=>handle(request,context,'upload');
export const GET=(request:NextRequest,context:Context)=>handle(request,context,'download');
export const PATCH=(request:NextRequest,context:Context)=>handle(request,context,'archive');
export const DELETE=(request:NextRequest,context:Context)=>handle(request,context,'delete');
export const POST=(request:NextRequest,context:Context)=>handle(request,context,'cleanup');
