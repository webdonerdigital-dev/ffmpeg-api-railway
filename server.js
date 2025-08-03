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

// Video overlay endpoint
app.post('/video-overlay', (req, res) => {
  try {
    const { 
      backgroundUrl, 
      overlayUrl, 
      animationUrl = '', // 3rd video for animations
      format = 'reels',
      avatarOnTop = false,
      avatarPosition = 'bottom-right',
      avatarSize = 200,
      overlayText = '',
      textPosition = 'center',
      textColor = 'white',
      textSize = 40,
      borderEnabled = false,
      borderColor = '#00FF00',
      borderWidth = 8,
      // Animation settings
      animationPosition = 'center',
      animationSize = 300,
      animationBlendMode = 'overlay' // overlay, screen, multiply
    } = req.body;

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ 
        error: 'Both backgroundUrl and overlayUrl are required' 
      });
    }

    const bgPath = `uploads/bg-${Date.now()}.mp4`;
    const overlayPath = `uploads/overlay-${Date.now()}.mp4`;
    const animationPath = `uploads/animation-${Date.now()}.mp4`;
    const outputPath = `uploads/output-${Date.now()}.mp4`;

    console.log('Starting video processing...');

    // Download videos (including animation if provided)
    let downloadCmd = `wget -O "${bgPath}" "${backgroundUrl}" && wget -O "${overlayPath}" "${overlayUrl}"`;
    if (animationUrl && animationUrl.trim() !== '') {
      downloadCmd += ` && wget -O "${animationPath}" "${animationUrl}"`;
    }
    
    exec(downloadCmd, (downloadError) => {
      if (downloadError) {
        console.error('Download error:', downloadError);
        return res.status(500).json({ 
          error: 'Failed to download videos',
          details: downloadError.message
        });
      }

      let ffmpegFilter = '';

      // Build filter based on layout type
      if (avatarOnTop) {
        // Avatar overlay on full background
        let overlayPos = '';
        switch(avatarPosition) {
          case 'top-left': overlayPos = '20:20'; break;
          case 'top-right': overlayPos = 'W-w-20:20'; break;
          case 'bottom-left': overlayPos = '20:H-h-20'; break;
          case 'bottom-right': overlayPos = 'W-w-20:H-h-20'; break;
          case 'center': overlayPos = '(W-w)/2:(H-h)/2'; break;
          default: overlayPos = 'W-w-20:20';
        }
        
        ffmpegFilter = `[0:v]scale=1080:1920[main_full];[1:v]scale=${avatarSize}:${avatarSize}[avatar_small];[main_full][avatar_small]overlay=${overlayPos}[video_with_avatar]`;
      } else {
        // Split vertical layout
        ffmpegFilter = `[0:v]scale=1080:1920,crop=1080:960:0:0[top_bg];[1:v]scale=480:480[avatar];color=black:size=1080x1920[bg];[bg][top_bg]overlay=0:0[temp1];[temp1][avatar]overlay=(1080-480)/2:960+(960-480)/2[video_with_avatar]`;
      }

      // Add animation overlay if provided
      if (animationUrl && animationUrl.trim() !== '') {
        let animPos = '';
        switch(animationPosition) {
          case 'top-left': animPos = '50:50'; break;
          case 'top-right': animPos = 'W-w-50:50'; break;
          case 'bottom-left': animPos = '50:H-h-50'; break;
          case 'bottom-right': animPos = 'W-w-50:H-h-50'; break;
          case 'center': animPos = '(W-w)/2:(H-h)/2'; break;
          case 'top-center': animPos = '(W-w)/2:100'; break;
          case 'bottom-center': animPos = '(W-w)/2:H-h-100'; break;
          default: animPos = '(W-w)/2:(H-h)/2';
        }
        
        // Animation with transparency support (simplified)
        ffmpegFilter += `;[2:v]scale=${animationSize}:${animationSize}[animation_scaled];[video_with_avatar][animation_scaled]overlay=${animPos}[video_final]`;
      } else {
        ffmpegFilter += `;[video_with_avatar]null[video_final]`;
      }

      // Add text if specified (simplified)
      if (overlayText && overlayText.trim() !== '') {
        let textPos = '';
        switch(textPosition) {
          case 'top': textPos = 'x=(w-text_w)/2:y=80'; break;
          case 'bottom': textPos = 'x=(w-text_w)/2:y=h-text_h-80'; break;
          case 'center': textPos = 'x=(w-text_w)/2:y=(h-text_h)/2'; break;
          default: textPos = 'x=(w-text_w)/2:y=(h-text_h)/2';
        }
        
        ffmpegFilter += `;[video_final]drawtext=text='${overlayText}':fontsize=${textSize}:fontcolor=${textColor}:${textPos}[with_text]`;
      } else {
        ffmpegFilter += `;[video_final]null[with_text]`;
      }

      // Add border if enabled (simplified)
      if (borderEnabled) {
        ffmpegFilter += `;[with_text]pad=1100:1940:10:10:color=${borderColor}`;
      }

      const ffmpegInputs = animationUrl && animationUrl.trim() !== '' 
        ? `ffmpeg -i "${bgPath}" -i "${overlayPath}" -i "${animationPath}"`
        : `ffmpeg -i "${bgPath}" -i "${overlayPath}"`;

      const ffmpegCmd = `${ffmpegInputs} ` +
        `-filter_complex "${ffmpegFilter}" ` +
        `-c:v libx264 -preset ultrafast -crf 28 ` +
        `-map 0:a? -c:a copy ` +
        `-t 15 -y "${outputPath}"`;

      console.log('FFmpeg command:', ffmpegCmd);

      exec(ffmpegCmd, { timeout: 180000 }, (error, stdout, stderr) => {
        // Clean up
        try {
          if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
          if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
          if (animationUrl && fs.existsSync(animationPath)) fs.unlinkSync(animationPath);
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }

        if (error) {
          console.error('FFmpeg error:', error);
          console.error('FFmpeg stderr:', stderr);
          return res.status(500).json({ 
            error: 'Video processing failed',
            details: stderr
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
          settings: {
            avatarOnTop,
            avatarPosition,
            avatarSize,
            overlayText,
            textPosition,
            borderEnabled
          },
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
  console.log('Ready to process videos!');
});
