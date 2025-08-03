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

// Simple video overlay - no complex filters
app.post('/video-overlay', (req, res) => {
  const { backgroundUrl, overlayUrl, format = 'reels' } = req.body;

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

    // Super simple filter - just overlay
    const filter = '[0:v]scale=1080:1920[bg];[1:v]scale=200:200[avatar];[bg][avatar]overlay=W-w-20:20';

    const ffmpegCmd = `ffmpeg -i "${bgPath}" -i "${overlayPath}" -filter_complex "${filter}" -c:v libx264 -preset ultrafast -crf 28 -t 10 -y "${outputPath}"`;

    exec(ffmpegCmd, { timeout: 60000 }, (error, stdout, stderr) => {
      // Cleanup
      try {
        if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
        if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
      } catch (e) {}

      if (error) {
        return res.status(500).json({ error: 'Processing failed', details: stderr });
      }

      const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
      res.json({ success: true, outputUrl, format });
    });
  });
});

app.listen(port, () => {
  console.log(`Minimal server on port ${port}`);
  console.log('Memory usage:', process.memoryUsage());
});
