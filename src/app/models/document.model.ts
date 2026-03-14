export type DocumentType = 'CONTRACT' | 'BILAN' | 'INVOICE' | 'NOTICE' | 'OTHER';

export interface DocumentModel {
  id: string;
  title: string;
  type?: DocumentType;
  url: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedById?: string;
  uploadedAt?: string;
  tags?: string[];
  description?: string;
}
export interface Document {
}
