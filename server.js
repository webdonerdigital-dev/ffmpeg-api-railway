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
  res.json({ 
    status: 'OK', 
    message: 'FFmpeg API Server',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/video-overlay', (req, res) => {
  const { 
    backgroundUrl, 
    overlayUrl, 
    avatarOnTop = true,
    neonBorder = false,
    neonColor = '#00FF00', // Neon green default
    neonWidth = 5,
    animationSpeed = 2 // Speed of flowing effect
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

    let filter = '';
    if (avatarOnTop) {
      filter = '[0:v]scale=1080:1920[bg];[1:v]scale=200:200[avatar];[bg][avatar]overlay=W-w-20:20[video_base]';
    } else {
      filter = '[0:v]scale=1080:960[top];[1:v]scale=1080:960[bottom];color=black:size=1080x1920[bg];[bg][top]overlay=0:0[temp];[temp][bottom]overlay=0:960[video_base]';
    }

    // Add animated neon border if enabled
    if (neonBorder) {
      const borderWidth = neonWidth;
      const totalWidth = 1080 + (borderWidth * 2);
      const totalHeight = 1920 + (borderWidth * 2);
      
      // Create animated flowing neon border effect
      filter += `;[video_base]pad=${totalWidth}:${totalHeight}:${borderWidth}:${borderWidth}:${neonColor}[padded];` +
        // Create flowing gradient effect using geq filter
        `color=${neonColor}:size=${totalWidth}x${totalHeight}[neon_base];` +
        `[neon_base]geq=` +
        `r='if(lt(X,${borderWidth})+gt(X,${totalWidth-borderWidth})+lt(Y,${borderWidth})+gt(Y,${totalHeight-borderWidth}),` +
        `128+127*sin(2*PI*(T*${animationSpeed}+X*0.01+Y*0.01)),0)':` +
        `g='if(lt(X,${borderWidth})+gt(X,${totalWidth-borderWidth})+lt(Y,${borderWidth})+gt(Y,${totalHeight-borderWidth}),` +
        `255,0)':` +
        `b='if(lt(X,${borderWidth})+gt(X,${totalWidth-borderWidth})+lt(Y,${borderWidth})+gt(Y,${totalHeight-borderWidth}),` +
        `128+127*sin(2*PI*(T*${animationSpeed}+X*0.01+Y*0.01)+PI/2),0)'[neon_animated];` +
        `[padded][neon_animated]blend=all_mode=screen[final]`;
    } else {
      filter += ';[video_base]null[final]';
    }

    const ffmpegCmd = `ffmpeg -i "${bgPath}" -i "${overlayPath}" -filter_complex "${filter}" -c:v libx264 -preset ultrafast -crf 28 -map 0:a? -c:a copy -t 10 -y "${outputPath}"`;

    console.log('FFmpeg command:', ffmpegCmd);

    exec(ffmpegCmd, { timeout: 90000 }, (error, stdout, stderr) => {
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
        settings: { 
          avatarOnTop, 
          neonBorder, 
          neonColor, 
          neonWidth,
          animationSpeed 
        }
      });
    });
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
