import { useState, useEffect, useCallback } from 'react';

export type Language = 'ar' | 'en';

export const translations = {
  // Common
  'common.loading': { ar: 'جاري التحميل...', en: 'Loading...' },
  'common.error': { ar: 'حدث خطأ ما', en: 'An error occurred' },
  'common.retry': { ar: 'إعادة المحاولة', en: 'Retry' },
  'common.save': { ar: 'حفظ', en: 'Save' },
  'common.saving': { ar: 'جاري الحفظ...', en: 'Saving...' },
  'common.cancel': { ar: 'إلغاء', en: 'Cancel' },
  'common.delete': { ar: 'حذف', en: 'Delete' },
  'common.edit': { ar: 'تعديل', en: 'Edit' },
  'common.add': { ar: 'إضافة', en: 'Add' },
  'common.search': { ar: 'بحث', en: 'Search' },
  'common.logout': { ar: 'تسجيل الخروج', en: 'Logout' },
  'common.login': { ar: 'تسجيل الدخول', en: 'Login' },
  'common.register': { ar: 'إنشاء حساب', en: 'Register' },
  'common.verified': { ar: 'مكتب موثق', en: 'Verified Office' },
  'common.yes': { ar: 'نعم', en: 'Yes' },
  'common.no': { ar: 'لا', en: 'No' },
  'common.optional': { ar: '(اختياري)', en: '(optional)' },

  // Navigation
  'nav.open_menu': { ar: 'فتح القائمة', en: 'Open menu' },
  'nav.close_menu': { ar: 'إغلاق القائمة', en: 'Close menu' },
  'nav.mobile_menu': { ar: 'قائمة التنقل', en: 'Navigation menu' },
  'nav.switch_to_english': { ar: 'التبديل إلى الإنجليزية', en: 'Switch to English' },
  'nav.switch_to_arabic': { ar: 'التبديل إلى العربية', en: 'Switch to Arabic' },
  'menu.offices': { ar: 'المكاتب', en: 'Offices' },
  'menu.customers': { ar: 'العملاء', en: 'Customers' },
  'menu.administration': { ar: 'الإدارة', en: 'Administration' },
  'auth.login_admin': { ar: 'دخول الإدارة', en: 'Admin Login' },
  'auth.login_admin_tagline': { ar: 'الوصول إلى لوحة تحكم المنصة', en: 'Access the platform administration dashboard.' },
  'auth.login_admin_wrong_role': { ar: 'هذه البوابة مخصصة للمسؤولين فقط — يرجى استخدام بوابة تسجيل الدخول الصحيحة.', en: 'This portal is for administrators only — please use your correct login portal.' },
  'auth.not_admin_prompt': { ar: 'لست مسؤولاً؟', en: 'Not an admin?' },
  'nav.home': { ar: 'الرئيسية', en: 'Home' },
  'nav.discover': { ar: 'اكتشف المكاتب', en: 'Discover Offices' },
  'nav.favourites': { ar: 'المفضلة', en: 'Favourites' },
  'nav.dashboard': { ar: 'لوحة التحكم', en: 'Dashboard' },
  'nav.admin': { ar: 'الإدارة', en: 'Admin' },
  'nav.portal': { ar: 'بوابة المكاتب', en: 'Office Portal' },
  'nav.customer_portal': { ar: 'بوابة العملاء', en: 'Customer Portal' },

  // Roles / Entities
  'entity.office': { ar: 'مكتب', en: 'Office' },
  'entity.freelancer': { ar: 'مستقل', en: 'Freelancer' },
  'entity.customer': { ar: 'عميل', en: 'Customer' },
  'entity.digital_office': { ar: 'المكتب الرقمي', en: 'Digital Office' },
  'entity.verified_office': { ar: 'مكتب موثّق', en: 'Verified Office' },
  'entity.verified_freelancer': { ar: 'مستقل موثّق', en: 'Verified Freelancer' },

  // Provider type
  'provider.type_label': { ar: 'نوع مزود الخدمة', en: 'Provider Type' },
  'provider.office': { ar: 'مكتب', en: 'Office' },
  'provider.freelancer': { ar: 'مستقل', en: 'Freelancer' },
  'provider.switch_offices': { ar: 'مكاتب', en: 'Offices' },
  'provider.switch_freelancers': { ar: 'مستقلون', en: 'Freelancers' },
  'provider.type_required': { ar: 'يرجى اختيار نوع مزود الخدمة', en: 'Please select a provider type' },
  'provider.doc_guidance_office': { ar: 'ستحتاج إلى: سجل تجاري أو ترخيص مهني وإثبات هوية', en: 'You will need: trade/professional license and ID document' },
  'provider.doc_guidance_freelancer': { ar: 'ستحتاج إلى: إثبات هوية وأي شهادات مهنية ذات صلة', en: 'You will need: ID document and any relevant professional certifications' },
  'provider.read_only_note': { ar: 'لا يمكن تغيير النوع بعد التسجيل. تواصل مع الدعم إذا احتجت إلى تغييره.', en: 'Provider type cannot be changed after registration. Contact support if you need to change it.' },

  // Metrics
  'metric.completed_transactions': { ar: 'المعاملات المكتملة', en: 'Completed Transactions' },
  'metric.clients_recommend': { ar: 'يوصي به العملاء', en: 'Clients Recommend' },
  
  // Home
  'home.hero_title': { ar: 'حوّل مكتبك إلى مكتب رقمي\nوكن على اتصال دائم بعملائك', en: 'Transform Your Office into a Digital Office\nand Stay Always Connected with Your Clients' },
  'home.hero_subtitle': { ar: 'اكتشف المكاتب والمستقلين حسب التخصص والموقع والتوفر، وتواصل معهم مباشرة.', en: 'Discover offices and freelancers by specialty, location, and availability, then connect directly.' },
  'home.start_discovery': { ar: 'اكتشف المكاتب الرقمية', en: 'Explore Digital Offices' },
  'home.trust_stats': { ar: 'أرقام المنصة', en: 'Platform Statistics' },
  'home.stat_offices': { ar: 'مكتب مسجل', en: 'Registered Offices' },
  'home.stat_verified': { ar: 'مكتب موثق', en: 'Verified Offices' },
  'home.stat_transactions': { ar: 'معاملة منجزة', en: 'Completed Transactions' },
  'home.categories_title': { ar: 'تصفح حسب التخصص', en: 'Browse by Category' },
  'home.start_digital_office': { ar: 'ابدأ مكتبك الرقمي', en: 'Start Your Digital Office' },
  'home.customer_portal_desc': { ar: 'اكتشف مكاتبنا المهنية وتواصل معها مباشرة', en: 'Discover professional offices and connect directly' },
  'home.office_portal_desc': { ar: 'أنشئ مكتبك الرقمي واستقبل عملاءك من أي مكان', en: 'Create your digital office and receive clients from anywhere' },
  'home.establish_digital_office': { ar: 'أسّس مكتبك الرقمي', en: 'Start Your Digital Office' },
  'home.office_launch_desc': { ar: 'ابدأ حضورك الرقمي واستقبل عملاء من أي مكان.', en: 'Launch your digital presence and welcome clients from anywhere.' },
  'home.already_have_office_account': { ar: 'لديك حساب بالفعل؟', en: 'Already have an office account?' },
  'home.already_registered_customer': { ar: 'لديك حساب؟', en: 'Already registered?' },
  
  // Discover
  'discover.title': { ar: 'اكتشف المكاتب المهنية', en: 'Discover Professional Offices' },
  'discover.search_placeholder': { ar: 'ابحث باسم المكتب أو المدينة...', en: 'Search by office name or city...' },
  'discover.filter_category': { ar: 'جميع التخصصات', en: 'All Categories' },
  'discover.verified_only': { ar: 'المكاتب الموثقة فقط', en: 'Verified Offices Only' },
  'discover.no_results': { ar: 'لم يتم العثور على مكاتب تطابق بحثك.', en: 'No offices found matching your search.' },
  'discover.no_results_office': { ar: 'لا توجد مكاتب مطابقة حاليًا', en: 'No matching offices found' },
  'discover.no_results_freelancer': { ar: 'لا يوجد مستقلون مطابقون حاليًا', en: 'No matching freelancers found' },
  'discover.api_error': { ar: 'تعذر تحميل النتائج. يرجى المحاولة مرة أخرى.', en: 'Unable to load results. Please try again.' },
  'discover.no_offices_available': { ar: 'لا توجد مكاتب متاحة حاليًا. سيتم إضافة المكاتب قريبًا.', en: 'No offices are currently available. Offices will be added soon.' },
  'discover.load_error': { ar: 'تعذر تحميل النتائج. يرجى المحاولة مرة أخرى.', en: 'Unable to load results. Please try again.' },
  'discover.view_profile': { ar: 'زيارة المكتب الرقمي', en: 'Visit Digital Office' },
  'discover.voice_search': { ar: 'البحث الصوتي', en: 'Voice search' },
  'discover.voice_unsupported': { ar: 'البحث الصوتي غير مدعوم على هذا المتصفح', en: 'Voice search is not supported on this browser' },
  'discover.voice_permission_denied': { ar: 'البحث الصوتي غير متاح', en: 'Voice search not available' },
  'discover.voice_permission_denied_desc': { ar: 'هذه الخدمة لا تدعم الوصول إلى الميكروفون. يرجى استخدام البحث النصي.', en: 'Microphone access is blocked in this environment. Please use text search instead.' },
  'discover.voice_no_speech': { ar: 'لم يتم اكتشاف أي كلام. يرجى المحاولة مرة أخرى.', en: 'No speech detected. Please try again.' },
  'discover.voice_error': { ar: 'فشل البحث الصوتي. يرجى المحاولة مرة أخرى.', en: 'Voice search failed. Please try again.' },
  'discover.all_categories': { ar: 'الكل', en: 'All' },
  'discover.section_title': { ar: 'المكاتب الرقمية', en: 'Digital Offices' },
  'discover.section_title_freelancers': { ar: 'المستقلون', en: 'Freelancers' },
  'discover.no_offices_available_office': { ar: 'لا توجد مكاتب متاحة حاليًا. سيتم إضافة المكاتب قريبًا.', en: 'No offices are currently available. Offices will be added soon.' },
  'discover.no_offices_available_freelancer': { ar: 'لا يوجد مستقلون متاحون حاليًا. سيتم إضافة مستقلين قريبًا.', en: 'No freelancers are currently available. Freelancers will be added soon.' },
  'discover.reset_search': { ar: 'إعادة تعيين البحث', en: 'Reset search' },
  'discover.load_more': { ar: 'تحميل المزيد', en: 'Load more' },
  'discover.load_more_loading': { ar: 'جاري التحميل...', en: 'Loading...' },
  'discover.showing_count': { ar: 'عرض {count} من {total}', en: 'Showing {count} of {total}' },

  // Sort controls
  'sort.nearest': { ar: 'الأقرب', en: 'Nearest' },
  'sort.available': { ar: 'متاح الآن', en: 'Available Now' },
  'sort.newest': { ar: 'الأحدث', en: 'Newest' },
  'sort.label': { ar: 'ترتيب حسب:', en: 'Sort by:' },
  'category.more': { ar: 'المزيد', en: 'More' },
  'category.more_title': { ar: 'جميع التخصصات', en: 'All Categories' },
  'category.clear_filter': { ar: 'مسح التصفية', en: 'Clear filter' },

  // Location consent dialog
  'location.consent_title': { ar: 'هل تريد عرض المكاتب الأقرب إليك؟', en: 'Show offices closest to you?' },
  'location.consent_body': { ar: 'نستخدم موقعك فقط لترتيب نتائج البحث بالقرب منك. لا نحفظ موقعك ولا نشاركه مع أي طرف.', en: 'We use your location only to sort results by distance. Your location is never stored or shared.' },
  'location.allow': { ar: 'السماح بالوصول للموقع', en: 'Allow location access' },
  'location.deny': { ar: 'المتابعة بدون موقع', en: 'Continue without location' },
  'location.requesting': { ar: 'جاري تحديد موقعك...', en: 'Detecting location...' },
  'location.unavailable': { ar: 'تحديد الموقع غير متاح في هذا المتصفح', en: 'Location not available on this browser' },
  'location.denied_fallback': { ar: 'تم رفض الوصول. سيتم الترتيب حسب المدينة.', en: 'Location denied. Sorting by city match instead.' },

  // Proximity labels on cards
  'proximity.near_you': { ar: 'قريب منك', en: 'Near you' },
  'proximity.km': { ar: 'كم', en: 'km' },

  // Digital Office Profile
  'profile.about': { ar: 'نبذة عن المكتب', en: 'About the Office' },
  'profile.services': { ar: 'الخدمات المقدمة', en: 'Services Offered' },
  'profile.certifications': { ar: 'الاعتمادات والتراخيص', en: 'Certifications & Licenses' },
  'profile.gallery': { ar: 'معرض الأعمال', en: 'Gallery' },
  'profile.contact': { ar: 'تواصل مع المكتب', en: 'Contact Office' },
  'profile.schedule_call': { ar: 'احجز مكالمة فيديو', en: 'Book Video Call' },
  'profile.add_favourite': { ar: 'إضافة للمفضلة', en: 'Add to Favourites' },
  'profile.remove_favourite': { ar: 'إزالة من المفضلة', en: 'Remove from Favourites' },
  'profile.location': { ar: 'الموقع', en: 'Location' },
  'profile.online_only': { ar: 'متاح الآن', en: 'Online Now' },
  'profile.qr_code': { ar: 'رمز QR', en: 'QR Code' },
  'profile.qr_hint': { ar: 'اطلب من العميل مسح الرمز لزيارة المكتب الرقمي مباشرة', en: 'Let a client scan this to open the digital office directly' },
  'profile.share': { ar: 'مشاركة', en: 'Share' },
  'profile.share_office': { ar: 'مشاركة المكتب', en: 'Share Office' },
  'profile.share_native': { ar: 'مشاركة مباشرة', en: 'Share via device' },
  'profile.share_whatsapp': { ar: 'مشاركة عبر واتساب', en: 'Share via WhatsApp' },
  'profile.copy_link': { ar: 'نسخ الرابط', en: 'Copy Link' },
  'profile.link_copied': { ar: 'تم نسخ الرابط', en: 'Link copied' },
  'profile.unavailable_title': { ar: 'هذا المكتب غير متاح حالياً', en: 'This office is currently unavailable' },
  'profile.unavailable_description': { ar: 'قد يكون هذا المكتب غير نشط أو قيد المراجعة أو تم إزالته من المنصة.', en: 'This office may be inactive, still under review, or no longer listed on the platform.' },
  'profile.unavailable_back': { ar: 'العودة للرئيسية', en: 'Back to Home' },
  'profile.error_not_found': { ar: 'هذا المكتب غير موجود أو لم يعد مدرجاً على المنصة.', en: 'This office was not found or is no longer listed on the platform.' },
  'profile.error_pending': { ar: 'هذا المكتب لا يزال قيد المراجعة ولم يُنشر بعد.', en: 'This office is still under review and has not been published yet.' },
  'profile.error_inactive': { ar: 'هذا المكتب غير نشط حالياً ولا يقبل استفسارات في الوقت الراهن.', en: 'This office is currently inactive and is not accepting inquiries at this time.' },
  'profile.marketing_tools': { ar: 'أدوات التسويق', en: 'Marketing Tools' },
  'profile.communication_tools': { ar: 'أدوات التواصل', en: 'Communication Tools' },
  'profile.call_placeholder_note': { ar: 'سيتم إرسال طلبك إلى المكتب للتأكيد', en: 'Your request will be sent to the office for confirmation' },
  'profile.digital_office_by': { ar: 'مكتب رقمي عبر SkayOffice', en: 'Digital Office by SkayOffice' },
  'profile.watch_intro': { ar: 'شاهد الفيديو التعريفي', en: 'Watch Intro Video' },
  'profile.carousel_prev': { ar: 'الصورة السابقة', en: 'Previous image' },
  'profile.carousel_next': { ar: 'الصورة التالية', en: 'Next image' },
  'profile.whatsapp_cta': { ar: 'تواصل عبر واتساب', en: 'Chat on WhatsApp' },
  'profile.call_cta': { ar: 'اتصال هاتفي', en: 'Call' },
  'profile.whatsapp_unavailable': { ar: 'رقم واتساب المكتب غير متاح حاليًا.', en: 'The office WhatsApp number is currently unavailable.' },
  'profile.offline_now': { ar: 'غير متاح حالياً', en: 'Offline' },
  'profile.open_map': { ar: 'فتح الموقع على الخريطة', en: 'Open on map' },
  'profile.no_summary': { ar: 'لا يوجد وصف مختصر متاح.', en: 'No short summary available.' },
  'profile.view_qr': { ar: 'عرض رمز QR', en: 'View QR code' },
  'common.close': { ar: 'إغلاق', en: 'Close' },
  'profile.scan_to_visit': { ar: 'اطلب من العميل مسح الرمز لزيارة المكتب الرقمي', en: 'Ask a client to scan this to open the digital office' },
  'profile.show_more': { ar: 'عرض المزيد', en: 'Show more' },
  'profile.show_less': { ar: 'عرض أقل', en: 'Show less' },
  'profile.communication_languages': { ar: 'لغات التواصل', en: 'Communication Languages' },
  'profile.serves_globally': { ar: 'نخدم عملاءنا عالميًا', en: 'Serves customers globally' },
  'profile.new_office': { ar: 'مكتب جديد', en: 'New Office' },
  'profile.verified_info': { ar: 'معلومات موثقة', en: 'Verified Information' },
  'profile.available_for_contact': { ar: 'متاح للتواصل', en: 'Available for Contact' },
  'profile.office_qr_label': { ar: 'رمز QR للمكتب', en: 'Office QR' },
  'profile.privacy_notice': { ar: 'جميع المحادثات آمنة ولن تُشارك مع أي طرف ثالث', en: 'All conversations are private and secure' },
  'card.available_in_person': { ar: 'متاح حضوريًا', en: 'Available In Person' },
  'card.offline': { ar: 'غير متصل', en: 'Offline' },
  'card.view_digital_office': { ar: 'عرض المكتب الرقمي', en: 'View Digital Office' },
  // Quick Office Card — updated CTA and response-time line
  'card.view_office': { ar: 'عرض المكتب', en: 'View Office' },
  'card.enlarge_cover': { ar: 'تكبير صورة الغلاف', en: 'Enlarge cover image' },
  'card.online_response': { ar: 'متصل الآن · يرد حالًا أو خلال دقائق', en: 'Online now · Replies now or within minutes' },
  // Decision Card tabs
  'tab.about': { ar: 'نبذة', en: 'About' },
  'tab.services': { ar: 'الخدمات', en: 'Services' },
  'tab.work': { ar: 'الأعمال', en: 'Work' },
  'tab.reviews': { ar: 'التقييمات', en: 'Reviews' },
  // Decision Card tab empty states
  'profile.tab_empty_services': { ar: 'لم تُضف خدمات بعد.', en: 'No services listed yet.' },
  'profile.tab_empty_work': { ar: 'لا توجد أعمال منشورة بعد.', en: 'No work samples published yet.' },
  'profile.tab_empty_reviews': { ar: 'لا توجد تقييمات بعد.', en: 'No reviews yet.' },
  // Decision Card — Save / favourite action in utility grid
  'profile.save_office': { ar: 'حفظ المكتب', en: 'Save Office' },
  'profile.saved_office': { ar: 'تم الحفظ', en: 'Saved' },
  // Auth
  'auth.login_customer': { ar: 'دخول العملاء', en: 'Customer Login' },
  'auth.login_office': { ar: 'دخول المكاتب', en: 'Office Login' },
  'auth.register_customer': { ar: 'حساب عميل جديد', en: 'New Customer Account' },
  'auth.register_office': { ar: 'تسجيل مكتب جديد', en: 'Register New Office' },
  'auth.email': { ar: 'البريد الإلكتروني', en: 'Email Address' },
  'auth.password': { ar: 'كلمة المرور', en: 'Password' },
  'auth.name': { ar: 'الاسم الكامل', en: 'Full Name' },
  'auth.office_name': { ar: 'اسم المكتب', en: 'Office Name' },
  'auth.phone': { ar: 'رقم الهاتف', en: 'Phone Number' },
  'auth.city': { ar: 'المدينة', en: 'City' },
  'auth.category': { ar: 'التخصص الرئيسي', en: 'Primary Category' },
  'auth.required_fields': { ar: 'الحقول المطلوبة', en: 'Required fields' },
  'auth.error_invalid_credentials': { ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة', en: 'Invalid email address or password' },
  'auth.error_account_locked':      { ar: 'تم إيقاف الدخول مؤقتًا بسبب محاولات فاشلة متكررة. يرجى المحاولة لاحقًا', en: 'Login temporarily locked due to repeated failed attempts. Please try again later.' },
  'auth.error_account_deactivated': { ar: 'تم إلغاء تفعيل هذا الحساب. يرجى التواصل مع الدعم', en: 'This account has been deactivated. Please contact support.' },
  'auth.no_account': { ar: 'ليس لديك حساب؟', en: 'Don\'t have an account?' },
  'auth.have_account': { ar: 'لديك حساب بالفعل؟', en: 'Already have an account?' },
  'auth.login_customer_tagline': { ar: 'سجل دخولك للوصول إلى المكاتب المفضلة لديك والتواصل معها', en: 'Log in to access your favourite offices and contact them directly.' },
  'auth.login_office_tagline': { ar: 'الوصول إلى لوحة التحكم وإدارة المكتب الرقمي الخاص بك', en: 'Access your dashboard and manage your digital office.' },
  'auth.register_customer_tagline': { ar: 'أنشئ حساباً للتواصل مع المكاتب وحفظ مفضلتك', en: 'Create an account to contact offices and save your favourites.' },
  'auth.register_office_tagline': { ar: 'أنشئ مكتبك الرقمي على المنصة وابدأ باستقبال العملاء', en: 'Create your digital office on the platform and start receiving customers.' },
  'auth.office_login_prompt': { ar: 'أنت مكتب مهني؟', en: 'Are you a professional office?' },
  'auth.terms_accept_label': { ar: 'أوافق على شروط الاستخدام وسياسة الخصوصية الخاصة بـ SkayOffice.', en: 'I agree to SkayOffice\'s Terms of Use and Privacy Policy.' },
  'auth.account_type': { ar: 'نوع الحساب', en: 'Account Type' },

  // Registration & logout toasts
  'auth.register_customer_success_title': { ar: 'تم التسجيل بنجاح!', en: 'Registration Successful!' },
  'auth.register_customer_success_desc':  { ar: 'مرحباً بك في SkayOffice. أنت الآن مسجّل دخول.', en: 'Welcome to SkayOffice. You are now logged in.' },
  'auth.register_office_success_title':   { ar: 'تم إنشاء مكتبك!', en: 'Office Created!' },
  'auth.register_office_success_desc':    { ar: 'مرحباً! سيتم مراجعة ملفك والتحقق منه قريباً.', en: 'Welcome! Your profile will be reviewed and verified shortly.' },
  'auth.logout_success_title':            { ar: 'تم تسجيل الخروج', en: 'Logged Out' },
  'auth.logout_success_desc':             { ar: 'تم تسجيل خروجك بنجاح. إلى اللقاء!', en: 'You have been successfully logged out. See you soon!' },
  'auth.login_customer_success_title':    { ar: 'أهلاً بعودتك!', en: 'Welcome Back!' },
  'auth.login_customer_success_desc':     { ar: 'تم تسجيل دخولك بنجاح.', en: 'You have successfully logged in.' },
  'auth.login_office_success_title':      { ar: 'مرحباً بك في لوحة التحكم!', en: 'Welcome to Your Dashboard!' },
  'auth.login_office_success_desc':       { ar: 'تم تسجيل دخول مكتبك بنجاح.', en: 'Your office account has been logged in successfully.' },
  'auth.forgot_password_toast_title':     { ar: 'تم إرسال الرابط', en: 'Reset Link Sent' },
  'auth.forgot_password_toast_desc':      { ar: 'إذا كان البريد مسجلاً، ستصل رسالة الاسترداد قريباً.', en: 'If this email is registered, a reset link has been sent to your inbox.' },
  'auth.reset_password_toast_title':      { ar: 'تم تغيير كلمة المرور!', en: 'Password Changed!' },
  'auth.reset_password_toast_desc':       { ar: 'يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.', en: 'You can now log in with your new password.' },

  // Password reset
  'auth.forgotPassword': { ar: 'نسيت كلمة المرور؟', en: 'Forgot Password?' },
  'auth.forgotPasswordLink': { ar: 'نسيت كلمة المرور؟', en: 'Forgot your password?' },
  'auth.resetPassword': { ar: 'استعادة كلمة المرور', en: 'Reset Password' },
  'auth.resetPasswordTagline': { ar: 'أدخل بريدك الإلكتروني المسجل وسنرسل لك رابط إعادة التعيين.', en: 'Enter your registered email address and we\'ll send you a reset link.' },
  'auth.setNewPassword': { ar: 'تعيين كلمة مرور جديدة', en: 'Set a New Password' },
  'auth.resetEmailSent': { ar: 'تم إرسال الرابط', en: 'Link Sent' },
  'auth.resetEmailSentDetail': { ar: 'إذا كان هناك حساب مرتبط بهذا البريد، فسيتم إرسال رابط استعادة كلمة المرور. تحقق من صندوق الوارد أو مجلد الرسائل غير المرغوب فيها.', en: 'If an account exists for this email, a password reset link has been sent. Check your inbox or spam folder.' },
  'auth.newPassword': { ar: 'كلمة المرور الجديدة', en: 'New Password' },
  'auth.confirmPassword': { ar: 'تأكيد كلمة المرور', en: 'Confirm Password' },
  'auth.passwordsDoNotMatch': { ar: 'كلمتا المرور غير متطابقتين', en: 'Passwords do not match' },
  'auth.passwordTooWeak': { ar: 'كلمة المرور ضعيفة جدًا', en: 'Password is too weak' },
  'auth.passwordRequirements': { ar: 'يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل، حرف واحد ورقم واحد.', en: 'Password must be at least 8 characters with at least one letter and one number.' },
  'auth.resetTokenInvalid': { ar: 'رابط غير صالح', en: 'Invalid Link' },
  'auth.resetTokenInvalidDetail': { ar: 'هذا الرابط غير صالح أو تم استخدامه مسبقًا. يرجى طلب رابط جديد.', en: 'This link is invalid or has already been used. Please request a new one.' },
  'auth.resetTokenExpired': { ar: 'انتهت صلاحية الرابط', en: 'Link Expired' },
  'auth.resetTokenExpiredDetail': { ar: 'انتهت صلاحية رابط إعادة التعيين. يرجى طلب رابط جديد.', en: 'The reset link has expired. Please request a new one.' },
  'auth.resetSuccess': { ar: 'تم تغيير كلمة المرور', en: 'Password Changed' },
  'auth.resetSuccessDetail': { ar: 'تم تغيير كلمة مرورك بنجاح. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.', en: 'Your password has been changed successfully. You can now log in with your new password.' },
  'auth.showPassword': { ar: 'إظهار', en: 'Show' },
  'auth.hidePassword': { ar: 'إخفاء', en: 'Hide' },
  'auth.sendResetLink': { ar: 'إرسال رابط الاستعادة', en: 'Send Reset Link' },
  'auth.sendingResetLink': { ar: 'جاري الإرسال...', en: 'Sending...' },
  'auth.backToLogin': { ar: 'العودة لتسجيل الدخول', en: 'Back to login' },
  'auth.requestNewLink': { ar: 'طلب رابط جديد', en: 'Request a new link' },
  'auth.savingPassword': { ar: 'جاري الحفظ...', en: 'Saving...' },
  'auth.saveNewPassword': { ar: 'حفظ كلمة المرور الجديدة', en: 'Save New Password' },

  // Spoken language display names — used on both the dashboard multi-select
  // and the public Decision Card language chips.
  'languages.ar': { ar: 'العربية', en: 'Arabic' },
  'languages.en': { ar: 'الإنجليزية', en: 'English' },
  'languages.ur': { ar: 'الأردية', en: 'Urdu' },
  'languages.hi': { ar: 'الهندية', en: 'Hindi' },
  'languages.tl': { ar: 'التاغالوغ', en: 'Tagalog' },
  'languages.fr': { ar: 'الفرنسية', en: 'French' },

  // Dashboard (Office)
  'dashboard.title': { ar: 'إدارة المكتب الرقمي', en: 'Manage Digital Office' },
  'dashboard.profile_tab': { ar: 'البيانات الأساسية', en: 'Basic Info' },
  'dashboard.services_tab': { ar: 'الخدمات', en: 'Services' },
  'dashboard.media_tab': { ar: 'الوسائط', en: 'Media & Gallery' },
  'dashboard.short_desc': { ar: 'وصف مختصر', en: 'Short Description' },
  'dashboard.full_desc': { ar: 'وصف تفصيلي', en: 'Full Description' },
  'dashboard.whatsapp': { ar: 'رقم الواتساب', en: 'WhatsApp Number' },
  'dashboard.website': { ar: 'الموقع الإلكتروني', en: 'Website' },
  'dashboard.address': { ar: 'العنوان التفصيلي', en: 'Full Address' },
  'dashboard.is_online': { ar: 'تقديم الخدمات عن بعد', en: 'Offer Online Services' },
  'dashboard.upload_cover': { ar: 'تحديث الغلاف', en: 'Update Cover' },
  'dashboard.add_service': { ar: 'إضافة خدمة جديدة', en: 'Add New Service' },
  'dashboard.service_name': { ar: 'اسم الخدمة', en: 'Service Name' },
  'dashboard.gallery_upload': { ar: 'إضافة للوسائط', en: 'Add to Media' },
  'dashboard.marketing_video': { ar: 'فيديو المكتب التعريفي', en: 'Marketing Video' },
  'dashboard.marketing_video_desc': { ar: 'فيديو واحد اختياري (MP4، حتى 75 ثانية و80 ميغابايت) يظهر لعملائك عند فتح مكتبك.', en: 'One optional video (MP4, up to 75s and 80MB) shown to customers when they open your office.' },
  'dashboard.marketing_video_upload': { ar: 'رفع فيديو', en: 'Upload Video' },
  'dashboard.marketing_video_replace': { ar: 'استبدال الفيديو', en: 'Replace Video' },
  'dashboard.marketing_video_delete': { ar: 'حذف الفيديو', en: 'Delete Video' },
  'dashboard.marketing_video_active': { ar: 'الفيديو التعريفي مفعّل حاليًا.', en: 'Your marketing video is currently active.' },
  'dashboard.marketing_video_empty': { ar: 'لم تتم إضافة فيديو تعريفي بعد. الفيديو اختياري ويظهر لعملائك عند فتح مكتبك.', en: 'No marketing video added yet. This is optional and shown to customers when they open your office.' },
  'dashboard.marketing_video_delete_confirm_title': { ar: 'حذف الفيديو التعريفي؟', en: 'Delete marketing video?' },
  'dashboard.marketing_video_delete_confirm_desc': { ar: 'سيتم حذف الفيديو نهائيًا ولن يظهر بعد الآن لعملائك. لا يمكن التراجع عن هذا الإجراء.', en: 'This will permanently remove the video — customers will no longer see it. This action cannot be undone.' },
  'dashboard.seconds_suffix': { ar: 'ث', en: 's' },
  'dashboard.verified_badge': { ar: 'موثق', en: 'Verified' },
  'not_found.title': { ar: 'الصفحة غير موجودة', en: 'Page not found' },
  'not_found.description': { ar: 'عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها.', en: 'Sorry, the page you\u2019re looking for doesn\u2019t exist or has been moved.' },
  'not_found.back_home': { ar: 'العودة للرئيسية', en: 'Back to Home' },
  'dashboard.documents_tab': { ar: 'مستندات التوثيق', en: 'Verification Documents' },

  // Office dashboard — application status meta
  'dashboard.status.draft': { ar: 'مسودة', en: 'Draft' },
  'dashboard.status.under_review': { ar: 'قيد المراجعة', en: 'Under Review' },
  'dashboard.status.changes_requested': { ar: 'مطلوب تعديلات', en: 'Changes Requested' },
  'dashboard.status.approved': { ar: 'تمت الموافقة', en: 'Approved' },
  'dashboard.status.active': { ar: 'نشط', en: 'Active' },
  'dashboard.status.rejected': { ar: 'مرفوض', en: 'Rejected' },
  'dashboard.status.suspended': { ar: 'معلّق', en: 'Suspended' },
  'dashboard.status_banner_label': { ar: 'حالة الطلب', en: 'Application status' },
  'dashboard.status_hint_draft': { ar: 'أكمل بيانات المكتب والمستندات المطلوبة ثم اضغط "إرسال للمراجعة".', en: 'Complete your office details and required documents, then click "Submit for Review".' },
  'dashboard.status_hint_changes_requested': { ar: 'ملاحظات الإدارة', en: 'Admin notes' },
  'dashboard.status_hint_under_review': { ar: 'طلبك قيد المراجعة ومقفل مؤقتاً عن التعديل، سنعلمك بالنتيجة قريباً.', en: 'Your application is under review and temporarily locked from edits. We\u2019ll notify you of the outcome soon.' },
  'dashboard.status_hint_approved': { ar: 'تمت الموافقة على طلبك، بانتظار تفعيل الإدارة لظهور مكتبك للعملاء.', en: 'Your application has been approved and is awaiting admin activation to appear to customers.' },
  'dashboard.status_hint_rejected': { ar: 'سبب الرفض', en: 'Rejection reason' },
  'dashboard.status_hint_suspended': { ar: 'تم تعليق مكتبك مؤقتاً من قبل الإدارة وهو غير ظاهر للعملاء حالياً.', en: 'Your office has been temporarily suspended by the admin and is not currently visible to customers.' },
  'dashboard.status_hint_active': { ar: 'مكتبك نشط وظاهر للعملاء في المنصة.', en: 'Your office is active and visible to customers on the platform.' },
  'dashboard.locked_edit_notice': { ar: 'بياناتك العامة ثابتة حالياً — أي تعديل تحفظه سيُرسل كـ"تعديل مقترح" لمراجعة الإدارة قبل ظهوره للعملاء.', en: 'Your public data is currently locked — any edit you save will be sent as a "proposed edit" for admin review before it appears to customers.' },
  'dashboard.pending_changes_notice': { ar: 'يوجد تعديل مقترح بانتظار موافقة الإدارة', en: 'There is a proposed edit awaiting admin approval' },
  'dashboard.pending_changes_submitted_at': { ar: 'أُرسل بتاريخ', en: 'submitted on' },
  'dashboard.missing_fields_notice': { ar: 'يرجى استكمال العناصر التالية قبل الإرسال', en: 'Please complete the following before submitting' },
  'dashboard.submit_for_review': { ar: 'إرسال للمراجعة', en: 'Submit for Review' },
  'dashboard.submitting': { ar: 'جاري الإرسال...', en: 'Submitting...' },
  'dashboard.save_as_pending_edit': { ar: 'حفظ كتعديل مقترح', en: 'Save as Proposed Edit' },
  'dashboard.readonly_tooltip': { ar: 'لا يمكن التعديل أثناء المراجعة', en: 'Cannot be edited while under review' },

  // Office dashboard — missing field labels
  'dashboard.field.name': { ar: 'اسم المكتب', en: 'Office name' },
  'dashboard.field.short_description': { ar: 'وصف مختصر', en: 'Short description' },
  'dashboard.field.city': { ar: 'المدينة', en: 'City' },
  'dashboard.field.category': { ar: 'التصنيف', en: 'Category' },
  'dashboard.field.whatsapp': { ar: 'رقم الواتساب', en: 'WhatsApp number' },
  'dashboard.field.spoken_languages': { ar: 'اللغات التي يتحدث بها المكتب', en: 'Languages spoken by the office' },
  'dashboard.field.services': { ar: 'خدمة واحدة على الأقل', en: 'At least one service' },
  'dashboard.field.identity_document': { ar: 'مستند الهوية', en: 'Identity document' },
  'dashboard.field.trade_license_document': { ar: 'مستند السجل التجاري', en: 'Trade license document' },

  // Office dashboard — languages spoken section
  'dashboard.languages_title': { ar: 'اللغات التي يتحدث بها المكتب', en: 'Languages Spoken by the Office' },
  'dashboard.languages_description': { ar: 'اختر اللغات التي يمكن للعملاء التواصل بها مع مكتبك.', en: 'Select the languages customers can use to communicate with your office.' },
  'dashboard.languages_placeholder': { ar: 'اختر اللغات', en: 'Select languages' },
  'dashboard.languages_selected_count': { ar: '{count} لغة محددة', en: '{count} language(s) selected' },
  'dashboard.languages_search_placeholder': { ar: 'ابحث عن لغة...', en: 'Search languages...' },
  'dashboard.languages_no_match': { ar: 'لا توجد نتائج', en: 'No results found' },
  'dashboard.languages_other_placeholder': { ar: 'لغة أخرى...', en: 'Other language...' },
  'dashboard.accepts_phone_calls_label': { ar: 'يمكن التواصل عبر هذا الرقم بمكالمة هاتفية أيضًا', en: 'Also accepts phone calls on this number' },

  // Office dashboard — toasts & error messages
  'dashboard.update_success': { ar: 'تم التحديث بنجاح', en: 'Updated successfully' },
  'dashboard.update_success_pending': { ar: 'تم إرسال التعديل المقترح للمراجعة', en: 'Your proposed edit has been sent for admin review' },
  'dashboard.no_office_title': { ar: 'لا يوجد حساب مكتب مرتبط', en: 'No office account found' },
  'dashboard.no_office_desc': { ar: 'هذا الحساب غير مرتبط بأي مكتب. إذا كنت تواجه مشكلة، يرجى التواصل مع الدعم.', en: 'This account is not linked to any office profile. If you think this is a mistake, please contact support.' },
  'dashboard.upload_confirm_failed_title': { ar: 'تعذّر تأكيد رفع الملف', en: 'Could not confirm the upload' },
  'dashboard.upload_confirm_failed_desc': { ar: 'لم نتمكن من تأكيد أن الملف تم حفظه بشكل صحيح في التخزين. يرجى المحاولة مرة أخرى.', en: 'We could not confirm the file was saved correctly in storage. Please try again.' },
  'dashboard.upload_failed_title': { ar: 'تعذّر رفع الملف', en: 'Upload failed' },
  'dashboard.upload_failed_desc_generic': { ar: 'حدث خطأ غير متوقع أثناء حفظ الملف، يرجى المحاولة مرة أخرى.', en: 'An unexpected error occurred while saving the file — please try again.' },
  'dashboard.gallery_upload_rejected': { ar: 'تعذّر رفع الملف: نوع أو حجم الملف غير مسموح به.', en: 'Could not upload the file: unsupported file type or size.' },
  'dashboard.video_uploaded_title': { ar: 'تم رفع الفيديو', en: 'Video uploaded' },
  'dashboard.video_uploaded_desc': { ar: 'تم حفظ فيديو المكتب التعريفي بنجاح.', en: 'Your office marketing video has been saved successfully.' },
  'dashboard.video_deleted_title': { ar: 'تم الحذف', en: 'Deleted' },
  'dashboard.video_deleted_desc': { ar: 'تم حذف فيديو المكتب التعريفي.', en: 'Your office marketing video has been deleted.' },
  'dashboard.video_delete_failed_title': { ar: 'تعذّر الحذف', en: 'Delete failed' },
  'dashboard.video_delete_failed_desc': { ar: 'حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى.', en: 'An unexpected error occurred — please try again.' },
  'dashboard.video_duration_exceeded': { ar: 'مدة الفيديو أطول من الحد المسموح 75 ثانية.', en: 'The video is longer than the 75-second limit.' },
  'dashboard.submit_success_title': { ar: 'تم إرسال الطلب', en: 'Application submitted' },
  'dashboard.submit_success_desc': { ar: 'تم إرسال طلبك للمراجعة من قبل الإدارة.', en: 'Your application has been sent for admin review.' },
  'dashboard.submit_failed_title': { ar: 'تعذّر الإرسال', en: 'Submission failed' },
  'dashboard.submit_failed_generic': { ar: 'يرجى استكمال البيانات المطلوبة.', en: 'Please complete the required information.' },
  'dashboard.primary_media_set_title': { ar: 'تم التحديد', en: 'Selected' },
  'dashboard.primary_media_set_desc': { ar: 'تم تعيين الصورة الرئيسية للمعرض.', en: 'The primary gallery image has been set.' },
  'dashboard.primary_media_failed_title': { ar: 'تعذّر التنفيذ', en: 'Action failed' },
  'dashboard.primary_media_failed_desc': { ar: 'حدث خطأ غير متوقع', en: 'An unexpected error occurred' },

  // Office dashboard — basic info card
  'dashboard.basic_info_title': { ar: 'البيانات الأساسية', en: 'Basic Info' },
  'dashboard.basic_info_description': { ar: 'هذه البيانات تظهر في بطاقة المكتب ونتائج البحث.', en: 'This information appears on your office card and in search results.' },
  'dashboard.short_desc_placeholder': { ar: 'وصف في سطر واحد...', en: 'A one-line description...' },
  'dashboard.full_desc_placeholder': { ar: 'اكتب تفاصيل كاملة عن المكتب وخبراته...', en: 'Write full details about the office and its expertise...' },
  'dashboard.is_online_desc': { ar: 'هل يقدم المكتب خدماته عن بعد للعملاء في مدن أخرى؟', en: 'Does the office offer its services remotely to customers in other cities?' },

  // Office dashboard — contact info card
  'dashboard.contact_info_title': { ar: 'بيانات التواصل', en: 'Contact Details' },
  'dashboard.whatsapp_placeholder': { ar: '+966500000000', en: '+966500000000' },
  'dashboard.website_placeholder': { ar: 'https://example.com', en: 'https://example.com' },
  'dashboard.country': { ar: 'الدولة', en: 'Country' },
  'dashboard.country_placeholder': { ar: 'المملكة العربية السعودية', en: 'Saudi Arabia' },
  'dashboard.specialization': { ar: 'التخصص', en: 'Specialization' },
  'dashboard.specialization_placeholder': { ar: 'مثال: توثيق العقود التجارية', en: 'e.g. Commercial contract notarization' },
  'dashboard.google_maps_url': { ar: 'رابط الموقع على خرائط جوجل', en: 'Google Maps link' },
  'dashboard.location_title': { ar: 'إحداثيات الموقع الجغرافي', en: 'Geographic Coordinates' },
  'dashboard.location_description': { ar: 'أضف إحداثيات مكتبك لتظهر في نتائج البحث القريبة منك. لن تُعرض هذه الإحداثيات للعملاء — تُستخدم فقط لترتيب ظهور مكتبك في البحث.', en: 'Add your office coordinates to appear in nearby searches. These are never shown to customers — they are only used to rank your listing by proximity.' },
  'dashboard.latitude': { ar: 'خط العرض (latitude)', en: 'Latitude' },
  'dashboard.longitude': { ar: 'خط الطول (longitude)', en: 'Longitude' },
  'dashboard.use_my_location': { ar: 'استخدام موقعي الحالي', en: 'Use my current location' },
  'dashboard.location_note': { ar: 'انقر الزر للملء التلقائي من موقع متصفحك، أو أدخل الإحداثيات يدوياً.', en: 'Click the button to auto-fill from your browser, or enter coordinates manually.' },
  'dashboard.google_maps_url_placeholder': { ar: 'https://maps.google.com/...', en: 'https://maps.google.com/...' },

  // Office dashboard — services tab
  'dashboard.services_description': { ar: 'أضف الخدمات التي يقدمها مكتبك بالتفصيل (مثل: ترجمة قانونية، عقود شركات، تصميم شعارات).', en: 'List the services your office provides in detail (e.g. legal translation, corporate contracts, logo design).' },
  'dashboard.no_services': { ar: 'لم يتم إضافة خدمات بعد.', en: 'No services added yet.' },

  // Office dashboard — media tab (tabs)
  'dashboard.media.tab_quick_card': { ar: 'بطاقة العرض السريع', en: 'Quick Card' },
  'dashboard.media.tab_decision_card': { ar: 'بطاقة القرار', en: 'Decision Card' },
  'dashboard.media.tab_works': { ar: 'الأعمال', en: 'Works' },
  'dashboard.media.tab_identity': { ar: 'الهوية', en: 'Identity' },
  'dashboard.media.works_title': { ar: 'معرض الأعمال', en: 'Works Gallery' },
  'dashboard.media.works_desc': { ar: 'اعرض حتى 4 صور من أعمالك. تخضع الصور للمراجعة قبل ظهورها للعملاء.', en: 'Show up to 4 images of your work. Images are reviewed before customers can see them.' },
  'dashboard.media.works_upload': { ar: '+ إضافة عمل', en: '+ Add work' },
  'dashboard.media.works_empty': { ar: 'لم تتم إضافة أعمال بعد.', en: 'No works added yet.' },
  'dashboard.media.works_empty_cta': { ar: 'أضف أول عمل إلى معرضك', en: 'Add your first work to your gallery' },
  'dashboard.media.works_pending': { ar: 'صور قيد المراجعة', en: 'Images pending review' },
  'dashboard.media.works_max_reached': { ar: 'تم الوصول إلى الحد الأقصى وهو 4 صور أعمال.', en: 'You have reached the 4-image works limit.' },
  'dashboard.media.status_pending': { ar: 'قيد المراجعة', en: 'Pending' },
  'dashboard.media.status_approved': { ar: 'معتمد', en: 'Approved' },
  'dashboard.media.works_crop_title': { ar: 'اختر منطقة عرض العمل', en: 'Choose Work Display Area' },
  'dashboard.media.works_crop_hint': { ar: 'اسحب المستطيل لاختيار الجزء الذي سيظهر بنسبة 4:3.', en: 'Drag the box to choose the area shown at a 4:3 ratio.' },
  'dashboard.media.delete_works_confirm_title': { ar: 'حذف صورة العمل؟', en: 'Delete this work image?' },
  'dashboard.media.delete_works_confirm_desc': { ar: 'سيتم حذف صورة العمل نهائيًا. لا يمكن التراجع عن هذا الإجراء.', en: 'This work image will be permanently deleted. This action cannot be undone.' },

  // Quick Card tab
  'dashboard.media.qc_title': { ar: 'صورة بطاقة العرض السريع', en: 'Quick Card Cover Image' },
  'dashboard.media.qc_desc': { ar: 'الصورة المصغرة التي تظهر في بطاقة مكتبك ضمن نتائج البحث.', en: 'The thumbnail shown on your office card in search results.' },
  'dashboard.media.qc_approved_label': { ar: 'الصورة الحالية المعتمدة', en: 'Current approved image' },
  'dashboard.media.qc_pending_label': { ar: 'صورة قيد المراجعة', en: 'Image pending review' },
  'dashboard.media.qc_no_image': { ar: 'لم يتم رفع صورة بعد.', en: 'No image uploaded yet.' },
  'dashboard.media.qc_upload_btn': { ar: 'رفع صورة', en: 'Upload Image' },
  'dashboard.media.qc_cancel_pending': { ar: 'إلغاء الطلب المعلق', en: 'Cancel Pending Request' },
  'dashboard.media.qc_pending_notice': { ar: 'تم إرسال صورة جديدة وهي قيد مراجعة الإدارة. ستظهر للعملاء فور الموافقة عليها.', en: 'A new image has been submitted and is awaiting admin review. It will be visible to customers once approved.' },
  'dashboard.media.qc_rejected_notice': { ar: 'تم رفض الصورة السابقة. يمكنك رفع صورة جديدة.', en: 'Your previous image was rejected. You can upload a new one.' },
  'dashboard.media.qc_rejection_reason': { ar: 'سبب الرفض', en: 'Rejection reason' },

  // Quick Card cover crop dialog
  'dashboard.media.crop_title': {
    ar: 'اختر منطقة غلاف البطاقة',
    en: 'Choose Card Cover Area',
  },
  'dashboard.media.crop_hint': {
    ar: 'اسحب المستطيل لاختيار الجزء الذي سيظهر في بطاقة مكتبك. النسبة مثبتة على 16:9.',
    en: 'Drag the box to select the area that will appear on your office card. Ratio is locked to 16:9.',
  },
  'dashboard.media.crop_confirm': {
    ar: 'استخدام هذا الاختيار',
    en: 'Use This Selection',
  },
  'dashboard.media.crop_skip': {
    ar: 'قطع مركزي تلقائي',
    en: 'Auto Center Crop',
  },
  'dashboard.media.portrait_crop_warning': {
    ar: 'هذه الصورة رأسية (أطول من عرضها). يُرجى تحديد منطقة أفقية 16:9 ستظهر كغلاف البطاقة — لن تظهر بقية الصورة في بطاقة العرض السريع أو يمكن الاطلاع عليها في معرض الصور.',
    en: 'This image is portrait (taller than wide). Please select the 16:9 landscape area to show as the card cover — the rest of the image will not be visible on the Quick Card but is preserved and can be viewed in your gallery.',
  },

  // Fullscreen image lightbox (public Decision Card only)
  'lightbox.prev_image': { ar: 'الصورة السابقة', en: 'Previous image' },
  'lightbox.next_image': { ar: 'الصورة التالية', en: 'Next image' },

  // Decision Card gallery crop dialog
  'dashboard.media.gallery_crop_title': {
    ar: 'اختر منطقة عرض صورة المعرض',
    en: 'Choose Gallery Display Area',
  },
  'dashboard.media.gallery_crop_hint': {
    ar: 'اسحب المستطيل لاختيار الجزء الذي سيظهر في معرض بطاقة القرار. النسبة مثبتة على 7:3.',
    en: 'Drag the box to select the area shown in the Decision Card gallery. Ratio is locked to 7:3.',
  },
  'dashboard.media.gallery_portrait_warning': {
    ar: 'هذه الصورة رأسية (أطول من عرضها). سيظهر جزء صغير منها في إطار المعرض 7:3 — اختر منطقة عريضة للعرض.',
    en: 'This image is portrait. Only a small section will be visible in the 7:3 gallery frame — select a wide area to show.',
  },

  // Decision Card tab
  'dashboard.media.dc_cover_crop_title': { ar: 'اختر منطقة الاقتصاص لصورة الغلاف', en: 'Crop Decision Card Hero Image' },
  'dashboard.media.dc_cover_crop_hint': { ar: 'اسحب المربع لاختيار الجزء الذي سيظهر في بطاقة القرار (نسبة 7:3)', en: 'Drag the box to choose the visible area in the Decision Card (7:3 ratio)' },
  'dashboard.media.dc_cover_portrait_warning': { ar: 'الصورة عمودية — سيُقتطع جزء منها لتناسب نسبة 7:3 الأفقية. اسحب الإطار لاختيار الجزء المناسب.', en: 'Portrait image — it will be cropped to fit the 7:3 landscape ratio. Drag the frame to pick the right section.' },
  'dashboard.media.dc_cover_title': { ar: 'صورة بطاقة القرار الرئيسية (الموضع 1)', en: 'Main Decision Card Image (Position 1)' },
  'dashboard.media.dc_cover_desc': { ar: 'الصورة الرئيسية في الموضع الأول ببطاقة القرار. الصورة الحالية تبقى مرئية للعملاء حتى تُعتمد الصورة الجديدة.', en: 'The main image in position 1 of the Decision Card. Your current image stays visible until a replacement is approved.' },
  'dashboard.media.dc_cover_approved': { ar: 'الصورة الرئيسية الحالية المعتمدة', en: 'Current approved main image' },
  'dashboard.media.dc_cover_pending': { ar: 'صورة بديلة قيد المراجعة', en: 'Replacement pending review' },
  'dashboard.media.dc_cover_none': { ar: 'لم يتم رفع صورة رئيسية بعد.', en: 'No main image uploaded yet.' },
  'dashboard.media.dc_cover_upload': { ar: 'رفع صورة رئيسية', en: 'Upload Main Image' },
  'dashboard.media.dc_cover_pending_exists': { ar: 'يوجد طلب استبدال قيد المراجعة. انتظر موافقة الإدارة أو رفضها قبل رفع صورة جديدة.', en: 'A replacement is already pending review. Wait for admin approval or rejection before uploading another.' },

  // Gallery tab (positions 2–4)
  'dashboard.media.gallery_title': { ar: 'صور بطاقة القرار الإضافية (المواضع 2-4)', en: 'Additional Decision Card Images (Positions 2–4)' },
  'dashboard.media.gallery_desc': { ar: 'أضف حتى 3 صور إضافية تظهر بالتناوب مع الصورة الرئيسية كل 8 ثوانٍ في بطاقة القرار.', en: 'Add up to 3 additional images that rotate with your main cover every 8 seconds in the Decision Card.' },
  'dashboard.media.gallery_pending_section': { ar: 'صور قيد المراجعة', en: 'Images Pending Review' },
  'dashboard.media.gallery_pending_notice': { ar: 'هذه الصور قيد مراجعة الإدارة وستظهر بالتناوب فور الموافقة عليها.', en: 'These images are being reviewed and will appear in rotation once approved.' },
  'dashboard.media.gallery_max_reached': { ar: 'المعرض ممتلئ (3/3 صور). احذف صورة حالية لإضافة صورة جديدة.', en: 'Gallery full (3/3 images). Delete an existing image to add a new one.' },
  'dashboard.media.gallery_move_up': { ar: 'نقل للأعلى', en: 'Move up' },
  'dashboard.media.gallery_move_down': { ar: 'نقل للأسفل', en: 'Move down' },

  // Admin media review strings
  'admin.media.section_title': { ar: 'مراجعة الوسائط', en: 'Media Review' },
  'admin.media.quick_card_cover': { ar: 'صورة البطاقة السريعة', en: 'Quick Card Cover' },
  'admin.media.decision_card_cover': { ar: 'صورة غلاف القرار', en: 'Decision Card Hero' },
  'admin.media.gallery_items': { ar: 'معرض الأعمال', en: 'Gallery Items' },
  'admin.media.no_pending': { ar: 'لا توجد وسائط معلقة', en: 'No pending media' },
  'admin.media.approve': { ar: 'قبول', en: 'Approve' },
  'admin.media.reject': { ar: 'رفض', en: 'Reject' },
  'admin.media.reject_reason_placeholder': { ar: 'سبب الرفض (اختياري)', en: 'Rejection reason (optional)' },

  // Legacy keys (kept for backward compat)
  'dashboard.cover_title': { ar: 'صورة الغلاف (Cover)', en: 'Cover Image' },
  'dashboard.gallery_description': { ar: 'أضف صور لسابقة أعمالك، تراخيصك، أو مقر المكتب.', en: 'Add photos of your past work, licenses, or office premises.' },
  'dashboard.gallery_primary_badge': { ar: 'رئيسية', en: 'Primary' },
  'dashboard.gallery_set_primary': { ar: 'تعيين كرئيسية', en: 'Set as primary' },
  'dashboard.media.set_as_quick_card_image': { ar: 'تعيين كصورة البطاقة السريعة', en: 'Set as Quick Card Image' },
  'dashboard.media.set_as_decision_card_main': { ar: 'تعيين كصورة رئيسية لبطاقة القرار', en: 'Set as Decision Card Main Image' },
  'dashboard.media.quick_card_image_badge': { ar: 'صورة البطاقة السريعة', en: 'Quick Card Image' },
  'dashboard.media.decision_card_main_badge': { ar: 'الصورة الرئيسية لبطاقة القرار', en: 'Decision Card Main Image' },
  'dashboard.media.delete_qc_image_btn': { ar: 'حذف الصورة', en: 'Delete Image' },
  'dashboard.media.delete_qc_image_confirm_title': { ar: 'هل أنت متأكد من حذف صورة بطاقة العرض السريع؟', en: 'Delete the Quick Card image?' },
  'dashboard.media.delete_qc_image_confirm_desc': { ar: 'سيتم حذف الصورة نهائيًا. لا يمكن التراجع عن هذا الإجراء.', en: 'The image will be permanently deleted. This action cannot be undone.' },
  'dashboard.media.delete_qc_image_success': { ar: 'تم حذف صورة بطاقة العرض السريع', en: 'Quick Card image deleted' },
  'dashboard.media.delete_dc_cover_btn': { ar: 'حذف صورة الغلاف', en: 'Delete Cover Image' },
  'dashboard.media.delete_dc_cover_confirm_title': { ar: 'هل أنت متأكد من حذف صورة الغلاف؟', en: 'Delete the cover image?' },
  'dashboard.media.delete_dc_cover_confirm_desc': { ar: 'سيتم حذف صورة الغلاف نهائيًا. لا يمكن التراجع عن هذا الإجراء.', en: 'The cover image will be permanently deleted. This action cannot be undone.' },
  'dashboard.media.delete_dc_cover_success': { ar: 'تم حذف صورة الغلاف', en: 'Cover image deleted' },
  'dashboard.media.delete_gallery_item_confirm_title': { ar: 'حذف هذا العنصر من المعرض؟', en: 'Delete this gallery item?' },
  'dashboard.media.delete_gallery_item_confirm_desc': { ar: 'سيتم حذف هذا العنصر نهائيًا. لا يمكن التراجع عن هذا الإجراء.', en: 'This item will be permanently deleted. This action cannot be undone.' },
  'dashboard.media.delete_gallery_item_success': { ar: 'تم حذف العنصر من المعرض', en: 'Gallery item deleted' },
  'auth.showPasswordLabel': { ar: 'إظهار كلمة المرور', en: 'Show password' },
  'auth.hidePasswordLabel': { ar: 'إخفاء كلمة المرور', en: 'Hide password' },
  'dashboard.gallery_empty': { ar: 'معرض الصور فارغ. قم برفع صور أو فيديوهات لعرضها لعملائك.', en: 'The gallery is empty. Upload photos or videos to show your customers.' },

  // Office dashboard — documents tab
  'dashboard.documents_description': { ar: 'مطلوب رفع مستند الهوية والسجل التجاري لإتمام إرسال الطلب للمراجعة. جميع المستندات خاصة ولا يراها إلا فريق الإدارة.', en: 'Uploading an identity document and trade license is required to submit your application for review. All documents are private and only visible to the admin team.' },
  'dashboard.document_type_identity': { ar: 'الهوية / جواز السفر', en: 'ID / Passport' },
  'dashboard.document_type_trade_license': { ar: 'السجل التجاري', en: 'Trade License' },
  'dashboard.document_type_professional_license': { ar: 'الترخيص المهني (اختياري)', en: 'Professional License (optional)' },
  'dashboard.document_type_certificate': { ar: 'شهادة إضافية (اختياري)', en: 'Additional Certificate (optional)' },
  'dashboard.upload_file': { ar: 'رفع ملف', en: 'Upload file' },
  'dashboard.no_document_uploaded': { ar: 'لم يتم رفع مستند بعد.', en: 'No document uploaded yet.' },
  'dashboard.document_number_prefix': { ar: 'مستند', en: 'Document' },
  'dashboard.document_status_approved': { ar: 'مقبول', en: 'Approved' },
  'dashboard.document_status_rejected': { ar: 'مرفوض', en: 'Rejected' },
  'dashboard.document_status_pending': { ar: 'قيد المراجعة', en: 'Under review' },

  // Office dashboard — contact tab descriptions
  'dashboard.contact_events_description': { ar: 'سجل بأحدث محاولات التواصل من العملاء مع مكتبك (للاطلاع فقط).', en: 'A log of recent customer contact attempts with your office (for reference only).' },
  'dashboard.video_requests_description': { ar: 'طلبات مكالمات الفيديو من العملاء — يمكنك تحديث حالة كل طلب.', en: 'Video call requests from customers — you can update the status of each request.' },

  // Office dashboard — sidebar preview
  'dashboard.card_preview_label': { ar: 'معاينة بطاقة المكتب', en: 'Office card preview' },

  // Favourites
  'fav.title': { ar: 'المكاتب المفضلة', en: 'Favourite Offices' },
  'fav.subtitle': { ar: 'قائمة المكاتب التي قمت بحفظها للرجوع إليها لاحقاً.', en: 'The offices you have saved to come back to later.' },
  'fav.empty': { ar: 'لم تقم بإضافة أي مكاتب للمفضلة بعد.', en: 'You haven\'t added any offices to your favourites yet.' },
  'fav.empty_description': { ar: 'يمكنك استكشاف المكاتب المهنية وحفظ المكاتب التي تهمك بالنقر على زر الإضافة للمفضلة في صفحة المكتب.', en: 'Explore professional offices and save the ones you like by tapping the favourite button on the office page.' },

  // Admin
  'admin.title': { ar: 'لوحة إدارة المنصة', en: 'Platform Administration' },
  'admin.offices_tab': { ar: 'المكاتب', en: 'Offices' },
  'admin.customers_tab': { ar: 'العملاء', en: 'Customers' },
  'admin.audit_tab': { ar: 'سجل النظام', en: 'Audit Log' },
  'admin.contact_tab': { ar: 'التواصل ومكالمات الفيديو', en: 'Contact & Video Calls' },
  'admin.verify_action': { ar: 'توثيق', en: 'Verify' },
  'admin.unverify_action': { ar: 'إلغاء التوثيق', en: 'Unverify' },
  'admin.delete_demo': { ar: 'حذف (بيانات تجريبية)', en: 'Delete (Demo Data)' },
  'admin.status': { ar: 'الحالة', en: 'Status' },
  'admin.status_active': { ar: 'نشط', en: 'Active' },
  'admin.status_suspended': { ar: 'معلّق', en: 'Suspended' },
  'admin.status_deactivated': { ar: 'معطّل', en: 'Deactivated' },
  'admin.suspend_customer': { ar: 'تعليق الحساب', en: 'Suspend' },
  'admin.reactivate_customer': { ar: 'إعادة التفعيل', en: 'Reactivate' },
  'admin.deactivate_customer': { ar: 'تعطيل الحساب', en: 'Deactivate' },
  'admin.status_reason_prompt': { ar: 'سبب تغيير الحالة (اختياري)', en: 'Reason for status change (optional)' },
  'admin.contact_events_title': { ar: 'أحداث التواصل الأخيرة', en: 'Recent Contact Events' },
  'admin.video_call_requests_title': { ar: 'طلبات مكالمات الفيديو', en: 'Video Call Requests' },
  'admin.customer_col': { ar: 'العميل', en: 'Customer' },
  'admin.office_col': { ar: 'المكتب', en: 'Office' },
  'admin.action_col': { ar: 'الإجراء', en: 'Action' },
  'admin.date_col': { ar: 'التاريخ', en: 'Date' },

  // Contact gating & events
  'contact.login_required_title': { ar: 'يلزم تسجيل الدخول', en: 'Login Required' },
  'contact.login_required_description': { ar: 'يرجى تسجيل الدخول كعميل للتواصل مع المكتب.', en: 'Please log in as a customer to contact this office.' },
  'contact.action_whatsapp_click': { ar: 'واتساب', en: 'WhatsApp' },
  'contact.action_video_call_request': { ar: 'طلب مكالمة فيديو', en: 'Video Call Request' },
  'contact.action_location_click': { ar: 'عرض الموقع', en: 'Location View' },
  'contact.action_share_click': { ar: 'مشاركة', en: 'Share' },

  // Video call request form
  'videocall.form_title': { ar: 'طلب مكالمة فيديو', en: 'Request a Video Call' },
  'videocall.preferred_date': { ar: 'التاريخ المفضل', en: 'Preferred Date' },
  'videocall.preferred_time': { ar: 'الوقت المفضل', en: 'Preferred Time' },
  'videocall.timezone': { ar: 'المنطقة الزمنية', en: 'Timezone' },
  'videocall.contact_number': { ar: 'رقم للتواصل', en: 'Contact Number' },
  'videocall.note': { ar: 'ملاحظة (اختياري)', en: 'Note (optional)' },
  'videocall.submit': { ar: 'إرسال الطلب', en: 'Send Request' },
  'videocall.submitting': { ar: 'جاري الإرسال...', en: 'Sending...' },
  'videocall.success_title': { ar: 'تم إرسال طلبك بنجاح', en: 'Your request was sent' },
  'videocall.success_description': { ar: 'سيتواصل معك المكتب لتأكيد الموعد.', en: 'The office will contact you to confirm the appointment.' },
  'videocall.status_new': { ar: 'جديد', en: 'New' },
  'videocall.status_viewed': { ar: 'تمت المراجعة', en: 'Viewed' },
  'videocall.status_accepted': { ar: 'مقبول', en: 'Accepted' },
  'videocall.status_declined': { ar: 'مرفوض', en: 'Declined' },
  'videocall.status_completed': { ar: 'مكتمل', en: 'Completed' },

  // Office dashboard — contact tab
  'dashboard.contact_tab': { ar: 'التواصل والمكالمات', en: 'Contact & Calls' },
  'dashboard.contact_events_title': { ar: 'أحداث التواصل الأخيرة', en: 'Recent Contact Events' },
  'dashboard.contact_events_empty': { ar: 'لا توجد أحداث تواصل حتى الآن.', en: 'No contact events yet.' },
  'dashboard.video_requests_empty': { ar: 'لا توجد طلبات مكالمات فيديو حتى الآن.', en: 'No video call requests yet.' },
  'dashboard.mark_viewed': { ar: 'تمت المراجعة', en: 'Mark Viewed' },
  'dashboard.mark_accepted': { ar: 'قبول', en: 'Accept' },
  'dashboard.mark_declined': { ar: 'رفض', en: 'Decline' },
  'dashboard.mark_completed': { ar: 'إنهاء كمكتمل', en: 'Mark Completed' },

  // Customer account dashboard
  'account.title': { ar: 'حسابي', en: 'My Account' },
  'account.profile_section': { ar: 'بياناتي الشخصية', en: 'My Profile' },
  'account.status_section': { ar: 'حالة الحساب', en: 'Account Status' },
  'account.status_active_notice': { ar: 'حسابك نشط ويمكنك التواصل مع المكاتب.', en: 'Your account is active and can contact offices.' },
  'account.status_suspended_notice': { ar: 'تم تعليق حسابك مؤقتاً ولا يمكنك التواصل مع المكاتب حالياً.', en: 'Your account is currently suspended and cannot contact offices.' },
  'account.favourites_section': { ar: 'المكاتب المفضلة', en: 'Favourite Offices' },
  'account.contact_history_section': { ar: 'سجل التواصل الأخير', en: 'Recent Contact History' },
  'account.video_requests_section': { ar: 'طلبات مكالمات الفيديو', en: 'Video Call Requests' },
  'account.no_contact_history': { ar: 'لا يوجد سجل تواصل حتى الآن.', en: 'No contact history yet.' },
  'account.no_video_requests': { ar: 'لا توجد طلبات مكالمات فيديو حتى الآن.', en: 'No video call requests yet.' },

  // Footer / branding
  'footer.project_of': { ar: 'SkayOffice أحد مشاريع شركة Future Road Labs', en: 'SkayOffice is a project of Future Road Labs.' },
  'footer.copyright': { ar: '© 2026 شركة فيوتشر رود لابز. جميع الحقوق محفوظة.', en: '© 2026 Future Road Labs. All rights reserved.' },
  'footer.email_label': { ar: 'البريد الإلكتروني', en: 'Email' },
  'footer.phone_label': { ar: 'الهاتف / واتساب', en: 'Phone / WhatsApp' },
  'footer.contact_title': { ar: 'تواصل معنا', en: 'Get in Touch' },
  'footer.legal_title': { ar: 'قانوني', en: 'Legal' },
  'footer.terms_link': { ar: 'شروط الاستخدام', en: 'Terms of Use' },
  'footer.privacy_link': { ar: 'سياسة الخصوصية', en: 'Privacy Policy' },

  // Legal pages chrome
  'legal.terms_title': { ar: 'شروط الاستخدام', en: 'Terms of Use' },
  'legal.privacy_title': { ar: 'سياسة الخصوصية', en: 'Privacy Policy' },
  'legal.last_updated': { ar: 'آخر تحديث: يوليو 2026', en: 'Last Updated: July 2026' },
  'legal.back_home': { ar: 'العودة للرئيسية', en: 'Back to Home' },

  // Auth — consent checkbox i18n
  'auth.terms_accept_intro': { ar: 'أوافق على', en: 'I agree to the' },
  'auth.terms_link_label': { ar: 'شروط الاستخدام', en: 'Terms of Use' },
  'auth.privacy_link_label': { ar: 'سياسة الخصوصية', en: 'Privacy Policy' },
  'auth.terms_and': { ar: 'و', en: 'and' },
  'auth.terms_error': { ar: 'يجب الموافقة على شروط الاستخدام وسياسة الخصوصية للمتابعة', en: 'You must accept the Terms of Use and Privacy Policy to continue' },

  // ── Form-level validation messages (shown inline by Zod / react-hook-form) ──
  'validation.required':               { ar: 'هذا الحقل مطلوب',                              en: 'This field is required' },
  'validation.email_required':         { ar: 'البريد الإلكتروني مطلوب',                      en: 'Email address is required' },
  'validation.email_invalid':          { ar: 'يرجى إدخال بريد إلكتروني صحيح',               en: 'Please enter a valid email address' },
  'validation.password_required':      { ar: 'كلمة المرور مطلوبة',                           en: 'Password is required' },
  'validation.password_min_6':         { ar: 'يجب أن تحتوي كلمة المرور على 6 أحرف على الأقل', en: 'Password must be at least 6 characters' },
  'validation.name_required':          { ar: 'الاسم الكامل مطلوب',                           en: 'Full name is required' },
  'validation.name_min':               { ar: 'يجب أن يحتوي الاسم على حرفين على الأقل',      en: 'Name must be at least 2 characters' },
  'validation.office_name_required':   { ar: 'اسم المكتب مطلوب',                             en: 'Office name is required' },
  'validation.office_name_min':        { ar: 'يجب أن يحتوي اسم المكتب على حرفين على الأقل', en: 'Office name must be at least 2 characters' },
  'validation.phone_invalid':          { ar: 'يرجى إدخال أرقام فقط',                        en: 'Please enter numbers only' },
  'validation.whatsapp_required':      { ar: 'رقم الواتساب مطلوب',                           en: 'WhatsApp number is required' },
  'validation.whatsapp_min':           { ar: 'يرجى إدخال رقم واتساب صحيح',                  en: 'Please enter a valid WhatsApp number' },
  'validation.city_required':          { ar: 'المدينة مطلوبة',                               en: 'City is required' },
  'validation.city_min':               { ar: 'يجب أن يحتوي اسم المدينة على حرفين على الأقل', en: 'City name must be at least 2 characters' },
  'validation.min_2':                  { ar: 'يجب أن يحتوي على حرفين على الأقل',             en: 'Must be at least 2 characters' },
  'validation.min_5':                  { ar: 'يجب أن يحتوي على 5 أحرف على الأقل',            en: 'Must be at least 5 characters' },
  'validation.min_6':                  { ar: 'يجب أن يحتوي على 6 أحرف على الأقل',            en: 'Must be at least 6 characters' },
  'validation.min_8':                  { ar: 'يجب أن يحتوي على 8 أحرف على الأقل',            en: 'Must be at least 8 characters' },
  'validation.provider_type_required': { ar: 'يرجى اختيار نوع الحساب (مكتب أو مستقل)',       en: 'Please select an account type (office or freelancer)' },

  // Share-the-platform section (homepage, above footer)
  'share_platform.title': { ar: 'شارك SkayOffice', en: 'Share SkayOffice' },
  'share_platform.description': { ar: 'ساعد الآخرين على اكتشاف المكاتب والخدمات الرقمية بسهولة.', en: 'Help others discover digital offices and professional services easily.' },
  'share_platform.action_button': { ar: 'مشاركة ونسخ رابط SkayOffice', en: 'Share & Copy SkayOffice Link' },
  'share_platform.copied_ready': { ar: 'تم نسخ رابط المنصة، ويمكنك مشاركته الآن.', en: 'Platform link copied and ready to share.' },
  'share_platform.share_opened_copy_failed': { ar: 'تم فتح المشاركة، لكن تعذر نسخ الرابط. يمكنك نسخه من رسالة المشاركة.', en: 'Sharing opened, but the link could not be copied. You can copy it from the share message.' },
  'share_platform.copy_failed': { ar: 'تعذر نسخ رابط المنصة. حاول مرة أخرى.', en: 'Could not copy the platform link. Please try again.' },
  'share_platform.shared_text': {
    ar: 'اكتشف SkayOffice، المنصة التي تساعدك على العثور على المكاتب والخدمات الرقمية بسهولة.',
    en: 'Discover SkayOffice, the platform for finding digital offices and professional services.',
  },

  // ── Admin navigation (7 top-level sections) ──
  'admin.nav.overview':          { ar: 'مركز القيادة',       en: 'Command Center' },
  'admin.nav.officeManagement':  { ar: 'إدارة المكاتب',      en: 'Office Management' },
  'admin.nav.customers':         { ar: 'العملاء',             en: 'Customers' },
  'admin.nav.intelligence':      { ar: 'ذكاء السوق',          en: 'Market Intelligence' },
  'admin.nav.activity':          { ar: 'سجل النشاط',          en: 'Activity Log' },
  'admin.nav.more':              { ar: 'المزيد',              en: 'More' },
  'admin.nav.settings':          { ar: 'إعدادات الحساب',     en: 'Account Settings' },
  'admin.nav.health':            { ar: 'صحة المنصة',          en: 'Platform Health' },
  // Legacy keys — kept for backwards compat
  'admin.nav.requests':          { ar: 'طلبات التسجيل',       en: 'Registration Requests' },
  'admin.nav.offices':           { ar: 'المكاتب',              en: 'Offices' },
  'admin.nav.analytics':         { ar: 'تحليلات التواصل',     en: 'Contact Analytics' },

  // ── Platform Health section ──
  'health.title':              { ar: 'صحة المنصة',               en: 'Platform Health'           },
  'health.last_checked':       { ar: 'آخر فحص',                  en: 'Last checked'              },
  'health.refresh':            { ar: 'تحديث',                    en: 'Refresh'                   },
  'health.uptime':             { ar: 'وقت التشغيل',              en: 'Uptime'                    },
  'health.status.healthy':     { ar: 'سليم',                     en: 'Healthy'                   },
  'health.status.warning':     { ar: 'تحذير',                    en: 'Warning'                   },
  'health.status.critical':    { ar: 'حرج',                      en: 'Critical'                  },
  'health.status.not_configured': { ar: 'غير مُفعَّل',           en: 'Not configured'            },
  'health.critical_issues':    { ar: 'مشاكل حرجة',               en: 'Critical issues'           },
  'health.warnings':           { ar: 'تحذيرات',                  en: 'Warnings'                  },
  'health.section.application':   { ar: 'التطبيق',               en: 'Application'               },
  'health.section.jobs':          { ar: 'المهام الخلفية',         en: 'Background Jobs'           },
  'health.section.database':      { ar: 'قاعدة البيانات والخدمات', en: 'Database & Core Services' },
  'health.section.notifications': { ar: 'الإشعارات',             en: 'Notifications'             },
  'health.section.payments':      { ar: 'المدفوعات',             en: 'Payments'                  },
  'health.errors_last_hour':   { ar: 'أخطاء آخر ساعة',           en: 'Errors (last hour)'        },
  'health.errors_total':       { ar: 'إجمالي الأخطاء',           en: 'Total errors'              },
  'health.last_error':         { ar: 'آخر خطأ',                  en: 'Last error'                },
  'health.view_errors':        { ar: 'عرض الأخطاء',              en: 'View errors'               },
  'health.last_successful_run':{ ar: 'آخر تشغيل ناجح',           en: 'Last successful run'       },
  'health.consecutive_failures':{ ar: 'فشل متتالي',              en: 'Consecutive failures'      },
  'health.jobs_completed':     { ar: 'مهام مكتملة (7 أيام)',     en: 'Completed (7 days)'        },
  'health.view_jobs':          { ar: 'عرض المهام',               en: 'View jobs'                 },
  'health.db_ping':            { ar: 'استجابة قاعدة البيانات',   en: 'DB ping'                   },
  'health.api_status':         { ar: 'حالة الـ API',             en: 'API status'                },
  'health.email_provider':     { ar: 'مزوّد البريد',             en: 'Email provider'            },
  'health.sent':               { ar: 'مُرسَل',                   en: 'Sent'                      },
  'health.delivered':          { ar: 'مُسلَّم',                  en: 'Delivered'                 },
  'health.failed':             { ar: 'فاشل',                     en: 'Failed'                    },
  'health.failure_rate':       { ar: 'معدل الفشل',               en: 'Failure rate'              },
  'health.payments_note':      { ar: 'بوابة الدفع لم تُضف بعد.', en: 'Payment gateway not yet integrated.' },
  'health.detail.recent_errors':  { ar: 'الأخطاء الأخيرة',       en: 'Recent Errors'             },
  'health.detail.recent_jobs':    { ar: 'المهام الأخيرة',         en: 'Recent Jobs'               },
  'health.no_errors':          { ar: 'لا توجد أخطاء مسجّلة',    en: 'No errors recorded'        },
  'health.no_jobs':            { ar: 'لا توجد مهام مسجّلة',     en: 'No jobs recorded'          },
  'health.ms':                 { ar: 'مللي ثانية',               en: 'ms'                        },

  // ── Admin account settings — change password ──
  'admin.settings.title':            { ar: 'تغيير كلمة المرور',                         en: 'Change Password' },
  'admin.settings.description':      { ar: 'تحديث كلمة مرور حساب المسؤول. ستُسجَّل خروجاً فور الحفظ.', en: 'Update your admin account password. You will be signed out immediately.' },
  'admin.settings.current_password': { ar: 'كلمة المرور الحالية',                       en: 'Current Password' },
  'admin.settings.new_password':     { ar: 'كلمة المرور الجديدة',                       en: 'New Password' },
  'admin.settings.confirm_password': { ar: 'تأكيد كلمة المرور الجديدة',                 en: 'Confirm New Password' },
  'admin.settings.submit':           { ar: 'تغيير كلمة المرور',                         en: 'Change Password' },
  'admin.settings.submitting':       { ar: 'جاري التغيير...',                           en: 'Changing...' },
  'admin.settings.success_title':    { ar: 'تم تغيير كلمة المرور',                      en: 'Password Changed' },
  'admin.settings.success_desc':     { ar: 'تم تحديث كلمة مرورك. سيتم تسجيل خروجك الآن.', en: 'Your password has been updated. Signing you out now.' },
  'admin.settings.wrong_current':    { ar: 'كلمة المرور الحالية غير صحيحة',             en: 'Current password is incorrect' },
  'admin.settings.rate_limited':     { ar: 'محاولات كثيرة. يرجى المحاولة لاحقاً.',      en: 'Too many attempts. Please try again later.' },
  'admin.settings.field_required':   { ar: 'هذا الحقل مطلوب',                           en: 'This field is required' },
};

export type TranslationKey = keyof typeof translations | keyof typeof dashboardTranslations | keyof typeof serviceRequestTranslations | keyof typeof reportTranslations;

let currentLanguage: Language = 'ar';
const listeners = new Set<() => void>();

try {
  const stored = localStorage.getItem('skayoffice-i18n');
  if (stored === 'ar' || stored === 'en') {
    currentLanguage = stored;
  }
} catch (e) {}

if (typeof document !== 'undefined') {
  document.documentElement.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = currentLanguage;
}

const emitChange = () => {
  listeners.forEach(listener => listener());
};

const setLanguage = (lang: Language) => {
  currentLanguage = lang;
  try {
    localStorage.setItem('skayoffice-i18n', lang);
  } catch (e) {}
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  emitChange();
};

export function useI18n() {
  const [language, setLangState] = useState<Language>(currentLanguage);

  useEffect(() => {
    const handleStoreChange = () => {
      setLangState(currentLanguage);
    };
    listeners.add(handleStoreChange);
    return () => {
      listeners.delete(handleStoreChange);
    };
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    const allTranslations = translations as Record<string, { ar: string; en: string }>;
    const translation = allTranslations[key];
    if (translation) {
      return translation[currentLanguage] || translation.ar || translation.en || '';
    }
    if (typeof console !== 'undefined' && import.meta.env?.DEV) {
      console.warn(`[i18n] Missing translation key: ${key}`);
    }
    return '';
  }, [language]);

  return {
    language,
    setLanguage,
    t
  };
}

/**
 * Picks the language-appropriate value for a bilingual `field`/`fieldAr`
 * pair used throughout the office data model. Falls back to the English
 * value (a complete, professionally-written sentence rather than a raw key
 * or blank string) whenever the Arabic value is missing — this is the one
 * explicitly allowed case where the rendered text may not match the
 * active UI language. The API-side serializer separately flags offices
 * missing Arabic content in the admin audit log, so this is never a
 * silent gap — it's a deliberate, logged fallback.
 */
export function pickLocalized(
  value: string | null | undefined,
  valueAr: string | null | undefined,
  language: Language,
): string | null | undefined {
  if (language === 'ar' && valueAr && valueAr.trim()) return valueAr;
  return value;
}

// A curated set of cities the platform actively serves, each with a known
// Arabic/English name pair — the mirror of `categoriesMap` for city display.
// `offices.city` intentionally has no `cityAr` column (see citySynonyms.ts
// on the server): city is a small, effectively-enumerable set in practice,
// so a static display map avoids per-office bilingual data entry for a
// field that rarely varies in spelling. An office whose stored city isn't
// in this map (a free-text city outside the curated list) is shown as-is
// in both languages rather than silently disappearing.
export const citiesMap: Record<string, { ar: string; en: string }> = {
  // Jordan
  Amman: { ar: 'عمان', en: 'Amman' },
  Zarqa: { ar: 'الزرقاء', en: 'Zarqa' },
  Irbid: { ar: 'إربد', en: 'Irbid' },
  Aqaba: { ar: 'العقبة', en: 'Aqaba' },
  // UAE
  Dubai: { ar: 'دبي', en: 'Dubai' },
  'Abu Dhabi': { ar: 'أبوظبي', en: 'Abu Dhabi' },
  Sharjah: { ar: 'الشارقة', en: 'Sharjah' },
  Ajman: { ar: 'عجمان', en: 'Ajman' },
  'Ras Al Khaimah': { ar: 'رأس الخيمة', en: 'Ras Al Khaimah' },
  Fujairah: { ar: 'الفجيرة', en: 'Fujairah' },
  'Umm Al Quwain': { ar: 'أم القيوين', en: 'Umm Al Quwain' },
  'Al Ain': { ar: 'العين', en: 'Al Ain' },
  // Kuwait
  'Kuwait City': { ar: 'مدينة الكويت', en: 'Kuwait City' },
  // Egypt
  Cairo: { ar: 'القاهرة', en: 'Cairo' },
  Alexandria: { ar: 'الإسكندرية', en: 'Alexandria' },
  Giza: { ar: 'الجيزة', en: 'Giza' },
  // Lebanon
  Beirut: { ar: 'بيروت', en: 'Beirut' },
  Tripoli: { ar: 'طرابلس', en: 'Tripoli' },
  // Saudi Arabia
  Riyadh: { ar: 'الرياض', en: 'Riyadh' },
  Jeddah: { ar: 'جدة', en: 'Jeddah' },
  Mecca: { ar: 'مكة المكرمة', en: 'Mecca' },
  Medina: { ar: 'المدينة المنورة', en: 'Medina' },
  Dammam: { ar: 'الدمام', en: 'Dammam' },
  Khobar: { ar: 'الخبر', en: 'Khobar' },
  Dhahran: { ar: 'الظهران', en: 'Dhahran' },
  Taif: { ar: 'الطائف', en: 'Taif' },
  Buraidah: { ar: 'بريدة', en: 'Buraidah' },
  Abha: { ar: 'أبها', en: 'Abha' },
  Tabuk: { ar: 'تبوك', en: 'Tabuk' },
  Jubail: { ar: 'الجبيل', en: 'Jubail' },
  // Qatar
  Doha: { ar: 'الدوحة', en: 'Doha' },
  // Oman
  Muscat: { ar: 'مسقط', en: 'Muscat' },
  Salalah: { ar: 'صلالة', en: 'Salalah' },
  // Bahrain
  Manama: { ar: 'المنامة', en: 'Manama' },
  // Iraq
  Baghdad: { ar: 'بغداد', en: 'Baghdad' },
  Erbil: { ar: 'أربيل', en: 'Erbil' },
  Basra: { ar: 'البصرة', en: 'Basra' },
  // Palestine
  Ramallah: { ar: 'رام الله', en: 'Ramallah' },
  Gaza: { ar: 'غزة', en: 'Gaza' },
  Jerusalem: { ar: 'القدس', en: 'Jerusalem' },
  // Syria
  Damascus: { ar: 'دمشق', en: 'Damascus' },
  Aleppo: { ar: 'حلب', en: 'Aleppo' },
  // Morocco / North Africa
  Casablanca: { ar: 'الدار البيضاء', en: 'Casablanca' },
  Rabat: { ar: 'الرباط', en: 'Rabat' },
  Tunis: { ar: 'تونس', en: 'Tunis' },
};

// Office `city` values are free text entered at registration time, so the
// stored casing isn't guaranteed to match this map's keys exactly (e.g.
// "BURAIDAH" vs "Buraidah") — look up case-insensitively so casing
// differences never cause a known city to silently fall back to raw text.
const citiesMapLowercase: Record<string, { ar: string; en: string }> = Object.fromEntries(
  Object.entries(citiesMap).map(([city, names]) => [city.toLowerCase(), names]),
);

export function localizedCity(city: string, language: Language): string {
  return citiesMapLowercase[city.trim().toLowerCase()]?.[language] ?? city;
}

export const categoriesMap: Record<string, { ar: string, en: string }> = {
  translation: { ar: 'الترجمة', en: 'Translation' },
  legal: { ar: 'الخدمات القانونية', en: 'Legal Services' },
  marketing: { ar: 'التسويق', en: 'Marketing' },
  development: { ar: 'تطوير البرمجيات', en: 'Software Development' },
  social_media_management: { ar: 'إدارة منصات التواصل الاجتماعي', en: 'Social Media Management' },
  design: { ar: 'التصميم', en: 'Design' },
  real_estate: { ar: 'الخدمات العقارية', en: 'Real Estate Services' },
  company_formation: { ar: 'تأسيس الشركات', en: 'Company Formation' },
  business_consulting: { ar: 'الاستشارات التجارية', en: 'Business Consulting' },
  accounting: { ar: 'المحاسبة', en: 'Accounting' },
  other: { ar: 'أخرى', en: 'Other' },
};

// ─── Dashboard (new professional shell) ────────────────────────────────────

export const dashboardTranslations = {
  // Nav labels
  'dash.nav.overview': { ar: 'الرئيسية', en: 'Overview' },
  'dash.nav.profile': { ar: 'ملف المكتب', en: 'Office Profile' },
  'dash.nav.media': { ar: 'الوسائط', en: 'Media' },
  'dash.nav.contact_features': { ar: 'وسائل التواصل', en: 'Contact' },
  'dash.nav.video_requests': { ar: 'طلبات الفيديو', en: 'Requests' },
  'dash.nav.documents': { ar: 'المستندات', en: 'Documents' },
  'dash.nav.performance': { ar: 'الأداء', en: 'Performance' },
  'dash.nav.subscription': { ar: 'الاشتراك', en: 'Subscription' },
  'dash.nav.notifications': { ar: 'الإشعارات', en: 'Notifications' },
  'dash.nav.settings': { ar: 'الإعدادات', en: 'Settings' },
  'dash.nav.help': { ar: 'الدعم', en: 'Help' },
  'dash.nav.more': { ar: 'المزيد', en: 'More' },
  // Overview
  'dash.overview.title': { ar: 'الرئيسية', en: 'Overview' },
  'dash.overview.profile_complete': { ar: 'اكتمال الملف', en: 'Profile Completion' },
  'dash.overview.view_public': { ar: 'عرض الملف العام', en: 'View Public Profile' },
  'dash.overview.needs_action': { ar: 'يحتاج إجراء الآن', en: 'Needs Action Now' },
  'dash.overview.all_good': { ar: 'لا توجد إجراءات مطلوبة حالياً — مكتبك مكتمل!', en: 'No actions needed right now — your profile looks great!' },
  'dash.overview.priority_high': { ar: 'عاجل', en: 'Urgent' },
  'dash.overview.priority_medium': { ar: 'مهم', en: 'Important' },
  'dash.overview.priority_low': { ar: 'اختياري', en: 'Optional' },
  'dash.overview.go_to': { ar: 'انتقل', en: 'Go' },
  // Action items
  'dash.action.missing_images': { ar: 'أضف صوراً للمكتب', en: 'Add office images' },
  'dash.action.missing_images_desc': { ar: 'الصور تساعد العملاء على التعرف على مكتبك وخدماتك', en: 'Images help customers recognise your office and services' },
  'dash.action.missing_whatsapp': { ar: 'أضف رقم واتساب', en: 'Add WhatsApp number' },
  'dash.action.missing_whatsapp_desc': { ar: 'واتساب هو أكثر طرق التواصل شيوعاً مع العملاء', en: 'WhatsApp is the most common way customers contact offices' },
  'dash.action.missing_languages': { ar: 'أضف لغات التواصل', en: 'Add communication languages' },
  'dash.action.missing_languages_desc': { ar: 'أخبر العملاء بالغات التي يمكنهم التحدث بها معك', en: 'Let customers know which languages they can use with you' },
  'dash.action.missing_description': { ar: 'أضف وصفاً مختصراً للمكتب', en: 'Add a short description' },
  'dash.action.missing_description_desc': { ar: 'وصف واضح يساعد العملاء على فهم خدماتك بسرعة', en: 'A clear description helps customers quickly understand your services' },
  'dash.action.missing_location': { ar: 'أضف موقع المكتب على الخريطة', en: 'Add office map location' },
  'dash.action.missing_location_desc': { ar: 'يمكن للعملاء الوصول إليك بسهولة أكبر عند معرفة موقعك', en: 'Customers can find you more easily with a map location' },
  'dash.action.rejected_document': { ar: 'مستند مرفوض — يحتاج استبداله', en: 'Rejected document — replacement required' },
  'dash.action.rejected_document_desc': { ar: 'يرجى رفع نسخة جديدة من المستند المرفوض لاستمرار مراجعة طلبك', en: 'Upload a new version of the rejected document to continue your application review' },
  'dash.action.new_video_requests': { ar: 'طلبات مكالمة فيديو تحتاج رداً', en: 'Video call requests need a response' },
  'dash.action.new_video_requests_desc': { ar: 'لديك طلبات مكالمة فيديو لم يتم الرد عليها بعد', en: 'You have unanswered video call requests waiting for your response' },
  'dash.action.pending_changes': { ar: 'تعديلات معلقة — بانتظار موافقة الإدارة', en: 'Pending edits — awaiting admin approval' },
  'dash.action.pending_changes_desc': { ar: 'تعديلاتك مرسلة للمراجعة ولم تُطبَّق بعد على الملف العام', en: 'Your edits are in review and not yet applied to your public profile' },
  'dash.action.submit_application': { ar: 'أرسل ملفك للمراجعة', en: 'Submit your profile for review' },
  'dash.action.submit_application_desc': { ar: 'ملفك جاهز للإرسال — أرسله الآن ليظهر للعملاء', en: 'Your profile is ready to submit — send it now to appear to customers' },
  // Performance
  'dash.performance.title': { ar: 'ملخص الأداء', en: 'Performance' },
  'dash.performance.subtitle': { ar: 'إجمالي تفاعلات العملاء مع مكتبك على المنصة', en: 'Total customer interactions with your office on the platform' },
  'dash.performance.whatsapp_clicks': { ar: 'نقرات واتساب', en: 'WhatsApp Clicks' },
  'dash.performance.phone_clicks': { ar: 'نقرات الهاتف', en: 'Phone Clicks' },
  'dash.performance.location_clicks': { ar: 'نقرات الموقع', en: 'Location Clicks' },
  'dash.performance.shares': { ar: 'مشاركات المكتب', en: 'Office Shares' },
  'dash.performance.video_requests': { ar: 'طلبات مكالمة الفيديو', en: 'Video Requests' },
  'dash.performance.total_interactions': { ar: 'إجمالي التفاعلات', en: 'Total Interactions' },
  'dash.performance.empty_title': { ar: 'لا توجد بيانات أداء بعد', en: 'No performance data yet' },
  'dash.performance.empty_desc': { ar: 'ستظهر هنا إحصائيات تفاعل العملاء بمجرد أن يبدأوا في زيارة ملفك.', en: 'Customer interaction stats will appear here once they start visiting your profile.' },
  'dash.performance.all_time': { ar: 'إجمالي منذ البداية', en: 'All time' },
  // Contact features
  'dash.contact.title': { ar: 'وسائل التواصل', en: 'Contact Features' },
  'dash.contact.subtitle': { ar: 'تحكم في طرق التواصل التي تظهر لعملائك في صفحة مكتبك العامة', en: 'Control which contact options appear on your public office page' },
  'dash.contact.whatsapp_feature': { ar: 'واتساب', en: 'WhatsApp' },
  'dash.contact.whatsapp_desc': { ar: 'يظهر زر التواصل عبر واتساب في صفحة مكتبك. يتطلب إدخال رقم واتساب في الملف الشخصي.', en: 'Shows a WhatsApp contact button on your office page. Requires a WhatsApp number in your profile.' },
  'dash.contact.phone_feature': { ar: 'المكالمة الهاتفية', en: 'Phone Call' },
  'dash.contact.phone_desc': { ar: 'يتيح للعملاء الاتصال الهاتفي على رقم الواتساب مباشرةً', en: 'Lets customers phone-call your WhatsApp number directly' },
  'dash.contact.video_call_feature': { ar: 'حجز مكالمة الفيديو', en: 'Video Call Booking' },
  'dash.contact.video_call_desc': { ar: 'يظهر زر حجز مكالمة الفيديو ويتيح للعملاء إرسال طلبات الحجز', en: 'Shows a video booking button and lets customers send booking requests' },
  'dash.contact.video_call_coming_soon': { ar: 'قريبًا — ميزة اختيارية', en: 'Coming Soon — Optional Feature' },
  'dash.contact.location_feature': { ar: 'الموقع على الخريطة', en: 'Map Location' },
  'dash.contact.location_desc': { ar: 'يعرض زر الموقع عند توفر رابط خرائط جوجل في ملف مكتبك', en: 'Shows a location button when a Google Maps link is set in your profile' },
  'dash.contact.feature_enabled': { ar: 'مفعّل', en: 'Enabled' },
  'dash.contact.feature_disabled': { ar: 'معطّل', en: 'Disabled' },
  'dash.contact.note': { ar: 'الميزات المعطّلة لا تظهر في صفحة مكتبك العامة ولا تُشغل مساحة فارغة.', en: 'Disabled features do not appear on your public page and leave no empty space.' },
  'dash.contact.saving': { ar: 'جاري الحفظ...', en: 'Saving...' },
  'dash.contact.saved': { ar: 'تم الحفظ', en: 'Saved' },
  // Video requests
  'dash.video.title': { ar: 'طلبات مكالمة الفيديو', en: 'Video Call Requests' },
  'dash.video.subtitle': { ar: 'طلبات حجز مكالمة الفيديو الواردة من العملاء', en: 'Incoming video call booking requests from customers' },
  'dash.video.disabled_notice': { ar: 'حجز مكالمة الفيديو معطّل حالياً. فعّله من قسم وسائل التواصل.', en: 'Video call booking is currently disabled. Enable it in the Contact Features section.' },
  'dash.video.enable_cta': { ar: 'الذهاب إلى وسائل التواصل', en: 'Go to Contact Features' },
  'dash.video.filter_all': { ar: 'الكل', en: 'All' },
  'dash.video.filter_new': { ar: 'جديد', en: 'New' },
  'dash.video.filter_viewed': { ar: 'تم الاطلاع', en: 'Viewed' },
  'dash.video.filter_accepted': { ar: 'مقبول', en: 'Accepted' },
  'dash.video.filter_declined': { ar: 'مرفوض', en: 'Declined' },
  'dash.video.filter_completed': { ar: 'مكتمل', en: 'Completed' },
  'dash.video.empty': { ar: 'لا توجد طلبات مكالمات فيديو', en: 'No video call requests' },
  'dash.video.empty_desc': { ar: 'ستظهر هنا طلبات الحجز عندما يرسلها العملاء', en: 'Booking requests will appear here when customers send them' },
  'dash.video.preferred_datetime': { ar: 'الوقت المفضل', en: 'Preferred Time' },
  'dash.video.contact_number': { ar: 'رقم التواصل', en: 'Contact Number' },
  'dash.video.received': { ar: 'تاريخ الإرسال', en: 'Received' },
  // Subscription
  'dash.subscription.title': { ar: 'الاشتراك والفوترة', en: 'Subscription & Billing' },
  'dash.subscription.pilot': { ar: 'الباقة التجريبية', en: 'Pilot Package' },
  'dash.subscription.status_active': { ar: 'نشط', en: 'Active' },
  'dash.subscription.contact_support': { ar: 'للاستفسار عن الاشتراك أو الترقية، تواصل مع الدعم الفني.', en: 'For subscription enquiries or upgrades, please contact support.' },
  'dash.subscription.included': { ar: 'ما يشمله الاشتراك', en: "What's included" },
  'dash.subscription.feature_listing': { ar: 'ظهور مكتبك في نتائج البحث', en: 'Your office appears in search results' },
  'dash.subscription.feature_profile': { ar: 'صفحة مكتب رقمية متكاملة', en: 'Full digital office profile page' },
  'dash.subscription.feature_whatsapp': { ar: 'تواصل مباشر عبر واتساب', en: 'Direct WhatsApp contact' },
  'dash.subscription.feature_media': { ar: 'معرض صور وفيديو تعريفي', en: 'Photo gallery and intro video' },
  'dash.subscription.feature_analytics': { ar: 'إحصائيات التفاعل مع العملاء', en: 'Customer interaction analytics' },
  'dash.subscription.contact_us': { ar: 'تواصل مع الدعم', en: 'Contact Support' },
  // Notifications
  'dash.notifications.title': { ar: 'الإشعارات', en: 'Notifications' },
  'dash.notifications.all': { ar: 'الكل', en: 'All' },
  'dash.notifications.unread': { ar: 'غير المقروءة', en: 'Unread' },
  'dash.notifications.mark_read': { ar: 'تحديد كمقروء', en: 'Mark as read' },
  'dash.notifications.mark_all_read': { ar: 'تحديد الكل كمقروء', en: 'Mark all as read' },
  'dash.notifications.empty': { ar: 'لا توجد إشعارات', en: 'No notifications' },
  'dash.notifications.empty_desc': { ar: 'ستظهر هنا إشعارات تغييرات حالة المكتب وطلبات العملاء', en: 'Office status changes and customer requests will appear here' },
  'dash.notifications.type_doc_approved': { ar: 'مستند مقبول', en: 'Document approved' },
  'dash.notifications.type_doc_rejected': { ar: 'مستند مرفوض', en: 'Document rejected' },
  'dash.notifications.type_video_request': { ar: 'طلب مكالمة فيديو جديد', en: 'New video call request' },
  'dash.notifications.type_pending_change': { ar: 'تعديل مقترح معلق', en: 'Proposed edit pending' },
  'dash.notifications.view': { ar: 'عرض', en: 'View' },
  // SR lifecycle notification types (Blocker 9)
  'dash.notifications.type_sr_submitted':                  { ar: 'طلب خدمة جديد', en: 'New service request' },
  'dash.notifications.type_sr_offer_sent':                 { ar: 'عرض جديد من المكتب', en: 'New offer from office' },
  'dash.notifications.type_sr_offer_accepted':             { ar: 'قبول العرض', en: 'Offer accepted' },
  'dash.notifications.type_sr_offer_rejected':             { ar: 'رفض العرض', en: 'Offer declined' },
  'dash.notifications.type_sr_rejected':                   { ar: 'طلب مرفوض', en: 'Request declined' },
  'dash.notifications.type_sr_completed_awaiting_confirm': { ar: 'بانتظار تأكيد الإتمام', en: 'Awaiting completion confirmation' },
  'dash.notifications.type_sr_confirmed_completed':        { ar: 'أكد العميل الإتمام', en: 'Customer confirmed completion' },
  'dash.notifications.type_sr_not_completed':              { ar: 'أفاد العميل بعدم الإتمام', en: 'Customer flagged not completed' },
  // Email/phone verification banner (Blocker 8)
  'verify.email_banner_title':     { ar: 'يرجى تأكيد بريدك الإلكتروني', en: 'Please verify your email' },
  'verify.email_banner_desc':      { ar: 'التفعيل يتطلب تأكيد البريد الإلكتروني. اطلب رمزاً لإرساله إلى بريدك المسجل.', en: 'Activation requires email verification. Request a code for your registered email.' },
  'verify.phone_banner_title':     { ar: 'يرجى تأكيد رقم هاتفك', en: 'Please verify your phone number' },
  'verify.phone_banner_desc':      { ar: 'التفعيل يتطلب تأكيد رقم الهاتف. اطلب رمزاً برسالة نصية إلى رقمك المسجل.', en: 'Activation requires phone verification. Request an SMS code for your registered number.' },
  'verify.send_code':              { ar: 'إرسال رمز التحقق', en: 'Send verification code' },
  'verify.resend_code':            { ar: 'إعادة إرسال الرمز', en: 'Resend code' },
  'verify.enter_code':             { ar: 'أدخل رمز التحقق', en: 'Enter verification code' },
  'verify.code_placeholder':       { ar: 'الرمز المكون من 6 أرقام', en: '6-digit code' },
  'verify.confirm':                { ar: 'تأكيد', en: 'Confirm' },
  'verify.verified':               { ar: '✓ تم التحقق من البريد الإلكتروني', en: '✓ Email verified' },
  'verify.verified_phone':         { ar: '✓ تم التحقق من رقم الهاتف', en: '✓ Phone verified' },
  'verify.error_invalid':          { ar: 'رمز التحقق غير صحيح', en: 'Invalid verification code' },
  'verify.error_expired':          { ar: 'انتهت صلاحية الرمز — أرسل رمزاً جديداً', en: 'Code expired — please request a new one' },
  'verify.error_attempts':         { ar: 'تم استنفاد محاولات الرمز — اطلب رمزاً جديداً', en: 'Code attempts exhausted — request a new code' },
  'verify.error_no_code':          { ar: 'لا يوجد رمز صالح — اطلب رمزاً جديداً', en: 'No active code found — request a new code' },
  'verify.error_delivery':         { ar: 'تعذر إرسال الرمز حالياً. حاول مرة أخرى لاحقاً.', en: 'The code could not be delivered. Please try again later.' },
  'verify.error_generic':          { ar: 'تعذر إكمال التحقق. حاول مرة أخرى.', en: 'Verification could not be completed. Please try again.' },
  'verify.sending':                { ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'verify.code_sent':              { ar: 'تم إرسال الرمز إلى بريدك الإلكتروني', en: 'Code sent to your email' },
  'verify.phone_code_sent':        { ar: 'تم إرسال الرمز برسالة نصية إلى هاتفك', en: 'Code sent by SMS to your phone' },
  // Settings
  'dash.settings.title': { ar: 'الإعدادات', en: 'Settings' },
  'dash.settings.language_section': { ar: 'اللغة', en: 'Language' },
  'dash.settings.language_ar': { ar: 'العربية', en: 'Arabic' },
  'dash.settings.language_en': { ar: 'الإنجليزية', en: 'English' },
  'dash.settings.account_section': { ar: 'معلومات الحساب', en: 'Account Info' },
  'dash.settings.works_section': { ar: 'معرض الأعمال', en: 'Works Portfolio' },
  'dash.settings.works_toggle': { ar: 'إظهار تبويب الأعمال للعملاء', en: 'Show the Works tab to customers' },
  'dash.settings.works_description': { ar: 'يمكنك إخفاء أو إظهار التبويب دون حذف الصور. لن تظهر للعملاء إلا الصور التي وافقت عليها الإدارة.', en: 'Hide or show the tab without deleting images. Only admin-approved images are visible to customers.' },
  'dash.settings.role_office': { ar: 'مكتب مهني', en: 'Professional Office' },
  'dash.settings.logout': { ar: 'تسجيل الخروج', en: 'Log Out' },
  'dash.settings.logout_confirm_title': { ar: 'تسجيل الخروج', en: 'Log Out' },
  'dash.settings.logout_confirm_desc': { ar: 'هل أنت متأكد من رغبتك في تسجيل الخروج؟', en: 'Are you sure you want to log out?' },
  // Help
  'dash.help.title': { ar: 'المساعدة والدعم', en: 'Help & Support' },
  'dash.help.faq_section': { ar: 'أسئلة شائعة', en: 'Frequently Asked Questions' },
  'dash.help.contact_section': { ar: 'تواصل مع الدعم', en: 'Contact Support' },
  'dash.help.getting_started': { ar: 'دليل البدء السريع', en: 'Getting Started Guide' },
  'dash.help.whatsapp_support': { ar: 'دعم عبر واتساب', en: 'WhatsApp Support' },
  'dash.help.email_support': { ar: 'دعم عبر البريد الإلكتروني', en: 'Email Support' },
  'dash.help.report_problem': { ar: 'الإبلاغ عن مشكلة', en: 'Report a Problem' },
  'dash.help.faq_1_q': { ar: 'كيف يظهر مكتبي للعملاء؟', en: 'How does my office appear to customers?' },
  'dash.help.faq_1_a': { ar: 'بعد الموافقة على طلبك وتفعيله من قبل فريق SkayOffice، سيظهر مكتبك في نتائج البحث ويمكن للعملاء زيارة صفحته الرقمية.', en: 'After your application is approved and activated by the SkayOffice team, your office will appear in search results and customers can visit its digital page.' },
  'dash.help.faq_2_q': { ar: 'كم من الوقت تستغرق مراجعة الطلب؟', en: 'How long does the application review take?' },
  'dash.help.faq_2_a': { ar: 'تستغرق المراجعة عادةً من 1 إلى 3 أيام عمل. ستتلقى إشعاراً فور صدور القرار.', en: 'Review typically takes 1–3 business days. You will receive a notification as soon as a decision is made.' },
  'dash.help.faq_3_q': { ar: 'كيف أغير معلومات مكتبي بعد الموافقة؟', en: 'How do I update my office info after approval?' },
  'dash.help.faq_3_a': { ar: 'يمكنك تعديل معلومات مكتبك في أي وقت من قسم "ملف المكتب". بعد الموافقة، تُرسل التعديلات للمراجعة قبل نشرها على الملف العام.', en: 'You can edit your office info anytime in "Office Profile". After approval, edits are sent for review before being published to your public profile.' },
  'dash.help.faq_4_q': { ar: 'كيف أعرف حالة طلبي؟', en: 'How do I check my application status?' },
  'dash.help.faq_4_a': { ar: 'تظهر حالة طلبك في لوحة التحكم، وستجد أي ملاحظات أو تعديلات مطلوبة في قسم التنبيهات.', en: 'Your application status appears on the dashboard, with any notes or requested changes shown in Notifications.' },
  'dash.help.faq_5_q': { ar: 'ما الحد الأقصى لعدد صور المعرض؟', en: 'What is the maximum number of gallery images?' },
  'dash.help.faq_5_a': { ar: 'يمكنك رفع ما يصل إلى 4 صور في المعرض، إضافةً إلى فيديو تعريفي واحد (اختياري).', en: 'You can upload up to 4 images in the gallery, plus one optional introductory video.' },
  'dash.help.onboarding_1': { ar: 'أكمل ملفك الشخصي بأكبر قدر ممكن من المعلومات', en: 'Complete your profile with as much information as possible' },
  'dash.help.onboarding_2': { ar: 'ارفع مستندات التحقق المطلوبة', en: 'Upload the required verification documents' },
  'dash.help.onboarding_3': { ar: 'أرسل طلبك للمراجعة وانتظر الموافقة', en: 'Submit your application for review and wait for approval' },
  'dash.help.onboarding_4': { ar: 'بعد التفعيل، أضف صوراً وفيديو تعريفي لمكتبك', en: 'After activation, add photos and an intro video for your office' },
  'dash.help.onboarding_5': { ar: 'تابع الطلبات والتنبيهات ورد على العملاء من لوحة التحكم', en: 'Monitor requests and notifications, and respond to customers from your dashboard' },

  // ── Office Tools section ──────────────────────────────────────────────────
  'dash.nav.office_tools': { ar: 'أدوات المكتب', en: 'Office Tools' },
  'dash.tools.title': { ar: 'أدوات المكتب', en: 'Office Tools' },
  'dash.tools.subtitle': { ar: 'شارك مكتبك الرقمي مع عملائك — يفتح رمز QR والرابط صفحة مكتبك العامة مباشرةً', en: 'Share your digital office with clients — the QR code and link open your public office page directly.' },
  'dash.tools.download_qr': { ar: 'تحميل رمز QR', en: 'Download QR' },
  'dash.tools.copy_link': { ar: 'نسخ الرابط', en: 'Copy Link' },
  'dash.tools.link_copied': { ar: 'تم النسخ!', en: 'Copied!' },
  'dash.tools.share': { ar: 'مشاركة', en: 'Share' },
  'dash.tools.inactive_notice': { ar: 'سيعمل الرابط ورمز QR بعد تفعيل مكتبك على المنصة', en: 'The link and QR code will work once your office is activated on the platform.' },
} as const;

// ─── Service Request feature translations ──────────────────────────────────

export const serviceRequestTranslations = {
  // Buttons & CTAs
  'sr.request_service':     { ar: 'طلب خدمة', en: 'Request a Service' },
  'sr.my_requests':         { ar: 'طلباتي', en: 'My Requests' },
  'sr.service_requests':    { ar: 'طلبات الخدمات', en: 'Service Requests' },
  'sr.send_offer':          { ar: 'إرسال العرض', en: 'Send Offer' },
  'sr.reject_request':      { ar: 'رفض الطلب', en: 'Reject Request' },
  'sr.accept_offer':        { ar: 'قبول العرض', en: 'Accept Offer' },
  'sr.reject_offer':        { ar: 'رفض العرض', en: 'Reject Offer' },
  'sr.mark_completed':      { ar: 'تم إنجاز الخدمة', en: 'Mark as Completed' },
  'sr.confirm_completed':   { ar: 'تم الإنجاز ✓', en: 'Service Completed ✓' },
  'sr.not_completed_btn':   { ar: 'لم يتم الإنجاز', en: 'Not Completed' },
  'sr.submit_request':      { ar: 'إرسال الطلب', en: 'Submit Request' },
  'sr.submitting':          { ar: 'جاري الإرسال...', en: 'Submitting...' },
  'sr.office_cannot_submit': { ar: 'طلبات الخدمة متاحة لحسابات العملاء فقط', en: 'Service requests are available for customer accounts only' },
  // Form fields
  'sr.service_name':        { ar: 'اسم الخدمة', en: 'Service Name' },
  'sr.service_name_placeholder': { ar: 'مثال: تأسيس شركة فردية', en: 'e.g. Company registration' },
  'sr.description':         { ar: 'وصف مختصر', en: 'Short Description' },
  'sr.description_placeholder': { ar: 'صف احتياجاتك بإيجاز...', en: 'Briefly describe your needs...' },
  'sr.price':               { ar: 'السعر', en: 'Price' },
  'sr.execution_duration':  { ar: 'مدة التنفيذ', en: 'Execution Duration' },
  'sr.days':                { ar: 'أيام', en: 'days' },
  // Dialog titles
  'sr.form_title':          { ar: 'طلب خدمة', en: 'Request a Service' },
  'sr.form_subtitle':       { ar: 'أرسل طلبك وسيتواصل معك المكتب لتحديد التفاصيل', en: 'Submit your request and the office will contact you with details' },
  'sr.offer_dialog_desc':   { ar: 'حدد السعر والمدة الزمنية للتنفيذ', en: 'Enter the price and execution timeline for this service' },
  // Private request attachments
  'sr.attachments':                 { ar: 'المرفقات', en: 'Attachments' },
  'sr.add_attachments':             { ar: 'إضافة مرفقات', en: 'Add attachments' },
  'sr.attachment_private_note':     { ar: 'المرفقات خاصة بين العميل والمكتب والإدارة فقط.', en: 'Attachments are private to the customer, office, and admins.' },
  'sr.attachment_upload_hint':      { ar: 'ملفات JPG أو PNG أو PDF فقط، بحد أقصى 10 ميجابايت للملف و5 ملفات.', en: 'JPG, PNG, or PDF only — up to 10MB per file and 5 files.' },
  'sr.attachment_from_office':      { ar: 'من المكتب', en: 'From office' },
  'sr.attachment_from_customer':    { ar: 'من العميل', en: 'From customer' },
  'sr.download_attachment':         { ar: 'تنزيل', en: 'Download' },
  'sr.no_attachments':              { ar: 'لا توجد مرفقات بعد', en: 'No attachments yet' },
  'sr.attachment_upload_error':     { ar: 'تعذر التحقق من المرفق. يرجى رفع ملف JPG أو PNG أو PDF صالح.', en: 'The attachment could not be verified. Upload a valid JPG, PNG, or PDF.' },
  'sr.attachment_download_error':   { ar: 'تعذر تنزيل المرفق. يرجى المحاولة مرة أخرى.', en: 'Could not download the attachment. Please try again.' },
  // Success messages
  'sr.success_message':     { ar: 'تم إرسال طلبك بنجاح', en: 'Your request has been sent successfully' },
  'sr.review_submitted':    { ar: 'تم إرسال تقييمك بنجاح', en: 'Your evaluation has been submitted' },
  // Status labels (used as sr.status_{status})
  'sr.status_submitted':                      { ar: 'طلب جديد', en: 'New Request' },
  'sr.status_offer_sent':                     { ar: 'عرض مُرسَل', en: 'Offer Sent' },
  'sr.status_agreed':                         { ar: 'تم الاتفاق', en: 'Agreed' },
  'sr.status_awaiting_customer_confirmation': { ar: 'بانتظار التأكيد', en: 'Awaiting Confirmation' },
  'sr.status_completed':                      { ar: 'مكتمل', en: 'Completed' },
  'sr.status_rejected':                       { ar: 'مرفوض', en: 'Rejected' },
  'sr.status_not_completed':                  { ar: 'لم يتم الإنجاز', en: 'Not Completed' },
  // Empty states
  'sr.empty_requests':           { ar: 'لا توجد طلبات حتى الآن', en: 'No requests yet' },
  'sr.empty_requests_desc':      { ar: 'طلبات الخدمة التي ترسلها ستظهر هنا', en: 'Service requests you send to offices will appear here' },
  'sr.empty_office_requests':    { ar: 'لا توجد طلبات واردة', en: 'No incoming requests' },
  'sr.empty_office_requests_desc': { ar: 'ستظهر هنا طلبات الخدمة الواردة من العملاء', en: 'Service requests from customers will appear here' },
  // Filter chips (office dashboard)
  'sr.filter_all':        { ar: 'الكل', en: 'All' },
  'sr.filter_submitted':  { ar: 'جديد', en: 'New' },
  'sr.filter_offer_sent': { ar: 'تم إرسال العرض', en: 'Offer Sent' },
  'sr.filter_agreed':     { ar: 'متفق عليه', en: 'Agreed' },
  'sr.filter_awaiting':   { ar: 'بانتظار التأكيد', en: 'Awaiting Confirm' },
  'sr.filter_completed':  { ar: 'مكتمل', en: 'Completed' },
  'sr.filter_rejected':   { ar: 'مرفوض', en: 'Rejected' },
  // Waiting states
  'sr.waiting_customer_response': { ar: 'بانتظار رد العميل على العرض', en: 'Waiting for customer to respond to offer' },
  'sr.waiting_office_response':   { ar: 'بانتظار رد المكتب', en: 'Waiting for office response' },
  'sr.waiting_customer_confirm':  { ar: 'بانتظار تأكيد العميل للإنجاز', en: 'Waiting for customer to confirm completion' },
  // Offer section labels
  'sr.offer_details':   { ar: 'تفاصيل العرض', en: 'Offer Details' },
  'sr.office_label':    { ar: 'المكتب', en: 'Office' },
  // Review form
  'sr.review_title':    { ar: 'تقييم الخدمة', en: 'Evaluate the Service' },
  'sr.review_q1':       { ar: 'هل تم إنجاز الخدمة؟', en: 'Was the service completed?' },
  'sr.review_q2':       { ar: 'هل تنصح الآخرين بالتعامل مع هذا المكتب؟', en: 'Would you recommend this office?' },
  'sr.review_q3':       { ar: 'سرعة الرد (1–5)', en: 'Response Speed (1–5)' },
  'sr.review_submit':   { ar: 'إرسال التقييم', en: 'Submit Evaluation' },
  'sr.reviewed':        { ar: 'تم التقييم ✓', en: 'Reviewed ✓' },
  // Confirmation section (customer view)
  'sr.confirm_question':    { ar: 'هل أنجز المكتب الخدمة؟', en: 'Did the office complete the service?' },
  // Section headings
  'sr.section_heading':   { ar: 'طلبات الخدمات', en: 'Service Requests' },
  'sr.section_desc':      { ar: 'إدارة طلبات الخدمة الواردة من العملاء', en: 'Manage incoming service requests from customers' },
  'sr.my_section_desc':   { ar: 'تتبع الطلبات التي أرسلتها للمكاتب', en: 'Track service requests you have sent to offices' },
  // Errors
  'sr.error_name_required':     { ar: 'اسم الخدمة مطلوب', en: 'Service name is required' },
  'sr.error_desc_required':     { ar: 'الوصف المختصر مطلوب', en: 'Description is required' },
  'sr.error_price_required':    { ar: 'السعر مطلوب', en: 'Price is required' },
  'sr.error_duration_required': { ar: 'مدة التنفيذ مطلوبة', en: 'Execution duration is required' },
  // Metrics (on Quick Display Card — all computed from real service-request data)
  'srm.metrics_title':        { ar: 'أداء الخدمة', en: 'Service Performance' },
  'srm.avg_response_speed':   { ar: 'وقت الاستجابة', en: 'Response Time' },
  'srm.completed_services':   { ar: 'خدمات منجزة', en: 'Completed' },
  'srm.recommend_pct':        { ar: 'يوصون بالمكتب', en: 'Recommend' },
  'srm.no_data':              { ar: 'لا توجد بيانات موثقة بعد', en: 'No verified data yet' },
  // Dashboard nav
  'dash.nav.service_requests': { ar: 'طلبات الخدمة', en: 'Service Requests' },
} as const;

// ── Office Report — Phase 1 translations ─────────────────────────────────────
const reportTranslations = {
  // Period selector
  'report.period_7d':  { ar: 'آخر 7 أيام',  en: 'Last 7 days'  },
  'report.period_30d': { ar: 'آخر 30 يومًا', en: 'Last 30 days' },
  'report.period_90d': { ar: 'آخر 90 يومًا', en: 'Last 90 days' },

  // Date labels
  'report.vs_label': { ar: 'مقارنةً بـ', en: 'vs.' },
  'report.data_note': { ar: 'يتم تحديث البيانات يوميًا', en: 'Data is updated daily.' },

  // Recommendation heading
  'report.rec_heading': { ar: 'أهم فرصة لك الآن', en: 'Your Biggest Opportunity' },

  // Core metrics
  'report.metric_impressions':     { ar: 'ظهور في البحث',         en: 'Search Impressions'    },
  'report.metric_profile_views':   { ar: 'زيارات الملف',          en: 'Profile Views'         },
  'report.metric_unique_visitors': { ar: 'زوار فريدون تقديريًا',  en: 'Est. Unique Visitors'  },
  'report.metric_contact_actions': { ar: 'إجراءات التواصل',       en: 'Contact Actions'       },
  'report.metric_conversion_rate': { ar: 'معدل التحويل',          en: 'Conversion Rate'       },
  'report.metric_whatsapp':        { ar: 'نقرات واتساب',          en: 'WhatsApp Clicks'       },
  'report.metric_phone':           { ar: 'نقرات الهاتف',          en: 'Phone Clicks'          },
  'report.metric_share':           { ar: 'مشاركات',               en: 'Share Actions'         },
  'report.metric_copy_link':       { ar: 'نسخ الرابط',            en: 'Copy Link'             },
  'report.metric_qr_visits':       { ar: 'زيارات QR',             en: 'QR-Origin Visits'      },

  // Tooltips
  'report.tooltip_unique_visitors': {
    ar: 'تقديري: يُحسب بجمع الزوار الفريدين يوميًا. قد يُحسب نفس الزائر أكثر من مرة عبر أيام متعددة.',
    en: 'Estimated by summing daily unique visitors. The same visitor may be counted on more than one day.',
  },

  // Change indicator
  'report.new':      { ar: 'جديد', en: 'New'  },
  'report.vs_prev':  { ar: 'الفترة السابقة', en: 'Previous period' },

  // Trend
  'report.trend_title': { ar: 'الاتجاه اليومي — زيارات الملف', en: 'Daily Trend — Profile Views' },

  // Top signals
  'report.top_signals_heading': { ar: 'أبرز الإشارات',    en: 'Top Signals'     },
  'report.top_service_label':   { ar: 'الخدمة الأكثر طلبًا', en: 'Most Requested Service' },
  'report.top_city_label':      { ar: 'المدينة الأكثر نشاطًا', en: 'Top Active City' },

  // Zero / error states
  'report.zero_title': { ar: 'لا توجد بيانات بعد',  en: 'No data yet'           },
  'report.zero_desc':  {
    ar: 'شارك رابط مكتبك أو رمز QR لبدء استقطاب الزوار وقياس الأداء.',
    en: 'Share your office link or QR code to start attracting visitors and measuring performance.',
  },
  'report.error': { ar: 'تعذّر تحميل التقرير، يرجى المحاولة مجدداً.', en: 'Could not load the report. Please try again.' },
} as const;

// Merge dashboard translations into the main translations object
// (Object.assign at module load time — safe because translations is const)
Object.assign(translations, dashboardTranslations);
Object.assign(translations, serviceRequestTranslations);
Object.assign(translations, reportTranslations);

export type DashTranslationKey = keyof typeof dashboardTranslations;
