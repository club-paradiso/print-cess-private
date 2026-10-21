import type { SupportedLocale } from "@print-cess/i18n";

export type DropFlowCopy = {
  stepPick: string;
  stepHandOver: string;
  stepReceived: string;
  moreWays: string;
};

const COPY: Record<SupportedLocale, DropFlowCopy> = {
  en: {
    stepPick: "Pick files",
    stepHandOver: "Hand over",
    stepReceived: "Received",
    moreWays: "Can't scan the QR? Use numbers and a shape",
  },
  ko: {
    stepPick: "파일 고르기",
    stepHandOver: "건네기",
    stepReceived: "받음 확인",
    moreWays: "QR을 찍을 수 없나요? 숫자와 도형으로 건네기",
  },
  "zh-CN": {
    stepPick: "选择文件",
    stepHandOver: "交给对方",
    stepReceived: "确认收到",
    moreWays: "无法扫描二维码？改用数字和图形",
  },
  id: {
    stepPick: "Pilih file",
    stepHandOver: "Serahkan",
    stepReceived: "Diterima",
    moreWays: "Tidak bisa memindai QR? Pakai angka dan bentuk",
  },
  fil: {
    stepPick: "Pumili ng file",
    stepHandOver: "Iabot",
    stepReceived: "Natanggap",
    moreWays: "Hindi ma-scan ang QR? Gumamit ng numero at hugis",
  },
  vi: {
    stepPick: "Chọn tệp",
    stepHandOver: "Trao tệp",
    stepReceived: "Đã nhận",
    moreWays: "Không quét được QR? Dùng số và hình",
  },
  th: {
    stepPick: "เลือกไฟล์",
    stepHandOver: "ส่งต่อ",
    stepReceived: "ได้รับแล้ว",
    moreWays: "สแกนคิวอาร์ไม่ได้? ใช้ตัวเลขและรูปทรง",
  },
  ne: {
    stepPick: "फाइल छान्नुहोस्",
    stepHandOver: "हस्तान्तरण",
    stepReceived: "प्राप्त भयो",
    moreWays: "QR स्क्यान गर्न सकिँदैन? अंक र आकार प्रयोग गर्नुहोस्",
  },
  km: {
    stepPick: "ជ្រើសឯកសារ",
    stepHandOver: "ប្រគល់",
    stepReceived: "បានទទួល",
    moreWays: "ស្កេន QR មិនបាន? ប្រើលេខ និងរូបរាង",
  },
  ar: {
    stepPick: "اختر الملفات",
    stepHandOver: "التسليم",
    stepReceived: "تم الاستلام",
    moreWays: "لا يمكنك مسح رمز QR؟ استخدم الأرقام والشكل",
  },
  ru: {
    stepPick: "Выбор файлов",
    stepHandOver: "Передача",
    stepReceived: "Получено",
    moreWays: "Не получается отсканировать QR? Используйте цифры и фигуру",
  },
  mn: {
    stepPick: "Файл сонгох",
    stepHandOver: "Хүлээлгэх",
    stepReceived: "Хүлээн авсан",
    moreWays: "QR уншуулж чадахгүй байна уу? Тоо ба дүрс ашиглана уу",
  },
  uk: {
    stepPick: "Вибір файлів",
    stepHandOver: "Передача",
    stepReceived: "Отримано",
    moreWays: "Не вдається відсканувати QR? Використайте цифри й фігуру",
  },
};

export function dropFlowCopy(locale: SupportedLocale): DropFlowCopy {
  return COPY[locale];
}
