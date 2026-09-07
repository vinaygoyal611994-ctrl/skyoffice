import React, { useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  useListMyOfficeDocuments, useAddMyOfficeDocument, useRemoveMyOfficeDocument,
  getListMyOfficeDocumentsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ObjectUploader } from '@workspace/object-storage-web';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Trash2, FileText, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { authFetch } from '@/lib/sessionToken';
import { safeApiError } from '@/lib/apiError';
import { buildStoragePutParameters } from '@/lib/uploadParameters';

const UPLOAD_CATEGORY_LIMITS = {
  document: { allowedFileTypes: ['application/pdf', 'image/jpeg', 'image/png'], maxFileSize: 15 * 1024 * 1024 },
} as const;

export function DocumentsSection() {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const uploadPathsRef = useRef<Record<string, string>>({});

  const { data: documents, isLoading } = useListMyOfficeDocuments();

  const addDocumentMut = useAddMyOfficeDocument({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyOfficeDocumentsQueryKey() }),
      onError: (err: any) => {
        toast({
          title: t('dashboard.upload_failed_title'),
          description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
          variant: 'destructive',
        });
      },
    },
  });

  const removeDocumentMut = useRemoveMyOfficeDocument({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyOfficeDocumentsQueryKey() }),
    },
  });

  const makeUploadParamsHandler = () => async (file: any) => {
    const res = await authFetch('/api/storage/uploads/request-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type, category: 'document' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }));
    }
    const data = await res.json();
    uploadPathsRef.current[file.id] = data.objectPath;
    return buildStoragePutParameters(data.uploadURL, file.type);
  };

  const docTypes = [
    { type: 'identity', label: t('dashboard.document_type_identity') },
    { type: 'trade_license', label: t('dashboard.document_type_trade_license') },
    { type: 'professional_license', label: t('dashboard.document_type_professional_license') },
    { type: 'certificate', label: t('dashboard.document_type_certificate') },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            {t('dashboard.documents_tab')}
          </CardTitle>
          <CardDescription>{t('dashboard.documents_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {docTypes.map(docType => {
            const existing = documents?.filter(d => d.documentType === docType.type) || [];
            return (
              <div key={docType.type} className="border rounded-xl p-4 bg-card" data-testid={`document-row-${docType.type}`}>
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <Label className="font-medium">{docType.label}</Label>
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    allowedFileTypes={[...UPLOAD_CATEGORY_LIMITS.document.allowedFileTypes]}
                    maxFileSize={UPLOAD_CATEGORY_LIMITS.document.maxFileSize}
                    onGetUploadParameters={makeUploadParamsHandler()}
                    onComplete={async result => {
                      if (result.successful && result.successful[0]) {
                        const path = uploadPathsRef.current[result.successful[0].id];
                        await addDocumentMut
                          .mutateAsync({ data: { documentType: docType.type as any, objectPath: path } })
                          .catch(() => {});
                      }
                    }}
                    buttonClassName="bg-secondary hover:bg-secondary/80 px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2"
                  >
                    <Plus size={14} />
                    {t('dashboard.upload_file')}
                  </ObjectUploader>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : existing.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">{t('dashboard.no_document_uploaded')}</p>
                ) : (
                  <div className="space-y-2">
                    {existing.map(doc => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-2 bg-muted/30 rounded-lg px-3 py-2 text-sm flex-wrap"
                        data-testid={`row-document-${doc.id}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {doc.status === 'approved' ? (
                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                          ) : doc.status === 'rejected' ? (
                            <XCircle size={14} className="text-red-500 shrink-0" />
                          ) : (
                            <Clock size={14} className="text-slate-400 shrink-0" />
                          )}
                          <span>{t('dashboard.document_number_prefix')} #{doc.id}</span>
                          <Badge
                            variant="outline"
                            className={
                              doc.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                : doc.status === 'rejected'
                                  ? 'bg-red-100 text-red-700 border-red-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                            }
                          >
                            {doc.status === 'approved'
                              ? t('dashboard.document_status_approved')
                              : doc.status === 'rejected'
                                ? t('dashboard.document_status_rejected')
                                : t('dashboard.document_status_pending')}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive"
                          onClick={() => removeDocumentMut.mutate({ documentId: doc.id })}
                          data-testid={`button-remove-document-${doc.id}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
