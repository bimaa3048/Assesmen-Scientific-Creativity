export const metadata = {
  title: 'Assesmen Scientific Creativity',
  description: 'Asesmen Scientific Creativity Fisika berbasis simulasi PhET untuk siswa SMA.',
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
