import { useState } from 'react';
import { Check, ChevronsUpDown, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export interface LanguageOption {
  code: string;
  labelEn: string;
  labelAr: string;
}

interface SpokenLanguagesSelectProps {
  options: LanguageOption[];
  selectedCodes: string[];
  customLanguages: string[];
  onChangeCodes: (codes: string[]) => void;
  onChangeCustom: (custom: string[]) => void;
  disabled?: boolean;
}

// Searchable multi-select for the "Languages Spoken by the Office" field.
// Built from the existing command.tsx + popover.tsx primitives since no
// combobox/multiselect component exists elsewhere in this app yet (see
// skayoffice: office-profile-simplification memory context).
export function SpokenLanguagesSelect({
  options,
  selectedCodes,
  customLanguages,
  onChangeCodes,
  onChangeCustom,
  disabled,
}: SpokenLanguagesSelectProps) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const toggleCode = (code: string) => {
    if (selectedCodes.includes(code)) {
      onChangeCodes(selectedCodes.filter((c) => c !== code));
    } else {
      onChangeCodes([...selectedCodes, code]);
    }
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (customLanguages.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCustomInput('');
      return;
    }
    onChangeCustom([...customLanguages, trimmed]);
    setCustomInput('');
  };

  const removeCustom = (value: string) => {
    onChangeCustom(customLanguages.filter((c) => c !== value));
  };

  const totalSelected = selectedCodes.length + customLanguages.length;

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
            data-testid="button-spoken-languages"
          >
            {totalSelected > 0
              ? t('dashboard.languages_selected_count').replace('{count}', String(totalSelected))
              : t('dashboard.languages_placeholder')}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={t('dashboard.languages_search_placeholder')} />
            <CommandList>
              <CommandEmpty>{t('dashboard.languages_no_match')}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => {
                  const selected = selectedCodes.includes(opt.code);
                  return (
                    <CommandItem
                      key={opt.code}
                      value={`${opt.labelEn} ${opt.labelAr}`}
                      onSelect={() => toggleCode(opt.code)}
                      data-testid={`option-language-${opt.code}`}
                    >
                      <Check
                        className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')}
                      />
                      {language === 'ar' ? opt.labelAr : opt.labelEn}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="flex gap-2">
        <Input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder={t('dashboard.languages_other_placeholder')}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          data-testid="input-custom-language"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={addCustom}
          disabled={disabled || !customInput.trim()}
          data-testid="button-add-custom-language"
        >
          <Plus size={16} />
        </Button>
      </div>

      {(selectedCodes.length > 0 || customLanguages.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {selectedCodes.map((code) => {
            const opt = options.find((o) => o.code === code);
            return (
              <Badge key={code} variant="secondary" className="gap-1 pr-1" data-testid={`badge-language-${code}`}>
                {opt ? (language === 'ar' ? opt.labelAr : opt.labelEn) : code}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => toggleCode(code)}
                    className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    data-testid={`button-remove-language-${code}`}
                  >
                    <X size={12} />
                  </button>
                )}
              </Badge>
            );
          })}
          {customLanguages.map((value) => (
            <Badge key={value} variant="outline" className="gap-1 pr-1" data-testid={`badge-custom-language-${value}`}>
              {value}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeCustom(value)}
                  className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  data-testid={`button-remove-custom-language-${value}`}
                >
                  <X size={12} />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
