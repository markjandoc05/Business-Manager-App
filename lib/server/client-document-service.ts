import { createHash } from 'node:crypto';
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { adminDb, adminStorageBucket } from '@/lib/server/firebase-admin';
import { clientDocumentMimeType, isScopedClientDocumentPath, MAX_CLIENT_DOCUMENT_SIZE, safeStorageFilename } from '@/lib/client-documents';
import { assertClientFinancialRetention } from './financial-retention';
import { recordId, requireWorkspaceRecordAccess, WorkspaceRecordError } from './workspace-record-access';

type FileIdentity = {documentId: string; storagePath: string; generation: string | null};
function references(orgId: string, clientId: string, documentId: string) {
  if (![orgId,clientId,documentId].every(recordId)) throw new WorkspaceRecordError('Invalid document reference.');
  const organization=adminDb.doc(`organizations/${orgId}`); const client=organization.collection('clients').doc(clientId);
  return {client, document:client.collection('documents').doc(documentId), operation:client.collection('documentOperations').doc(documentId), guard:organization.collection('clientDocumentGuards').doc(clientId)};
}
async function access(transaction: Transaction, orgId: string, clientId: string, documentId: string, uid: string, write=false, upload=false) {
  const actor=await requireWorkspaceRecordAccess(transaction,orgId,uid,write?'canonical':false);
  const refs=references(orgId,clientId,documentId);
  const [client,guard]=await Promise.all([transaction.get(refs.client),transaction.get(refs.guard)]);
  if(!client.exists) throw new WorkspaceRecordError('The Client could not be found.',404);
  if(guard.exists) throw new WorkspaceRecordError('Client document deletion is in progress. Refresh before trying again.',409);
  const data=client.data() || {};
  if(upload && (data.archived===true || data.trashed===true || data.status==='ARCHIVED')) throw new WorkspaceRecordError('Documents cannot be uploaded to an archived Client.',409);
  return {actor,refs};
}
function missing(error: unknown) { return !!error && typeof error==='object' && 'code' in error && [404,'404','storage/object-not-found'].includes(error.code as never); }
async function fileGeneration(path: string) {
  try {
    const [metadata]=await adminStorageBucket().file(path).getMetadata();
    if(typeof metadata.generation!=='string' || !/^\d+$/.test(metadata.generation)) throw new WorkspaceRecordError('The stored file version could not be verified.',503);
    return metadata.generation;
  } catch(error) { if(missing(error)) return null;throw new WorkspaceRecordError('The stored file version could not be verified. Its file and document have been retained.',502); }
}
function assertPath(path: unknown, org: string, client: string, id: string): asserts path is string {
  if(!isScopedClientDocumentPath(path,org,client,id)) throw new WorkspaceRecordError('This stored file is outside the verified Client document namespace. The existing record and link have been retained.',409);
}

export async function uploadClientDocumentOnServer(orgId: string, clientId: string, requestedId: string, uid: string, name: string, type: string, bytes: Buffer) {
  const mimeType=clientDocumentMimeType({name,type});
  if(!mimeType || typeof name!=='string' || name.length>1024) throw new WorkspaceRecordError('That file type or name is not supported. Use PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, or PNG.');
  if(!bytes.length) throw new WorkspaceRecordError('Please select a file to upload.');
  if(bytes.length>MAX_CLIENT_DOCUMENT_SIZE) throw new WorkspaceRecordError('Maximum file size: 1 MB',413);
  const hash=createHash('sha256').update(JSON.stringify([uid,name,mimeType,bytes.length])).update(bytes).digest('hex');
  const prepared=await adminDb.runTransaction(async transaction=>{
    const {actor,refs:requested}=await access(transaction,orgId,clientId,requestedId,uid,true,true);
    const recoveryRef=requested.client.collection('documentUploadKeys').doc(hash);
    const recovery=await transaction.get(recoveryRef);
    const id=recovery.data()?.state==='PREPARED'?String(recovery.data()?.documentId):requestedId;
    const refs=references(orgId,clientId,id);
    const path=`organizations/${orgId}/clients/${clientId}/documents/${id}/${safeStorageFilename(name)}`;
    const [operation,document]=await Promise.all([transaction.get(refs.operation),transaction.get(refs.document)]);
    const op=operation.data() || {};
    if(operation.exists && (op.uid!==uid || op.requestHash!==hash || op.storagePath!==path)) throw new WorkspaceRecordError('This upload request was used for different file details.',409);
    if(document.exists) {
      if(op.state!=='REGISTERED') throw new WorkspaceRecordError('This document already exists. Its file has been retained.',409);
      return {id,path,replay:{id,...document.data()}};
    }
    if(operation.exists && op.state!=='PREPARED') throw new WorkspaceRecordError('This upload is unavailable because document deletion has begun.',409);
    transaction.set(recoveryRef,{state:'PREPARED',documentId:id});
    if(!operation.exists) transaction.create(refs.operation,{state:'PREPARED',uid,requestHash:hash,storagePath:path,name,mimeType,size:bytes.length,uploadedByName:typeof actor.user.name==='string'?actor.user.name:uid,createdAt:Timestamp.now()});
    return {id,path,replay:null};
  });
  if(prepared.replay) return prepared.replay;
  const {id,path}=prepared;
  try {
    await adminStorageBucket().file(path).save(bytes,{resumable:false,contentType:mimeType,preconditionOpts:{ifGenerationMatch:0},metadata:{metadata:{ventaleRequestHash:hash}}});
  } catch { /* Both lost upload acknowledgments and same-key retries are verified below. Never compensate by deleting. */ }
  let stored;
  try { [stored]=await adminStorageBucket().file(path).getMetadata(); }
  catch { throw new WorkspaceRecordError('Upload completion could not be verified. Retry the same file; any uploaded file has been retained.',503); }
  if(stored.metadata?.ventaleRequestHash!==hash || Number(stored.size)!==bytes.length || stored.contentType!==mimeType || typeof stored.generation!=='string' || !/^\d+$/.test(stored.generation)) throw new WorkspaceRecordError('Upload completion could not be verified. Retry the same file; any uploaded file has been retained.',503);
  return adminDb.runTransaction(async transaction=>{
    const {refs}=await access(transaction,orgId,clientId,id,uid,true,true);
    const [operation,document]=await Promise.all([transaction.get(refs.operation),transaction.get(refs.document)]);
    const op=operation.data() || {};
    if(op.uid!==uid || op.requestHash!==hash || op.storagePath!==path || !['PREPARED','REGISTERED'].includes(op.state)) throw new WorkspaceRecordError('Upload registration changed. The file has been retained.',409);
    if(document.exists) {
      if(op.state!=='REGISTERED') throw new WorkspaceRecordError('The document already exists. Its file has been retained.',409);
      return {id,...document.data()};
    }
    const data={name,storagePath:path,mimeType,size:bytes.length,uploadedAt:Timestamp.now(),uploadedByUid:uid,uploadedByName:op.uploadedByName,archived:false,archivedAt:null,archivedBy:null};
    transaction.create(refs.document,data);transaction.update(refs.operation,{state:'REGISTERED',generation:stored.generation});
    transaction.set(refs.client.collection('documentUploadKeys').doc(hash),{state:'REGISTERED',documentId:id});
    return {id,...data};
  });
}

export async function changeClientDocumentArchive(orgId: string, clientId: string, id: string, uid: string, archived: boolean) {
  return adminDb.runTransaction(async transaction=>{
    const {refs}=await access(transaction,orgId,clientId,id,uid,true);
    const [document,operation]=await Promise.all([transaction.get(refs.document),transaction.get(refs.operation)]);
    if(!document.exists) throw new WorkspaceRecordError('The document could not be found.',404);
    if(['DELETING','DELETED'].includes(operation.data()?.state)) throw new WorkspaceRecordError('Document deletion has begun. The document cannot be restored.',409);
    transaction.update(refs.document,{archived,archivedAt:archived?Timestamp.now():null,archivedBy:archived?uid:null});
  });
}

export async function readClientDocumentOnServer(orgId: string, clientId: string, id: string, uid: string) {
  const data=await adminDb.runTransaction(async transaction=>{
    const {refs}=await access(transaction,orgId,clientId,id,uid);
    const [document,operation]=await Promise.all([transaction.get(refs.document),transaction.get(refs.operation)]);
    if(!document.exists) throw new WorkspaceRecordError('The document could not be found.',404);
    if(['DELETING','DELETED'].includes(operation.data()?.state)) throw new WorkspaceRecordError('Document deletion has begun. Refresh Client Documents.',409);
    return document.data() || {};
  });
  assertPath(data.storagePath,orgId,clientId,id);
  const [metadata]=await adminStorageBucket().file(data.storagePath).getMetadata();
  const size=Number(metadata.size);
  if(!Number.isSafeInteger(size) || size<1 || size>MAX_CLIENT_DOCUMENT_SIZE || typeof metadata.generation!=='string' || !/^\d+$/.test(metadata.generation)) throw new WorkspaceRecordError('The stored file size or version cannot be safely verified.',409);
  const [bytes]=await adminStorageBucket().file(data.storagePath,{generation:metadata.generation}).download();
  if(bytes.length!==size || bytes.length>MAX_CLIENT_DOCUMENT_SIZE) throw new WorkspaceRecordError('The stored file changed during download. Please try again.',409);
  return {bytes,name:typeof data.name==='string'?data.name:'Document'};
}

export async function deleteClientDocumentOnServer(orgId: string, clientId: string, id: string, uid: string) {
  const initial=await adminDb.runTransaction(async transaction=>{
    const {refs}=await access(transaction,orgId,clientId,id,uid,true);
    const [document,operation]=await Promise.all([transaction.get(refs.document),transaction.get(refs.operation)]);
    const op=operation.data() || {};const data=document.data() || {};
    if(!document.exists && op.state==='DELETED') return null;
    if(!document.exists) throw new WorkspaceRecordError('The document could not be found.',404);
    if(data.archived!==true) throw new WorkspaceRecordError('Only archived documents can be permanently deleted.',409);
    assertPath(data.storagePath,orgId,clientId,id);
    if(op.state==='PREPARED') throw new WorkspaceRecordError('Upload registration is uncertain. The file has been retained.',409);
    return {path:data.storagePath,previous:op.state==='DELETING'?op.generation as string|null:undefined};
  });
  if(!initial) return;
  const generation=initial.previous===undefined?await fileGeneration(initial.path):initial.previous;
  await adminDb.runTransaction(async transaction=>{
    const {refs}=await access(transaction,orgId,clientId,id,uid,true);
    const [document,operation]=await Promise.all([transaction.get(refs.document),transaction.get(refs.operation)]);
    const op=operation.data() || {};
    if(document.data()?.archived!==true || document.data()?.storagePath!==initial.path || op.state==='PREPARED' || op.state==='DELETED') throw new WorkspaceRecordError('The document changed before deletion. Its file has been retained.',409);
    if(op.state==='DELETING' && op.generation!==generation) throw new WorkspaceRecordError('The stored file version changed. Its file has been retained.',409);
    transaction.set(refs.operation,{...op,state:'DELETING',storagePath:initial.path,generation});
  });
  if(generation) {
    try { await adminStorageBucket().file(initial.path,{preconditionOpts:{ifGenerationMatch:generation}}).delete(); }
    catch(error) { if(!missing(error)) throw new WorkspaceRecordError('Unable to delete the stored file. Retry the same deletion; the document remains reserved.',502); }
  }
  await adminDb.runTransaction(async transaction=>{
    const {refs}=await access(transaction,orgId,clientId,id,uid,true);
    const [document,operation]=await Promise.all([transaction.get(refs.document),transaction.get(refs.operation)]);
    if(operation.data()?.state==='DELETED' && !document.exists) return;
    if(operation.data()?.state!=='DELETING' || operation.data()?.generation!==generation || document.data()?.storagePath!==initial.path || document.data()?.archived!==true) throw new WorkspaceRecordError('Deletion completion is uncertain. Retry the same deletion.',409);
    transaction.delete(refs.document);transaction.update(refs.operation,{state:'DELETED'});
  });
}

export async function refuseUnknownDocumentCleanup(orgId: string, clientId: string, id: string, uid: string, path: unknown) {
  assertPath(path,orgId,clientId,id);
  await adminDb.runTransaction(async transaction=>{
    const {refs}=await access(transaction,orgId,clientId,id,uid,true);
    const [document,operation]=await Promise.all([transaction.get(refs.document),transaction.get(refs.operation)]);
    if(document.exists) throw new WorkspaceRecordError('Registered documents must use the normal document deletion workflow.',409);
    if(operation.data()?.state==='PREPARED') throw new WorkspaceRecordError('Upload registration is pending. Retry the original upload; the file has been retained.',409);
    throw new WorkspaceRecordError('This orphan file has no verified completed registration. It has been retained for recovery.',409);
  });
}

/** Freeze all document mutation before single/bulk Client deletion touches Storage.
 * Unknown pending uploads block deletion; failed deletes keep a retryable guard. */
export async function removeClientDocumentFiles(orgId: string, clientId: string, uid: string, planned: {documentId:string;storagePath:string}[]) {
  const org=adminDb.doc(`organizations/${orgId}`);const client=org.collection('clients').doc(clientId);const guard=org.collection('clientDocumentGuards').doc(clientId);
  const current=await adminDb.runTransaction(async transaction=>{
    await requireWorkspaceRecordAccess(transaction,orgId,uid,'canonical');
    const parent=await transaction.get(client);
    if(!parent.exists || parent.data()?.trashed!==true) throw new WorkspaceRecordError('The Client changed before deletion.',409);
    return transaction.get(guard);
  });
  const files: FileIdentity[]=current.exists ? current.data()?.files || [] : await Promise.all(planned.map(async file=>{assertPath(file.storagePath,orgId,clientId,file.documentId);return {...file,generation:await fileGeneration(file.storagePath)};}));
  await adminDb.runTransaction(async transaction=>{
    await requireWorkspaceRecordAccess(transaction,orgId,uid,'canonical');
    const [parent,marker,documents,operations]=await Promise.all([transaction.get(client),transaction.get(guard),transaction.get(client.collection('documents')),transaction.get(client.collection('documentOperations'))]);
    if(!parent.exists || parent.data()?.trashed!==true) throw new WorkspaceRecordError('The Client changed before deletion.',409);
    await assertClientFinancialRetention(transaction,org,clientId);
    if(operations.docs.some(op=>['PREPARED','DELETING'].includes(op.data().state))) throw new WorkspaceRecordError('A document upload or deletion is pending. Complete its recovery before deleting the Client.',409);
    if(documents.size!==files.length || documents.docs.some(doc=>!files.some(file=>file.documentId===doc.id && file.storagePath===doc.data().storagePath))) throw new WorkspaceRecordError('Client documents changed before deletion. No files were deleted.',409);
    if(marker.exists && (marker.data()?.state!=='DELETING' || JSON.stringify(marker.data()?.files)!==JSON.stringify(files))) throw new WorkspaceRecordError('Client document deletion changed. No files were deleted.',409);
    if(!marker.exists) transaction.create(guard,{state:'DELETING',files});
  });
  for(const file of files) {
    assertPath(file.storagePath,orgId,clientId,file.documentId);
    if(!file.generation) continue;
    try {await adminStorageBucket().file(file.storagePath,{preconditionOpts:{ifGenerationMatch:file.generation}}).delete();}
    catch(error){if(!missing(error))throw new WorkspaceRecordError('Unable to delete a stored document. Client deletion remains reserved; retry it.',502);}
  }
}
