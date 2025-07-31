const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Storage configuration for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    cb(null, `video_${timestamp}${extension}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/avi', 'video/mov', 'video/mkv', 'video/webm'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'), false);
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// HLS Video Segmentation Class
class HLSSegmenter {
  constructor() {
    this.outputDir = path.join(__dirname, 'hls_output');
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    fs.ensureDirSync(this.outputDir);
  }

  async segmentVideo(inputPath, options = {}) {
    const {
      segmentDuration = 6,
      qualities = [
        { name: '480p', width: 854, height: 480, bitrate: '1000k' },
        { name: '720p', width: 1280, height: 720, bitrate: '2500k' },
        { name: '1080p', width: 1920, height: 1080, bitrate: '5000k' }
      ],
      outputName = 'stream'
    } = options;

    const videoId = `${outputName}_${Date.now()}`;
    const videoOutputDir = path.join(this.outputDir, videoId);
    
    await fs.ensureDir(videoOutputDir);

    try {
      // Create master playlist
      const masterPlaylist = await this.createMasterPlaylist(qualities, videoId);
      
      // Process each quality variant
      const variantPromises = qualities.map(quality => 
        this.processQualityVariant(inputPath, quality, videoOutputDir, segmentDuration)
      );

      await Promise.all(variantPromises);

      // Write master playlist
      const masterPlaylistPath = path.join(videoOutputDir, 'master.m3u8');
      await fs.writeFile(masterPlaylistPath, masterPlaylist);

      return {
        success: true,
        videoId,
        masterPlaylistUrl: `/hls/${videoId}/master.m3u8`,
        qualities: qualities.map(q => q.name),
        outputDir: videoOutputDir
      };

    } catch (error) {
      console.error('Segmentation error:', error);
      throw error;
    }
  }

  async processQualityVariant(inputPath, quality, outputDir, segmentDuration) {
    return new Promise((resolve, reject) => {
      const outputPattern = path.join(outputDir, `${quality.name}_%03d.ts`);
      const playlistPath = path.join(outputDir, `${quality.name}.m3u8`);

      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          `-b:v ${quality.bitrate}`,
          '-b:a 128k',
          `-s ${quality.width}x${quality.height}`,
          '-profile:v baseline',
          '-level 3.0',
          '-start_number 0',
          '-hls_time ' + segmentDuration,
          '-hls_list_size 0',
          '-f hls',
          '-hls_segment_filename ' + outputPattern
        ])
        .output(playlistPath)
        .on('start', (commandLine) => {
          console.log(`Starting ${quality.name} processing:`, commandLine);
        })
        .on('progress', (progress) => {
          console.log(`${quality.name} processing: ${progress.percent?.toFixed(1) || 0}% done`);
        })
        .on('end', () => {
          console.log(`${quality.name} processing completed`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`${quality.name} processing error:`, err);
          reject(err);
        })
        .run();
    });
  }

  async createMasterPlaylist(qualities, videoId) {
    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    for (const quality of qualities) {
      const bandwidth = parseInt(quality.bitrate.replace('k', '')) * 1000;
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${quality.width}x${quality.height}\n`;
      playlist += `${quality.name}.m3u8\n\n`;
    }
    
    return playlist;
  }

  async getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
          
          resolve({
            duration: metadata.format.duration,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            video: videoStream ? {
              codec: videoStream.codec_name,
              width: videoStream.width,
              height: videoStream.height,
              fps: videoStream.r_frame_rate
            } : null,
            audio: audioStream ? {
              codec: audioStream.codec_name,
              bitrate: audioStream.bit_rate,
              sampleRate: audioStream.sample_rate
            } : null
          });
        }
      });
    });
  }
}

const segmenter = new HLSSegmenter();

// Routes

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Upload and segment video
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const inputPath = req.file.path;
    const { segmentDuration, outputName } = req.body;

    // Get video information
    const videoInfo = await segmenter.getVideoInfo(inputPath);
    
    // Determine appropriate qualities based on input resolution
    let qualities = [
      { name: '480p', width: 854, height: 480, bitrate: '1000k' }
    ];

    if (videoInfo.video.height >= 720) {
      qualities.push({ name: '720p', width: 1280, height: 720, bitrate: '2500k' });
    }
    
    if (videoInfo.video.height >= 1080) {
      qualities.push({ name: '1080p', width: 1920, height: 1080, bitrate: '5000k' });
    }

    // Segment the video
    const result = await segmenter.segmentVideo(inputPath, {
      segmentDuration: parseInt(segmentDuration) || 6,
      qualities,
      outputName: outputName || 'uploaded_video'
    });

    // Clean up uploaded file
    await fs.remove(inputPath);

    res.json({
      ...result,
      videoInfo,
      message: 'Video successfully segmented for HLS streaming'
    });

  } catch (error) {
    console.error('Upload/segmentation error:', error);
    res.status(500).json({ 
      error: 'Failed to process video',
      details: error.message 
    });
  }
});

// Serve HLS files
app.use('/hls', express.static(path.join(__dirname, 'hls_output')));

// Get available videos
app.get('/api/videos', async (req, res) => {
  try {
    const hlsDir = path.join(__dirname, 'hls_output');
    
    if (!await fs.pathExists(hlsDir)) {
      return res.json({ videos: [] });
    }

    const videoDirs = await fs.readdir(hlsDir);
    const videos = [];

    for (const dir of videoDirs) {
      const dirPath = path.join(hlsDir, dir);
      const stat = await fs.stat(dirPath);
      
      if (stat.isDirectory()) {
        const masterPlaylistPath = path.join(dirPath, 'master.m3u8');
        
        if (await fs.pathExists(masterPlaylistPath)) {
          const masterPlaylist = await fs.readFile(masterPlaylistPath, 'utf8');
          const qualities = this.extractQualitiesFromMasterPlaylist(masterPlaylist);
          
          videos.push({
            id: dir,
            name: dir.replace(/^stream_/, ''),
            masterPlaylistUrl: `/hls/${dir}/master.m3u8`,
            qualities,
            createdAt: stat.birthtime
          });
        }
      }
    }

    res.json({ videos: videos.sort((a, b) => b.createdAt - a.createdAt) });

  } catch (error) {
    console.error('Error getting videos:', error);
    res.status(500).json({ error: 'Failed to get video list' });
  }
});

// Helper function to extract qualities from master playlist
function extractQualitiesFromMasterPlaylist(content) {
  const lines = content.split('\n');
  const qualities = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const resolutionMatch = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
      const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
      
      if (resolutionMatch && bandwidthMatch && lines[i + 1]) {
        qualities.push({
          name: lines[i + 1].replace('.m3u8', ''),
          resolution: `${resolutionMatch[1]}x${resolutionMatch[2]}`,
          bandwidth: parseInt(bandwidthMatch[1])
        });
      }
    }
  }
  
  return qualities;
}

// Delete video
app.delete('/api/videos/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const videoDir = path.join(__dirname, 'hls_output', videoId);
    
    if (await fs.pathExists(videoDir)) {
      await fs.remove(videoDir);
      res.json({ success: true, message: 'Video deleted successfully' });
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    ffmpeg: ffmpeg.getAvailableFormats ? 'available' : 'not available'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 HLS Video Segmentation Server running on port ${PORT}`);
  console.log(`📺 Client available at: http://localhost:${PORT}`);
  console.log(`🔧 API endpoints:`);
  console.log(`   POST /api/upload - Upload and segment video`);
  console.log(`   GET  /api/videos - List available videos`);
  console.log(`   GET  /hls/:videoId/master.m3u8 - Access HLS stream`);
  console.log(`   GET  /api/health - Health check`);
});

module.exports = app;