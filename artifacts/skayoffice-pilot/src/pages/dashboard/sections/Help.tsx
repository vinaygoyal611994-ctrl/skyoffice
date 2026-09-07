import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HelpCircle, ChevronDown, MessageCircle, Mail, CheckCircle2 } from 'lucide-react';

interface FAQItem {
  qKey: string;
  aKey: string;
}

const FAQ_ITEMS: FAQItem[] = [
  { qKey: 'dash.help.faq_1_q', aKey: 'dash.help.faq_1_a' },
  { qKey: 'dash.help.faq_2_q', aKey: 'dash.help.faq_2_a' },
  { qKey: 'dash.help.faq_3_q', aKey: 'dash.help.faq_3_a' },
  { qKey: 'dash.help.faq_4_q', aKey: 'dash.help.faq_4_a' },
  { qKey: 'dash.help.faq_5_q', aKey: 'dash.help.faq_5_a' },
];

const ONBOARDING_STEPS = [
  'dash.help.onboarding_1',
  'dash.help.onboarding_2',
  'dash.help.onboarding_3',
  'dash.help.onboarding_4',
  'dash.help.onboarding_5',
];

function FAQAccordion({ qKey, aKey }: FAQItem) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b last:border-0">
      <button
        className="w-full flex items-center justify-between gap-3 py-4 text-start"
        onClick={() => setOpen(o => !o)}
      >
        <span className="font-medium text-sm leading-snug">{t(qKey as any)}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <p className="text-sm text-muted-foreground pb-4 leading-relaxed">{t(aKey as any)}</p>
      )}
    </div>
  );
}

export function HelpSection() {
  const { t } = useI18n();

  return (
    <div className="space-y-5">
      {/* Getting started */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle size={18} className="text-primary" />
            {t('dash.help.getting_started')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {ONBOARDING_STEPS.map((key, i) => (
            <div key={key} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </div>
              <p className="text-sm leading-relaxed">{t(key as any)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-base">{t('dash.help.faq_section')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {FAQ_ITEMS.map(item => (
            <FAQAccordion key={item.qKey} {...item} />
          ))}
        </CardContent>
      </Card>

      {/* Contact support */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('dash.help.contact_section')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-12"
            onClick={() => window.open('https://wa.me/96560000000', '_blank')}
          >
            <MessageCircle size={18} className="text-emerald-500" />
            {t('dash.help.whatsapp_support')}
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-12"
            onClick={() => window.open('mailto:support@skayoffice.com', '_blank')}
          >
            <Mail size={18} className="text-blue-500" />
            {t('dash.help.email_support')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
