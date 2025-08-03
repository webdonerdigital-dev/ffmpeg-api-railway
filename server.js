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

      // Smart Reels format: preserve aspect ratios
      let ffmpegFilter = '';
      
      if (format === 'reels') {
        // Option 1: Avatar overlay on main video (new request)
        if (req.body.avatarOnTop) {
          const avatarSize = req.body.avatarSize || 200;
          const avatarPosition = req.body.avatarPosition || 'top-right';
          
          let overlayPos = '';
          switch(avatarPosition) {
            case 'top-left': overlayPos = '20:20'; break;
            case 'top-right': overlayPos = 'W-w-20:20'; break;
            case 'bottom-left': overlayPos = '20:H-h-20'; break;
            case 'bottom-right': overlayPos = 'W-w-20:H-h-20'; break;
            case 'center': overlayPos = '(W-w)/2:(H-h)/2'; break;
            default: overlayPos = 'W-w-20:20'; // top-right
          }
          
          // Ana video tam ekran + avatar küçük overlay
          ffmpegFilter = `[0:v]scale=1080:1920[main_full];` +
            `[1:v]scale=${avatarSize}:${avatarSize},format=rgba,colorchannelmixer=aa=0.8[avatar_transparent];` +
            `[main_full][avatar_transparent]overlay=${overlayPos}[combined]`;
        }
        // Option 2: Split vertical (original)
        else {
          // BG video: Keep original 9:16, crop to top half
          // Avatar: Keep square, scale to fit bottom area
          ffmpegFilter = `[0:v]scale=1080:1920,crop=1080:960:0:0[top_bg];` +
            `[1:v]scale=480:480[avatar];` +
            `color=black:size=1080x1920[bg];` +
            `[bg][top_bg]overlay=0:0[temp1];` +
            `[temp1][avatar]overlay=(1080-480)/2:960+(960-480)/2[combined]`;
        }
      } else {
        // Original logic for other formats
        ffmpegFilter = `[0:v]scale=1080:960[top];[1:v]scale=1080:960[bottom];` +
          `color=black:size=1080x1920[bg];` +
          `[bg][top]overlay=0:0[temp1];` +
          `[temp1][bottom]overlay=0:960[combined]`;
      }

      // Add text if specified
      if (overlayText && overlayText.trim() !== '') {
        const textPosition = req.body.textPosition || 'center';
        const textColor = req.body.textColor || 'white';
        const textSize = req.body.textSize || 40;
        
        let textPos = '';
        switch(textPosition) {
          case 'top': textPos = 'x=(w-text_w)/2:y=50'; break;
          case 'bottom': textPos = 'x=(w-text_w)/2:y=h-text_h-50'; break;
          case 'center': textPos = 'x=(w-text_w)/2:y=(h-text_h)/2'; break;
          case 'top-left': textPos = 'x=30:y=50'; break;
          case 'top-right': textPos = 'x=w-text_w-30:y=50'; break;
          case 'bottom-left': textPos = 'x=30:y=h-text_h-50'; break;
          case 'bottom-right': textPos = 'x=w-text_w-30:y=h-text_h-50'; break;
          default: textPos = 'x=(w-text_w)/2:y=(h-text_h)/2';
        }
        
        ffmpegFilter += `;[combined]drawtext=text='${overlayText}':fontsize=${textSize}:fontcolor=${textColor}:${textPos}:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[text_added]`;
      } else {
        ffmpegFilter += `;[combined]copy[text_added]`;
      }

      // Add neon border if enabled
      if (borderEnabled) {
        const borderColor = req.body.borderColor || '#00FF00'; // Neon green default
        const borderWidth = req.body.borderWidth || 8;
        const glowIntensity = req.body.glowIntensity || 3;
        
        // Create neon glow effect with multiple borders
        ffmpegFilter += `;[text_added]pad=${targetFormat.width + borderWidth * 2}:${targetFormat.height + borderWidth * 2}:${borderWidth}:${borderWidth}:${borderColor}[bordered];` +
          `[bordered]boxblur=${glowIntensity}:${glowIntensity}[glowed];` +
          `[text_added][glowed]overlay=${borderWidth}:${borderWidth}[final_with_glow]`;
        
        // Override final filter name
        ffmpegFilter = ffmpegFilter.replace('[text_added]', '[text_added]').replace('[final_with_glow]', '');
      } else {
        ffmpegFilter = ffmpegFilter.replace('[text_added]', '');
      }

      const ffmpegCmd = `ffmpeg -i "${bgPath}" -i "${overlayPath}" ` +
        `-filter_complex "${ffmpegFilter}" ` +
        `-map "[final]" ` +
        `-map 0:a? ` +
        `-c:v libx264 -preset ultrafast -crf 28 ` +
        `-c:a copy ` +
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
