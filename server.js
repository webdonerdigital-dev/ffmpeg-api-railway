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
  const outputPath = `uploads/output-${Date.now()}.mp4`;

  const downloadCmd = `wget -O "${bgPath}" "${backgroundUrl}" && wget -O "${overlayPath}" "${overlayUrl}"`;
  
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

    let filter = '';
    if (avatarOnTop) {
      filter = `[0:v]scale=${targetFormat.width}:${targetFormat.height}[bg];[1:v]scale=${avatarSize}:${avatarSize}[avatar];[bg][avatar]overlay=${overlayPos}[video_final]`;
    } else {
      const halfHeight = targetFormat.height / 2;
      filter = `[0:v]scale=${targetFormat.width}:${halfHeight}[top];[1:v]scale=${targetFormat.width}:${halfHeight}[bottom];color=black:size=${targetFormat.width}x${targetFormat.height}[bg];[bg][top]overlay=0:0[temp];[temp][bottom]overlay=0:${halfHeight}[video_final]`;
    }

    // Add simple neon border if enabled
    if (neonBorder) {
      const totalWidth = targetFormat.width + (neonWidth * 2);
      const totalHeight = targetFormat.height + (neonWidth * 2);
      filter += `;[video_final]pad=${totalWidth}:${totalHeight}:${neonWidth}:${neonWidth}:color=${neonColor}`;
    }

    const ffmpegCmd = `ffmpeg -i "${bgPath}" -i "${overlayPath}" -filter_complex "${filter}" -c:v libx264 -preset ultrafast -crf 28 -map 0:a? -c:a copy -t 15 -y "${outputPath}"`;

    console.log('FFmpeg command:', ffmpegCmd);

    exec(ffmpegCmd, { timeout: 90000 }, (error, stdout, stderr) => {
      // Cleanup
      try {
        if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
        if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
      } catch (e) {}

      if (error) {
        console.error('FFmpeg error:', stderr);
        return res.status(500).json({ error: 'Processing failed', details: stderr });
      }

      const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
      res.json({ 
        success: true, 
        outputUrl, 
        settings: { format, avatarOnTop, avatarPosition, avatarSize, neonBorder }
      });
    });
  });
});

app.listen(port, () => {
  console.log(`Minimal server on port ${port}`);
  console.log('Memory usage:', process.memoryUsage());
});
