import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'مرکز مدیریت حامین',
  description: 'مدیریت یکپارچه ربات‌ها، گفتگوها و آزمون‌های حامین',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
