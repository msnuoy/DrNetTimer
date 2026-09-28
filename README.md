# DrNetTimer ⏳

ربات Inline تلگرام برای شمارش معکوس زنده داخل خود پیام، روی یک Cloudflare Worker.
بدون دیتابیس خارجی و بدون VPS.

```
@DrNetTimer 3d 🚀 نسخه جدید Dr.Net
```

<div dir="rtl">

**🚀 نسخه جدید Dr.Net**

⏳ 02 روز 14 ساعت 32 دقیقه 08 ثانیه

</div>

## نحوهٔ کار

```
Telegram ──webhook──▶ Worker
  inline_query          → پاسخ فوری داخل همان پاسخ webhook (بدون loading)
  chosen_inline_result  → inline_message_id → Durable Object «Countdown»
  callback_query        → نمایش زمان دقیق تا ثانیه (بدون state)
Countdown (یک DO برای هر پیام) ── alarm هر TICK ثانیه ──▶ editMessageText
```

- زمان هدف داخل `result_id` و `callback_data` ذخیره می‌شود، پس Worker هیچ state‌ای ندارد.
- هر پیام ارسال‌شده یک Durable Object کوچک (SQLite، روی پلن رایگان هم هست) دارد.
  این DO با alarm پیام را ویرایش می‌کند و بعد از پایان زمان خودش پاک می‌شود.
- ویرایش‌ها طوری تنظیم می‌شوند که ثانیه‌ها مضرب TICK باشند (…۵۰، ۴۰، ۳۰). پس شمارش مرتب کم می‌شود.
- اگر تلگرام خطای 429 بدهد، ربات به اندازهٔ `retry_after` صبر می‌کند و فاصلهٔ ویرایش‌ها را بیشتر می‌کند.
  اگر پیام پاک شود، شمارش متوقف می‌شود.

## راه‌اندازی

1. در [@BotFather](https://t.me/BotFather):
   - `/newbot` و گرفتن توکن. username ربات باید به `bot` ختم شود (مثلاً `DrNetTimerBot`).
     همان را بدون @ در `BOT_USERNAME` داخل `wrangler.toml` بگذارید.
   - `/setinline` برای روشن کردن Inline Mode (placeholder مثلاً: `3d عنوان`)
   - `/setinlinefeedback` و انتخاب **Enabled**. **ضروری است**، وگرنه `inline_message_id` نمی‌رسد و پیام زنده نمی‌شود.
2. دیپلوی (نیازمند Node.js نسخهٔ ۲۲ یا بالاتر و یک حساب رایگان Cloudflare):
   ```bash
   npm install
   npx wrangler login
   npx wrangler deploy                      # آدرس Worker را چاپ می‌کند
   npx wrangler secret put BOT_TOKEN        # توکن BotFather
   npx wrangler secret put WEBHOOK_SECRET   # رشتهٔ تصادفی (فقط A-Z a-z 0-9 _ -)، مثل: openssl rand -hex 32
   ```
3. یک بار این آدرس را باز کنید تا webhook ثبت شود:
   `https://drnettimer.<subdomain>.workers.dev/setup?key=<WEBHOOK_SECRET>`
4. (پیشنهادی) به ربات `/start` بدهید، شناسهٔ عددی خود را بردارید و در `ALLOWED_USERS` بگذارید.
   بعد دوباره `npx wrangler deploy` کنید.

## فرمت ورودی

| نوع | مثال |
|---|---|
| مدت (`w d h m s`) | `3d` · `2h30m` · `1w2d` · `90s` |
| ساعت (امروز، یا فردا اگر گذشته باشد) | `18:30` |
| تاریخ شمسی یا میلادی (ساعت اختیاری) | `1405/07/10 18:30` · `2026-10-02 18:30` |

اعداد فارسی هم قبول می‌شوند. هر چه بعد از زمان بیاید عنوان پیام است.

## تنظیمات (`wrangler.toml` → `[vars]`)

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `TICK` | `10` | فاصلهٔ ویرایش هر پیام (ثانیه) |
| `TZ_OFFSET` | `+03:30` | منطقهٔ زمانی برای ورودی ساعت و تاریخ |
| `ALLOWED_USERS` | خالی | شناسه‌هایی که اجازهٔ ساخت شمارش دارند (با کاما). خالی یعنی همه |
| `BOT_USERNAME` | `DrNetTimer` | فقط برای متن راهنما |

## محدودیت‌ها

- تلگرام خودش متن پیام را زنده نمی‌کند و ویرایش ثانیه‌به‌ثانیه هم به flood limit می‌خورد.
  برای همین پیام هر `TICK` ثانیه ویرایش می‌شود و دکمهٔ «⏱ زمان دقیق» زمان را تا ثانیه نشان می‌دهد.
- هزینه: هر شمارش فعال با `TICK=10` روزانه حدود ۸٬۶۴۰ درخواست Durable Object مصرف می‌کند.
  سقف پلن رایگان ۱۰۰٬۰۰۰ درخواست در روز است، یعنی حدود ۱۰ شمارش همزمان.
  با `TICK=30` حدود ۳۰ شمارش ممکن است. برای بیشتر، پلن ۵ دلاری Workers کافی است.

## توسعه

```bash
npm test          # تست‌های منطق زمان (node --test)
npx wrangler dev  # اجرای محلی؛ TG_API را می‌شود به یک mock از Bot API اشاره داد
```
