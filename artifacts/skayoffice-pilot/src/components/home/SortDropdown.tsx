import React from 'react';
import { ChevronDown, MapPin, Wifi, Clock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type OfficeSortType } from '@workspace/api-client-react';

interface Props {
  sort: OfficeSortType;
  onSortChange: (sort: OfficeSortType) => void;
  t: (key: any) => string;
}

const SORT_OPTIONS: OfficeSortType[] = ['nearest', 'available', 'newest'];

const SORT_ICONS: Record<OfficeSortType, React.ComponentType<{ size?: number; className?: string }>> = {
  nearest: MapPin,
  available: Wifi,
  newest: Clock,
};

export function SortDropdown({ sort, onSortChange, t }: Props) {
  const CurrentIcon = SORT_ICONS[sort];

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
        {t('sort.label')}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 bg-card text-sm font-medium hover:border-primary/40 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 shadow-sm min-h-[36px]"
          >
            <CurrentIcon size={14} className="text-primary shrink-0" />
            <span className="whitespace-nowrap">{t(`sort.${sort}` as any)}</span>
            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-[160px]">
          {SORT_OPTIONS.map((option) => {
            const OptionIcon = SORT_ICONS[option];
            const isSelected = sort === option;
            return (
              <DropdownMenuItem
                key={option}
                onClick={() => onSortChange(option)}
                className={`flex items-center gap-2 cursor-pointer ${
                  isSelected ? 'text-primary font-semibold' : ''
                }`}
              >
                <OptionIcon
                  size={14}
                  className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                />
                {t(`sort.${option}` as any)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
