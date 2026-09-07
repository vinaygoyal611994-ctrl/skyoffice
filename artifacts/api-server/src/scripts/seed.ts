/**
 * Seeds demo data for the SkayOffice Pilot: 8-10 demo offices spread across
 * every category, one demo customer, and one admin account.
 * Safe to re-run: skips creation if seed users already exist.
 */
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  db,
  pool,
  usersTable,
  officesTable,
  officeServicesTable,
  officeMediaTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { generateUniqueOfficeSlug } from "../lib/slug";

const ADMIN_EMAIL = "admin@skayoffice.demo";
const CUSTOMER_EMAIL = "customer@skayoffice.demo";

// Passwords for seeded accounts must come from Replit Secrets, never from
// source — a hardcoded demo password is a publicly-known credential the
// moment the repo is shared or forked. The admin account gets its own
// secret (SEED_ADMIN_PASSWORD) so rotating it doesn't also rotate every
// demo customer/office login, and so it can be made stronger/private
// independently of the general demo password (SEED_DEMO_PASSWORD).
const ADMIN_PASSWORD = requireEnv("SEED_ADMIN_PASSWORD");
const DEMO_PASSWORD = requireEnv("SEED_DEMO_PASSWORD");

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} environment variable is required to seed accounts but was not provided. ` +
        "Set it in Replit Secrets before running the seed script.",
    );
  }
  return value;
}

const objectStorageService = new ObjectStorageService();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEED_ASSETS_DIR = path.resolve(__dirname, "../seed-assets");

/**
 * Uploads a locally seeded demo image through the real object-storage
 * upload pipeline (the same presigned-URL flow the office dashboard uses)
 * and returns the objectPath to store on the office/media record.
 */
async function uploadSeedImage(relativePath: string): Promise<string> {
  const filePath = path.join(SEED_ASSETS_DIR, relativePath);
  const buffer = await readFile(filePath);
  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const putResponse = await fetch(uploadURL, {
    method: "PUT",
    body: buffer,
    headers: { "Content-Type": "image/jpeg" },
  });
  if (!putResponse.ok) {
    throw new Error(
      `Failed to upload seed image ${relativePath}: ${putResponse.status}`,
    );
  }
  return objectStorageService.normalizeObjectEntityPath(uploadURL);
}

const DEMO_OFFICES = [
  {
    name: "Levant Bridge Translation",
    nameAr: "جسر الشام للترجمة المعتمدة",
    category: "translation" as const,
    city: "Amman",
    shortDescription: "Certified legal & technical translation across Arabic, English and French.",
    shortDescriptionAr: "ترجمة معتمدة قانونية وتقنية باللغات العربية والإنجليزية والفرنسية.",
    description:
      "Levant Bridge Translation has supported law firms, embassies and multinational companies for over a decade with certified, notarized translation services in more than 12 languages.",
    descriptionAr:
      "يقدّم جسر الشام للترجمة المعتمدة خدماته لمكاتب المحاماة والسفارات والشركات متعددة الجنسيات منذ أكثر من عقد، مع خدمات ترجمة معتمدة وموثقة بأكثر من 12 لغة.",
    services: [
      { name: "Certified Document Translation", nameAr: "ترجمة الوثائق المعتمدة" },
      { name: "Legal Interpretation", nameAr: "الترجمة الفورية القانونية" },
      { name: "Localization", nameAr: "التوطين اللغوي" },
    ],
    certifications: ["ISO 17100 Certified", "Sworn Translator License"],
    certificationsAr: ["معتمد وفق آيزو 17100", "رخصة مترجم محلّف"],
    completedTransactions: 482,
    clientsRecommendPercent: 96,
    isVerified: true,
  },
  {
    name: "Al-Mizan Legal Advisors",
    nameAr: "الميزان للاستشارات القانونية",
    category: "legal" as const,
    city: "Dubai",
    shortDescription: "Corporate & commercial legal counsel for growing businesses.",
    shortDescriptionAr: "استشارات قانونية تجارية وشركاتية للأعمال النامية.",
    description:
      "Al-Mizan Legal Advisors is a boutique corporate law practice specializing in contracts, dispute resolution and regulatory compliance for SMEs and startups across the GCC.",
    descriptionAr:
      "الميزان للاستشارات القانونية مكتب محاماة متخصص في العقود وتسوية المنازعات والامتثال التنظيمي للشركات الصغيرة والمتوسطة والشركات الناشئة في دول مجلس التعاون الخليجي.",
    services: [
      { name: "Contract Drafting", nameAr: "صياغة العقود" },
      { name: "Dispute Resolution", nameAr: "تسوية المنازعات" },
      { name: "Regulatory Compliance", nameAr: "الامتثال التنظيمي" },
    ],
    certifications: ["Dubai Legal Affairs Licensed", "GCC Bar Registered"],
    certificationsAr: ["مرخّص من دائرة الشؤون القانونية بدبي", "مسجّل في نقابة المحامين الخليجية"],
    completedTransactions: 213,
    clientsRecommendPercent: 92,
    isVerified: true,
  },
  {
    name: "Nova Reach Marketing",
    nameAr: "نوفا ريتش للتسويق الرقمي",
    category: "marketing" as const,
    city: "Riyadh",
    shortDescription: "Full-funnel digital marketing for regional brands.",
    shortDescriptionAr: "تسويق رقمي متكامل للعلامات التجارية الإقليمية.",
    description:
      "Nova Reach Marketing builds data-driven campaigns spanning paid social, SEO and content strategy, helping regional retail and hospitality brands grow their customer base.",
    descriptionAr:
      "تبني نوفا ريتش للتسويق حملات مبنية على البيانات تشمل الإعلانات المدفوعة على مواقع التواصل وتحسين محركات البحث واستراتيجية المحتوى، لمساعدة علامات التجزئة والضيافة الإقليمية على توسيع قاعدة عملائها.",
    services: [
      { name: "Social Media Management", nameAr: "إدارة وسائل التواصل الاجتماعي" },
      { name: "SEO", nameAr: "تحسين محركات البحث" },
      { name: "Paid Campaigns", nameAr: "الحملات الإعلانية المدفوعة" },
    ],
    certifications: ["Google Partner Agency"],
    certificationsAr: ["وكالة شريكة معتمدة من جوجل"],
    completedTransactions: 356,
    clientsRecommendPercent: 90,
    isVerified: false,
  },
  {
    name: "Cedar Peak Software",
    nameAr: "سيدر بيك لتطوير البرمجيات",
    category: "development" as const,
    city: "Beirut",
    shortDescription: "Custom web and mobile application development.",
    shortDescriptionAr: "تطوير تطبيقات ويب وجوال مخصصة.",
    description:
      "Cedar Peak Software designs and ships production web and mobile applications for startups and enterprises, with a focus on clean architecture and long-term maintainability.",
    descriptionAr:
      "تصمم سيدر بيك لتطوير البرمجيات وتُطلق تطبيقات ويب وجوال جاهزة للإنتاج للشركات الناشئة والمؤسسات، مع التركيز على البنية النظيفة وسهولة الصيانة على المدى الطويل.",
    services: [
      { name: "Web App Development", nameAr: "تطوير تطبيقات الويب" },
      { name: "Mobile App Development", nameAr: "تطوير تطبيقات الجوال" },
      { name: "API Integration", nameAr: "دمج واجهات البرمجة" },
    ],
    certifications: ["AWS Certified Partner"],
    certificationsAr: ["شريك معتمد من AWS"],
    completedTransactions: 128,
    clientsRecommendPercent: 94,
    isVerified: true,
  },
  {
    name: "Studio Lumen Design",
    nameAr: "استوديو لومين للتصميم",
    category: "design" as const,
    city: "Cairo",
    shortDescription: "Brand identity and product design studio.",
    shortDescriptionAr: "استوديو هوية بصرية وتصميم منتجات.",
    description:
      "Studio Lumen Design partners with founders to craft distinctive brand identities, packaging and digital product experiences that stand out in crowded markets.",
    descriptionAr:
      "يتعاون استوديو لومين للتصميم مع المؤسسين لصياغة هويات تجارية مميزة وتغليف وتجارب منتج رقمية تبرز في الأسواق المزدحمة.",
    services: [
      { name: "Brand Identity", nameAr: "الهوية التجارية" },
      { name: "UI/UX Design", nameAr: "تصميم واجهات وتجربة المستخدم" },
      { name: "Packaging Design", nameAr: "تصميم التغليف" },
    ],
    certifications: ["Adobe Certified Partner"],
    certificationsAr: ["شريك معتمد من أدوبي"],
    completedTransactions: 174,
    clientsRecommendPercent: 97,
    isVerified: true,
  },
  {
    name: "Horizon Estates Group",
    nameAr: "مجموعة هورايزون العقارية",
    category: "real_estate" as const,
    city: "Doha",
    shortDescription: "Residential & commercial real estate brokerage.",
    shortDescriptionAr: "وساطة عقارية سكنية وتجارية.",
    description:
      "Horizon Estates Group connects buyers, sellers and tenants across Doha's residential and commercial markets, with dedicated advisors for every transaction stage.",
    descriptionAr:
      "تربط مجموعة هورايزون العقارية المشترين والبائعين والمستأجرين في أسواق الدوحة السكنية والتجارية، مع مستشارين مخصصين لكل مرحلة من مراحل الصفقة.",
    services: [
      { name: "Property Sales", nameAr: "بيع العقارات" },
      { name: "Leasing", nameAr: "التأجير" },
      { name: "Investment Advisory", nameAr: "الاستشارات الاستثمارية" },
    ],
    certifications: ["RERA Registered Broker"],
    certificationsAr: ["وسيط مسجّل لدى مؤسسة تنظيم قطاع العقارات"],
    completedTransactions: 261,
    clientsRecommendPercent: 88,
    isVerified: false,
  },
  {
    name: "Founders Path Company Formation",
    nameAr: "فاوندرز باث لتأسيس الشركات",
    category: "company_formation" as const,
    city: "Abu Dhabi",
    shortDescription: "End-to-end business setup and licensing.",
    shortDescriptionAr: "تأسيس أعمال وترخيص شامل من الألف إلى الياء.",
    description:
      "Founders Path guides entrepreneurs through mainland and free-zone company formation, licensing and bank account setup, cutting weeks off the typical setup timeline.",
    descriptionAr:
      "ترشد فاوندرز باث رواد الأعمال خلال تأسيس الشركات في المناطق البرية والحرة، والترخيص، وفتح الحسابات المصرفية، مما يختصر أسابيع من الوقت اللازم عادة لإتمام التأسيس.",
    services: [
      { name: "Free Zone Setup", nameAr: "التأسيس في المناطق الحرة" },
      { name: "Trade License", nameAr: "الرخصة التجارية" },
      { name: "Bank Account Opening", nameAr: "فتح الحساب المصرفي" },
    ],
    certifications: ["UAE Ministry of Economy Approved"],
    certificationsAr: ["معتمد من وزارة الاقتصاد الإماراتية"],
    completedTransactions: 145,
    clientsRecommendPercent: 95,
    isVerified: true,
  },
  {
    name: "Meridian Business Consulting",
    nameAr: "ميريديان للاستشارات الإدارية",
    category: "business_consulting" as const,
    city: "Amman",
    shortDescription: "Strategy and operations consulting for SMEs.",
    shortDescriptionAr: "استشارات استراتيجية وتشغيلية للشركات الصغيرة والمتوسطة.",
    description:
      "Meridian Business Consulting helps small and mid-sized companies sharpen strategy, streamline operations and prepare for growth-stage investment.",
    descriptionAr:
      "تساعد ميريديان للاستشارات الإدارية الشركات الصغيرة والمتوسطة على صقل استراتيجيتها وتبسيط عملياتها والاستعداد للاستثمار في مراحل النمو.",
    services: [
      { name: "Strategy Consulting", nameAr: "الاستشارات الاستراتيجية" },
      { name: "Operations Review", nameAr: "مراجعة العمليات" },
      { name: "Growth Planning", nameAr: "تخطيط النمو" },
    ],
    certifications: ["PMI Certified Consultants"],
    certificationsAr: ["مستشارون معتمدون من معهد إدارة المشاريع"],
    completedTransactions: 97,
    clientsRecommendPercent: 91,
    isVerified: false,
  },
  {
    name: "Ledger & Co. Accounting",
    nameAr: "ليدجر آند كو للمحاسبة",
    category: "accounting" as const,
    city: "Kuwait City",
    shortDescription: "Bookkeeping, tax and audit services for businesses.",
    shortDescriptionAr: "خدمات مسك الدفاتر والضرائب والتدقيق للشركات.",
    description:
      "Ledger & Co. provides accurate bookkeeping, VAT filing and audit preparation for retail, hospitality and professional services businesses.",
    descriptionAr:
      "تقدّم ليدجر آند كو خدمات مسك دفاتر دقيقة، وتقديم إقرارات ضريبة القيمة المضافة، والتحضير للتدقيق لشركات التجزئة والضيافة والخدمات المهنية.",
    services: [
      { name: "Bookkeeping", nameAr: "مسك الدفاتر" },
      { name: "VAT Filing", nameAr: "تقديم إقرارات ضريبة القيمة المضافة" },
      { name: "Audit Preparation", nameAr: "التحضير للتدقيق" },
    ],
    certifications: ["Certified Public Accountants"],
    certificationsAr: ["محاسبون قانونيون معتمدون"],
    completedTransactions: 302,
    clientsRecommendPercent: 93,
    isVerified: true,
  },
  {
    name: "Compass Notary Services",
    nameAr: "كومباس لخدمات التوثيق",
    category: "other" as const,
    city: "Muscat",
    shortDescription: "Notarization and document authentication services.",
    shortDescriptionAr: "خدمات التوثيق والتصديق على المستندات.",
    description:
      "Compass Notary Services handles notarization, apostille and document authentication for individuals and businesses moving across borders.",
    descriptionAr:
      "تتولى كومباس لخدمات التوثيق أعمال التوثيق والتصديق على المستندات (أبوستيل) للأفراد والشركات المنتقلين عبر الحدود.",
    services: [
      { name: "Notarization", nameAr: "التوثيق" },
      { name: "Apostille Services", nameAr: "خدمات التصديق أبوستيل" },
      { name: "Document Authentication", nameAr: "تصديق المستندات" },
    ],
    certifications: ["Ministry of Justice Licensed Notary"],
    certificationsAr: ["كاتب عدل مرخّص من وزارة العدل"],
    completedTransactions: 76,
    clientsRecommendPercent: 89,
    isVerified: false,
  },
];

async function upsertUser(params: {
  role: "office" | "customer" | "admin";
  name: string;
  email: string;
  phone?: string;
}) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, params.email));
  if (existing) return existing;

  const passwordHash = await hashPassword(
    params.role === "admin" ? ADMIN_PASSWORD : DEMO_PASSWORD,
  );
  const [user] = await db
    .insert(usersTable)
    .values({ ...params, passwordHash })
    .returning();
  return user;
}

async function seed() {
  logger.info("Seeding SkayOffice Pilot demo data...");

  await upsertUser({ role: "admin", name: "Platform Admin", email: ADMIN_EMAIL });
  await upsertUser({
    role: "customer",
    name: "Demo Customer",
    email: CUSTOMER_EMAIL,
    phone: "+962700000000",
  });

  for (let i = 0; i < DEMO_OFFICES.length; i++) {
    const demo = DEMO_OFFICES[i];
    const email = `office${i + 1}@skayoffice.demo`;

    const [existingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (existingUser) {
      const [existingOffice] = await db
        .select()
        .from(officesTable)
        .where(eq(officesTable.userId, existingUser.id));

      if (existingOffice) {
        // Backfill a public slug onto demo offices seeded before the slug
        // column existed, so old demo rows get shareable/QR-able URLs too.
        if (!existingOffice.slug) {
          const slug = await generateUniqueOfficeSlug(existingOffice.name);
          await db
            .update(officesTable)
            .set({ slug })
            .where(eq(officesTable.id, existingOffice.id));
          existingOffice.slug = slug;
          logger.info({ email, slug }, "Backfilled slug for existing demo office");
        }

        // Backfill bilingual content (name/description/certifications/
        // service names in Arabic) onto already-seeded demo offices — this
        // script is designed to be safely re-run, and rows created before
        // Arabic fields existed must still end up fully bilingual.
        if (
          existingOffice.nameAr !== demo.nameAr ||
          existingOffice.shortDescriptionAr !== demo.shortDescriptionAr ||
          existingOffice.descriptionAr !== demo.descriptionAr
        ) {
          await db
            .update(officesTable)
            .set({
              nameAr: demo.nameAr,
              shortDescriptionAr: demo.shortDescriptionAr,
              descriptionAr: demo.descriptionAr,
              certifications: demo.certifications,
              certificationsAr: demo.certificationsAr,
            })
            .where(eq(officesTable.id, existingOffice.id));
          logger.info({ email }, "Backfilled Arabic content for existing demo office");
        }

        const existingServices = await db
          .select()
          .from(officeServicesTable)
          .where(eq(officeServicesTable.officeId, existingOffice.id));
        for (const service of demo.services) {
          const match = existingServices.find((s) => s.name === service.name);
          if (match) {
            if (match.nameAr !== service.nameAr) {
              await db
                .update(officeServicesTable)
                .set({ nameAr: service.nameAr })
                .where(eq(officeServicesTable.id, match.id));
            }
          } else {
            await db
              .insert(officeServicesTable)
              .values({ officeId: existingOffice.id, name: service.name, nameAr: service.nameAr });
          }
        }

        if (!existingOffice.coverUrl) {
          // Backfill imagery for offices seeded before the demo-imagery
          // pipeline existed, through the same real upload flow.
          const assetDir = `office-${i + 1}`;
          const [coverUrl, gallery1Url, gallery2Url] = await Promise.all([
            uploadSeedImage(`${assetDir}/cover.jpg`),
            uploadSeedImage(`${assetDir}/gallery-1.jpg`),
            uploadSeedImage(`${assetDir}/gallery-2.jpg`),
          ]);

          await db
            .update(officesTable)
            .set({
              coverUrl,
              heroMediaUrl: coverUrl,
              heroMediaType: "image",
            })
            .where(eq(officesTable.id, existingOffice.id));

          const existingGallery = await db
            .select()
            .from(officeMediaTable)
            .where(eq(officeMediaTable.officeId, existingOffice.id));
          if (existingGallery.length === 0) {
            for (const mediaUrl of [gallery1Url, gallery2Url]) {
              await db
                .insert(officeMediaTable)
                .values({ officeId: existingOffice.id, url: mediaUrl, type: "image" });
            }
          }

          logger.info({ email }, "Backfilled demo imagery for existing office");
        } else {
          logger.info({ email }, "Demo office already seeded, skipping");
        }
      }
      continue;
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const [user] = await db
      .insert(usersTable)
      .values({
        role: "office",
        name: demo.name,
        email,
        phone: "+962790000" + String(100 + i),
        passwordHash,
      })
      .returning();

    const slug = await generateUniqueOfficeSlug(demo.name);
    const assetDir = `office-${i + 1}`;
    const [coverUrl, gallery1Url, gallery2Url] = await Promise.all([
      uploadSeedImage(`${assetDir}/cover.jpg`),
      uploadSeedImage(`${assetDir}/gallery-1.jpg`),
      uploadSeedImage(`${assetDir}/gallery-2.jpg`),
    ]);

    const [office] = await db
      .insert(officesTable)
      .values({
        userId: user.id,
        name: demo.name,
        slug,
        nameAr: demo.nameAr,
        category: demo.category,
        city: demo.city,
        shortDescription: demo.shortDescription,
        shortDescriptionAr: demo.shortDescriptionAr,
        description: demo.description,
        descriptionAr: demo.descriptionAr,
        phone: user.phone!,
        whatsapp: user.phone,
        email,
        isOnline: i % 3 !== 0,
        isVerified: demo.isVerified,
        completedTransactions: demo.completedTransactions,
        clientsRecommendPercent: demo.clientsRecommendPercent,
        isDemo: true,
        coverUrl,
        heroMediaUrl: coverUrl,
        heroMediaType: "image",
        certifications: demo.certifications,
        certificationsAr: demo.certificationsAr,
      })
      .returning();

    for (const service of demo.services) {
      await db
        .insert(officeServicesTable)
        .values({ officeId: office.id, name: service.name, nameAr: service.nameAr });
    }

    for (const mediaUrl of [gallery1Url, gallery2Url]) {
      await db
        .insert(officeMediaTable)
        .values({ officeId: office.id, url: mediaUrl, type: "image" });
    }

    logger.info(
      { office: office.name },
      "Seeded demo office with imagery through storage pipeline",
    );
  }

  logger.info("Seeding complete.");
}

seed()
  .catch((err) => {
    logger.error({ err }, "Seeding failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
