# Messenger Web Tester — Meta Messenger API

เว็บทดสอบส่งข้อความ Facebook Messenger แบบมี Backend โดยเก็บ Page Access Token ฝั่งเซิร์ฟเวอร์และเข้ารหัสก่อนบันทึกลง `data/settings.enc.json`

## สิ่งที่มี
- หน้าแรกตามดีไซน์เดิม
- ส่งข้อความจริงผ่าน Meta Messenger Send API ไปยัง PSID ทีละข้อความ
- หน้า Settings สำหรับ Page ID / Page Access Token / Webhook Verify Token / Admin Key
- Webhook `GET /webhook` สำหรับ Meta verification
- Webhook `POST /webhook` สำหรับรับ event และเก็บ log แบบไม่เปิด token
- Dockerfile + `render.yaml` สำหรับ deploy ขึ้น Render
- Admin Key ป้องกัน API ที่เกี่ยวกับ token

## ก่อนเริ่ม
ต้องมี Facebook Page และ Meta App ที่เปิด Messenger Platform และมีสิทธิ์ที่จำเป็นสำหรับการส่งข้อความ เช่น `pages_messaging` ตามข้อกำหนดของ Meta

การส่งข้อความด้วย Send API ใช้ Page ID + Page Access Token และผู้รับเป็น Page-scoped ID (PSID) โดยข้อกำหนดของ Meta เรื่องหน้าต่างการรับข้อความ/การยินยอมยังมีผลกับผู้รับแต่ละราย

## รันบนเครื่อง

```bash
cp .env.example .env
```

ตั้งค่าอย่างน้อย:

- `ADMIN_KEY` = รหัสยาวสุ่มสำหรับเข้าหน้า Settings/API
- `MASTER_KEY` = secret ยาวสุ่มสำหรับเข้ารหัส token ที่เก็บบน disk
- `GRAPH_API_VERSION` = เวอร์ชัน Graph API ที่คุณต้องการใช้

จากนั้น:

```bash
npm install
npm start
```

เปิด `http://localhost:3000`

## ตั้งค่า Messenger

1. สร้าง Meta App และเพิ่ม Messenger Platform
2. เชื่อม Facebook Page ของคุณกับ App
3. สร้าง Page Access Token ที่มีสิทธิ์เหมาะสม
4. เปิดหน้า Settings ของเว็บ
5. ใส่ Page ID, Page Access Token และ Verify Token
6. ใส่ `ADMIN_KEY` ที่ตรงกับค่าใน server `.env`
7. คัดลอก Webhook URL ที่หน้า Settings แสดง เช่น `https://YOUR-DOMAIN/webhook`
8. นำ Callback URL + Verify Token ไปตั้งค่า Webhooks ใน Meta และ subscribe event ที่ต้องการ เช่น messages
9. ทดสอบด้วย PSID ของผู้ใช้ที่มีสิทธิ์/เป็นไปตามข้อกำหนดการรับข้อความของ Meta

## Deploy บน Render

ไฟล์ `render.yaml` ถูกเตรียมไว้แล้ว

1. Push โฟลเดอร์นี้ขึ้น GitHub
2. ใน Render เลือก New → Blueprint แล้วเลือก repository
3. ตั้ง `ADMIN_KEY` เป็นค่า random ยาวๆ
4. ตั้ง `MASTER_KEY` เป็นค่า random ยาวๆ และอย่าเปลี่ยนหลังจากมี token ถูกบันทึกแล้ว เว้นแต่คุณจะตั้งค่าการเชื่อมต่อใหม่
5. Deploy
6. ใช้ URL ที่ Render ให้มาเปิดเว็บ
7. ตั้ง Webhook URL เป็น `https://YOUR-RENDER-DOMAIN/webhook`

> หมายเหตุ: Render Free instance อาจมีข้อจำกัด/หยุดพักตามแผนบริการ และ filesystem แบบ local ไม่เหมาะกับการเก็บข้อมูลสำคัญระยะยาว หากใช้จริงควรย้าย secret storage ไป secret manager/managed database

## ความปลอดภัย
- ไม่ส่ง Page Access Token กลับไปที่ browser
- Token ถูกเข้ารหัสด้วย AES-256-GCM ก่อนเก็บในไฟล์
- API ที่แตะ token ต้องใช้ `x-admin-key`
- อย่า commit `.env` หรือ `data/settings.enc.json`
- ใช้ HTTPS เมื่อ deploy จริง
- เปลี่ยน `ADMIN_KEY` และ `MASTER_KEY` จากค่าใน `.env.example`

## หมายเหตุเกี่ยวกับการส่งจำนวนมาก
หน้าเว็บเวอร์ชันนี้ออกแบบเป็น **real send แบบทีละข้อความสำหรับทดสอบ** ไม่ได้เปิดปุ่มยิงซ้ำจำนวนมากแบบ 50 ครั้ง/0.1 วินาทีจาก mock เดิม เพราะการส่งข้อความต้องอยู่ภายใต้ข้อกำหนดของ Meta และสิทธิ์/หน้าต่างการรับข้อความของผู้รับ การทำ bulk messaging โดยไม่มี consent อาจทำให้ข้อความถูกปฏิเสธหรือกระทบการใช้งาน Page
