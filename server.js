const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'FFmpeg API Server is running',
    endpoints: {
      '/video-overlay': 'POST - Universal video overlay with text and border support',
      '/health': 'GET - Health check'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Universal video overlay endpoint
app.post('/video-overlay', (req, res) => {
  try {
    const { 
      backgroundUrl, 
      overlayUrl, 
      format = 'landscape',
      layout = 'overlay',
      fadeHeight = 100,
      fadeDuration = 0.5,
      outputWidth = 1920,
      outputHeight = 1080,
      overlayText = '',
      textColor = 'white',
      textSize = 30,
      borderEnabled = false,
      borderColor = '#00BFFF',
      borderWidth = 10
    } = req.body;

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ 
        error: 'Both backgroundUrl and overlayUrl are required' 
      });
    }

    // Format presets
    const formats = {
      'landscape': { width: 1920, height: 1080 },
      'reels': { width: 1080, height: 1920 },
      'square': { width: 1080, height: 1080 },
      'story': { width: 1080, height: 1920 },
      'youtube': { width: 1920, height: 1080 },
      'tiktok': { width: 1080, height: 1920 }
    };

    const targetFormat = formats[format] || { width: outputWidth, height: outputHeight };
    const bgPath = `uploads/bg-${Date.now()}.mp4`;
    const overlayPath = `uploads/overlay-${Date.now()}.mp4`;
    const outputPath = `uploads/output-${Date.now()}.mp4`;

    // Download videos
    const downloadCmd = `wget -O "${bgPath}" "${backgroundUrl}" && wget -O "${overlayPath}" "${overlayUrl}"`;
    
    exec(downloadCmd, (downloadError) => {
      if (downloadError) {
        return res.status(500).json({ 
          error: 'Failed to download videos',
          details: downloadError.message
        });
      }

      let ffmpegFilter = '';

      // Layout options
      switch (layout) {
        case 'split-vertical':
          const halfHeight = targetFormat.height / 2;
          ffmpegFilter = `[0:v]scale=${targetFormat.width}:${halfHeight}[top];` +
            `[1:v]scale=${targetFormat.width}:${halfHeight}[bottom];` +
            `[top]fade=out:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:0:0[top_faded];` +
            `[bottom]fade=in:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:0:${halfHeight-fadeHeight/2}[bottom_faded];` +
            `[top_faded][bottom_faded]overlay=0:0[video_combined]`;
          break;

        case 'split-horizontal':
          const halfWidth = targetFormat.width / 2;
          ffmpegFilter = `[0:v]scale=${halfWidth}:${targetFormat.height}[left];` +
            `[1:v]scale=${halfWidth}:${targetFormat.height}[right];` +
            `[left]fade=out:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:0:0[left_faded];` +
            `[right]fade=in:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:${halfWidth-fadeHeight/2}:0[right_faded];` +
            `[left_faded][right_faded]overlay=0:0[video_combined]`;
          break;

        case 'overlay':
        default:
          const cropHeight = targetFormat.height - fadeHeight;
          ffmpegFilter = `[0:v]scale=${targetFormat.width}:${targetFormat.height}[bg];` +
            `[1:v]scale=${targetFormat.width}:${targetFormat.height},crop=${targetFormat.width}:${cropHeight}:0:0,` +
            `pad=${targetFormat.width}:${targetFormat.height}:0:0,` +
            `fade=out:st=0:d=${fadeDuration}:alpha=1[overlay_faded];` +
            `[bg][overlay_faded]overlay=0:0[video_combined]`;
          break;
      }

      // Add text overlay if specified
      if (overlayText && overlayText.trim() !== '') {
        ffmpegFilter += `;[video_combined]drawtext=` +
          `text='${overlayText}':` +
          `fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:` +
          `fontsize=${textSize}:` +
          `fontcolor=${textColor}:` +
          `x=(w-text_w)/2:` +
          `y=(h-text_h)/2[text_added]`;
      } else {
        ffmpegFilter += `;[video_combined]null[text_added]`;
      }

      // Add border if enabled
      if (borderEnabled) {
        ffmpegFilter += `;[text_added]pad=` +
          `${targetFormat.width + borderWidth * 2}:` +
          `${targetFormat.height + borderWidth * 2}:` +
          `${borderWidth}:${borderWidth}:` +
          `color=${borderColor}`;
      }

      const ffmpegCmd = `ffmpeg -i "${bgPath}" -i "${overlayPath}" ` +
        `-filter_complex "${ffmpegFilter}" ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a copy -t 60 -y "${outputPath}"`;

      console.log('Executing FFmpeg command:', ffmpegCmd);

      exec(ffmpegCmd, { timeout: 300000 }, (error, stdout, stderr) => {
        // Clean up
        if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
        if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);

        if (error) {
          console.error('FFmpeg error:', error);
          return res.status(500).json({ 
            error: 'Video processing failed',
            details: stderr
          });
        }

        const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
        
        res.json({
          success: true,
          message: 'Video overlay completed successfully',
          outputUrl: outputUrl,
          format: `${targetFormat.width}x${targetFormat.height}`,
          layout: layout,
          overlayText: overlayText,
          borderEnabled: borderEnabled,
          processTime: new Date().toISOString()
        });
      });
    });

  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
});

app.listen(port, () => {
  console.log(`FFmpeg API Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
