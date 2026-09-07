/**
 * IntelligenceHub — Market Intelligence, Contact Analytics, and Supply Control
 * under one nav entry.  No data sources or features are removed.
 */
import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { TrendingUp, BarChart3, ShieldCheck, CreditCard, Rocket } from 'lucide-react';
import IntelligenceSection from './Intelligence';
import { ContactAnalyticsSection } from './ContactAnalytics';
import { SupplyControlSection } from './SupplyControlSection';
import { SubscriptionSection } from './SubscriptionSection';
import { CommercialLaunchSection } from './CommercialLaunchSection';

type IntelView = 'market' | 'contact' | 'supply' | 'subscriptions' | 'launch';

export function IntelligenceHubSection() {
  const { language } = useI18n();
  const [view, setView] = useState<IntelView>('market');

  const tabs = [
    {
      id: 'market' as const,
      icon: <TrendingUp size={15} />,
      labelAr: 'ذكاء السوق',
      labelEn: 'Market Intelligence',
    },
    {
      id: 'contact' as const,
      icon: <BarChart3 size={15} />,
      labelAr: 'تحليلات التواصل',
      labelEn: 'Contact Analytics',
    },
    {
      id: 'supply' as const,
      icon: <ShieldCheck size={15} />,
      labelAr: 'التحكم بالعرض',
      labelEn: 'Supply Control',
    },
    {
      id: 'subscriptions' as const,
      icon: <CreditCard size={15} />,
      labelAr: 'الاشتراكات',
      labelEn: 'Subscriptions',
    },
    {
      id: 'launch' as const,
      icon: <Rocket size={15} />,
      labelAr: 'الإطلاق التجاري',
      labelEn: 'Commercial Launch',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="dashboard-scroll scrollbar-none flex gap-1 border-b" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            role="tab"
            aria-selected={view === tab.id}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              view === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {tab.icon}
            {language === 'ar' ? tab.labelAr : tab.labelEn}
          </button>
        ))}
      </div>

      {/* Content */}
      {view === 'market'        && <IntelligenceSection />}
      {view === 'contact'       && <ContactAnalyticsSection />}
      {view === 'supply'        && <SupplyControlSection />}
      {view === 'subscriptions' && <SubscriptionSection />}
      {view === 'launch'         && <CommercialLaunchSection />}
    </div>
  );
}
