class HLSPlayer {
    constructor(videoElementId, hlsUrl) {
        this.video = document.getElementById(videoElementId);
        this.hlsUrl = hlsUrl;
        this.hls = null;

        this.init();
    }

    init() {
        if (Hls.isSupported()) {
            this.hls = new Hls({
                enableWorker: true,
                backBufferLength: 90
            });

            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('HLS manifest loaded');
                this.video.play().catch(e => {
                    console.log('Autoplay blocked - click play manually');
                });
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.error('Fatal HLS error:', data);
                    switch(data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            this.hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            this.hls.recoverMediaError();
                            break;
                        default:
                            this.destroy();
                            break;
                    }
                }
            });

            this.hls.loadSource(this.hlsUrl);
            this.hls.attachMedia(this.video);

        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.video.src = this.hlsUrl;
            this.video.addEventListener('loadedmetadata', () => {
                this.video.play();
            });
        } else {
            console.error('HLS not supported');
        }
    }

    destroy() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const player = new HLSPlayer('video', '/output.m3u8');
});