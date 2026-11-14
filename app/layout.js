export const metadata = {
  title: 'Creative Thinking Skills',
  description: 'Creative Thinking Skills untuk Fisika berbasis simulasi PhET bagi siswa SMA.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <meta name="theme-color" content="#102c38" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
