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
      '/overlay': 'POST - Overlay two videos',
      '/health': 'GET - Health check'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Video overlay endpoint
app.post('/overlay', upload.fields([
  { name: 'background', maxCount: 1 },
  { name: 'overlay', maxCount: 1 }
]), (req, res) => {
  try {
    if (!req.files?.background || !req.files?.overlay) {
      return res.status(400).json({ 
        error: 'Both background and overlay videos are required' 
      });
    }

    const backgroundPath = req.files.background[0].path;
    const overlayPath = req.files.overlay[0].path;
    const outputPath = `uploads/output-${Date.now()}.mp4`;
    
    // Get parameters from request
    const fadeHeight = req.body.fadeHeight || 100;
    const fadeDuration = req.body.fadeDuration || 0.5;
    const cropHeight = 1080 - parseInt(fadeHeight);

    // FFmpeg command for bottom fade overlay
    const ffmpegCmd = `ffmpeg -i "${backgroundPath}" -i "${overlayPath}" ` +
      `-filter_complex "` +
      `[1:v]crop=1920:${cropHeight}:0:0,` +
      `pad=1920:1080:0:0,` +
      `fade=out:st=0:d=${fadeDuration}:alpha=1[faded];` +
      `[0:v][faded]overlay=0:0" ` +
      `-c:v libx264 -preset fast -crf 23 ` +
      `-c:a copy -y "${outputPath}"`;

    console.log('Executing FFmpeg command:', ffmpegCmd);

    exec(ffmpegCmd, (error, stdout, stderr) => {
      // Clean up input files
      fs.unlinkSync(backgroundPath);
      fs.unlinkSync(overlayPath);

      if (error) {
        console.error('FFmpeg error:', error);
        console.error('FFmpeg stderr:', stderr);
        return res.status(500).json({ 
          error: 'Video processing failed',
          details: stderr
        });
      }

      // Check if output file was created
      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ 
          error: 'Output file was not created' 
        });
      }

      const outputUrl = `${req.protocol}://${req.get('host')}/${outputPath}`;
      
      res.json({
        success: true,
        message: 'Video overlay completed successfully',
        outputUrl: outputUrl,
        outputPath: outputPath,
        processTime: new Date().toISOString()
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

      // FFmpeg command
      const ffmpegCmd = `ffmpeg -i "${backgroundPath}" -i "${overlayPath}" ` +
        `-filter_complex "` +
        `[1:v]crop=1920:${cropHeight}:0:0,` +
        `pad=1920:1080:0:0,` +
        `fade=out:st=0:d=${fadeDuration}:alpha=1[faded];` +
        `[0:v][faded]overlay=0:0" ` +
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

app.listen(port, () => {
  console.log(`FFmpeg API Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
