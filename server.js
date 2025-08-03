app.listen(port, () => {
  console.log(`FFmpeg API Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});const express = require('express');
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
      '/overlay': 'POST - Overlay two videos',
      '/health': 'GET - Health check'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Universal video overlay endpoint - supports all formats
app.post('/video-overlay', (req, res) => {
  try {
    const { 
      backgroundUrl, 
      overlayUrl, 
      format = 'landscape', // 'landscape', 'reels', 'square'
      layout = 'overlay', // 'overlay', 'split-vertical', 'split-horizontal'
      fadeHeight = 100,
      fadeDuration = 0.5,
      outputWidth = 1920,
      outputHeight = 1080,
      // Text overlay options
      overlayText = '',
      textColor = 'white',
      textSize = 30,
      textFont = 'Arial',
      textPosition = 'center',
      // Border options
      borderEnabled = false,
      borderColor = '#00BFFF', // Neon blue
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
        case 'split-vertical': // Alt alta (Reels için ideal)
          const halfHeight = targetFormat.height / 2;
          ffmpegFilter = `[0:v]scale=${targetFormat.width}:${halfHeight}[top];` +
            `[1:v]scale=${targetFormat.width}:${halfHeight}[bottom];` +
            `[top]fade=out:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:0:0[top_faded];` +
            `[bottom]fade=in:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:0:${halfHeight-fadeHeight/2}[bottom_faded];` +
            `[top_faded][bottom_faded]overlay=0:0`;
          break;

        case 'split-horizontal': // Yan yana
          const halfWidth = targetFormat.width / 2;
          ffmpegFilter = `[0:v]scale=${halfWidth}:${targetFormat.height}[left];` +
            `[1:v]scale=${halfWidth}:${targetFormat.height}[right];` +
            `[left]fade=out:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:0:0[left_faded];` +
            `[right]fade=in:st=0:d=${fadeDuration}:alpha=1,pad=${targetFormat.width}:${targetFormat.height}:${halfWidth-fadeHeight/2}:0[right_faded];` +
            `[left_faded][right_faded]overlay=0:0`;
          break;

        case 'overlay': // Üst üste bindirme
        default:
          const cropHeight = targetFormat.height - fadeHeight;
          ffmpegFilter = `[0:v]scale=${targetFormat.width}:${targetFormat.height}[bg];` +
            `[1:v]scale=${targetFormat.width}:${targetFormat.height},crop=${targetFormat.width}:${cropHeight}:0:0,` +
            `pad=${targetFormat.width}:${targetFormat.height}:0:0,` +
            `fade=out:st=0:d=${fadeDuration}:alpha=1[overlay_faded];` +
            `[bg][overlay_faded]overlay=0:0`;
      // Add text overlay if specified
      if (overlayText && overlayText.trim() !== '') {
        ffmpegFilter += `[temp1];[temp1]drawtext=` +
          `text='${overlayText}':` +
          `fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:` +
          `fontsize=${textSize}:` +
          `fontcolor=${textColor}:` +
          `x=(w-text_w)/2:` +
          `y=(h-text_h)/2:` +
          `shadow=1:shadowcolor=black:shadowx=2:shadowy=2[temp2]`;
        ffmpegFilter = ffmpegFilter.replace('[temp1];[temp1]', '[temp1];[temp1]').replace('overlay=0:0', 'overlay=0:0[temp1]');
      } else {
        ffmpegFilter += '[temp2]';
        ffmpegFilter = ffmpegFilter.replace('overlay=0:0', 'overlay=0:0[temp2]');
      }

      // Add border if enabled
      if (borderEnabled) {
        ffmpegFilter += `;[temp2]pad=` +
          `${targetFormat.width + borderWidth * 2}:` +
          `${targetFormat.height + borderWidth * 2}:` +
          `${borderWidth}:${borderWidth}:` +
          `${borderColor}[bordered]`;
        ffmpegFilter = ffmpegFilter.replace('[temp2]', '[temp2]').replace(';[temp2]', ';[temp2]') + '[final]';
        ffmpegFilter = ffmpegFilter.replace('[bordered]', '[bordered]').replace('[final]', '');
      } else {
        ffmpegFilter = ffmpegFilter.replace('[temp2]', '');
      }

      const ffmpegCmd = `ffmpeg -i "${bgPath}" -i "${overlayPath}" ` +
        `-filter_complex "${ffmpegFilter}" ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a copy -t 60 -y "${outputPath}"`;

      console.log('Executing universal FFmpeg command:', ffmpegCmd);

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
          fadeHeight: fadeHeight,
          fadeDuration: fadeDuration,
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

// URL-based overlay endpoint (for n8n integration)
app.post('/overlay-urls', (req, res) => {
  try {
    const { backgroundUrl, overlayUrl, fadeHeight = 100, fadeDuration = 0.5 } = req.body;

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ 
        error: 'Both backgroundUrl and overlayUrl are required' 
      });
    }

    const backgroundPath = `uploads/bg-${Date.now()}.mp4`;
    const overlayPath = `uploads/overlay-${Date.now()}.mp4`;
    const outputPath = `uploads/output-${Date.now()}.mp4`;

    // Download videos first
    const downloadCmd = `wget -O "${backgroundPath}" "${backgroundUrl}" && wget -O "${overlayPath}" "${overlayUrl}"`;
    
    exec(downloadCmd, (downloadError) => {
      if (downloadError) {
        return res.status(500).json({ 
          error: 'Failed to download videos',
          details: downloadError.message
        });
      }

      const cropHeight = 1080 - parseInt(fadeHeight);

      // FFmpeg command for adaptive resolution
      const ffmpegCmd = `ffmpeg -i "${backgroundPath}" -i "${overlayPath}" ` +
        `-filter_complex "` +
        `[0:v]scale=1920:1080[bg];` +
        `[1:v]scale=1920:1080,crop=1920:${cropHeight}:0:0,` +
        `pad=1920:1080:0:0,` +
        `fade=out:st=0:d=${fadeDuration}:alpha=1[faded];` +
        `[bg][faded]overlay=0:0" ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a copy -y "${outputPath}"`;

      exec(ffmpegCmd, (error, stdout, stderr) => {
        // Clean up input files
        if (fs.existsSync(backgroundPath)) fs.unlinkSync(backgroundPath);
        if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);

        if (error) {
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
          fadeHeight: fadeHeight,
          fadeDuration: fadeDuration,
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

// Instagram Reels overlay endpoint (9:16 format)
app.post('/reels-overlay', upload.fields([
  { name: 'topVideo', maxCount: 1 },
  { name: 'bottomVideo', maxCount: 1 }
]), (req, res) => {
  try {
    if (!req.files?.topVideo || !req.files?.bottomVideo) {
      return res.status(400).json({ 
        error: 'Both topVideo and bottomVideo are required' 
      });
    }

    const topVideoPath = req.files.topVideo[0].path;
    const bottomVideoPath = req.files.bottomVideo[0].path;
    const outputPath = `uploads/reels-output-${Date.now()}.mp4`;
    
    // Reels parameters
    const fadeZone = req.body.fadeZone || 150; // fade zone height
    const fadeDuration = req.body.fadeDuration || 1.0; // fade duration
    const reelsWidth = 1080;
    const reelsHeight = 1920;
    const halfHeight = 960;

    // FFmpeg command for Reels format (9:16)
    const ffmpegCmd = `ffmpeg -i "${topVideoPath}" -i "${bottomVideoPath}" ` +
      `-filter_complex "` +
      `[0:v]scale=${reelsWidth}:${halfHeight},crop=${reelsWidth}:${halfHeight-fadeZone/2}:0:0[top_cropped];` +
      `[1:v]scale=${reelsWidth}:${halfHeight},crop=${reelsWidth}:${halfHeight-fadeZone/2}:0:${fadeZone/2}[bottom_cropped];` +
      `[top_cropped]pad=${reelsWidth}:${halfHeight}:0:0[top_padded];` +
      `[bottom_cropped]pad=${reelsWidth}:${halfHeight}:0:${fadeZone}[bottom_padded];` +
      `[top_padded]fade=out:st=0:d=${fadeDuration}:alpha=1,` +
      `fade=in:st=0:d=${fadeDuration}:alpha=1[top_faded];` +
      `[bottom_padded]fade=in:st=0:d=${fadeDuration}:alpha=1,` +
      `fade=out:st=0:d=${fadeDuration}:alpha=1[bottom_faded];` +
      `color=black:size=${reelsWidth}x${reelsHeight}[bg];` +
      `[bg][top_faded]overlay=0:0[temp];` +
      `[temp][bottom_faded]overlay=0:${halfHeight}" ` +
      `-c:v libx264 -preset fast -crf 23 ` +
      `-c:a copy -t 60 -y "${outputPath}"`;

    console.log('Executing Reels FFmpeg command:', ffmpegCmd);

    exec(ffmpegCmd, { timeout: 300000 }, (error, stdout, stderr) => {
      // Clean up input files
      fs.unlinkSync(topVideoPath);
      fs.unlinkSync(bottomVideoPath);

      if (error) {
        console.error('FFmpeg error:', error);
        console.error('FFmpeg stderr:', stderr);
        return res.status(500).json({ 
          error: 'Reels video processing failed',
          details: stderr
        });
      }

      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ 
          error: 'Reels output file was not created' 
        });
      }

      const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
      
      res.json({
        success: true,
        message: 'Instagram Reels overlay completed successfully',
        outputUrl: outputUrl,
        format: '9:16 (1080x1920)',
        fadeZone: fadeZone,
        fadeDuration: fadeDuration,
        processTime: new Date().toISOString()
      });
    });

  } catch (err) {
    console.error('Reels server error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
});

// Reels URL-based overlay endpoint
app.post('/reels-overlay-urls', (req, res) => {
  try {
    const { topVideoUrl, bottomVideoUrl, fadeZone = 150, fadeDuration = 1.0 } = req.body;

    if (!topVideoUrl || !bottomVideoUrl) {
      return res.status(400).json({ 
        error: 'Both topVideoUrl and bottomVideoUrl are required' 
      });
    }

    const topVideoPath = `uploads/top-${Date.now()}.mp4`;
    const bottomVideoPath = `uploads/bottom-${Date.now()}.mp4`;
    const outputPath = `uploads/reels-output-${Date.now()}.mp4`;

    // Download videos
    const downloadCmd = `wget -O "${topVideoPath}" "${topVideoUrl}" && wget -O "${bottomVideoPath}" "${bottomVideoUrl}"`;
    
    exec(downloadCmd, (downloadError) => {
      if (downloadError) {
        return res.status(500).json({ 
          error: 'Failed to download videos',
          details: downloadError.message
        });
      }

      const reelsWidth = 1080;
      const reelsHeight = 1920;
      const halfHeight = 960;

      // FFmpeg command for Reels format
      const ffmpegCmd = `ffmpeg -i "${topVideoPath}" -i "${bottomVideoPath}" ` +
        `-filter_complex "` +
        `[0:v]scale=${reelsWidth}:${halfHeight},crop=${reelsWidth}:${halfHeight-fadeZone/2}:0:0[top_cropped];` +
        `[1:v]scale=${reelsWidth}:${halfHeight},crop=${reelsWidth}:${halfHeight-fadeZone/2}:0:${fadeZone/2}[bottom_cropped];` +
        `[top_cropped]pad=${reelsWidth}:${halfHeight}:0:0[top_padded];` +
        `[bottom_cropped]pad=${reelsWidth}:${halfHeight}:0:${fadeZone}[bottom_padded];` +
        `[top_padded]fade=out:st=0:d=${fadeDuration}:alpha=1[top_faded];` +
        `[bottom_faded]fade=in:st=0:d=${fadeDuration}:alpha=1[bottom_faded];` +
        `color=black:size=${reelsWidth}x${reelsHeight}[bg];` +
        `[bg][top_faded]overlay=0:0[temp];` +
        `[temp][bottom_faded]overlay=0:${halfHeight}" ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a copy -t 60 -y "${outputPath}"`;

      exec(ffmpegCmd, { timeout: 300000 }, (error, stdout, stderr) => {
        // Clean up
        if (fs.existsSync(topVideoPath)) fs.unlinkSync(topVideoPath);
        if (fs.existsSync(bottomVideoPath)) fs.unlinkSync(bottomVideoPath);

        if (error) {
          return res.status(500).json({ 
            error: 'Reels processing failed',
            details: stderr
          });
        }

        const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
        
        res.json({
          success: true,
          message: 'Instagram Reels overlay completed',
          outputUrl: outputUrl,
          format: '9:16 Instagram Reels (1080x1920)',
          fadeZone: fadeZone,
          fadeDuration: fadeDuration,
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
