export const MAX_CLIENT_DOCUMENT_SIZE = 1_048_576;
export const CLIENT_DOCUMENT_SIZE_ERROR = 'File is too large. Maximum upload size is 1 MB.';

export function getClientDocumentSizeError(size: number) {
  return size > MAX_CLIENT_DOCUMENT_SIZE ? CLIENT_DOCUMENT_SIZE_ERROR : null;
}
