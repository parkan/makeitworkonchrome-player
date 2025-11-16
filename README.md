# HLS Player for Chrome H.264 Sync Fix

Minimal HLS.js player that bypasses Chrome's broken H.264 decoder.

## Problem Solved
Chrome has a documented H.264 decoder bug that causes audio/video desync with certain VAAPI-encoded MP4 files. This player uses HLS streaming with software decoding to bypass the issue entirely.

## Usage

### 1. Convert MP4 to HLS
```bash
ffmpeg -i input.mp4 -c copy -start_number 0 -hls_time 10 -hls_list_size 0 -f hls output.m3u8
```

### 2. Basic Implementation
```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script src="player.js"></script>
<video id="video" controls></video>
<script>
    new HLSPlayer('video', '/path/to/playlist.m3u8');
</script>
```

### 3. Advanced Usage
```javascript
const player = new HLSPlayer('video', '/output.m3u8');

// Destroy when done
player.destroy();
```

## Requirements
- Modern browser with Media Source Extensions support
- HLS playlist (.m3u8) and segments (.ts files)
- Web server with proper CORS headers for video serving

## How It Works
1. MP4 is segmented into HLS format (small .ts chunks)
2. HLS.js fetches and decodes segments using software decoder
3. Chrome's buggy H.264 hardware decoder is completely bypassed
4. Result: Perfect audio/video synchronization

## Browser Support
- Chrome/Edge: Uses HLS.js with MSE
- Safari: Native HLS support
- Firefox: Uses HLS.js with MSE

## License
MIT