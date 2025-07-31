#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');

// Command line argument parsing
const args = process.argv.slice(2);

function showUsage() {
  console.log(`
🎬 HLS Video Segmentation Tool

Usage: node segment-video.js <input-video> [options]

Options:
  --output <name>        Output name (default: video filename)
  --duration <seconds>   Segment duration in seconds (default: 6)
  --qualities <list>     Comma-separated quality list (default: 480p,720p,1080p)
  --output-dir <path>    Output directory (default: ./hls_output)
  --help                 Show this help message

Quality formats:
  480p   = 854x480   @ 1000k bitrate
  720p   = 1280x720  @ 2500k bitrate
  1080p  = 1920x1080 @ 5000k bitrate
  custom = widthxheight@bitrate (e.g., 1280x720@2000k)

Examples:
  node segment-video.js video.mp4
  node segment-video.js video.mp4 --output my-stream --duration 10
  node segment-video.js video.mp4 --qualities 480p,720p --output-dir /var/www/hls
  node segment-video.js video.mp4 --qualities 854x480@1500k,1280x720@3000k
`);
}

function parseArguments() {
  if (args.length === 0 || args.includes('--help')) {
    showUsage();
    process.exit(0);
  }

  const inputFile = args[0];
  const options = {
    inputFile,
    outputName: path.parse(inputFile).name,
    segmentDuration: 6,
    qualities: ['480p', '720p', '1080p'],
    outputDir: './hls_output'
  };

  for (let i = 1; i < args.length; i += 2) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--output':
        options.outputName = value;
        break;
      case '--duration':
        options.segmentDuration = parseInt(value);
        break;
      case '--qualities':
        options.qualities = value.split(',');
        break;
      case '--output-dir':
        options.outputDir = value;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

function parseQuality(qualityStr) {
  const presets = {
    '480p': { name: '480p', width: 854, height: 480, bitrate: '1000k' },
    '720p': { name: '720p', width: 1280, height: 720, bitrate: '2500k' },
    '1080p': { name: '1080p', width: 1920, height: 1080, bitrate: '5000k' }
  };

  if (presets[qualityStr]) {
    return presets[qualityStr];
  }

  // Parse custom format: widthxheight@bitrate
  const customMatch = qualityStr.match(/^(\d+)x(\d+)@(\d+k?)$/);
  if (customMatch) {
    const [, width, height, bitrate] = customMatch;
    return {
      name: `${width}x${height}`,
      width: parseInt(width),
      height: parseInt(height),
      bitrate: bitrate.endsWith('k') ? bitrate : `${bitrate}k`
    };
  }

  throw new Error(`Invalid quality format: ${qualityStr}. Use preset (480p, 720p, 1080p) or custom (widthxheight@bitrate)`);
}

class CLIHLSSegmenter {
  constructor(options) {
    this.options = options;
    this.outputDir = path.resolve(options.outputDir);
    this.videoOutputDir = path.join(this.outputDir, options.outputName);
  }

  async init() {
    await fs.ensureDir(this.videoOutputDir);
  }

  async getVideoInfo() {
    return new Promise((resolve, reject) => {
      console.log('📋 Analyzing input video...');
      
      ffmpeg.ffprobe(this.options.inputFile, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to analyze video: ${err.message}`));
        } else {
          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
          
          if (!videoStream) {
            reject(new Error('No video stream found in input file'));
            return;
          }

          const info = {
            duration: metadata.format.duration,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            video: {
              codec: videoStream.codec_name,
              width: videoStream.width,
              height: videoStream.height,
              fps: videoStream.r_frame_rate,
              pixelFormat: videoStream.pix_fmt
            },
            audio: audioStream ? {
              codec: audioStream.codec_name,
              bitrate: audioStream.bit_rate,
              sampleRate: audioStream.sample_rate,
              channels: audioStream.channels
            } : null
          };

          console.log(`📺 Video: ${info.video.width}x${info.video.height} ${info.video.codec} @ ${info.video.fps} fps`);
          console.log(`🎵 Audio: ${info.audio ? `${info.audio.codec} @ ${info.audio.sampleRate}Hz` : 'None'}`);
          console.log(`⏱️  Duration: ${Math.floor(info.duration / 60)}:${(info.duration % 60).toFixed(0).padStart(2, '0')}`);
          console.log(`💾 Size: ${(info.size / 1024 / 1024).toFixed(1)}MB`);

          resolve(info);
        }
      });
    });
  }

  async processQualities() {
    const qualities = this.options.qualities.map(q => parseQuality(q));
    
    console.log(`\n🎯 Processing ${qualities.length} quality variant(s):`);
    qualities.forEach(q => {
      console.log(`   • ${q.name}: ${q.width}x${q.height} @ ${q.bitrate}`);
    });

    // Create master playlist
    const masterPlaylist = this.createMasterPlaylist(qualities);
    
    // Process each quality variant
    const startTime = Date.now();
    
    for (const quality of qualities) {
      console.log(`\n🔄 Processing ${quality.name}...`);
      await this.processQualityVariant(quality);
    }

    // Write master playlist
    const masterPlaylistPath = path.join(this.videoOutputDir, 'master.m3u8');
    await fs.writeFile(masterPlaylistPath, masterPlaylist);
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\n✅ Segmentation completed in ${duration.toFixed(1)}s`);
    console.log(`📂 Output directory: ${this.videoOutputDir}`);
    console.log(`🎬 Master playlist: ${masterPlaylistPath}`);
  }

  async processQualityVariant(quality) {
    return new Promise((resolve, reject) => {
      const outputPattern = path.join(this.videoOutputDir, `${quality.name}_%03d.ts`);
      const playlistPath = path.join(this.videoOutputDir, `${quality.name}.m3u8`);

      let lastProgress = 0;

      ffmpeg(this.options.inputFile)
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          `-b:v ${quality.bitrate}`,
          '-b:a 128k',
          `-s ${quality.width}x${quality.height}`,
          '-profile:v baseline',
          '-level 3.0',
          '-start_number 0',
          '-hls_time ' + this.options.segmentDuration,
          '-hls_list_size 0',
          '-f hls',
          '-hls_segment_filename ' + outputPattern,
          '-preset fast',
          '-crf 23'
        ])
        .output(playlistPath)
        .on('start', (commandLine) => {
          console.log(`   Starting ${quality.name} encoding...`);
        })
        .on('progress', (progress) => {
          const percent = Math.floor(progress.percent || 0);
          if (percent > lastProgress + 5) { // Update every 5%
            console.log(`   ${quality.name}: ${percent}% complete`);
            lastProgress = percent;
          }
        })
        .on('end', () => {
          console.log(`   ✅ ${quality.name} completed`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`   ❌ ${quality.name} failed:`, err.message);
          reject(err);
        })
        .run();
    });
  }

  createMasterPlaylist(qualities) {
    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    for (const quality of qualities) {
      const bandwidth = parseInt(quality.bitrate.replace('k', '')) * 1000;
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${quality.width}x${quality.height}\n`;
      playlist += `${quality.name}.m3u8\n\n`;
    }
    
    return playlist;
  }

  async segment() {
    try {
      console.log('🎬 HLS Video Segmentation Tool\n');
      
      // Check if input file exists
      if (!await fs.pathExists(this.options.inputFile)) {
        throw new Error(`Input file not found: ${this.options.inputFile}`);
      }

      await this.init();
      const videoInfo = await this.getVideoInfo();
      await this.processQualities();

      console.log('\n🎉 HLS segmentation completed successfully!');
      console.log('\nTo test the stream:');
      console.log(`1. Start a web server in the output directory`);
      console.log(`2. Open master.m3u8 in a HLS-compatible player`);
      console.log(`3. Or use: node server.js (from the project root)`);

    } catch (error) {
      console.error('\n❌ Segmentation failed:', error.message);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  try {
    const options = parseArguments();
    const segmenter = new CLIHLSSegmenter(options);
    await segmenter.segment();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = CLIHLSSegmenter;