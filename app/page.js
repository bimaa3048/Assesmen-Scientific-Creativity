import Script from 'next/script';

export default function HomePage() {
  return (
    <>
      <div id="app" aria-live="polite">
        <div className="loading-screen"><div className="loader" /><p>Menyiapkan ruang asesmen…</p></div>
      </div>
      <div id="toast-region" className="toast-region" aria-live="assertive" />
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
