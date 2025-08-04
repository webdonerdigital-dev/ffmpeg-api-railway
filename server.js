const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Minimal setup - debug için
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Create uploads directory
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Minimal server working' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', memory: process.memoryUsage() });
});

// Enhanced video overlay with options
app.post('/video-overlay', (req, res) => {
  const { 
    backgroundUrl, 
    overlayUrl, 
    frameUrl, // Yeni parametre: frame URL
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
    let currentOutput = '';
    
    // 1. Background ve avatar işleme
    if (avatarOnTop) {
      filter = `[0:v]scale=${targetFormat.width}:${targetFormat.height}[bg];[1:v]scale=${avatarSize}:${avatarSize}[avatar];[bg][avatar]overlay=${overlayPos}[base]`;
      currentOutput = 'base';
    } else {
      const halfHeight = targetFormat.height / 2;
      filter = `[0:v]scale=${targetFormat.width}:${halfHeight}[top];[1:v]scale=${targetFormat.width}:${halfHeight}[bottom];color=black:size=${targetFormat.width}x${targetFormat.height}[bg];[bg][top]overlay=0:0[temp];[temp][bottom]overlay=0:${halfHeight}[base]`;
      currentOutput = 'base';
    }
    
    // 2. Neon border ekleme (isteğe bağlı)
    if (neonBorder) {
      const totalWidth = targetFormat.width + (neonWidth * 2);
      const totalHeight = targetFormat.height + (neonWidth * 2);
      
      // Static neon border
      filter += `;[${currentOutput}]pad=${totalWidth}:${totalHeight}:${neonWidth}:${neonWidth}:color=${neonColor}[with_border]`;
      
      // Add flowing animation effect using geq
      filter += `;color=${neonColor}:size=${totalWidth}x${totalHeight}[neon_bg];` +
        `[neon_bg]geq=` +
        `r='if(lt(X,${neonWidth})+gt(X,${totalWidth-neonWidth})+lt(Y,${neonWidth})+gt(Y,${totalHeight-neonWidth}),` +
        `180+75*sin(2*PI*(T*2+X*0.02+Y*0.02)),40)':` +
        `g='if(lt(X,${neonWidth})+gt(X,${totalWidth-neonWidth})+lt(Y,${neonWidth})+gt(Y,${totalHeight-neonWidth}),` +
        `255,100)':` +
        `b='if(lt(X,${neonWidth})+gt(X,${totalWidth-neonWidth})+lt(Y,${neonWidth})+gt(Y,${totalHeight-neonWidth}),` +
        `200+55*sin(2*PI*(T*2+X*0.02+Y*0.02)+PI/3),180)'` +
        `[neon_animated];` +
        `[with_border][neon_animated]blend=all_mode=lighten[with_neon]`;
      currentOutput = 'with_neon';
    }
    
    // 3. Frame ekleme (isteğe bağlı)
    if (frameUrl) {
      const isPNG = frameUrl.toLowerCase().includes('.png');
      
      // Frame'i işle
      if (isPNG) {
        // PNG için format ve döngü ayarı
        filter += `;[2:v]format=rgba,scale=${targetFormat.width}:${targetFormat.height}[frame]`;
      } else {
        // Video frame için döngü ayarı
        filter += `;[2:v]loop=loop=-1:size=32767:start=0,scale=${targetFormat.width}:${targetFormat.height}[frame]`;
      }
      
      // Frame'i overlay yap
      filter += `;[${currentOutput}][frame]overlay=0:0[output]`;
      currentOutput = 'output';
    }
    
    // FFmpeg için inputları hazırla
    let inputs = `-i "${bgPath}" -i "${overlayPath}"`;
    if (frameUrl) {
      const isPNG = frameUrl.toLowerCase().includes('.png');
      if (isPNG) {
        inputs += ` -ignore_loop 0 -i "${framePath}"`;
      } else {
        inputs += ` -i "${framePath}"`;
      }
    }
    
    // FFmpeg komutunu oluştur
    const ffmpegCmd = `ffmpeg ${inputs} -filter_complex "${filter}" -map "[${currentOutput}]" -c:v libx264 -preset veryfast -crf 30 -map 0:a? -c:a copy -t 10 -y "${outputPath}"`;
    
    console.log('FFmpeg command:', ffmpegCmd);
    
    exec(ffmpegCmd, { timeout: 300000 }, (error, stdout, stderr) => {
      // Cleanup
      try {
        if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
        if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
        if (framePath && fs.existsSync(framePath)) fs.unlinkSync(framePath);
      } catch (e) {}
      
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
          frameUsed: !!frameUrl
        }
      });
    });
  });
});

app.listen(port, () => {
  console.log(`Minimal server on port ${port}`);
  console.log('Memory usage:', process.memoryUsage());
});
