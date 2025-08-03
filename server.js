const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Create uploads directory
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'FFmpeg API Server is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Simple video overlay endpoint
app.post('/video-overlay', (req, res) => {
  try {
    const { 
      backgroundUrl, 
      overlayUrl, 
      format = 'reels',
      overlayText = '',
      borderEnabled = false
    } = req.body;

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ 
        error: 'Both backgroundUrl and overlayUrl are required' 
      });
    }

    const bgPath = `uploads/bg-${Date.now()}.mp4`;
    const overlayPath = `uploads/overlay-${Date.now()}.mp4`;
    const outputPath = `uploads/output-${Date.now()}.mp4`;

    console.log('Starting video processing...');

    // Download videos
    const downloadCmd = `wget -O "${bgPath}" "${backgroundUrl}" && wget -O "${overlayPath}" "${overlayUrl}"`;
    
    exec(downloadCmd, (downloadError) => {
      if (downloadError) {
        console.error('Download error:', downloadError);
        return res.status(500).json({ 
          error: 'Failed to download videos',
          details: downloadError.message
        });
      }

      // Simple Reels format: 1080x1920, split vertical
      let ffmpegFilter = `[0:v]scale=1080:960[top];[1:v]scale=1080:960[bottom];` +
        `color=black:size=1080x1920[bg];` +
        `[bg][top]overlay=0:0[temp1];` +
        `[temp1][bottom]overlay=0:960[combined]`;

      // Add text if specified
      if (overlayText && overlayText.trim() !== '') {
        ffmpegFilter += `;[combined]drawtext=text='${overlayText}':fontsize=30:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2[final]`;
      } else {
        ffmpegFilter += `;[combined]null[final]`;
      }

      const ffmpegCmd = `ffmpeg -i "${bgPath}" -i "${overlayPath}" ` +
        `-filter_complex "${ffmpegFilter}" ` +
        `-map "[final]" ` +
        `-c:v libx264 -preset ultrafast -crf 28 ` +
        `-t 10 -y "${outputPath}"`;

      console.log('FFmpeg command:', ffmpegCmd);

      exec(ffmpegCmd, { timeout: 120000 }, (error, stdout, stderr) => {
        // Clean up
        try {
          if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
          if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }

        if (error) {
          console.error('FFmpeg error:', error);
          console.error('FFmpeg stderr:', stderr);
          return res.status(500).json({ 
            error: 'Video processing failed',
            details: stderr,
            command: ffmpegCmd
          });
        }

        if (!fs.existsSync(outputPath)) {
          return res.status(500).json({ 
            error: 'Output file not created'
          });
        }

        const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
        
        res.json({
          success: true,
          message: 'Video processed successfully',
          outputUrl: outputUrl,
          format: '1080x1920 Reels',
          processTime: new Date().toISOString()
        });
      });
    });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`FFmpeg API Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('Server started successfully!');
});
