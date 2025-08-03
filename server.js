const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Minimal setup - debug için
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Minimal server working' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', memory: process.memoryUsage() });
});

// Test endpoint - FFmpeg yok
app.post('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server responding',
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Minimal server on port ${port}`);
  console.log('Memory usage:', process.memoryUsage());
});
