/**
 * OfficeManagement — unified section combining the Intake Queue and All Offices
 * views under one nav entry.  Both views share a single OfficeDetailDialog
 * action panel — no duplicate action workflows exist anywhere.
 */
import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Building2, ClipboardList } from 'lucide-react';
import { RegistrationRequestsSection } from './RegistrationRequests';
import { OfficesTableSection } from './OfficesTable';

type OfficeView = 'intake' | 'all';

export function OfficeManagementSection() {
  const { language } = useI18n();
  const [view, setView] = useState<OfficeView>('intake');

  const tabs = [
    {
      id: 'intake' as const,
      icon: <ClipboardList size={15} />,
      labelAr: 'قائمة الانتظار',
      labelEn: 'Intake Queue',
    },
    {
      id: 'all' as const,
      icon: <Building2 size={15} />,
      labelAr: 'جميع المكاتب',
      labelEn: 'All Offices',
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
      {view === 'intake' && <RegistrationRequestsSection />}
      {view === 'all'    && <OfficesTableSection />}
    </div>
  );
}
