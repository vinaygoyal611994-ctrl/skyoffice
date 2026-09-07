import { officeCategoryEnum } from "@workspace/db";

export const CATEGORY_LABELS: Record<
  (typeof officeCategoryEnum)[number],
  { labelAr: string; labelEn: string }
> = {
  translation: { labelAr: "الترجمة", labelEn: "Translation" },
  legal: { labelAr: "الخدمات القانونية", labelEn: "Legal Services" },
  marketing: { labelAr: "التسويق", labelEn: "Marketing" },
  development: { labelAr: "تطوير البرمجيات", labelEn: "Software Development" },
  design: { labelAr: "التصميم", labelEn: "Design" },
  real_estate: { labelAr: "العقارات", labelEn: "Real Estate" },
  company_formation: {
    labelAr: "تأسيس الشركات",
    labelEn: "Company Formation",
  },
  business_consulting: {
    labelAr: "الاستشارات التجارية",
    labelEn: "Business Consulting",
  },
  accounting: { labelAr: "المحاسبة", labelEn: "Accounting" },
  social_media_management: {
    labelAr: "إدارة منصات التواصل الاجتماعي",
    labelEn: "Social Media Management",
  },
  other: { labelAr: "أخرى", labelEn: "Other" },
};
