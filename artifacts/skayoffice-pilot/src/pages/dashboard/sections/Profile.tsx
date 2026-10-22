import React, { useRef, useState } from 'react';
import { useI18n, categoriesMap, type TranslationKey } from '@/lib/i18n';
import { safeApiError } from '@/lib/apiError';
import {
  useGetMyOffice, useUpdateMyOffice, useAddMyOfficeService, useRemoveMyOfficeService,
  useSubmitMyOfficeApplication, getGetMyOfficeQueryKey,
} from '@workspace/api-client-react';
import type { SelectableOfficeCategory } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SpokenLanguagesSelect } from '@/components/office/SpokenLanguagesSelect';
import {
  AlertTriangle, CheckCircle2, Clock, XCircle, Send, Lock,
  Plus, Trash2, User, Phone, Globe2, Briefcase, MapPin, Navigation,
} from 'lucide-react';

const STATUS_META: Record<string, { labelKey: TranslationKey; tone: string; icon: React.ReactNode }> = {
  draft: { labelKey: 'dashboard.status.draft', tone: 'bg-slate-100 text-slate-700 border-slate-200', icon: <Clock size={14} /> },
  under_review: { labelKey: 'dashboard.status.under_review', tone: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Clock size={14} /> },
  changes_requested: { labelKey: 'dashboard.status.changes_requested', tone: 'bg-amber-100 text-amber-800 border-amber-200', icon: <AlertTriangle size={14} /> },
  approved: { labelKey: 'dashboard.status.approved', tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={14} /> },
  active: { labelKey: 'dashboard.status.active', tone: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={14} /> },
  rejected: { labelKey: 'dashboard.status.rejected', tone: 'bg-red-100 text-red-700 border-red-200', icon: <XCircle size={14} /> },
  suspended: { labelKey: 'dashboard.status.suspended', tone: 'bg-red-100 text-red-700 border-red-200', icon: <XCircle size={14} /> },
};

const LOCKED_EDIT_STATUSES = ['approved', 'active', 'suspended'];

const MISSING_FIELD_KEYS: Record<string, TranslationKey> = {
  name: 'dashboard.field.name',
  shortDescription: 'dashboard.field.short_description',
  city: 'dashboard.field.city',
  category: 'dashboard.field.category',
  whatsapp: 'dashboard.field.whatsapp',
  spokenLanguages: 'dashboard.field.spoken_languages',
  services: 'dashboard.field.services',
  'identity document': 'dashboard.field.identity_document',
  'trade license document': 'dashboard.field.trade_license_document',
};

const SPOKEN_LANGUAGE_OPTIONS = [
  { code: 'ar', labelEn: 'Arabic', labelAr: 'العربية' },
  { code: 'en', labelEn: 'English', labelAr: 'الإنجليزية' },
  { code: 'ur', labelEn: 'Urdu', labelAr: 'الأردية' },
  { code: 'hi', labelEn: 'Hindi', labelAr: 'الهندية' },
  { code: 'tl', labelEn: 'Tagalog', labelAr: 'التاغالوغ' },
  { code: 'fr', labelEn: 'French', labelAr: 'الفرنسية' },
];

export function ProfileSection() {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: office, isLoading } = useGetMyOffice();

  const updateMutation = useUpdateMyOffice({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), data);
        const savedStatus = data?.status ?? office?.status;
        const wasLocked = savedStatus ? LOCKED_EDIT_STATUSES.includes(savedStatus) : false;

        // For locked offices (active/approved/suspended), the API must return a
        // non-null pendingChangesSubmittedAt to confirm the edit was staged for
        // admin review. If the field is missing the server did not persist the
        // change — show an error instead of a false-positive success toast.
        if (wasLocked && !data?.pendingChangesSubmittedAt) {
          toast({
            title: language === 'ar' ? 'خطأ في الحفظ' : 'Save error',
            description: language === 'ar'
              ? 'لم يتم إرسال التعديلات للمراجعة. يرجى المحاولة مجدداً.'
              : 'Changes could not be staged for admin review. Please try again.',
            variant: 'destructive',
          });
          return;
        }

        toast({
          title: t('common.save'),
          description: wasLocked ? t('dashboard.update_success_pending') : t('dashboard.update_success'),
        });
      },
      onError: (err: any) => {
        toast({
          title: t('dashboard.upload_failed_title'),
          description: safeApiError(err, language, { ar: t('dashboard.upload_failed_desc_generic'), en: t('dashboard.upload_failed_desc_generic') }),
          variant: 'destructive',
        });
      },
    },
  });

  const addServiceMut = useAddMyOfficeService({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() });
        setNewService('');
      },
    },
  });

  const removeServiceMut = useRemoveMyOfficeService({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMyOfficeQueryKey() }),
    },
  });

  const [missingFields, setMissingFields] = useState<string[]>([]);
  const submitMut = useSubmitMyOfficeApplication({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyOfficeQueryKey(), data);
        setMissingFields([]);
        toast({ title: t('dashboard.submit_success_title'), description: t('dashboard.submit_success_desc') });
      },
      onError: (err: any) => {
        const fields: string[] = err?.data?.missingFields || [];
        setMissingFields(fields);
        toast({
          title: t('dashboard.submit_failed_title'),
          description: safeApiError(err, language, { ar: t('dashboard.submit_failed_generic'), en: t('dashboard.submit_failed_generic') }),
          variant: 'destructive',
        });
      },
    },
  });

  const [formData, setFormData] = useState({
    name: '', nameAr: '', category: 'translation', city: '', email: '', whatsapp: '', acceptsPhoneCalls: false,
    website: '', address: '', country: '', specialization: '', googleMapsUrl: '',
    shortDescription: '', description: '', isOnline: false,
    latitude: '', longitude: '',
  });
  const [spokenLanguages, setSpokenLanguages] = useState<string[]>([]);
  const [customLanguages, setCustomLanguages] = useState<string[]>([]);
  const [newService, setNewService] = useState('');
  const [deleteServiceId, setDeleteServiceId] = useState<number | null>(null);
  const initRef = useRef(false);

  React.useEffect(() => {
    if (office && !initRef.current) {
      setFormData({
        name: office.name || '',
        nameAr: office.nameAr || '',
        category: office.category || 'translation',
        city: office.city || '',
        email: office.email || '',
        whatsapp: office.whatsapp || '',
        acceptsPhoneCalls: !!office.acceptsPhoneCalls,
        website: office.website || '',
        address: office.address || '',
        country: office.country || '',
        specialization: office.specialization || '',
        googleMapsUrl: office.googleMapsUrl || '',
        latitude: office.latitude != null ? String(office.latitude) : '',
        longitude: office.longitude != null ? String(office.longitude) : '',
        shortDescription: office.shortDescription || '',
        description: office.description || '',
        isOnline: !!office.isOnline,
      });
      setSpokenLanguages(office.spokenLanguages || []);
      setCustomLanguages(office.customLanguages || []);
      initRef.current = true;
    }
  }, [office]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = () => {
    const lat = formData.latitude !== '' ? parseFloat(formData.latitude) : null;
    const lon = formData.longitude !== '' ? parseFloat(formData.longitude) : null;
    const { category, ...profileFields } = formData;
    updateMutation.mutate({
      data: {
        ...profileFields,
        ...(category !== 'other' ? { category: category as SelectableOfficeCategory } : {}),
        spokenLanguages,
        customLanguages,
        latitude: isNaN(lat as number) ? null : lat,
        longitude: isNaN(lon as number) ? null : lon,
      },
    });
  };

  const handleDetectLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData(prev => ({
          ...prev,
          latitude: String(Math.round(pos.coords.latitude * 1e6) / 1e6),
          longitude: String(Math.round(pos.coords.longitude * 1e6) / 1e6),
        }));
      },
      () => {},
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!office) return null;

  const statusMeta = STATUS_META[office.status] || STATUS_META.draft;
  const canSubmit = office.status === 'draft' || office.status === 'changes_requested';
  const isLocked = LOCKED_EDIT_STATUSES.includes(office.status);
  const isUnderReview = office.status === 'under_review';
  const fieldsReadOnly = isUnderReview;
  const hasPendingChanges = !!office.pendingChanges;
  const proposedName = typeof office.pendingChanges?.name === 'string' ? office.pendingChanges.name : null;
  const hasProposedNameAr = !!office.pendingChanges && Object.prototype.hasOwnProperty.call(office.pendingChanges, 'nameAr');
  const proposedNameAr = hasProposedNameAr ? office.pendingChanges?.nameAr : undefined;
  const proposedCategory = typeof office.pendingChanges?.category === 'string' ? office.pendingChanges.category : null;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`rounded-2xl border p-4 flex items-start gap-3 ${statusMeta.tone}`} data-testid="banner-application-status">
        <div className="mt-0.5 shrink-0">{statusMeta.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            {t('dashboard.status_banner_label')}: {t(statusMeta.labelKey)}
          </div>
          {office.status === 'draft' && (
            <p className="text-xs mt-1 opacity-80">{t('dashboard.status_hint_draft')}</p>
          )}
          {office.status === 'changes_requested' && office.changeRequestReason && (
            <p className="text-xs mt-1 opacity-80">{t('dashboard.status_hint_changes_requested')}: {office.changeRequestReason}</p>
          )}
          {office.status === 'under_review' && (
            <p className="text-xs mt-1 opacity-80 flex items-center gap-1.5">
              <Lock size={12} /> {t('dashboard.status_hint_under_review')}
            </p>
          )}
          {office.status === 'approved' && (
            <p className="text-xs mt-1 opacity-80">{t('dashboard.status_hint_approved')}</p>
          )}
          {office.status === 'rejected' && office.rejectionReason && (
            <p className="text-xs mt-1 opacity-80">{t('dashboard.status_hint_rejected')}: {office.rejectionReason}</p>
          )}
          {office.status === 'suspended' && (
            <p className="text-xs mt-1 opacity-80">{t('dashboard.status_hint_suspended')}</p>
          )}
          {office.status === 'active' && (
            <p className="text-xs mt-1 opacity-80">{t('dashboard.status_hint_active')}</p>
          )}
          {isLocked && (
            <p className="text-xs mt-1.5 flex items-center gap-1.5 font-medium">
              <Lock size={12} /> {t('dashboard.locked_edit_notice')}
            </p>
          )}
          {hasPendingChanges && (
            <p className="text-xs mt-1 opacity-80" data-testid="text-pending-changes-notice">
              {t('dashboard.pending_changes_notice')}
              {office.pendingChangesSubmittedAt
                ? ` (${t('dashboard.pending_changes_submitted_at')} ${new Date(office.pendingChangesSubmittedAt).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-CA')})`
                : ''}.
            </p>
          )}
        </div>
      </div>

      {/* Missing fields */}
      {missingFields.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4" data-testid="banner-missing-fields">
          <div className="font-semibold text-red-800 flex items-center gap-2 mb-2 text-sm">
            <AlertTriangle size={14} /> {t('dashboard.missing_fields_notice')}:
          </div>
          <ul className="list-disc list-inside text-sm text-red-700 space-y-0.5">
            {missingFields.map(f => (
              <li key={f} data-testid={`missing-field-${f}`}>
                {MISSING_FIELD_KEYS[f] ? t(MISSING_FIELD_KEYS[f]) : f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Basic Info */}
      <Card className="overflow-hidden shadow-sm border-border/60">
        <CardHeader className="bg-muted/30 border-b border-border/50 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><User size={14} /></span>
            {t('dashboard.basic_info_title')}
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">{t('dashboard.basic_info_description')}</CardDescription>
        </CardHeader>
        <CardContent className={`grid grid-cols-1 md:grid-cols-2 gap-5 pt-5 px-5 ${fieldsReadOnly ? 'opacity-60' : ''}`}>
          <div className="space-y-1.5">
            <Label>{t('auth.office_name')} <span className="text-red-500 ms-0.5">*</span></Label>
            <Input name="name" value={formData.name} onChange={handleChange} disabled={fieldsReadOnly || !!(isLocked && proposedName)} />
            {isLocked && <p className="text-xs text-muted-foreground">{language === 'ar' ? 'تتطلب تغييرات اسم المكتب موافقة الإدارة قبل ظهورها للعامة.' : 'Changes to your office name require admin approval before appearing publicly.'}</p>}
            {isLocked && proposedName && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs" data-testid="pending-office-name">
                <div>{language === 'ar' ? 'الاسم العام المعتمد:' : 'Approved public name:'} <strong>{office.name}</strong></div>
                <div>{language === 'ar' ? 'الاسم المقترح:' : 'Proposed name:'} <strong>{proposedName}</strong></div>
                <Badge variant="outline" className="mt-1 bg-amber-100">{language === 'ar' ? 'قيد المراجعة' : 'Pending review'}</Badge>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{language === 'ar' ? 'اسم المكتب بالعربية' : 'Office Name (Arabic)'} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input name="nameAr" dir="rtl" value={formData.nameAr} onChange={handleChange} disabled={fieldsReadOnly || (isLocked && hasProposedNameAr)} placeholder={language === 'ar' ? 'اختياري' : 'Optional'} />
            {isLocked && <p className="text-xs text-muted-foreground">{language === 'ar' ? 'تغييرات الاسم العربي تتطلب موافقة الإدارة.' : 'Arabic-name changes also require admin approval.'}</p>}
            {isLocked && hasProposedNameAr && <p className="text-xs text-amber-700">{language === 'ar' ? 'الاسم العربي المقترح:' : 'Proposed Arabic name:'} {String(proposedNameAr || (language === 'ar' ? 'فارغ — استخدام الاسم الأساسي' : 'Empty — use base name'))}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t('dashboard.field.category')} <span className="text-red-500 ms-0.5">*</span></Label>
            <Select value={formData.category === 'other' ? undefined : formData.category} onValueChange={category => setFormData(p => ({ ...p, category: category as SelectableOfficeCategory }))} disabled={fieldsReadOnly}>
              <SelectTrigger data-testid="select-office-category"><SelectValue placeholder={language === 'ar' ? 'اختر تصنيفاً حالياً' : 'Select a current category'} /></SelectTrigger>
              <SelectContent>
                {Object.entries(categoriesMap).filter(([key]) => key !== 'other').map(([key, labels]) => (
                  <SelectItem key={key} value={key}>{labels[language]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formData.category === 'other' && <p className="text-xs text-amber-700">{language === 'ar' ? 'التصنيف القديم غير متاح للطلبات الجديدة. اختر تصنيفاً حالياً فقط إذا أردت تغييره.' : 'The legacy category is no longer selectable. Choose a current category only if you want to change it.'}</p>}
            {isLocked && proposedCategory && <p className="text-xs text-amber-700">{language === 'ar' ? 'التصنيف المقترح قيد المراجعة:' : 'Proposed category pending review:'} {categoriesMap[proposedCategory]?.[language] ?? proposedCategory}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t('auth.city')} <span className="text-red-500 ms-0.5">*</span></Label>
            <Input name="city" value={formData.city} onChange={handleChange} disabled={fieldsReadOnly} />
          </div>
          <div className="space-y-1.5 col-span-1 md:col-span-2">
            <Label>{t('dashboard.short_desc')} <span className="text-red-500 ms-0.5">*</span></Label>
            <Input name="shortDescription" value={formData.shortDescription} onChange={handleChange} placeholder={t('dashboard.short_desc_placeholder')} disabled={fieldsReadOnly} />
          </div>
          <div className="space-y-1.5 col-span-1 md:col-span-2">
            <Label>
              {t('dashboard.full_desc')}{' '}
              <span className="text-muted-foreground font-normal">{t('common.optional')}</span>
            </Label>
            <Textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              className="min-h-[110px]"
              placeholder={t('dashboard.full_desc_placeholder')}
              disabled={fieldsReadOnly}
            />
          </div>
          <div className="flex items-center justify-between gap-4 col-span-1 md:col-span-2 border p-4 rounded-xl bg-muted/20">
            <div>
              <Label>{t('dashboard.is_online')}</Label>
              <p className="text-xs text-muted-foreground">{t('dashboard.is_online_desc')}</p>
            </div>
            <Switch checked={formData.isOnline} onCheckedChange={c => setFormData(p => ({ ...p, isOnline: c }))} disabled={fieldsReadOnly} />
          </div>
        </CardContent>
      </Card>

      {/* Contact Info */}
      <Card className="overflow-hidden shadow-sm border-border/60">
        <CardHeader className="bg-muted/30 border-b border-border/50 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Phone size={14} /></span>
            {t('dashboard.contact_info_title')}
          </CardTitle>
        </CardHeader>
        <CardContent className={`grid grid-cols-1 md:grid-cols-2 gap-5 pt-5 px-5 ${fieldsReadOnly ? 'opacity-60' : ''}`}>
          <div className="space-y-1.5">
            <Label>{t('dashboard.whatsapp')} <span className="text-red-500 ms-0.5">*</span></Label>
            <Input name="whatsapp" value={formData.whatsapp} onChange={handleChange} dir="ltr" className="text-start" placeholder={t('dashboard.whatsapp_placeholder')} disabled={fieldsReadOnly} data-testid="input-whatsapp" />
          </div>
          <div className="flex items-center gap-3 md:pt-6">
            <Checkbox
              id="accepts-phone-calls"
              checked={formData.acceptsPhoneCalls}
              onCheckedChange={c => setFormData(p => ({ ...p, acceptsPhoneCalls: !!c }))}
              disabled={fieldsReadOnly}
              data-testid="checkbox-accepts-phone-calls"
            />
            <Label htmlFor="accepts-phone-calls" className="font-normal cursor-pointer text-sm">
              {t('dashboard.accepts_phone_calls_label')}
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label>{t('auth.email')}</Label>
            <Input name="email" value={formData.email} onChange={handleChange} dir="ltr" className="text-start" disabled={fieldsReadOnly} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('dashboard.website')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input name="website" value={formData.website} onChange={handleChange} dir="ltr" className="text-start" placeholder={t('dashboard.website_placeholder')} disabled={fieldsReadOnly} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('dashboard.country')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input name="country" value={formData.country} onChange={handleChange} placeholder={t('dashboard.country_placeholder')} data-testid="input-country" disabled={fieldsReadOnly} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('dashboard.specialization')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input name="specialization" value={formData.specialization} onChange={handleChange} placeholder={t('dashboard.specialization_placeholder')} data-testid="input-specialization" disabled={fieldsReadOnly} />
          </div>
          <div className="space-y-1.5 col-span-1 md:col-span-2">
            <Label>{t('dashboard.google_maps_url')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input name="googleMapsUrl" value={formData.googleMapsUrl} onChange={handleChange} dir="ltr" className="text-start" placeholder={t('dashboard.google_maps_url_placeholder')} data-testid="input-google-maps-url" disabled={fieldsReadOnly} />
          </div>
          <div className="space-y-1.5 col-span-1 md:col-span-2">
            <Label>{t('dashboard.address')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input name="address" value={formData.address} onChange={handleChange} disabled={fieldsReadOnly} />
          </div>
        </CardContent>
      </Card>

      {/* Location coordinates */}
      <Card className="overflow-hidden shadow-sm border-border/60">
        <CardHeader className="bg-muted/30 border-b border-border/50 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><MapPin size={14} /></span>
            {t('dashboard.location_title')}
          </CardTitle>
          <CardDescription>{t('dashboard.location_description')}</CardDescription>
        </CardHeader>
        <CardContent className={`grid grid-cols-1 md:grid-cols-2 gap-5 pt-5 px-5 ${fieldsReadOnly ? 'opacity-60' : ''}`}>
          <div className="space-y-1.5">
            <Label>{t('dashboard.latitude')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input
              name="latitude"
              value={formData.latitude}
              onChange={handleChange}
              dir="ltr"
              className="text-start"
              placeholder="e.g. 24.6877"
              disabled={fieldsReadOnly}
              data-testid="input-latitude"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('dashboard.longitude')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></Label>
            <Input
              name="longitude"
              value={formData.longitude}
              onChange={handleChange}
              dir="ltr"
              className="text-start"
              placeholder="e.g. 46.7219"
              disabled={fieldsReadOnly}
              data-testid="input-longitude"
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleDetectLocation}
              disabled={fieldsReadOnly}
            >
              <Navigation size={14} />
              {t('dashboard.use_my_location')}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">{t('dashboard.location_note')}</p>
          </div>
        </CardContent>
      </Card>

      {/* Languages */}
      <Card className="overflow-hidden shadow-sm border-border/60">
        <CardHeader className="bg-muted/30 border-b border-border/50 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Globe2 size={14} /></span>
            {t('dashboard.languages_title')} <span className="text-red-500 ms-0.5">*</span>
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">{t('dashboard.languages_description')}</CardDescription>
        </CardHeader>
        <CardContent className={`pt-5 px-5 ${fieldsReadOnly ? 'opacity-60' : ''}`}>
          <SpokenLanguagesSelect
            options={SPOKEN_LANGUAGE_OPTIONS}
            selectedCodes={spokenLanguages}
            customLanguages={customLanguages}
            onChangeCodes={setSpokenLanguages}
            onChangeCustom={setCustomLanguages}
            disabled={fieldsReadOnly}
          />
        </CardContent>
      </Card>

      {/* Services */}
      <Card className="overflow-hidden shadow-sm border-border/60">
        <CardHeader className="bg-muted/30 border-b border-border/50 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Briefcase size={14} /></span>
            {t('profile.services')} <span className="text-red-500 ms-0.5">*</span>
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">{t('dashboard.services_description')}</CardDescription>
        </CardHeader>
        <CardContent className="pt-5 px-5">
          <div className="flex gap-3 mb-5">
            <Input
              value={newService}
              onChange={e => setNewService(e.target.value)}
              placeholder={t('dashboard.service_name')}
              onKeyDown={e => {
                if (e.key === 'Enter' && newService) addServiceMut.mutate({ data: { name: newService } });
              }}
            />
            <Button
              onClick={() => addServiceMut.mutate({ data: { name: newService } })}
              disabled={!newService || addServiceMut.isPending}
            >
              <Plus size={16} className="me-1.5" />
              {t('common.add')}
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {office.services?.map(srv => (
              <div
                key={srv.id}
                className="flex items-center justify-between gap-2 p-3 border rounded-xl bg-card shadow-sm group"
                data-testid={`row-service-${srv.id}`}
              >
                <span className="font-medium text-sm break-words">{srv.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  onClick={() => setDeleteServiceId(srv.id)}
                  data-testid={`button-remove-service-${srv.id}`}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            {(!office.services || office.services.length === 0) && (
              <div className="col-span-full py-8 text-center text-muted-foreground italic border border-dashed rounded-xl bg-muted/10 text-sm">
                {t('dashboard.no_services')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete service confirmation */}
      <AlertDialog open={deleteServiceId !== null} onOpenChange={open => { if (!open) setDeleteServiceId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'ar' ? 'حذف الخدمة؟' : 'Delete Service?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar'
                ? 'هل أنت متأكد أنك تريد حذف هذه الخدمة؟ لا يمكن التراجع عن هذا الإجراء.'
                : 'Are you sure you want to delete this service? This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteServiceId(null)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteServiceId !== null) removeServiceMut.mutate({ serviceId: deleteServiceId });
                setDeleteServiceId(null);
              }}
              data-testid="button-confirm-delete-service"
            >
              {language === 'ar' ? 'حذف' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bottom save button for long form */}
      <div className="flex gap-3 flex-wrap pb-4">
        {canSubmit && (
          <Button
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending}
            variant="secondary"
            className="gap-2"
          >
            <Send size={15} />
            {submitMut.isPending ? t('dashboard.submitting') : t('dashboard.submit_for_review')}
          </Button>
        )}
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending || fieldsReadOnly}
        >
          {updateMutation.isPending ? t('common.saving') : isLocked ? t('dashboard.save_as_pending_edit') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
