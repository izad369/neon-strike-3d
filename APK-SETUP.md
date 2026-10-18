> ✅ **وضعیت (v4.0):** هر سه فیکس این سند حالا خودم روی APK اعمال و منتشر شده — [`DesertStrike3D-Local-v4.0.apk`](https://github.com/izad369/neon-strike-3d/releases/download/v4.0-local/DesertStrike3D-Local-v4.0.apk). این سند فقط به‌عنوان مرجع فنی می‌ماند.

# راهنمای ساخت درست APK (نسخهٔ اندروید بازی Desert Strike 3D)

این سند سه مشکلی که توی APK فعلی دیده شده رو ریشه‌ای حل می‌کنه:

1. اسکن QR می‌گه «Access Denied» بدون اینکه اصلاً پاپ‌آپ مجوز بیاد
2. یوزرنیم و تنظیمات بعد از بستن اپ ذخیره نمی‌مونه
3. (توصیهٔ مهم) صفحهٔ بازی بهتره از لینک https لود بشه نه فایل لوکال

ریشهٔ هر سه مشکل **تنظیمات WebView داخل پروژهٔ اندروید** است، نه خود بازی.
بازی سمت سرور هم آپدیت شده (v3.10) تا در بدترین حالت هم پیام درست بده و
با fallback کار کنه، ولی فیکس اصلی اینجاست:

---

## ۱) مجوز دوربین (فیکس اسکن QR)

WebView به‌صورت پیش‌فرض **هیچ مجوزی به صفحه نمی‌ده** — حتی اگر
`android.permission.CAMERA` در منیفست باشد. باید هر دو لایه فعال بشه:

### الف) منیفست — `AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.CAMERA"/>
```

### ب) درخواست مجوز رانتایم (اندروید ۶ به بالا) — داخل Activity

```kotlin
private val CAM_REQ = 4001

override fun onCreate(savedInstanceState: Bundle?) {
    // ...
    ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.CAMERA), CAM_REQ)
}

override fun onRequestPermissionsResult(code: Int, perms: Array<String>, results: IntArray) {
    super.onRequestPermissionsResult(code, perms, results)
    // بعد از تأیید کاربر، WebView اجازهٔ دوربین را در درخواست بعدی می‌گیرد
}
```

### ج) مهم‌ترین بخش — جواب‌دادن به درخواست مجوزِ خود صفحه

بازی با `getUserMedia` از WebView دوربین می‌خواهد؛ اگر این callback پیاده
نشه، درخواست **بدون هیچ پاپ‌آپی رد می‌شه** (همان «Access Denied» که می‌دید):

```kotlin
webView.webChromeClient = object : WebChromeClient() {
    override fun onPermissionRequest(request: PermissionRequest) {
        runOnUiThread {
            request.grant(request.resources) // دوربین را به صفحه می‌دهد
        }
    }
}
```

اگر می‌خواهید سخت‌گیرتر باشید، فقط دوربین را بدهید:

```kotlin
override fun onPermissionRequest(request: PermissionRequest) {
    val onlyCamera = request.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
    if (onlyCamera.isNotEmpty()) runOnUiThread { request.grant(onlyCamera.toTypedArray()) }
    else request.deny()
}
```

---

## ۲) ذخیرهٔ یوزرنیم و تنظیمات (DOM Storage)

اگر `domStorageEnabled` روشن نباشد، `localStorage` بی‌صدا کار نمی‌کند و
اسم پلیر بعد از بستن اپ می‌پرد. بازی از v3.10 حتی وقتی localStorage کار
نکند از cookie و رکورد Career هم نام را برمی‌گرداند، ولی فیکس اصلی:

```kotlin
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true      // ← localStorage
webView.settings.databaseEnabled = true        // ← IndexedDB (آمار Career)
```

نکته: دکمهٔ Back اندروید و چرخش صفحه هم بهتره به WebView سپرده بشه تا
state از دست نره:

```kotlin
override fun onBackPressed() {
    if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
}
```

---

## ۳) لود بازی از https (نه file://)

`getUserMedia` (دوربین) فقط در **Secure Context** کار می‌کند. صفحهٔ
`file://` secure محسوب نمی‌شود، پس دوربین حتی با مجوز هم بسته می‌ماند.
دو راه درست:

### راه اول (ساده‌تر و توصیه‌شده) — لود از سرور:

```kotlin
webView.loadUrl("https://neon-strike-3d.rezaei-reza1092.workers.dev/")
```

مزیت: بازی همیشه آخرین نسخه است (v3.10+)، آفلاین هم سرویس‌ورکر صفحات
پایه را کش می‌کند، و localStorage بین وب و APK یکی می‌ماند.

### راه دوم (آفلاین کامل) — WebViewAssetLoader:

اگر می‌خواهید HTML داخل APK باشد، فایل را از `assets/` با دامنهٔ مجازی
https سرو کنید تا secure context بماند:

```kotlin
val assetLoader = WebViewAssetLoader.Builder()
    .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
    .build()

webView.webViewClient = object : WebViewClientCompat() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        assetLoader.shouldInterceptRequest(request.url)
}
webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
```

(کلاس‌ها از `androidx.webkit:webkit:1.x` هستند.)

---

## ۴) نکتهٔ شبکهٔ ایران + میرور

- دامنهٔ `workers.dev` در ایران فیلتر است. تا وقتی دامنهٔ اختصاصی به Worker
  وصل نشده، APK/مرورگر می‌تواند بازی را از میرور گیت‌هاب باز کند و فقط
  سیگنالینگ را با پارامتر `?signal=` به یک آدرس باز هدایت کند:

```
https://izad369.github.io/neon-strike-3d/?signal=https://<آدرس-باز-ورکر>
```

- این تنظیم یک بار در localStorage ذخیره می‌شود و بعدی لازم نیست.
- وقتی دامنهٔ اختصاصی وصل شد دیگر هیچ تنظیمی لازم نیست؛ همه‌چیز same-origin است.

---

## ۵) چک‌لیست نهایی قبل از خروجی گرفتن APK

- [ ] `INTERNET` + `CAMERA` در منیفست
- [ ] درخواست رانتایمِ CAMERA در Activity
- [ ] `onPermissionRequest` در WebChromeClient → `request.grant(...)`
- [ ] `domStorageEnabled = true` و `databaseEnabled = true`
- [ ] `javaScriptEnabled = true`
- [ ] لود از https (سرور یا WebViewAssetLoader)
- [ ] تست: اسکن QR لِن بدون پیام خطا + اسم پلیر بعد از ری‌استارت اپ باقی بماند
