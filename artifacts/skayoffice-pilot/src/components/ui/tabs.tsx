import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

// Merges an internal ref with a forwarded ref so both point at the same DOM
// node — needed because the scrollable variant below tracks scroll position
// on the same element that the parent might also want a ref to.
function useMergedRef<T>(...refs: Array<React.Ref<T> | undefined>) {
  return React.useCallback((node: T | null) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, refs);
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    /**
     * When true, renders the tab list as a horizontally-scrollable strip
     * instead of relying on flex-wrap/shrink. Use this whenever the tab
     * count or label length can plausibly overflow the viewport (mobile
     * widths, long Arabic labels, 5+ tabs) — the alternative (tabs silently
     * clipped at the screen edge) is not acceptable UX. Adds edge "fade"
     * hints that appear only while there is more content to scroll to in
     * that direction, and works correctly in both RTL and LTR.
     */
    scrollable?: boolean;
  }
>(({ className, scrollable, children, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRef(ref, innerRef);
  const [showStartFade, setShowStartFade] = React.useState(false);
  const [showEndFade, setShowEndFade] = React.useState(false);

  const updateFades = React.useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    // Math.abs() normalizes scrollLeft across LTR (0..max) and the
    // spec-compliant RTL convention used by all current browser engines
    // (0..-max), so the same start/end logic works in both directions.
    const scrolled = Math.abs(el.scrollLeft);
    const maxScroll = el.scrollWidth - el.clientWidth;
    setShowStartFade(scrolled > 2);
    setShowEndFade(scrolled < maxScroll - 2);
  }, []);

  React.useEffect(() => {
    if (!scrollable) return;
    updateFades();
    const el = innerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateFades, { passive: true });
    const resizeObserver = new ResizeObserver(updateFades);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener('scroll', updateFades);
      resizeObserver.disconnect();
    };
  }, [scrollable, updateFades, children]);

  if (!scrollable) {
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    );
  }

  return (
    <div className="relative">
      <TabsPrimitive.List
        ref={mergedRef}
        className={cn(
          'flex items-center overflow-x-auto scrollbar-none scroll-smooth [-webkit-overflow-scrolling:touch]',
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
      {/* Edge fade hints — signal there are more tabs to scroll to without
          permanently occluding the first/last tab. `start-0`/`end-0` are
          logical properties so they land on the correct physical side in
          both RTL and LTR automatically; only the gradient direction needs
          an explicit rtl:/ltr: flip. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 start-0 w-8 transition-opacity duration-200 ltr:bg-gradient-to-r rtl:bg-gradient-to-l from-background to-transparent',
          showStartFade ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 end-0 w-8 transition-opacity duration-200 ltr:bg-gradient-to-l rtl:bg-gradient-to-r from-background to-transparent',
          showEndFade ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
