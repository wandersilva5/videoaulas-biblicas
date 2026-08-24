;(async () => {
  console.log('=== Starting automatic migration ===');
  
  const OUTPUT_DIR = join('output');
  const studies = await readdir(OUTPUT_DIR);
  const studyDirs = studies.filter((f) => {
    const fullPath = join(OUTPUT_DIR, f);
    try {
      const st = await stat(fullPath);
      return st.isDirectory();
    } catch { return false; }
  });

  for (const slug of studyDirs) {
    const studyPath = join(OUTPUT_DIR, slug);
    const imagensDir = join(studyPath, 'imagens');
    const audiosDir = join(studyPath, 'audios');
    const videosDir = join(studyPath, 'videos');
    
    // Check if already migrated
    const imgExists = await existsSync(imagensDir);
    const audioExists = await existsSync(audiosDir);
    const videoExists = await existsSync(videosDir);
    if (imgExists && audioExists && videoExists) {
      console.log(`[migr] Estudo "$slug" já migrado — pulando.`);
      continue;
    }
    
    console.log(`[migr] Migrando estudo: $slug`);
    await mkdir(imagensDir, { recursive: true });
    await mkdir(audiosDir, { recursive: true });
    await mkdir(videosDir, { recursive: true });
    
    const files = await readdir(studyPath);
    for (const f of files) {
      const fullPath = join(studyPath, f);
      const statResult = await stat(fullPath);
      if (!statResult.isFile()) continue;
      
      const basename = f;
      
      // slide-*.png -> imagens/
      if (/^slide-\d{2}\.png$/.test(basename)) {
        await rename(fullPath, join(imagensDir, basename));
        console.log(`[migr] Movido: $basename -> imagens/`);
      }
      // *-narracao.mp3 -> audios/
      else if (/-narracao\.mp3$/.test(basename)) {
        await rename(fullPath, join(audiosDir, basename));
        console.log(`[migr] Movido: $basename -> audios/`);
      }
      // *-questionario-*.mp3 or questionario-narracao-full.mp3 -> audios/
      else if (/-questionario-.+\\.mp3$/.test(basename) || /questionario-narracao-full\.mp3/.test(basename)) {
        await rename(fullPath, join(audiosDir, basename));
        console.log(`[migr] Movido: $basename -> audios/`);
      }
      // *.mp4 -> videos/
      else if (/.+\.mp4$/.test(basename)) {
        await rename(fullPath, join(videosDir, basename));
        console.log(`[migr] Movido: $basename -> videos/`);
      }
      // Keep roteiro-short.json, manifesto.json, material.txt, fonte.pdf in root
      else {
        console.log(`[migr] Mantido na raiz: $basename`);
      }
    }
    console.log(`[migr] Migração de "$slug" concluída.`);
  }
  
  console.log('=== Migration completed ===');
})();