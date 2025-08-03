const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Server working' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', memory: process.memoryUsage() });
});

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

  let downloadCmd = `wget -O "${bgPath}" "${backgroundUrl}" && wget -O "${overlayPath}" "${overlayUrl}"`;
  if (frameUrl) downloadCmd += ` && wget -O "${framePath}" "${frameUrl}"`;
  
  exec(downloadCmd, (downloadError) => {
    if (downloadError) {
      return res.status(500).json({ error: 'Download failed' });
    }

    // Format settings
    const formats = {
      'reels': { width: 1080, height: 1920 },
      'landscape': { width: 1920, height: 1080 },
      'square': { width: 1080, height: 1080 }
    };
    const targetFormat = formats[format] || formats['reels'];

    // Avatar position
    let overlayPos = '';
    switch(avatarPosition) {
      case 'top-left': overlayPos = '20:20'; break;
      case 'top-right': overlayPos = 'W-w-20:20'; break;
      case 'bottom-left': overlayPos = '20:H-h-20'; break;
      case 'bottom-right': overlayPos = 'W-w-20:H-h-20'; break;
      case 'center': overlayPos = '(W-w)/2:(H-h)/2'; break;
      default: overlayPos = 'W-w-20:20';
    }

    // Filtre zincirini oluştur
    let filter = '';
    let currentOutput = 'bg_scaled';
    
    // 1. Background scaling
    filter += `[0:v]scale=${targetFormat.width}:${targetFormat.height}[${currentOutput}];`;
    
    // 2. Avatar scaling ve overlay
    filter += `[1:v]scale=${avatarSize}:${avatarSize}[avatar];`;
    filter += `[${currentOutput}][avatar]overlay=${overlayPos}[${currentOutput}_avatar];`;
    currentOutput += '_avatar';
    
    // 3. Neon border (isteğe bağlı)
    if (neonBorder) {
      const totalWidth = targetFormat.width + (neonWidth * 2);
      const totalHeight = targetFormat.height + (neonWidth * 2);
      
      filter += `[${currentOutput}]pad=${totalWidth}:${totalHeight}:${neonWidth}:${neonWidth}:color=${neonColor}[${currentOutput}_padded];`;
      filter += `color=${neonColor}:size=${totalWidth}x${totalHeight}[neon_bg];`;
      filter += `[neon_bg]geq=`;
      filter += `r='if(lt(X,${neonWidth})+gt(X,${totalWidth-neonWidth})+lt(Y,${neonWidth})+gt(Y,${totalHeight-neonWidth}),`;
      filter += `180+75*sin(2*PI*(T*2+X*0.02+Y*0.02)),40)':`;
      filter += `g='if(lt(X,${neonWidth})+gt(X,${totalWidth-neonWidth})+lt(Y,${neonWidth})+gt(Y,${totalHeight-neonWidth}),`;
      filter += `255,100)':`;
      filter += `b='if(lt(X,${neonWidth})+gt(X,${totalWidth-neonWidth})+lt(Y,${neonWidth})+gt(Y,${totalHeight-neonWidth}),`;
      filter += `200+55*sin(2*PI*(T*2+X*0.02+Y*0.02)+PI/3),180)'`;
      filter += `[neon_animated];`;
      filter += `[${currentOutput}_padded][neon_animated]blend=all_mode=lighten[${currentOutput}_neon];`;
      currentOutput += '_neon';
    }
    
    // 4. Frame overlay (isteğe bağlı)
    if (frameUrl) {
      const isPNG = frameUrl.toLowerCase().includes('.png');
      filter += `[${currentOutput}]${isPNG ? '' : 'setpts=PTS-STARTPTS,'}[final_bg];`;
      filter += `[2:v]${isPNG ? 'format=rgba,' : ''}scale=${targetFormat.width}:${targetFormat.height}[frame];`;
      filter += `[final_bg][frame]overlay=0:0:shortest=1[video_final]`;
    } else {
      filter += `[${currentOutput}]null[video_final]`;
    }

    // APNG için özel parametreler
    const apngOptions = frameUrl && frameUrl.toLowerCase().includes('.png') 
      ? `-ignore_loop 0` 
      : '';

    const inputs = `-i "${bgPath}" -i "${overlayPath}" ${frameUrl ? `${apngOptions} -i "${framePath}"` : ''}`;
    
    // Ses işleme - ilk videodan sesi al
    const audioMap = `-map 0:a? -c:a copy`;
    
    const ffmpegCmd = `ffmpeg ${inputs} -filter_complex "${filter}" ` +
      `-map "[video_final]" ${audioMap} ` +
      `-c:v libx264 -preset ultrafast -crf 28 -t 30 -threads 0 -y "${outputPath}"`;

    console.log('FFmpeg command:', ffmpegCmd);

    exec(ffmpegCmd, { timeout: 600000 }, (error, stdout, stderr) => {
      // Cleanup
      [bgPath, overlayPath, framePath].forEach(path => {
        if (path && fs.existsSync(path)) fs.unlinkSync(path);
      });

      if (error) {
        console.error('FFmpeg error:', stderr);
        return res.status(500).json({ 
          error: 'Processing failed', 
          details: stderr,
          command: ffmpegCmd // Hata ayıklama için komutu da döndür
        });
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
          frameUsed: !!frameUrl
        }
      });
    });
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
