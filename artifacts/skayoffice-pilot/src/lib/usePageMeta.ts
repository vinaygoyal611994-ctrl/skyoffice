import { useEffect } from 'react';

const DEFAULT_TITLE       = 'SkayOffice';
const DEFAULT_DESCRIPTION = 'مكتبك الرقمي.. على اتصال دائم — اكتشف المكاتب والمستقلين حسب التخصص والموقع والتوفر.';

function setMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setOg(property: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

interface PageMeta {
  title: string;
  description: string;
  keywords?: string;
}

export function usePageMeta({ title, description, keywords }: PageMeta) {
  useEffect(() => {
    document.title = title;
    setMeta('description', description);
    setOg('og:title', title);
    setOg('og:description', description);
    if (keywords) setMeta('keywords', keywords);

    return () => {
      document.title = DEFAULT_TITLE;
      setMeta('description', DEFAULT_DESCRIPTION);
      setOg('og:title', DEFAULT_TITLE);
      setOg('og:description', DEFAULT_DESCRIPTION);
    };
  }, [title, description, keywords]);
}
