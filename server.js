app.post('/video-overlay', (req, res) => {
  const { 
    backgroundUrl, 
    overlayUrl, 
    frameUrl,
    format = 'reels',
    avatarOnTop = true,
    avatarPosition = 'bottom-right',
    avatarSize = 200,
    neonBorder = false,
    neonColor = '#00FF00',
    neonWidth = 5
  } = req.body;

  if (!backgroundUrl || !overlayUrl) {
    return res.status(400).json({ error: 'URLs required' });
  }

  const bgPath = `uploads/bg-${Date.now()}.mp4`;
  const overlayPath = `uploads/overlay-${Date.now()}.mp4`;
  const framePath = frameUrl ? `uploads/frame-${Date.now()}.${frameUrl.includes('.png') ? 'png' : 'mp4'}` : null;
  const outputPath = `uploads/output-${Date.now()}.mp4`;

  // İndirme komutunu güncelle
  let downloadCmd = `wget -O "${bgPath}" "${backgroundUrl}" && wget -O "${overlayPath}" "${overlayUrl}"`;
  if (frameUrl) {
    downloadCmd += ` && wget -O "${framePath}" "${frameUrl}"`;
  }
  
  exec(downloadCmd, (downloadError) => {
    if (downloadError) {
      return res.status(500).json({ error: 'Download failed' });
    }

    const formats = {
      'reels': { width: 1080, height: 1920 },
      'landscape': { width: 1920, height: 1080 },
      'square': { width: 1080, height: 1080 }
    };
    const targetFormat = formats[format] || formats['reels'];

    let overlayPos = '';
    switch(avatarPosition) {
      case 'top-left': overlayPos = '20:20'; break;
      case 'top-right': overlayPos = 'W-w-20:20'; break;
      case 'bottom-left': overlayPos = '20:H-h-20'; break;
      case 'bottom-right': overlayPos = 'W-w-20:H-h-20'; break;
      case 'center': overlayPos = '(W-w)/2:(H-h)/2'; break;
      default: overlayPos = 'W-w-20:20';
    }

    let filter = '';
    let inputCount = 2;
    
    if (avatarOnTop) {
      filter = `[0:v]scale=${targetFormat.width}:${targetFormat.height}[bg];`;
      filter += `[1:v]scale=${avatarSize}:${avatarSize}[avatar];`;
      filter += `[bg][avatar]overlay=${overlayPos}[combined]`;
      
      // Animasyonlu PNG desteği
      if (frameUrl) {
        // APNG için özel işleme
        if (frameUrl.toLowerCase().endsWith('.png')) {
          filter += `;[2:v]format=rgba,scale=${targetFormat.width}:${targetFormat.height}[frame]`;
          filter += `;[combined][frame]overlay=0:0:shortest=1[video_final]`;
        } 
        // Video frame için
        else {
          filter += `;[2:v]scale=${targetFormat.width}:${targetFormat.height}[frame]`;
          filter += `;[combined][frame]overlay=0:0:shortest=1[video_final]`;
        }
        inputCount = 3;
      } else {
        filter += `;[combined]null[video_final]`;
      }
    } else {
      // Diğer senaryolar...
    }

    // APNG için özel parametreler
    const apngOptions = frameUrl && frameUrl.toLowerCase().endsWith('.png') 
      ? `-ignore_loop 0` // Sonsuz döngü
      : '';

    const inputs = `-i "${bgPath}" -i "${overlayPath}" ${frameUrl ? `${apngOptions} -i "${framePath}"` : ''}`;
    
    const ffmpegCmd = `ffmpeg ${inputs} -filter_complex "${filter}" ` +
      `-c:v libx264 -preset veryfast -crf 30 -map 0:a? -c:a copy -t 10 -y "${outputPath}"`;

    console.log('FFmpeg command:', ffmpegCmd);

    exec(ffmpegCmd, { timeout: 600000 }, (error, stdout, stderr) => {
      // Temizlik
      [bgPath, overlayPath, framePath].forEach(path => {
        if (path && fs.existsSync(path)) fs.unlinkSync(path);
      });

      if (error) {
        console.error('FFmpeg error:', stderr);
        return res.status(500).json({ error: 'Processing failed', details: stderr });
      }

      const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
      res.json({ 
        success: true, 
        outputUrl, 
        settings: { 
          format, 
          avatarOnTop, 
          avatarPosition, 
          avatarSize, 
          neonBorder, 
          frameUsed: !!frameUrl,
          frameType: frameUrl ? (frameUrl.toLowerCase().endsWith('.png') ? 'APNG' : 'Video') : 'None'
        }
      });
    });
  });
});
