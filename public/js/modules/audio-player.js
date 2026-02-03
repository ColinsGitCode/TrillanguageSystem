/**
 * 全局音频播放器
 */

export class AudioPlayer {
    constructor() {
        this.currentAudio = null;
        this.currentBtn = null;
        this.playlist = []; // { url, btn }
        this.currentIndex = -1;
    }

    play(url, btnElement) {
        // 如果点击的是当前正在播放的按钮，则暂停
        if (this.currentAudio && this.currentAudio.src.endsWith(encodeURI(url)) && !this.currentAudio.paused) {
            this.pause();
            return;
        }

        this.stop(); // 停止之前的

        this.currentAudio = new Audio(url);
        this.currentBtn = btnElement;

        // UI 更新
        if (this.currentBtn) {
            this.currentBtn.classList.add('playing');
            this.currentBtn.textContent = '||'; // Pause icon
        }

        this.currentAudio.play().catch(e => {
            console.error('Play failed:', e);
            this.resetBtn();
        });

        this.currentAudio.onended = () => {
            this.resetBtn();
            this.currentAudio = null;
            // 可以在这里实现连播逻辑
        };

        this.currentAudio.onerror = () => {
            console.error('Audio load error');
            if (this.currentBtn) this.currentBtn.style.color = 'red';
            this.resetBtn();
        };
    }

    pause() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.resetBtn();
        }
    }

    stop() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.resetBtn();
        }
        this.currentAudio = null;
    }

    resetBtn() {
        if (this.currentBtn) {
            this.currentBtn.classList.remove('playing');
            this.currentBtn.textContent = '▶'; // Play icon
            this.currentBtn = null;
        }
        // 清除所有播放状态（防止UI不同步）
        document.querySelectorAll('.audio-btn').forEach(b => {
            b.classList.remove('playing');
            b.textContent = '▶';
        });
    }
}

export const player = new AudioPlayer();
