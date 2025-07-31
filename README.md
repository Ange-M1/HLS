# HLS Video Segmentation System

A complete HTTP Live Streaming (HLS) video segmentation solution with both client-side player and server-side tools for processing videos into adaptive bitrate streams.

## 🎥 Features

### Client-Side Player
- **Advanced HLS Player**: Built with HLS.js for cross-browser compatibility
- **Adaptive Bitrate Streaming**: Automatic quality switching based on network conditions
- **Manual Quality Selection**: User can manually select video quality
- **Intelligent Segment Caching**: IndexedDB-based caching with cleanup management
- **Segment Preloading**: Preloads upcoming segments for smooth playback
- **Real-time Buffer Monitoring**: Shows buffer status and segment information
- **Segment Navigation**: Jump between segments with precise controls
- **Network Status Monitoring**: Online/offline detection and status updates

### Server-Side Processing
- **Video Upload & Processing**: Web interface for uploading videos
- **Multi-Quality Encoding**: Automatic generation of multiple bitrate variants
- **FFmpeg Integration**: Professional-grade video processing
- **HLS Manifest Generation**: Creates master and variant playlists
- **RESTful API**: Complete API for video management
- **Command-Line Tools**: CLI for batch processing

### Quality Variants
- **480p**: 854x480 @ 1000kbps
- **720p**: 1280x720 @ 2500kbps  
- **1080p**: 1920x1080 @ 5000kbps
- **Custom**: Define your own resolution and bitrate

## 🚀 Quick Start

### Prerequisites
- Node.js 14+ 
- FFmpeg installed and accessible in PATH
- Modern web browser with HLS support

### Installation

1. **Clone and Install Dependencies**
```bash
git clone <repository-url>
cd hls-video-segmentation
npm install
```

2. **Install FFmpeg** (if not already installed)

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Windows:**
Download from [FFmpeg official website](https://ffmpeg.org/download.html)

3. **Start the Server**
```bash
npm start
```

4. **Open Web Interface**
Navigate to `http://localhost:3000` in your browser

## 📖 Usage

### Web Interface

1. **Upload Video**: Select a video file and configure segmentation settings
2. **Monitor Processing**: Watch real-time progress during encoding
3. **Stream Video**: Select from available HLS streams
4. **Quality Control**: Manually select quality or use adaptive streaming
5. **Segment Navigation**: Use segment controls for precise seeking

### Command-Line Interface

**Basic Usage:**
```bash
# Segment a video with default settings
node scripts/segment-video.js input.mp4

# Custom output name and segment duration
node scripts/segment-video.js input.mp4 --output my-stream --duration 10

# Specific quality variants
node scripts/segment-video.js input.mp4 --qualities 480p,720p

# Custom output directory
node scripts/segment-video.js input.mp4 --output-dir /var/www/hls

# Custom quality with specific bitrates
node scripts/segment-video.js input.mp4 --qualities 854x480@1500k,1280x720@3000k
```

**CLI Options:**
- `--output <name>`: Output name (default: input filename)
- `--duration <seconds>`: Segment duration (default: 6)
- `--qualities <list>`: Comma-separated quality list
- `--output-dir <path>`: Output directory (default: ./hls_output)
- `--help`: Show help message

## 🔧 API Reference

### Upload Video
```http
POST /api/upload
Content-Type: multipart/form-data

Parameters:
- video: Video file
- segmentDuration: Segment duration in seconds (optional)
- outputName: Output name (optional)
```

### List Videos
```http
GET /api/videos

Response:
{
  "videos": [
    {
      "id": "video_id",
      "name": "video_name", 
      "masterPlaylistUrl": "/hls/video_id/master.m3u8",
      "qualities": [...],
      "createdAt": "timestamp"
    }
  ]
}
```

### Delete Video
```http
DELETE /api/videos/:videoId

Response:
{
  "success": true,
  "message": "Video deleted successfully"
}
```

### Health Check
```http
GET /api/health

Response:
{
  "status": "ok",
  "timestamp": "ISO timestamp",
  "ffmpeg": "available|not available"
}
```

### Serve HLS Files
```http
GET /hls/:videoId/master.m3u8
GET /hls/:videoId/:quality.m3u8
GET /hls/:videoId/:segment.ts
```

## 🏗️ Architecture

### File Structure
```
hls-video-segmentation/
├── index.html              # Web interface
├── main.js                 # Client-side HLS player
├── style.css               # Styling
├── server.js               # Express server
├── package.json            # Dependencies
├── scripts/
│   └── segment-video.js    # CLI segmentation tool
├── uploads/                # Temporary upload directory
└── hls_output/             # HLS output directory
    ├── video_id_1/
    │   ├── master.m3u8     # Master playlist
    │   ├── 480p.m3u8       # 480p variant playlist
    │   ├── 720p.m3u8       # 720p variant playlist
    │   ├── 1080p.m3u8      # 1080p variant playlist
    │   ├── 480p_000.ts     # 480p segments
    │   ├── 720p_000.ts     # 720p segments
    │   └── 1080p_000.ts    # 1080p segments
    └── video_id_2/
        └── ...
```

### Technology Stack
- **Frontend**: HTML5, CSS3, JavaScript (ES6+), Tailwind CSS
- **Backend**: Node.js, Express.js
- **Video Processing**: FFmpeg, fluent-ffmpeg
- **Storage**: File system, IndexedDB (client-side caching)
- **Streaming**: HLS.js, native HLS support

## ⚙️ Configuration

### Server Configuration
Modify `server.js` to customize:
- Port number (default: 3000)
- Upload file size limits (default: 500MB)
- Supported video formats
- Output directory paths

### Encoding Settings
Adjust quality presets in both `server.js` and `scripts/segment-video.js`:
```javascript
const qualities = [
  { name: '480p', width: 854, height: 480, bitrate: '1000k' },
  { name: '720p', width: 1280, height: 720, bitrate: '2500k' },
  { name: '1080p', width: 1920, height: 1080, bitrate: '5000k' }
];
```

### HLS Player Configuration
Customize player settings in `main.js`:
```javascript
this.hls = new Hls({
  enableWorker: true,
  maxBufferLength: 30,
  maxBufferSize: 60 * 1000 * 1000, // 60MB
  // ... other options
});
```

## 🔍 Troubleshooting

### Common Issues

**FFmpeg not found:**
- Ensure FFmpeg is installed and in system PATH
- Check with: `ffmpeg -version`

**Upload fails:**
- Check file size limits
- Verify supported video formats
- Ensure sufficient disk space

**Playback issues:**
- Check browser HLS support
- Verify network connectivity
- Clear cache and try again

**Performance optimization:**
- Adjust segment duration (trade-off between latency and efficiency)
- Optimize quality settings for target audience
- Use CDN for production deployment

### Debug Mode
Enable detailed logging:
```bash
DEBUG=* npm start
```

## 📱 Browser Compatibility

| Browser | HLS Support | Notes |
|---------|-------------|-------|
| Safari | Native | Full support |
| Chrome | HLS.js | Requires JavaScript |
| Firefox | HLS.js | Requires JavaScript |
| Edge | HLS.js | Requires JavaScript |
| Mobile Safari | Native | Full support |
| Mobile Chrome | HLS.js | Good performance |

## 🌐 Production Deployment

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /hls/ {
        root /path/to/hls_output;
        add_header Cache-Control "max-age=3600";
        add_header Access-Control-Allow-Origin "*";
    }
}
```

### Environment Variables
```bash
export PORT=3000
export NODE_ENV=production
export HLS_OUTPUT_DIR=/var/www/hls
export MAX_FILE_SIZE=1073741824  # 1GB
```

### Docker Deployment
```dockerfile
FROM node:16-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Resources

- [HLS.js Documentation](https://github.com/video-dev/hls.js/)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [HLS Specification](https://tools.ietf.org/html/rfc8216)
- [Apple HLS Authoring](https://developer.apple.com/streaming/)

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section
2. Search existing issues
3. Create a new issue with detailed information
4. Include browser/OS version and console logs