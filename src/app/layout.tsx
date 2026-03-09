import type { Metadata } from 'next';
import Providers from './components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Parser App - Мониторинг объявлений',
  description: 'Автоматизированный поиск объявлений на сайтах закупок',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
