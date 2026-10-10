import React from 'react';
import { useI18n } from '@/lib/i18n';
import { useListFavourites, useRemoveFavourite, getListFavouritesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { HeartCrack, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickOfficeCard } from '@/components/office/QuickOfficeCard';

export function Favourites() {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();

  const { data: favourites, isLoading } = useListFavourites();

  const removeFavMutation = useRemoveFavourite({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFavouritesQueryKey() })
    }
  });

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 flex flex-col gap-8 min-h-[80vh]">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight">
          {t('fav.title')}
        </h1>
        <p className="text-muted-foreground text-lg">
          {t('fav.subtitle')}
        </p>
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : !favourites?.length ? (
          <div className="flex flex-col items-center justify-center py-24 text-center border rounded-xl border-dashed bg-muted/10">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6">
              <HeartCrack className="h-10 w-10 text-muted-foreground/60" />
            </div>
            <h3 className="text-2xl font-serif font-bold mb-3">{t('fav.empty')}</h3>
            <p className="text-muted-foreground max-w-md mb-8">
              {t('fav.empty_description')}
            </p>
            <Button size="lg" className="rounded-full px-4 sm:px-8" asChild>
              <Link href="/discover">
                <Search className="mr-2 rtl:ml-2 rtl:mr-0" size={18} />
                {t('nav.discover')}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {favourites.map((fav, index) => (
              <QuickOfficeCard
                key={fav.id}
                office={fav}
                index={index}
                showFavourite
                isFavourite
                favouriteDisabled={removeFavMutation.isPending}
                onToggleFavourite={() => removeFavMutation.mutate({ officeId: fav.id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
