# YouTube-like Video Player with HLS Manifest Manipulation

A modern, YouTube-like video player that downloads HLS live streams, modifies the manifest to serve the first 3 segments locally from IndexedDB, and displays a spinner for online segments requiring internet connection.

## Features

### 🎥 Core Functionality
- **HLS Stream Support**: Load and play HLS live streams using HLS.js
- **Manifest Manipulation**: Automatically modifies HLS manifests to point first 3 segments to local URLs
- **Offline Caching**: Stores first 3 segments (approximately 15 seconds) in IndexedDB for offline playback
- **Smart Playback**: Seamlessly transitions from cached segments to online streaming

### 🔄 Offline Capabilities
- **Local Segment Serving**: Service Worker intercepts local segment requests and serves from IndexedDB
- **Offline Playback**: Watch cached segments even without internet connection
- **Persistent Storage**: Segments remain cached across browser sessions
- **Cache Management**: Clear cache functionality with visual feedback

### 🎨 User Experience
- **YouTube-like Interface**: Modern, responsive design with dark theme
- **Loading Spinners**: Visual feedback during video loading and online segment fetching
- **Real-time Status**: Network status, segment information, and cache status display
- **Debug Information**: Live debug log for troubleshooting

### 📊 Monitoring & Debug
- **Segment Tracking**: Real-time segment playback information
- **Network Status**: Online/offline status with automatic detection
- **Cache Status**: Visual indication of cached segments
- **Debug Console**: Live logging of all operations

## How It Works

### 1. Manifest Download & Parsing
```javascript
// Downloads the HLS manifest and parses segment URLs
const { content: manifestContent, segments } = await downloadManifest(streamUrl);
```

### 2. Segment Caching
```javascript
// Downloads and caches the first 3 segments in IndexedDB
await downloadAndCacheFirstSegments(segments, baseUrl);
```

### 3. Manifest Modification
```javascript
// Creates modified manifest with local URLs for first 3 segments
modifiedManifest = createModifiedManifest(manifestContent, baseUrl, segments);
// Original: https://example.com/segment1.ts
// Modified: http://localhost/playlist.m3u8/segment1.ts
```

### 4. Service Worker Interception
```javascript
// Service Worker intercepts local segment requests
if (url.hostname === 'localhost' && url.pathname.includes('/playlist.m3u8/segment')) {
    event.respondWith(handleLocalSegmentRequest(event.request));
}
```

### 5. Online Segment Spinner
```javascript
// Shows spinner for segments 4+ (online segments)
if (currentSegmentIndex >= 3) {
    showOnlineSegmentSpinner();
}
```

## Usage

### 1. Load a Stream
1. Enter an HLS stream URL in the input field
2. Click "Load Stream" or press Enter
3. The player will automatically:
   - Download the manifest
   - Cache the first 3 segments
   - Modify the manifest
   - Start playback

### 2. Offline Playback
- Once segments are cached, you can:
  - Close the browser
  - Disconnect from the internet
  - Reopen the browser
  - Still watch the first 15 seconds (3 segments) of the video

### 3. Online Streaming
- After the first 3 segments, a spinner appears
- The player fetches remaining segments from the original URL
- Requires internet connection for segments 4+

## Technical Architecture

### File Structure
```
├── index.html          # Main HTML interface
├── script.js           # Core application logic
├── sw.js              # Service Worker for local segment serving
├── style.css          # Custom styling
└── README.md          # This file
```

### Key Components

#### 1. IndexedDB Storage
- **Database**: `HLSVideoCacheDB`
- **Object Stores**: 
  - `videoSegments`: Stores segment data as ArrayBuffer
  - `manifests`: Stores original manifest content

#### 2. Service Worker
- **Registration**: Automatic registration on page load
- **Interception**: Handles `http://localhost/playlist.m3u8/segment*.ts` requests
- **Serving**: Returns cached segments from IndexedDB

#### 3. HLS.js Integration
- **Manifest Loading**: Loads modified manifest via blob URL
- **Event Handling**: Tracks segment loading and playback
- **Error Recovery**: Automatic error recovery for network issues

#### 4. UI Components
- **Video Player**: HTML5 video with HLS.js
- **Loading Overlays**: Multiple loading states with spinners
- **Status Display**: Real-time network and cache status
- **Debug Console**: Live operation logging

## Browser Compatibility

### Required Features
- **Service Workers**: For local segment serving
- **IndexedDB**: For segment caching
- **HLS.js**: For HLS playback (or native HLS support in Safari)
- **Fetch API**: For downloading manifests and segments

### Supported Browsers
- ✅ Chrome 40+
- ✅ Firefox 44+
- ✅ Safari 11.1+
- ✅ Edge 17+

## API Reference

### Core Functions

#### `loadVideoStream(streamUrl)`
Loads and plays an HLS stream with offline caching.

#### `downloadAndCacheFirstSegments(segments, baseUrl)`
Downloads and caches the first 3 segments in IndexedDB.

#### `createModifiedManifest(originalManifest, baseUrl, segments)`
Creates a modified manifest with local URLs for first 3 segments.

#### `clearCache()`
Clears all cached data from IndexedDB.

### Event Handlers

#### HLS Events
- `MANIFEST_PARSED`: Manifest successfully parsed
- `FRAG_LOADED`: Segment loaded (triggers spinner for online segments)
- `FRAG_PARSED`: Segment parsed (hides spinner)
- `ERROR`: Error handling with automatic recovery

#### Network Events
- `online`: Network connection restored
- `offline`: Network connection lost

## Configuration

### HLS.js Options
```javascript
hls = new Hls({
    debug: false,
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 90
});
```

### IndexedDB Configuration
```javascript
const request = indexedDB.open('HLSVideoCacheDB', 1);
```

### Service Worker Registration
```javascript
const registration = await navigator.serviceWorker.register('/sw.js');
```

## Troubleshooting

### Common Issues

#### 1. "HLS is not supported in this browser"
- **Solution**: Use a modern browser with HLS.js support
- **Alternative**: Use Safari which has native HLS support

#### 2. "Service Worker registration failed"
- **Cause**: HTTPS required for Service Workers
- **Solution**: Serve over HTTPS or use localhost for development

#### 3. "Segment not found in IndexedDB"
- **Cause**: Segments not properly cached
- **Solution**: Check network connection and try reloading

#### 4. "Manifest download failed"
- **Cause**: CORS issues or invalid URL
- **Solution**: Ensure the HLS stream URL is accessible and CORS-enabled

### Debug Information
The debug console shows real-time information about:
- Manifest download status
- Segment caching progress
- HLS.js events
- Network status changes
- Error messages

## Performance Considerations

### Memory Usage
- Segments are stored as ArrayBuffer in IndexedDB
- Blob URLs are created for manifest serving
- Memory is automatically cleaned up when segments are no longer needed

### Network Optimization
- Only first 3 segments are cached (approximately 15 seconds)
- Remaining segments are streamed on-demand
- Automatic error recovery for network issues

### Storage Limits
- IndexedDB storage is limited by available disk space
- Cache can be cleared manually via "Clear Cache" button
- Old segments are not automatically expired

## Future Enhancements

### Planned Features
- **Adaptive Bitrate**: Support for multiple quality levels
- **Background Sync**: Automatic segment preloading
- **Push Notifications**: Notify when new segments are available
- **Analytics**: Detailed playback analytics
- **Custom Controls**: YouTube-like custom video controls

### Technical Improvements
- **WebAssembly**: Faster segment processing
- **WebRTC**: Real-time streaming capabilities
- **WebCodecs**: Hardware-accelerated video decoding
- **SharedArrayBuffer**: More efficient memory usage

## License

This project is open source and available under the MIT License.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

---

**Note**: This player is designed for educational and demonstration purposes. For production use, consider additional security measures, error handling, and performance optimizations.