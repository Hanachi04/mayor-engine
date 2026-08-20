# فهرس حزمة MaYor Cloud Pro MTF

## التشغيل السحابي

- `.github/workflows/mayor.yml`: تشغيل المسح كل 30 دقيقة وحفظ `tracked.json`.
- `.github/workflows/weekly-report.yml`: تقرير أسبوعي كل جمعة.
- `engine/scan.js`: كود المحرك السحابي الكامل.
- `engine/weekly_report.js`: كود التقرير الأسبوعي.
- `data/tracked.json`: قاعدة البيانات المسطحة للصفقات.

## المراقبة المحلية

- `dashboard/mayor_dashboard.html`: لوحة المراقبة العربية. افتحها في Chrome ثم اختر `data/tracked.json`.
- `dashboard/VERIFICATION.md`: نتيجة فحص الواجهة.

## الوثائق

- `README.md`: دليل التشغيل والحماية والقياس.
- `CLOUD_PRO_SPEC.md`: مواصفات الاستراتيجية وقواعدها.
- `خطة_تطوير_و_تحسين_MaYor.md`: خارطة التطوير السابقة.
- `GOOGLE_SHEET_LINK.md`: خيار Google Sheets المؤجل.

## ملاحظات أمنية

الحزمة لا تحتوي على Bot Token أو GitHub PAT. يجب وضع الأسرار في GitHub Secrets فقط. لا تشارك أي توكن سبق نشره، وقم بتدويره قبل الاستخدام التجاري.
