import { Link } from 'wouter';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

// ─────────────────────────────────────────────
//  Shared layout wrapper
// ─────────────────────────────────────────────

function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  const { language } = useI18n();
  const isRtl = language === 'ar';
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-primary to-primary/75 text-primary-foreground">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-14">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors mb-8"
          >
            <BackIcon size={15} />
            <span>{isRtl ? 'العودة للرئيسية' : 'Back to Home'}</span>
          </Link>
          <p className="text-xs font-semibold tracking-widest uppercase text-primary-foreground/55 mb-3">
            SkayOffice · Legal
          </p>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">{title}</h1>
          <p className="text-sm text-primary-foreground/65">{lastUpdated}</p>
        </div>
      </div>

      {/* Main content card */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-5 pb-16">
        <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
          <div className="p-6 md:p-10 legal-content text-sm leading-7 text-foreground/90 [&>p]:mb-4 [&>p:last-of-type]:mb-0">
            {children}
          </div>
        </div>

        {/* Footer row */}
        <div className="mt-8 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <BackIcon size={15} />
            <span>{isRtl ? 'العودة للرئيسية' : 'Back to Home'}</span>
          </Link>
          <p className="text-xs text-muted-foreground">{lastUpdated}</p>
        </div>
      </div>
    </div>
  );
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="py-6 border-b border-border/50 last:border-b-0">
      <div className="flex items-start gap-3 mb-3">
        <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold flex items-center justify-center ring-1 ring-primary/20 mt-0.5">
          {number}
        </span>
        <h2 className="text-[15px] font-semibold text-foreground leading-snug pt-0.5">{title}</h2>
      </div>
      <div className="space-y-3 text-muted-foreground ps-10">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="leading-relaxed">{children}</p>;
}

function UL({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-primary/40 flex-shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center font-mono bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-md text-xs border border-amber-200 dark:border-amber-700/50">
      [{label}]
    </span>
  );
}

// ─────────────────────────────────────────────
//  TERMS OF USE — English
// ─────────────────────────────────────────────

function TermsEn() {
  return (
    <>
      <p className="text-muted-foreground">
        Please read these Terms of Use carefully before using the SkayOffice platform. By creating an account or using the platform in any way, you agree to be bound by these Terms. If you do not agree, you must not use the platform.
      </p>

      <p className="text-xs text-muted-foreground/70 italic border-s-2 border-yellow-400 ps-3">
        ⚠ These Terms were prepared in good faith as a starting framework for the market pilot phase of SkayOffice. They have not been reviewed by a qualified legal professional. We recommend independent legal review before unrestricted commercial launch.
      </p>

      <Section number={1} title="Platform Definition and Role">
        <P>SkayOffice is a digital discovery and communication platform operated by Future Road Labs. It enables professional offices, freelancers, and service providers (collectively, "Service Providers") to create digital profiles and connect with potential customers ("Customers") seeking professional services.</P>
        <P>Future Road Labs owns and operates the platform, including its software, design, database structure, interface, brand, and all associated intellectual property, unless explicitly stated otherwise.</P>
        <P>The platform does not provide professional services itself. It serves exclusively as a discovery channel and communication bridge between Service Providers and Customers.</P>
      </Section>

      <Section number={2} title="Account Registration">
        <P>To access certain features of the platform, you must register an account. You agree to:</P>
        <UL items={[
          "Provide accurate, complete, and current information during registration',",
          'Maintain the confidentiality of your login credentials',
          'Notify us immediately of any unauthorised use of your account',
          'Accept responsibility for all activities that occur under your account',
        ]} />
        <P>You may not create an account on behalf of another person or organisation without proper authorisation.</P>
      </Section>

      <Section number={3} title="User Eligibility">
        <P>You must be at least 18 years of age to create an account or use the platform. By registering, you confirm that you meet this requirement. If you are registering on behalf of a legal entity, you confirm that you have authority to bind that entity to these Terms.</P>
        <P>The platform is intended for professional, business, and commercial use. Consumer protection rules may apply differently in your jurisdiction.</P>
      </Section>

      <Section number={4} title="Accuracy of Submitted Information">
        <P>All information submitted to the platform — including office details, service descriptions, contact information, certifications, qualifications, and documents — must be truthful, accurate, and not misleading. You are solely responsible for the content of your profile and submissions.</P>
        <P>Future Road Labs reserves the right to reject, remove, or request correction of any content that it reasonably believes to be inaccurate, incomplete, or misleading.</P>
      </Section>

      <Section number={5} title="Office and Freelancer Responsibilities">
        <P>Service Providers who register on the platform agree to:</P>
        <UL items={[
          'Hold all licences, permits, and qualifications required by applicable law to offer the services listed on their profile',
          'Represent their services, qualifications, and pricing truthfully and without exaggeration',
          'Respond to customer enquiries in a timely and professional manner',
          'Keep their profile information, availability, and contact details up to date',
          'Not submit forged, altered, or misrepresenting documents for verification',
          'Comply with applicable laws and professional regulations in their jurisdiction',
          'Not use the platform to solicit customers outside the platform in a manner that circumvents these Terms',
        ]} />
      </Section>

      <Section number={6} title="Customer Responsibilities">
        <P>Customers who use the platform agree to:</P>
        <UL items={[
          'Use the platform in good faith and for lawful purposes only',
          'Provide accurate information when contacting Service Providers',
          'Respect the professional time and communication channels of Service Providers',
          'Not misuse contact details or communication tools to send spam, harass, or abuse Service Providers',
          'Not impersonate another person or organisation',
        ]} />
      </Section>

      <Section number={7} title="Acceptable Use">
        <P>You agree to use the platform only for lawful purposes and in a manner consistent with these Terms. Prohibited activities include, but are not limited to:</P>
        <UL items={[
          'Attempting to gain unauthorised access to the platform, other user accounts, or platform systems',
          'Uploading or transmitting malicious code, viruses, or harmful software',
          'Scraping, crawling, or systematically extracting data from the platform without written authorisation',
          'Posting false reviews, fabricated transaction records, or misleading ratings',
          'Using the platform to facilitate fraud, money laundering, or any illegal activity',
          'Harassing, threatening, or abusing other users',
          'Circumventing or attempting to circumvent any security or access-control feature',
          'Creating multiple accounts to evade suspension or to gain unfair advantage',
          'Infringing any intellectual property rights of Future Road Labs or any third party',
        ]} />
      </Section>

      <Section number={8} title="Documents, Images, and Uploaded Content">
        <P>You are solely responsible for any content — including documents, images, videos, text, and files — that you upload to the platform. You warrant that:</P>
        <UL items={[
          'You own or have the necessary rights and permissions to upload and display such content',
          'The content does not infringe any third-party intellectual property rights',
          'The content does not contain unlawful, defamatory, obscene, or misleading material',
          'Documents submitted for verification are genuine and unaltered',
        ]} />
        <P>By uploading content, you grant Future Road Labs a limited, non-exclusive, royalty-free licence to store, process, display, and transmit that content solely to operate and provide the platform services.</P>
        <P>Future Road Labs may remove content at any time without prior notice if it reasonably believes the content violates these Terms or applicable law.</P>
      </Section>

      <Section number={9} title="Public Profile Publication and Approval">
        <P>Service Provider profiles are not publicly visible until they have been reviewed and approved by the Future Road Labs administration team. Submission of a registration application does not guarantee approval or publication.</P>
        <P>Future Road Labs may request additional information, documents, or corrections before approving a profile. It may also reject an application without obligation to provide detailed reasons, at its sole discretion.</P>
        <P>Once approved and active, profiles are visible to all users of the platform, including anonymously browsing visitors.</P>
      </Section>

      <Section number={10} title="Direct Communication via External Services">
        <P>The platform provides contact tools that connect Customers with Service Providers via WhatsApp, telephone, maps, and external websites. These external services are operated by independent third parties (including Meta, Google, and telecommunications providers) and are not controlled by Future Road Labs.</P>
        <P>Future Road Labs is not responsible for the availability, content, privacy practices, or conduct of any external service. Your use of those services is governed by the respective terms of the third-party provider.</P>
      </Section>

      <Section number={11} title="Platform Role as Intermediary">
        <P>SkayOffice is a discovery and communication platform only. Future Road Labs is not a party to any contract, agreement, transaction, or professional relationship formed between Service Providers and Customers through or facilitated by the platform.</P>
        <P>All arrangements — including scope of work, pricing, timelines, deliverables, payment terms, and dispute resolution — are made directly between the Service Provider and the Customer. Future Road Labs bears no responsibility for the performance, outcome, or fulfilment of any such arrangement.</P>
      </Section>

      <Section number={12} title="No Guarantees">
        <P>Future Road Labs makes no representation or warranty regarding:</P>
        <UL items={[
          'The quality, accuracy, completeness, or fitness for purpose of any Service Provider profile or listed service',
          'The licensing status, qualifications, or legal compliance of any Service Provider',
          'The availability, response time, or professional conduct of any Service Provider',
          'The outcome or completion of any transaction or professional engagement',
          'The continued availability or performance of the platform itself',
        ]} />
        <P>You use the platform and engage with Service Providers entirely at your own risk.</P>
      </Section>

      <Section number={13} title="Subscription Plans and Payments">
        <P>Certain features of the platform may require a paid subscription. Subscription plans, pricing, and included features are published on the platform and may be updated from time to time with reasonable notice.</P>
        <P>All payments are processed through third-party payment providers. By subscribing, you agree to the payment terms and authorise the applicable charges.</P>
      </Section>

      <Section number={14} title="Renewals, Cancellation, and Refunds">
        <P>Subscriptions may renew automatically unless cancelled before the renewal date. You are responsible for cancelling your subscription if you do not wish it to renew.</P>
        <P>Refund eligibility, if any, is governed by the refund policy published on the platform at the time of purchase. Future Road Labs reserves the right to grant or deny refund requests at its sole discretion, consistent with applicable consumer protection law.</P>
      </Section>

      <Section number={15} title="Taxes and Third-Party Payment Providers">
        <P>You are solely responsible for determining and paying any applicable taxes arising from your use of the platform or your commercial activities conducted through it. Future Road Labs does not provide tax advice.</P>
        <P>Payment processing is performed by independent third-party providers. Future Road Labs is not responsible for payment failures, processing errors, or data security incidents that occur within third-party payment systems.</P>
      </Section>

      <Section number={16} title="Account Suspension and Termination">
        <P>Future Road Labs may suspend, restrict, or terminate your account at any time, with or without notice, if it reasonably believes that you have:</P>
        <UL items={[
          'Violated these Terms or any applicable law',
          'Engaged in fraudulent, abusive, or harmful conduct',
          'Submitted false or misleading information',
          'Failed to maintain the standards required for platform participation',
        ]} />
        <P>You may request account deletion at any time by contacting us. Upon termination, your profile and associated data will be handled in accordance with our Privacy Policy.</P>
      </Section>

      <Section number={17} title="Intellectual Property">
        <P>Future Road Labs owns all intellectual property rights in and to the SkayOffice platform, including but not limited to:</P>
        <UL items={[
          'The software, source code, and technical architecture',
          'The platform design, visual interface, and user experience',
          'The SkayOffice brand, name, logo, and associated trademarks',
          'The database structure, data models, and compiled platform data',
          'All original content, copy, and documentation created by Future Road Labs',
        ]} />
        <P>Nothing in these Terms grants you any right, title, or interest in the platform or its intellectual property beyond a limited, revocable licence to use the platform for its intended purpose.</P>
      </Section>

      <Section number={18} title="User Content Licence">
        <P>You retain ownership of all content that you upload to the platform (your "User Content"). By uploading User Content, you grant Future Road Labs a worldwide, non-exclusive, royalty-free licence to use, store, reproduce, display, and transmit your User Content solely to the extent necessary to operate and provide the platform.</P>
        <P>This licence terminates when you delete your User Content or your account, subject to reasonable technical and backup retention periods.</P>
      </Section>

      <Section number={19} title="Disclaimers">
        <P>The platform is provided on an "as is" and "as available" basis. Future Road Labs makes no warranties — express, implied, statutory, or otherwise — regarding the platform, including any warranties of merchantability, fitness for a particular purpose, non-infringement, or uninterrupted operation.</P>
        <P>Future Road Labs does not warrant that the platform will be error-free, free from security vulnerabilities, or always accessible.</P>
      </Section>

      <Section number={20} title="Limitation of Liability">
        <P>To the fullest extent permitted by applicable law, Future Road Labs and its affiliates, directors, employees, and agents shall not be liable for:</P>
        <UL items={[
          'Any indirect, incidental, consequential, special, or punitive damages',
          'Loss of profits, revenue, data, or business opportunities',
          'Damages arising from your reliance on information provided by Service Providers',
          'Any dispute, claim, or liability arising between Service Providers and Customers',
          'Platform downtime, data loss, or security incidents beyond our reasonable control',
        ]} />
        <P>Our aggregate liability for any claim arising from use of the platform shall not exceed the amount you paid to Future Road Labs in the twelve months preceding the claim, or USD 100, whichever is greater.</P>
      </Section>

      <Section number={21} title="Indemnification">
        <P>You agree to indemnify, defend, and hold harmless Future Road Labs and its affiliates, officers, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising from:</P>
        <UL items={[
          'Your use of the platform',
          'Your violation of these Terms or any applicable law',
          'Your User Content or submissions',
          'Any dispute between you and another user of the platform',
        ]} />
      </Section>

      <Section number={22} title="Third-Party Links and Services">
        <P>The platform may contain links to external websites and services that are not owned or controlled by Future Road Labs. We have no control over and assume no responsibility for the content, privacy policies, or practices of any third-party sites or services. We encourage you to review the terms and privacy policies of any third-party services you access.</P>
      </Section>

      <Section number={23} title="Changes to the Platform and Terms">
        <P>Future Road Labs reserves the right to modify, suspend, or discontinue any part of the platform at any time without notice. We may also update these Terms from time to time. Where changes are material, we will notify registered users through the platform or by email. Your continued use of the platform after an update constitutes your acceptance of the revised Terms.</P>
        <P>The version of the Terms in force at the time you use the platform is the version that applies to you.</P>
      </Section>

      <Section number={24} title="Governing Law">
        <P>These Terms are governed by and construed in accordance with the laws of the United Arab Emirates. Any disputes arising under or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of the United Arab Emirates, unless mandatory consumer protection laws in your jurisdiction provide otherwise.</P>
      </Section>

      <Section number={25} title="Contact">
        <P>If you have any questions about these Terms, please contact us at:</P>
        <P>
          <strong>Future Road Labs</strong><br />
          Address: <Placeholder label="COMPANY ADDRESS" /><br />
          Email: <Placeholder label="LEGAL CONTACT EMAIL" />
        </P>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────
//  TERMS OF USE — Arabic
// ─────────────────────────────────────────────

function TermsAr() {
  return (
    <>
      <p className="text-muted-foreground">
        يُرجى قراءة شروط الاستخدام هذه بعناية قبل استخدام منصة SkayOffice. بمجرد إنشاء حساب أو استخدام المنصة بأي شكل، فإنك توافق على الالتزام بهذه الشروط. إذا كنت لا توافق عليها، يجب عليك عدم استخدام المنصة.
      </p>

      <p className="text-xs text-muted-foreground/70 italic border-s-2 border-yellow-400 ps-3">
        ⚠ صِيغت هذه الشروط بنية حسنة بوصفها إطاراً أولياً لمرحلة الإطلاق التجريبي لـ SkayOffice، ولم تخضع بعد لمراجعة من مستشار قانوني مؤهل. يُنصح بإجراء مراجعة قانونية مستقلة قبل الإطلاق التجاري الكامل.
      </p>

      <Section number={1} title="تعريف المنصة ودورها">
        <P>SkayOffice منصة رقمية للاكتشاف والتواصل المهني، تُشغّلها شركة فيوتشر رود لابز. تُتيح المنصة للمكاتب المهنية والمستقلين ومقدمي الخدمات (يُشار إليهم مجتمعين بـ"مقدمي الخدمة") إنشاء ملفات تعريف رقمية والتواصل مع العملاء المحتملين ("العملاء") الباحثين عن خدمات مهنية.</P>
        <P>تمتلك شركة فيوتشر رود لابز وتُشغّل المنصة، بما يشمل البرنامج والتصميم وبنية قاعدة البيانات والواجهة والعلامة التجارية وجميع حقوق الملكية الفكرية المرتبطة بها، ما لم يُنصّ على خلاف ذلك صراحةً.</P>
        <P>لا تُقدّم المنصة خدمات مهنية بنفسها، إذ تعمل حصراً بوصفها قناةً للاكتشاف وجسراً للتواصل بين مقدمي الخدمة والعملاء.</P>
      </Section>

      <Section number={2} title="تسجيل الحساب">
        <P>للوصول إلى بعض ميزات المنصة، يتعين عليك تسجيل حساب. بالتسجيل، توافق على ما يلي:</P>
        <UL items={[
          'تقديم معلومات دقيقة وكاملة وحديثة خلال عملية التسجيل',
          'الحفاظ على سرية بيانات الدخول الخاصة بك',
          'إبلاغنا فوراً بأي استخدام غير مصرح به لحسابك',
          'تحمّل المسؤولية الكاملة عن جميع الأنشطة التي تجري من خلال حسابك',
        ]} />
        <P>لا يحق لك إنشاء حساب نيابةً عن شخص آخر أو مؤسسة دون الحصول على تفويض رسمي مناسب.</P>
      </Section>

      <Section number={3} title="شروط الأهلية">
        <P>يشترط أن يكون عمرك ثمانية عشر (18) عاماً على الأقل لإنشاء حساب أو استخدام المنصة. بالتسجيل، تؤكد استيفاءك لهذا الشرط. إذا كنت تسجّل نيابةً عن كيان قانوني، فأنت تقرّ بامتلاكك الصلاحية لإلزام ذلك الكيان بهذه الشروط.</P>
        <P>تستهدف المنصة الاستخدام المهني والتجاري والأعمال. قد تنطبق قواعد حماية المستهلك بشكل مختلف تبعاً للاختصاص القضائي في بلدك.</P>
      </Section>

      <Section number={4} title="دقة المعلومات المُقدَّمة">
        <P>يجب أن تكون جميع المعلومات المُقدَّمة إلى المنصة — بما تشمل تفاصيل المكتب وأوصاف الخدمات وبيانات التواصل والشهادات والمؤهلات والمستندات — صادقةً ودقيقةً وغير مُضلِّلة. أنت المسؤول الوحيد عن محتوى ملفك الشخصي وما تُقدّمه من معلومات.</P>
        <P>تحتفظ شركة فيوتشر رود لابز بالحق في رفض أي محتوى أو إزالته أو طلب تصحيحه إذا اعتقدت بصورة معقولة أنه غير دقيق أو ناقص أو مُضلِّل.</P>
      </Section>

      <Section number={5} title="مسؤوليات المكاتب والمستقلين">
        <P>بالتسجيل في المنصة بوصفك مقدّم خدمة، توافق على ما يلي:</P>
        <UL items={[
          'امتلاك جميع التراخيص والتصاريح والمؤهلات التي يشترطها القانون المعمول به لتقديم الخدمات المُدرجة في ملفك الشخصي',
          'تقديم خدماتك ومؤهلاتك وأسعارك بصدق ودون مبالغة',
          'الاستجابة لاستفسارات العملاء في الوقت المناسب وبأسلوب مهني',
          'تحديث بيانات ملفك الشخصي وتوافره وبيانات التواصل باستمرار',
          'عدم تقديم مستندات مزورة أو مُعدَّلة أو مُضلِّلة للتحقق',
          'الامتثال للقوانين المعمول بها والأنظمة المهنية في اختصاصك القضائي',
          'عدم استخدام المنصة للتواصل مع العملاء خارجها بطريقة تتحايل على هذه الشروط',
        ]} />
      </Section>

      <Section number={6} title="مسؤوليات العملاء">
        <P>باستخدام المنصة، يوافق العملاء على ما يلي:</P>
        <UL items={[
          'استخدام المنصة بنية حسنة ولأغراض مشروعة فقط',
          'تقديم معلومات دقيقة عند التواصل مع مقدمي الخدمة',
          'احترام وقت مقدمي الخدمة المهني وقنوات التواصل المتاحة',
          'عدم إساءة استخدام بيانات التواصل أو أدوات التواصل لإرسال رسائل مزعجة أو مضايقة مقدمي الخدمة أو إساءتهم',
          'عدم انتحال شخصية أي شخص أو مؤسسة',
        ]} />
      </Section>

      <Section number={7} title="الاستخدام المقبول والأنشطة المحظورة">
        <P>توافق على استخدام المنصة للأغراض المشروعة فحسب ووفق هذه الشروط. تشمل الأنشطة المحظورة، على سبيل المثال لا الحصر:</P>
        <UL items={[
          'محاولة الوصول غير المصرح به إلى المنصة أو حسابات مستخدمين آخرين أو أنظمة المنصة',
          'تحميل أو نقل أكواد خبيثة أو فيروسات أو برامج ضارة',
          'استخراج البيانات آلياً من المنصة دون تفويض كتابي',
          'نشر تقييمات مزيفة أو سجلات معاملات ملفقة أو تقييمات مضللة',
          'استخدام المنصة لتسهيل الاحتيال أو غسيل الأموال أو أي نشاط غير مشروع',
          'مضايقة مستخدمين آخرين أو تهديدهم أو الإساءة إليهم',
          'التحايل على أي ميزة أمنية أو تحكم في الوصول أو محاولة ذلك',
          'إنشاء حسابات متعددة للتهرب من قرار تعليق أو لاكتساب ميزة غير عادلة',
          'انتهاك أي حقوق ملكية فكرية تعود لشركة فيوتشر رود لابز أو أي طرف ثالث',
        ]} />
      </Section>

      <Section number={8} title="المستندات والصور والمحتوى المحمَّل">
        <P>أنت المسؤول الوحيد عن أي محتوى — يشمل المستندات والصور ومقاطع الفيديو والنصوص والملفات — تُحمّله إلى المنصة. تضمن بذلك ما يلي:</P>
        <UL items={[
          'امتلاكك أو حصولك على الحقوق والأذونات اللازمة لتحميل هذا المحتوى وعرضه',
          'عدم انتهاك المحتوى لأي حقوق ملكية فكرية لأطراف ثالثة',
          'خلو المحتوى من أي مواد غير قانونية أو تشهيرية أو فاضحة أو مضللة',
          'صحة المستندات المُقدَّمة للتحقق وعدم تعديلها',
        ]} />
        <P>بتحميل المحتوى، تمنح شركة فيوتشر رود لابز ترخيصاً محدوداً وغير حصري وبدون مقابل مادي لتخزين محتواك ومعالجته وعرضه ونقله فقط بقدر ما هو ضروري لتشغيل خدمات المنصة وتقديمها.</P>
        <P>يحق لشركة فيوتشر رود لابز إزالة المحتوى في أي وقت دون إشعار مسبق إذا اعتقدت بصورة معقولة بانتهاكه لهذه الشروط أو للقانون المعمول به.</P>
      </Section>

      <Section number={9} title="نشر الملف الشخصي والموافقة عليه">
        <P>لا تكون ملفات مقدمي الخدمة مرئيةً للعموم إلا بعد مراجعتها والموافقة عليها من قِبَل فريق إدارة شركة فيوتشر رود لابز. لا يضمن تقديم طلب التسجيل الموافقةَ عليه أو نشرَه.</P>
        <P>يحق لشركة فيوتشر رود لابز طلب معلومات أو مستندات إضافية أو تصحيحات قبل الموافقة على الملف الشخصي، كما يحق لها رفض الطلب دون التزام بتقديم أسباب تفصيلية، وذلك وفق تقديرها المطلق.</P>
        <P>بعد الموافقة والتفعيل، تصبح الملفات الشخصية مرئيةً لجميع مستخدمي المنصة، بمن فيهم الزوار المجهولون.</P>
      </Section>

      <Section number={10} title="التواصل المباشر عبر الخدمات الخارجية">
        <P>توفر المنصة أدوات تواصل تربط العملاء بمقدمي الخدمة عبر واتساب والهاتف والخرائط والمواقع الإلكترونية الخارجية. هذه الخدمات الخارجية تُشغّلها أطراف ثالثة مستقلة (بما تشمل ميتا وجوجل وشركات الاتصالات) وهي خارج نطاق سيطرة شركة فيوتشر رود لابز.</P>
        <P>لا تتحمل شركة فيوتشر رود لابز أي مسؤولية عن توافر أي خدمة خارجية أو محتواها أو ممارسات خصوصيتها أو سلوك مشغّليها. يخضع استخدامك لتلك الخدمات لشروط مزوّديها المعنيين.</P>
      </Section>

      <Section number={11} title="دور المنصة كوسيط">
        <P>SkayOffice منصة اكتشاف وتواصل حصراً. لا تُعدّ شركة فيوتشر رود لابز طرفاً في أي عقد أو اتفاقية أو معاملة أو علاقة مهنية تنشأ بين مقدمي الخدمة والعملاء من خلال المنصة أو بتسهيل منها.</P>
        <P>تُبرَم جميع الترتيبات — بما تشمل نطاق العمل والأسعار والجداول الزمنية والمنجزات وشروط الدفع وحل النزاعات — مباشرةً بين مقدم الخدمة والعميل. لا تتحمل شركة فيوتشر رود لابز أي مسؤولية عن أداء أي ترتيب من هذا القبيل أو نتيجته أو تنفيذه.</P>
      </Section>

      <Section number={12} title="انعدام الضمانات">
        <P>لا تُقدّم شركة فيوتشر رود لابز أي إقرار أو ضمان بشأن:</P>
        <UL items={[
          'جودة أي ملف شخصي لمقدم الخدمة أو خدمة مُدرجة أو دقتها أو اكتمالها أو ملاءمتها لغرض بعينه',
          'الوضع الترخيصي لأي مقدم خدمة أو مؤهلاته أو مدى امتثاله للقانون',
          'توافر أي مقدم خدمة أو سرعة استجابته أو سلوكه المهني',
          'نتيجة أي معاملة أو تعاقد مهني أو اكتماله',
          'استمرار توافر المنصة ذاتها أو أدائها',
        ]} />
        <P>أنت تستخدم المنصة وتتعامل مع مقدمي الخدمة على مسؤوليتك الكاملة.</P>
      </Section>

      <Section number={13} title="خطط الاشتراك والمدفوعات">
        <P>قد تستلزم بعض ميزات المنصة اشتراكاً مدفوعاً. تُنشر خطط الاشتراك والأسعار والميزات المتضمنة على المنصة وقد تُحدَّث من وقت لآخر مع إشعار معقول.</P>
        <P>تُعالَج جميع المدفوعات عبر مزودي خدمات دفع خارجيين. بالاشتراك، توافق على شروط الدفع وتُفوّض الرسوم المعمول بها.</P>
      </Section>

      <Section number={14} title="التجديد والإلغاء وسياسة الاسترداد">
        <P>قد تُجدَّد الاشتراكات تلقائياً ما لم يُلغَ الاشتراك قبل تاريخ التجديد. أنت مسؤول عن إلغاء اشتراكك إذا لم ترغب في تجديده.</P>
        <P>تخضع أهلية الاسترداد، إن وُجدت، لسياسة الاسترداد المنشورة على المنصة وقت الشراء. تحتفظ شركة فيوتشر رود لابز بالحق في قبول طلبات الاسترداد أو رفضها وفق تقديرها المطلق، مع الالتزام بقوانين حماية المستهلك المعمول بها.</P>
      </Section>

      <Section number={15} title="الضرائب ومزودو خدمات الدفع الخارجيون">
        <P>أنت المسؤول الوحيد عن تحديد أي ضرائب معمول بها والوفاء بها فيما يتعلق باستخدامك للمنصة أو أنشطتك التجارية التي تُجريها من خلالها. لا تُقدّم شركة فيوتشر رود لابز أي استشارات ضريبية.</P>
        <P>تُنفَّذ عمليات الدفع عبر مزودين خارجيين مستقلين. لا تتحمل شركة فيوتشر رود لابز أي مسؤولية عن أعطال الدفع أو أخطاء المعالجة أو حوادث أمن البيانات التي تقع داخل أنظمة الدفع الخارجية.</P>
      </Section>

      <Section number={16} title="تعليق الحساب وإنهاؤه">
        <P>يحق لشركة فيوتشر رود لابز تعليق حسابك أو تقييده أو إنهاؤه في أي وقت مع إشعار أو بدونه إذا اعتقدت بصورة معقولة أنك:</P>
        <UL items={[
          'انتهكت هذه الشروط أو أي قانون معمول به',
          'مارست سلوكاً احتيالياً أو إساءياً أو ضاراً',
          'قدّمت معلومات كاذبة أو مضللة',
          'أخفقت في الوفاء بالمعايير المطلوبة للمشاركة في المنصة',
        ]} />
        <P>يمكنك طلب حذف حسابك في أي وقت عبر التواصل معنا. عند إنهاء الحساب، تُعالَج بياناتك وملفك الشخصي وفقاً لسياسة الخصوصية الخاصة بنا.</P>
      </Section>

      <Section number={17} title="الملكية الفكرية">
        <P>تمتلك شركة فيوتشر رود لابز جميع حقوق الملكية الفكرية في منصة SkayOffice وتشمل على وجه الخصوص:</P>
        <UL items={[
          'البرامج والكود المصدري والبنية التقنية',
          'تصميم المنصة وواجهتها البصرية وتجربة المستخدم',
          'العلامة التجارية لـ SkayOffice واسمها وشعارها والعلامات التجارية المرتبطة بها',
          'بنية قاعدة البيانات ونماذج البيانات والبيانات المجمّعة للمنصة',
          'جميع المحتوى الأصلي والنسخ الإبداعية والوثائق التي أنشأتها شركة فيوتشر رود لابز',
        ]} />
        <P>لا يمنحك شيء في هذه الشروط أي حق أو ملكية في المنصة أو ملكيتها الفكرية سوى ترخيص محدود قابل للإلغاء لاستخدام المنصة للغرض المقصود منها.</P>
      </Section>

      <Section number={18} title="ترخيص محتوى المستخدم">
        <P>تحتفظ بملكية جميع المحتوى الذي تُحمّله إلى المنصة ("محتوى المستخدم"). بتحميل محتوى المستخدم، تمنح شركة فيوتشر رود لابز ترخيصاً عالمياً وغير حصري وبدون مقابل مادي لاستخدام محتواك المستخدم وتخزينه واستنساخه وعرضه ونقله فقط بقدر ما هو ضروري لتشغيل المنصة وتقديم خدماتها.</P>
        <P>ينتهي هذا الترخيص عند حذفك لمحتوى المستخدم أو حسابك، مع مراعاة فترات الاحتفاظ الفنية المعقولة لأغراض النسخ الاحتياطي.</P>
      </Section>

      <Section number={19} title="إخلاء المسؤولية">
        <P>تُقدَّم المنصة "كما هي" و"بحسب توافرها". لا تُقدّم شركة فيوتشر رود لابز أي ضمانات — صريحة أو ضمنية أو قانونية أو غيرها — بشأن المنصة، بما يشمل أي ضمانات تتعلق بالقابلية للتسويق أو الملاءمة لغرض معين أو عدم الانتهاك أو التشغيل المتواصل.</P>
        <P>لا تضمن شركة فيوتشر رود لابز خلوّ المنصة من الأخطاء أو الثغرات الأمنية أو انقطاع الوصول إليها في أي وقت.</P>
      </Section>

      <Section number={20} title="تحديد المسؤولية">
        <P>بالقدر الأقصى المسموح به بموجب القانون المعمول به، لن تكون شركة فيوتشر رود لابز وشركاتها التابعة ومديروها وموظفوها ووكلاؤها مسؤولين عن:</P>
        <UL items={[
          'أي أضرار غير مباشرة أو عرضية أو تبعية أو خاصة أو عقابية',
          'خسارة الأرباح أو الإيرادات أو البيانات أو الفرص التجارية',
          'الأضرار الناجمة عن اعتمادك على معلومات مُقدَّمة من مقدمي الخدمة',
          'أي نزاع أو مطالبة أو مسؤولية تنشأ بين مقدمي الخدمة والعملاء',
          'توقف المنصة أو فقدان البيانات أو الحوادث الأمنية خارج نطاق سيطرتنا المعقولة',
        ]} />
        <P>لا تتجاوز مسؤوليتنا الإجمالية عن أي مطالبة تنشأ عن استخدام المنصة المبلغ الذي دفعته لشركة فيوتشر رود لابز في الاثني عشر شهراً السابقة للمطالبة، أو ما يعادل 100 دولار أمريكي، أيهما أكبر.</P>
      </Section>

      <Section number={21} title="التعويض">
        <P>توافق على تعويض شركة فيوتشر رود لابز وشركاتها التابعة ومسؤوليها وموظفيها ووكلائها والدفاع عنهم وحمايتهم من وضد أي مطالبات ومسؤوليات وأضرار وخسائر ونفقات (بما تشمل الأتعاب القانونية المعقولة) الناجمة عن:</P>
        <UL items={[
          'استخدامك للمنصة',
          'انتهاكك لهذه الشروط أو أي قانون معمول به',
          'محتوى المستخدم الخاص بك أو تقديماتك',
          'أي نزاع بينك وبين مستخدم آخر للمنصة',
        ]} />
      </Section>

      <Section number={22} title="الروابط والخدمات الخارجية">
        <P>قد تحتوي المنصة على روابط لمواقع إلكترونية وخدمات خارجية ليست مملوكةً لشركة فيوتشر رود لابز ولا تُديرها. نحن لا نتحكم في محتوى تلك المواقع والخدمات أو سياسات خصوصيتها أو ممارساتها، ولا نتحمل أي مسؤولية عنها. نشجعك على مراجعة شروط الاستخدام وسياسات الخصوصية الخاصة بأي خدمات خارجية تصل إليها.</P>
      </Section>

      <Section number={23} title="تغييرات المنصة والشروط">
        <P>تحتفظ شركة فيوتشر رود لابز بالحق في تعديل أي جزء من المنصة أو تعليقه أو إيقافه في أي وقت دون إشعار. يحق لنا أيضاً تحديث هذه الشروط من وقت لآخر. في حال كانت التغييرات جوهرية، سنخطر المستخدمين المسجلين عبر المنصة أو البريد الإلكتروني. استمرارك في استخدام المنصة بعد أي تحديث يُعدّ قبولاً منك للشروط المعدّلة.</P>
        <P>النسخة من الشروط السارية وقت استخدامك للمنصة هي النسخة التي تنطبق عليك.</P>
      </Section>

      <Section number={24} title="القانون الحاكم">
        <P>تخضع هذه الشروط وتُفسَّر وفق قوانين دولة الإمارات العربية المتحدة. تخضع أي نزاعات تنشأ بموجب هذه الشروط أو فيما يتعلق بها للاختصاص القضائي الحصري لمحاكم دولة الإمارات العربية المتحدة، ما لم تنص قوانين حماية المستهلك الإلزامية في بلدك على خلاف ذلك.</P>
      </Section>

      <Section number={25} title="التواصل معنا">
        <P>إذا كان لديك أي استفسار حول هذه الشروط، يُرجى التواصل معنا على:</P>
        <P>
          <strong>شركة فيوتشر رود لابز</strong><br />
          العنوان: <Placeholder label="COMPANY ADDRESS" /><br />
          البريد الإلكتروني: <Placeholder label="LEGAL CONTACT EMAIL" />
        </P>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────
//  PRIVACY POLICY — English
// ─────────────────────────────────────────────

function PrivacyEn() {
  return (
    <>
      <p className="text-muted-foreground">
        This Privacy Policy explains how Future Road Labs ("we", "us", "our") collects, uses, stores, and protects information about you when you use the SkayOffice platform. By using the platform, you agree to the practices described in this Policy.
      </p>

      <p className="text-xs text-muted-foreground/70 italic border-s-2 border-yellow-400 ps-3">
        ⚠ This Privacy Policy was prepared in good faith as a starting framework for the market pilot phase of SkayOffice. It has not been reviewed by a qualified legal or data-protection professional. We recommend independent legal review before unrestricted commercial launch.
      </p>

      <Section number={1} title="Who Operates the Platform">
        <P>The SkayOffice platform is owned and operated by Future Road Labs. We are the data controller responsible for the personal information collected through the platform.</P>
        <P>Contact: <Placeholder label="PRIVACY CONTACT EMAIL" /></P>
      </Section>

      <Section number={2} title="Data We Collect">
        <P>We collect the following categories of information:</P>
        <P><strong>Account and identity data:</strong> your name, email address, phone number, password (stored as a cryptographic hash), account role (customer, office, or administrator), and account status.</P>
        <P><strong>Office and freelancer profile information:</strong> business name, service category, city and country, short and full descriptions, WhatsApp number, website, physical address, Google Maps URL, spoken languages, specialisation, certifications, services offered, and profile images.</P>
        <P><strong>Documents submitted for verification:</strong> trade licences, professional licences, identity documents, and any other files you upload to support your registration application. These are processed solely for verification purposes.</P>
        <P><strong>Images, videos, and uploaded media:</strong> gallery images, cover images, profile logos, marketing videos, and other media you upload to display on your profile.</P>
        <P><strong>Location and map data:</strong> latitude and longitude coordinates, if you choose to add a map location to your profile. We do not continuously track your device location.</P>
        <P><strong>Payment and subscription records:</strong> subscription plan, payment status, and transaction history. We do not store complete payment card details — these are processed and held by our third-party payment provider.</P>
        <P><strong>Technical, device, log, and usage data:</strong> IP address, browser type, device type, operating system, pages visited, time and date of access, session identifiers, and error logs. This data is collected automatically when you use the platform.</P>
        <P><strong>Cookies and similar technologies:</strong> we use session cookies to maintain your login state. We may use analytics cookies to understand how the platform is used. You can control cookie behaviour through your browser settings.</P>
        <P><strong>Legal consent records:</strong> the date and time you accepted the Terms of Use and Privacy Policy, and the version of those documents you accepted.</P>
      </Section>

      <Section number={3} title="How We Use Your Data">
        <P>We use the information we collect to:</P>
        <UL items={[
          'Create and manage your account',
          'Publish and maintain your public office or freelancer profile',
          'Review and process your registration application',
          'Enable discovery of offices and freelancers by customers',
          'Process payments and manage subscriptions',
          'Send account-related notifications (application status, subscription updates)',
          'Enforce our Terms of Use and prevent abuse',
          'Monitor platform security and performance',
          'Comply with legal obligations and respond to lawful requests',
          'Improve the platform based on usage patterns',
        ]} />
      </Section>

      <Section number={4} title="Legal Bases for Processing">
        <P>We process your personal data on the following legal bases:</P>
        <UL items={[
          'Contract performance — processing necessary to provide the services you signed up for',
          'Legitimate interests — operating and improving the platform, preventing fraud, and ensuring security',
          'Consent — for non-essential cookies and marketing communications, where applicable',
          'Legal obligation — complying with applicable laws and regulatory requirements',
        ]} />
        <P>Where your jurisdiction requires a specific legal basis, we will rely on the most appropriate one for the processing activity concerned.</P>
      </Section>

      <Section number={5} title="Publicly Displayed Information">
        <P>When your office or freelancer profile is approved and active, certain information is publicly visible to all users of the platform, including users who are not logged in. Publicly displayed information includes: your business name, service category, city, short and full descriptions, profile images, gallery, services, certifications, WhatsApp number, website, email address, and Google Maps location (if provided).</P>
        <P>You are responsible for the information you choose to include in your public profile. Do not include sensitive personal information that you do not wish to be publicly visible.</P>
      </Section>

      <Section number={6} title="Data Sharing">
        <P>We do not sell your personal data to third parties. We may share information with:</P>
        <UL items={[
          'Hosting and cloud infrastructure providers who store and process platform data on our behalf',
          'Analytics providers who help us understand platform usage',
          'Email and communications providers who deliver platform notifications',
          'Map service providers (such as Google Maps) to display and process location data',
          'Payment processors who handle subscription and payment transactions',
          'Customer support tools used to manage user enquiries',
        ]} />
        <P>All third-party providers who process personal data on our behalf are required to handle it in a manner consistent with this Privacy Policy and applicable data protection law.</P>
      </Section>

      <Section number={7} title="Legal and Regulatory Disclosure">
        <P>We may disclose your information where required to do so by applicable law, court order, regulatory authority, or governmental request. We will, where legally permissible, notify you of any such request before disclosing your data.</P>
      </Section>

      <Section number={8} title="No Sale of Personal Data">
        <P>We do not sell, rent, or trade your personal information to any third party for their own marketing or commercial purposes.</P>
      </Section>

      <Section number={9} title="International Data Transfers">
        <P>The platform is operated from and data is primarily stored within cloud infrastructure that may be located in multiple regions. If your data is transferred outside your country, we take reasonable steps to ensure it remains protected in accordance with applicable data protection standards.</P>
      </Section>

      <Section number={10} title="Data Retention">
        <P>We retain your personal data for as long as your account remains active and for a reasonable period thereafter to fulfil our legal, financial, and operational obligations. Specifically:</P>
        <UL items={[
          'Account data is retained for the duration of your account and for up to 24 months following account closure',
          'Verification documents are retained for the period required by applicable law and our compliance obligations',
          'Audit and activity logs are retained for up to 24 months',
          'Payment records are retained in accordance with applicable financial and tax record-keeping requirements',
        ]} />
        <P>After the applicable retention period, we will delete or anonymise your personal data.</P>
      </Section>

      <Section number={11} title="Security Measures">
        <P>We implement reasonable technical and organisational safeguards to protect your personal data against unauthorised access, disclosure, alteration, and destruction. These include encrypted data transmission (HTTPS/TLS), hashed password storage, access controls, and session management.</P>
        <P>However, no method of electronic transmission or storage is completely secure. We cannot guarantee absolute security and encourage you to use strong, unique passwords and to keep your login credentials confidential.</P>
      </Section>

      <Section number={12} title="Your Rights">
        <P>Depending on your jurisdiction, you may have the following rights regarding your personal data:</P>
        <UL items={[
          'Access — the right to request a copy of the personal data we hold about you',
          'Rectification — the right to request correction of inaccurate or incomplete data',
          'Erasure — the right to request deletion of your personal data, subject to legal retention obligations',
          'Restriction — the right to request that we limit how we process your data in certain circumstances',
          'Objection — the right to object to processing based on legitimate interests',
          'Portability — the right to receive your data in a structured, commonly used, machine-readable format',
        ]} />
        <P>To exercise any of these rights, please contact us at: <Placeholder label="PRIVACY CONTACT EMAIL" /></P>
        <P>We will respond to rights requests within a reasonable timeframe. We may need to verify your identity before processing a request.</P>
      </Section>

      <Section number={13} title="Account Deletion">
        <P>You may request deletion of your account at any time by contacting us at: <Placeholder label="PRIVACY CONTACT EMAIL" /></P>
        <P>Upon receiving a verified deletion request, we will delete or anonymise your personal data, subject to retention obligations under applicable law (for example, financial records and legal compliance obligations). Profile data that was publicly displayed before deletion may persist in external caches or search engine indices for a period after deletion.</P>
      </Section>

      <Section number={14} title="Children and Minors">
        <P>The platform is not intended for use by individuals under the age of 18. We do not knowingly collect personal data from minors. If you believe that a minor has provided personal data through the platform, please contact us and we will take prompt steps to delete it.</P>
      </Section>

      <Section number={15} title="Third-Party Services">
        <P>The platform integrates with and links to third-party services including WhatsApp (operated by Meta Platforms, Inc.), Google Maps, and payment providers. When you interact with these services, their own privacy policies apply. We encourage you to review the privacy policies of all third-party services you use in connection with the platform.</P>
        <P>We are not responsible for the privacy practices of any third-party service.</P>
      </Section>

      <Section number={16} title="Updates to This Policy">
        <P>We may update this Privacy Policy from time to time to reflect changes in our practices, technology, or applicable law. Where changes are material, we will notify registered users through the platform or by email. The date of the most recent update is shown at the top of this page.</P>
        <P>Your continued use of the platform after an update constitutes your acceptance of the revised Privacy Policy.</P>
      </Section>

      <Section number={17} title="Contact">
        <P>If you have any questions, concerns, or requests regarding this Privacy Policy or our data-handling practices, please contact us at:</P>
        <P>
          <strong>Future Road Labs — Privacy</strong><br />
          Email: <Placeholder label="PRIVACY CONTACT EMAIL" />
        </P>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────
//  PRIVACY POLICY — Arabic
// ─────────────────────────────────────────────

function PrivacyAr() {
  return (
    <>
      <p className="text-muted-foreground">
        توضّح سياسة الخصوصية هذه كيفية جمع شركة فيوتشر رود لابز ("نحن" أو "الشركة") للمعلومات المتعلقة بك عند استخدامك لمنصة SkayOffice، واستخدامها وتخزينها وحمايتها. باستخدامك للمنصة، توافق على الممارسات الموضّحة في هذه السياسة.
      </p>

      <p className="text-xs text-muted-foreground/70 italic border-s-2 border-yellow-400 ps-3">
        ⚠ صِيغت سياسة الخصوصية هذه بنية حسنة بوصفها إطاراً أولياً لمرحلة الإطلاق التجريبي لـ SkayOffice، ولم تخضع بعد لمراجعة من متخصص قانوني أو في مجال حماية البيانات. يُنصح بإجراء مراجعة قانونية مستقلة قبل الإطلاق التجاري الكامل.
      </p>

      <Section number={1} title="من يُشغّل المنصة">
        <P>منصة SkayOffice مملوكةٌ لشركة فيوتشر رود لابز وتُشغّلها. نحن المتحكم بالبيانات المسؤول عن المعلومات الشخصية المُجمَّعة من خلال المنصة.</P>
        <P>للتواصل: <Placeholder label="PRIVACY CONTACT EMAIL" /></P>
      </Section>

      <Section number={2} title="البيانات التي نجمعها">
        <P>نجمع الفئات التالية من المعلومات:</P>
        <P><strong>بيانات الحساب والهوية:</strong> اسمك وعنوان بريدك الإلكتروني ورقم هاتفك وكلمة مرورك (المخزّنة على شكل بصمة تشفيرية) ودورك على المنصة (عميل أو مكتب أو مشرف) وحالة حسابك.</P>
        <P><strong>معلومات ملف المكتب أو المستقل:</strong> اسم العمل وتصنيف الخدمة والمدينة والبلد والأوصاف المختصرة والتفصيلية ورقم واتساب والموقع الإلكتروني والعنوان الفيزيائي ورابط خرائط جوجل ولغات التواصل والتخصص والشهادات المهنية والخدمات المقدمة وصور الملف الشخصي.</P>
        <P><strong>المستندات المُقدَّمة للتحقق:</strong> السجلات التجارية والتراخيص المهنية ووثائق الهوية وأي ملفات أخرى تُحمّلها لدعم طلب تسجيلك. تُعالَج هذه المستندات حصراً لأغراض التحقق.</P>
        <P><strong>الصور ومقاطع الفيديو والوسائط المحمَّلة:</strong> صور المعرض وصور الغلاف وشعارات الملف الشخصي ومقاطع الفيديو التعريفية وغيرها من الوسائط التي تُحمّلها لعرضها في ملفك الشخصي.</P>
        <P><strong>بيانات الموقع والخرائط:</strong> إحداثيات خط العرض وخط الطول، إذا اخترت إضافة موقع على الخريطة لملفك الشخصي. نحن لا نتتبع موقع جهازك باستمرار.</P>
        <P><strong>سجلات الدفع والاشتراك:</strong> خطة الاشتراك وحالة الدفع وسجل المعاملات. لا نحتفظ ببيانات البطاقة الائتمانية الكاملة — تُعالَج هذه البيانات وتُحتفظ بها من قِبَل مزود خدمة الدفع الخارجي.</P>
        <P><strong>البيانات التقنية وبيانات الجهاز والسجلات والاستخدام:</strong> عنوان IP ونوع المتصفح ونوع الجهاز ونظام التشغيل والصفحات التي تمت زيارتها والتاريخ والوقت ومعرّفات الجلسة وسجلات الأخطاء. تُجمَّع هذه البيانات تلقائياً عند استخدامك للمنصة.</P>
        <P><strong>ملفات تعريف الارتباط والتقنيات المماثلة:</strong> نستخدم ملفات تعريف ارتباط الجلسات للحفاظ على حالة تسجيل الدخول. قد نستخدم ملفات تعريف ارتباط تحليلية لفهم كيفية استخدام المنصة. يمكنك التحكم في سلوك ملفات تعريف الارتباط من خلال إعدادات متصفحك.</P>
        <P><strong>سجلات الموافقة القانونية:</strong> التاريخ والوقت اللذان قبلت فيهما شروط الاستخدام وسياسة الخصوصية، إضافةً إلى إصدار تلك الوثائق الذي وافقت عليه.</P>
      </Section>

      <Section number={3} title="كيف نستخدم بياناتك">
        <P>نستخدم المعلومات التي نجمعها من أجل:</P>
        <UL items={[
          'إنشاء حسابك وإدارته',
          'نشر ملف مكتبك أو ملفك كمستقل وصيانته',
          'مراجعة طلب تسجيلك ومعالجته',
          'تمكين العملاء من اكتشاف المكاتب والمستقلين',
          'معالجة المدفوعات وإدارة الاشتراكات',
          'إرسال الإشعارات المرتبطة بالحساب (حالة الطلب وتحديثات الاشتراك)',
          'تطبيق شروط الاستخدام ومنع الإساءة',
          'مراقبة أمان المنصة وأدائها',
          'الامتثال للالتزامات القانونية والاستجابة للطلبات المشروعة',
          'تحسين المنصة استناداً إلى أنماط الاستخدام',
        ]} />
      </Section>

      <Section number={4} title="الأسس القانونية للمعالجة">
        <P>نعالج بياناتك الشخصية استناداً إلى الأسس القانونية التالية:</P>
        <UL items={[
          'تنفيذ العقد — المعالجة الضرورية لتقديم الخدمات التي اشتركت فيها',
          'المصالح المشروعة — تشغيل المنصة وتحسينها ومنع الاحتيال وضمان الأمن',
          'الموافقة — لملفات تعريف الارتباط غير الأساسية والاتصالات التسويقية حيثما انطبق ذلك',
          'الالتزام القانوني — الامتثال للقوانين المعمول بها والمتطلبات التنظيمية',
        ]} />
        <P>حيثما اشترط اختصاصك القضائي أساساً قانونياً محدداً، سنعتمد الأنسب منها للنشاط المعني بالمعالجة.</P>
      </Section>

      <Section number={5} title="المعلومات المعروضة للعموم">
        <P>عند الموافقة على ملف مكتبك أو ملفك كمستقل وتفعيله، تصبح بعض المعلومات مرئيةً للعموم لجميع مستخدمي المنصة بمن فيهم غير المسجلين. تشمل المعلومات المعروضة للعموم: اسم العمل وتصنيف الخدمة والمدينة والأوصاف المختصرة والتفصيلية وصور الملف الشخصي والمعرض والخدمات والشهادات ورقم واتساب والموقع الإلكتروني وعنوان البريد الإلكتروني وموقع خرائط جوجل (إذا أُضيف).</P>
        <P>أنت مسؤول عن المعلومات التي تختار إدراجها في ملفك الشخصي العام. لا تُدرج معلومات شخصية حساسة لا تودّ أن تكون مرئيةً للعموم.</P>
      </Section>

      <Section number={6} title="مشاركة البيانات">
        <P>لا نبيع بياناتك الشخصية لأطراف ثالثة. قد نشارك المعلومات مع:</P>
        <UL items={[
          'مزودي البنية التحتية السحابية والاستضافة الذين يخزّنون بيانات المنصة ويعالجونها نيابةً عنا',
          'مزودي التحليلات الذين يساعدوننا على فهم استخدام المنصة',
          'مزودي البريد الإلكتروني والاتصالات الذين يُرسلون إشعارات المنصة',
          'مزودي خدمات الخرائط (كخرائط جوجل) لعرض بيانات الموقع ومعالجتها',
          'معالجي الدفع المسؤولين عن معاملات الاشتراك والدفع',
          'أدوات دعم العملاء المستخدمة لإدارة استفسارات المستخدمين',
        ]} />
        <P>جميع مزودي الخدمات الخارجيين الذين يعالجون البيانات الشخصية نيابةً عنا ملزمون بالتعامل معها بما يتوافق مع سياسة الخصوصية هذه وقانون حماية البيانات المعمول به.</P>
      </Section>

      <Section number={7} title="الإفصاح القانوني والتنظيمي">
        <P>قد نُفصح عن معلوماتك عند الاقتضاء بموجب القانون المعمول به أو بأمر قضائي أو بطلب من جهة تنظيمية أو حكومية. وحيثما سمح القانون بذلك، سنخطرك بأي طلب من هذا القبيل قبل الإفصاح عن بياناتك.</P>
      </Section>

      <Section number={8} title="عدم بيع البيانات الشخصية">
        <P>لا نبيع معلوماتك الشخصية أو نؤجّرها أو نتاجر بها مع أي طرف ثالث لأغراضه التسويقية أو التجارية الخاصة.</P>
      </Section>

      <Section number={9} title="نقل البيانات الدولي">
        <P>تُشغَّل المنصة وتُخزَّن البيانات بصورة رئيسية ضمن بنية تحتية سحابية قد تقع مراكز بياناتها في مناطق متعددة. إذا نُقلت بياناتك خارج بلدك، نتخذ تدابير معقولة لضمان بقائها محمية وفق معايير حماية البيانات المعمول بها.</P>
      </Section>

      <Section number={10} title="الاحتفاظ بالبيانات">
        <P>نحتفظ ببياناتك الشخصية طالما كان حسابك نشطاً ولفترة معقولة بعد ذلك لتلبية التزاماتنا القانونية والمالية والتشغيلية. تحديداً:</P>
        <UL items={[
          'تُحتفظ ببيانات الحساب طوال مدة حسابك ولمدة تصل إلى 24 شهراً بعد إغلاقه',
          'تُحتفظ بمستندات التحقق للمدة التي يشترطها القانون المعمول به والتزاماتنا بالامتثال',
          'تُحتفظ بسجلات المراجعة والنشاط لمدة تصل إلى 24 شهراً',
          'تُحتفظ بسجلات الدفع وفق متطلبات الاحتفاظ بالسجلات المالية والضريبية المعمول بها',
        ]} />
        <P>بعد انتهاء فترة الاحتفاظ المعمول بها، سنحذف بياناتك الشخصية أو نجعلها مجهولة الهوية.</P>
      </Section>

      <Section number={11} title="الإجراءات الأمنية">
        <P>نُطبّق ضمانات تقنية وتنظيمية معقولة لحماية بياناتك الشخصية من الوصول غير المصرح به والإفصاح والتعديل والتدمير. تشمل هذه الضمانات تشفير نقل البيانات (HTTPS/TLS) وتخزين كلمات المرور بصورة مجزّأة تشفيرياً وضوابط الوصول وإدارة الجلسات.</P>
        <P>بيد أن لا طريقة نقل إلكتروني أو تخزين آمنة كلياً. لا يمكننا ضمان أمان مطلق، ونحثّك على استخدام كلمات مرور قوية وفريدة والحفاظ على سرية بيانات الدخول الخاصة بك.</P>
      </Section>

      <Section number={12} title="حقوقك">
        <P>بحسب اختصاصك القضائي، قد تمتلك الحقوق التالية فيما يتعلق ببياناتك الشخصية:</P>
        <UL items={[
          'الوصول — حق طلب نسخة من البيانات الشخصية التي نحتفظ بها عنك',
          'التصحيح — حق طلب تصحيح البيانات غير الدقيقة أو الناقصة',
          'الحذف — حق طلب حذف بياناتك الشخصية، مع مراعاة التزامات الاحتفاظ القانونية',
          'التقييد — حق طلب تحديد كيفية معالجتنا لبياناتك في ظروف معينة',
          'الاعتراض — حق الاعتراض على المعالجة القائمة على المصالح المشروعة',
          'نقل البيانات — حق استلام بياناتك بصيغة منظمة وشائعة الاستخدام وقابلة للقراءة آلياً',
        ]} />
        <P>لممارسة أي من هذه الحقوق، يُرجى التواصل معنا على: <Placeholder label="PRIVACY CONTACT EMAIL" /></P>
        <P>سنستجيب لطلبات ممارسة الحقوق في غضون فترة زمنية معقولة. قد نحتاج إلى التحقق من هويتك قبل معالجة أي طلب.</P>
      </Section>

      <Section number={13} title="حذف الحساب">
        <P>يمكنك طلب حذف حسابك في أي وقت بالتواصل معنا على: <Placeholder label="PRIVACY CONTACT EMAIL" /></P>
        <P>عند استلام طلب حذف موثّق، سنحذف بياناتك الشخصية أو نجعلها مجهولة الهوية، مع الاحتفاظ بما يوجبه القانون المعمول به (كالسجلات المالية والتزامات الامتثال القانوني). قد تستمر بيانات الملف الشخصي التي كانت مرئيةً للعموم قبل الحذف في ذاكرة التخزين المؤقت الخارجية أو فهارس محركات البحث لفترة بعد الحذف.</P>
      </Section>

      <Section number={14} title="الأطفال والقاصرون">
        <P>المنصة غير مخصصة للأفراد الذين تقل أعمارهم عن ثمانية عشر (18) عاماً. لا نجمع بياناتهم الشخصية عن علم. إذا كنت تعتقد أن قاصراً قدّم بياناته الشخصية من خلال المنصة، يُرجى التواصل معنا وسنتخذ خطوات فورية لحذفها.</P>
      </Section>

      <Section number={15} title="خدمات الطرف الثالث">
        <P>تتكامل المنصة مع خدمات طرف ثالث وترتبط بها، بما تشمل واتساب (تُشغّله شركة Meta Platforms, Inc.) وخرائط جوجل ومزودي خدمات الدفع. عند تفاعلك مع هذه الخدمات، تنطبق سياسات الخصوصية الخاصة بها. نشجعك على مراجعة سياسات خصوصية جميع خدمات الطرف الثالث التي تستخدمها في سياق المنصة.</P>
        <P>لا نتحمل أي مسؤولية عن ممارسات الخصوصية لأي خدمة طرف ثالث.</P>
      </Section>

      <Section number={16} title="تحديثات هذه السياسة">
        <P>قد نُحدّث سياسة الخصوصية هذه من وقت لآخر لتعكس تغييرات في ممارساتنا أو التكنولوجيا أو القانون المعمول به. في حال كانت التغييرات جوهرية، سنخطر المستخدمين المسجلين عبر المنصة أو البريد الإلكتروني. يظهر تاريخ آخر تحديث في أعلى هذه الصفحة.</P>
        <P>استمرارك في استخدام المنصة بعد أي تحديث يُعدّ قبولاً منك لسياسة الخصوصية المعدّلة.</P>
      </Section>

      <Section number={17} title="التواصل معنا">
        <P>إذا كان لديك أي استفسار أو مخاوف أو طلبات بشأن سياسة الخصوصية هذه أو ممارساتنا في التعامل مع البيانات، يُرجى التواصل معنا على:</P>
        <P>
          <strong>شركة فيوتشر رود لابز — قسم الخصوصية</strong><br />
          البريد الإلكتروني: <Placeholder label="PRIVACY CONTACT EMAIL" />
        </P>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────
//  Exported page components
// ─────────────────────────────────────────────

export function TermsPage() {
  const { language } = useI18n();
  const isAr = language === 'ar';

  return (
    <LegalPage
      title={isAr ? 'شروط الاستخدام' : 'Terms of Use'}
      lastUpdated={isAr ? 'آخر تحديث: يوليو 2026' : 'Last Updated: July 2026'}
    >
      {isAr ? <TermsAr /> : <TermsEn />}
    </LegalPage>
  );
}

export function PrivacyPage() {
  const { language } = useI18n();
  const isAr = language === 'ar';

  return (
    <LegalPage
      title={isAr ? 'سياسة الخصوصية' : 'Privacy Policy'}
      lastUpdated={isAr ? 'آخر تحديث: يوليو 2026' : 'Last Updated: July 2026'}
    >
      {isAr ? <PrivacyAr /> : <PrivacyEn />}
    </LegalPage>
  );
}
