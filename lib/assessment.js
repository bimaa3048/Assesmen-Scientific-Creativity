const questions = [
  {
    id: 'q1',
    indicator: 'Fluency (Kelancaran)',
    title: 'Menemukan variasi rangkaian',
    prompt: 'Gunakan 1 baterai 9 V dan 3 lampu identik untuk menemukan berbagai konfigurasi rangkaian berbeda agar ketiga lampu menyala bersamaan. Untuk setiap konfigurasi, sertakan sketsa/diagram, klasifikasi (seri, paralel, atau campuran), arus total dari baterai, tingkat kecerahan tiap lampu, dan bukti screenshot jika tersedia.',
    fields: [
      { key: 'configurations', label: 'Konfigurasi rangkaian (sketsa, klasifikasi, arus total, dan kecerahan tiap lampu)', type: 'textarea' },
      { key: 'measurements', label: 'Data pengukuran tambahan', type: 'textarea' },
    ],
    rubric: [
      '4 — Empat konfigurasi berbeda berfungsi dan benar; sketsa, data arus, kecerahan, serta bukti lengkap.',
      '3 — Tiga konfigurasi berfungsi dengan data pendukung.',
      '2 — Satu–dua konfigurasi berfungsi, atau beberapa data/sketsa terlewat.',
      '1 — Rangkaian dicoba tetapi sebagian besar tidak berfungsi atau korsleting.',
      '0 — Tidak menjawab.',
    ],
  },
  {
    id: 'q2',
    indicator: 'Flexibility (Keluwesan)',
    title: 'Membandingkan seri dan paralel',
    prompt: 'Buat Rangkaian A: 2 lampu seri dengan baterai 9 V; dan Rangkaian B: 2 lampu paralel dengan baterai 9 V. Jelaskan mengapa lampu pada rangkaian paralel tampak lebih terang menggunakan sedikitnya dua pendekatan konsep yang berbeda dari hambatan total, distribusi tegangan, atau kuat arus. Untuk setiap pendekatan, tuliskan nama, data ukur PhET (voltmeter/amperemeter), penalaran fisika, dan persamaan matematis yang mendukung.',
    fields: [
      { key: 'approaches', label: 'Pendekatan konsep, penjelasan, dan persamaan', type: 'textarea' },
      { key: 'measurements', label: 'Data ukur rangkaian A dan B', type: 'textarea' },
    ],
    rubric: [
      '4 — Sedikitnya dua pendekatan yang benar-benar berbeda, tepat dan logis, didukung data ukur.',
      '3 — Dua pendekatan berbeda, tetapi salah satu penjelasan/data kurang lengkap atau kurang tepat.',
      '2 — Hanya satu pendekatan benar, atau dua penjelasan berasal dari kategori konsep yang sama.',
      '1 — Penjelasan tidak tepat secara prinsip kelistrikan dasar.',
      '0 — Tidak menjawab.',
    ],
  },
  {
    id: 'q3',
    indicator: 'Originality (Keaslian)',
    title: 'Merancang pencahayaan pintar',
    prompt: 'Rancang sistem pencahayaan lorong dengan satu baterai, satu lampu utama, beberapa sakelar, dan resistor/lampu tambahan sebagai hambatan. Buat minimal tiga tingkat kecerahan (terang, sedang, redup) yang dipilih dengan membuka/menutup sakelar. Sertakan sketsa/diagram, aturan kombinasi sakelar untuk tiap tingkat dan penjelasan fisikanya, bukti pengujian (screenshot tiap tingkat jika tersedia), serta hal yang membuat rancangan unik.',
    fields: [
      { key: 'design', label: 'Sketsa/diagram rancangan', type: 'textarea' },
      { key: 'switchRules', label: 'Aturan sakelar dan penjelasan tiga tingkat kecerahan', type: 'textarea' },
      { key: 'uniqueness', label: 'Keunikan dan kreativitas rancangan', type: 'textarea' },
    ],
    rubric: [
      '4 — Rancangan unik/inovatif, tiga tingkat terbukti berfungsi di PhET, logika dijelaskan sangat jelas.',
      '3 — Rancangan cukup unik dan berfungsi, tetapi penjelasan logika sakelar kurang jelas.',
      '2 — Rancangan terlalu standar/sederhana, tetapi konsep fisika benar.',
      '1 — Rancangan inovatif dicoba tetapi tidak berfungsi atau korsleting.',
      '0 — Tidak memberikan rancangan.',
    ],
  },
  {
    id: 'q4',
    indicator: 'Elaboration (Elaborasi)',
    title: 'Menyelidiki penambahan lampu seri',
    prompt: 'Investigasi pengaruh jumlah lampu seri dari 1 sampai 5 terhadap arus total dan tegangan pada salah satu lampu. Buat tabel hasil ukur untuk tiap jumlah lampu, grafik jumlah lampu (sumbu-X) terhadap arus total (sumbu-Y), analisis tren dengan mengaitkan hambatan ekuivalen, dan kesimpulan berdasarkan data. Jangan mengarang data pengukuran.',
    fields: [
      { key: 'dataTable', label: 'Tabel hasil ukur: jumlah lampu | arus total (A) | tegangan satu lampu (V)', type: 'textarea' },
      { key: 'graph', label: 'Catatan grafik (opsional; grafik dibuat otomatis dari tabel)', type: 'textarea' },
      { key: 'analysis', label: 'Analisis tren dan kaitan dengan hambatan ekuivalen', type: 'textarea' },
      { key: 'conclusion', label: 'Kesimpulan berdasarkan hasil', type: 'textarea' },
    ],
    rubric: [
      '4 — Tabel 1–5 lampu lengkap, grafik tepat, analisis dan kesimpulan mendalam mengaitkan data dengan hambatan seri.',
      '3 — Eksperimen lengkap dengan tabel dan grafik baik; analisis hambatan ekuivalen kurang mendalam.',
      '2 — Data tidak lengkap, tanpa grafik, atau analisis tidak menjelaskan konsep inti.',
      '1 — Hanya penjelasan singkat tanpa data dan grafik.',
      '0 — Tidak menjawab.',
    ],
  },
];


export const assessment = {
  id: 'scientific-creativity-electric-circuits',
  title: 'Pengembangan Instrumen Asesmen Scientific Creativity Berbasis Simulasi PhET pada Materi Rangkaian Listrik Dasar untuk Siswa SMA',
  subject: 'Fisika',
  material: 'Rangkaian listrik dasar: seri, paralel, dan campuran',
  audience: 'Siswa Sekolah Menengah Atas (SMA)',
  durationMinutes: 60,
  maximumScore: 16,
  simulationUrl: 'https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc',
  simulationEmbedUrl: 'https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_en.html',
  questions,
};

export { questions };
