class WalkieTalkie {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = new Map();
        this.nickname = '';
        this.channel = 'general';
        this.isTalking = false;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;

        this.loginScreen = document.getElementById('loginScreen');
        this.appScreen = document.getElementById('appScreen');
        this.nicknameInput = document.getElementById('nicknameInput');
        this.channelInput = document.getElementById('channelInput');
        this.joinBtn = document.getElementById('joinBtn');
        this.pttButton = document.getElementById('pttButton');
        this.pttStatus = document.getElementById('pttStatus');
        this.usersContainer = document.getElementById('usersContainer');
        this.channelBadge = document.getElementById('channelBadge');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.visualizer = document.getElementById('visualizer');
        this.volumeSlider = document.getElementById('volumeSlider');

        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        this.init();
    }

    init() {
        this.joinBtn.addEventListener('click', () => this.joinChannel());
        this.nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinChannel();
        });

        this.pttButton.addEventListener('mousedown', () => this.startTalking());
        this.pttButton.addEventListener('mouseup', () => this.stopTalking());
        this.pttButton.addEventListener('mouseleave', () => this.stopTalking());

        this.pttButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startTalking();
        });
        this.pttButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopTalking();
        });

        this.volumeSlider.addEventListener('input', (e) => {
            const volume = e.target.value / 100;
            document.querySelectorAll('audio').forEach(audio => {
                audio.volume = volume;
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.isTalking && this.appScreen.style.display !== 'none') {
                e.preventDefault();
                this.startTalking();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && this.isTalking) {
                e.preventDefault();
                this.stopTalking();
            }
        });
    }

    async joinChannel() {
        this.nickname = this.nicknameInput.value.trim() || 'Anonymous';
        this.channel = this.channelInput.value.trim() || 'general';

        if (this.nickname.length < 2) {
            alert('Please enter a nickname (at least 2 characters)');
            return;
        }

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                },
                video: false
            });

            this.setupAudioVisualization();

            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });

            this.connectSocket();

        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Could not access microphone. Please allow microphone permission and try again.');
        }
    }

    connectSocket() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus('connected');
            this.socket.emit('join', {
                nickname: this.nickname,
                channel: this.channel
            });
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('channel-users', (users) => {
            users.forEach(user => {
                this.addUserToList(user);
                this.createPeerConnection(user.id, true);
            });
        });

        this.socket.on('user-joined', (user) => {
            console.log('User joined:', user.nickname);
            this.addUserToList(user);
            this.createPeerConnection(user.id, false);
        });

        this.socket.on('user-left', (user) => {
            console.log('User left:', user.nickname);
            this.removeUserFromList(user.id);
            this.closePeerConnection(user.id);
        });

        this.socket.on('user-talking', (data) => {
            this.updateUserTalkingStatus(data.id, data.status);
        });

        this.socket.on('offer', async (data) => {
            await this.handleOffer(data);
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data);
        });

        this.loginScreen.style.display = 'none';
        this.appScreen.style.display = 'block';
        this.channelBadge.textContent = this.channel;
    }

    async createPeerConnection(peerId, isInitiator) {
        try {
            const pc = new RTCPeerConnection(this.iceServers);
            this.peers.set(peerId, pc);

            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });

            pc.ontrack = (event) => {
                console.log('Received remote stream from:', peerId);
                this.playRemoteStream(peerId, event.streams[0]);
            };

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('ice-candidate', {
                        targetId: peerId,
                        candidate: event.candidate
                    });
                }
            };

            pc.onconnectionstatechange = () => {
                console.log(`Connection state with ${peerId}:`, pc.connectionState);
            };

            if (isInitiator) {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.socket.emit('offer', {
                    targetId: peerId,
                    offer: offer
                });
            }

        } catch (err) {
            console.error('Error creating peer connection:', err);
        }
    }

    async handleOffer(data) {
        try {
            const { senderId, offer } = data;
            let pc = this.peers.get(senderId);
            if (!pc) {
                await this.createPeerConnection(senderId, false);
                pc = this.peers.get(senderId);
            }
            await pc.setRemoteDescription(offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.socket.emit('answer', {
                targetId: senderId,
                answer: answer
            });
        } catch (err) {
            console.error('Error handling offer:', err);
        }
    }

    async handleAnswer(data) {
        try {
            const { senderId, answer } = data;
            const pc = this.peers.get(senderId);
            if (pc) {
                await pc.setRemoteDescription(answer);
            }
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    }

    async handleIceCandidate(data) {
        try {
            const { senderId, candidate } = data;
            const pc = this.peers.get(senderId);
            if (pc) {
                await pc.addIceCandidate(candidate);
            }
        } catch (err) {
            console.error('Error handling ICE candidate:', err);
        }
    }

    playRemoteStream(peerId, stream) {
        let audio = document.getElementById(`audio-${peerId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${peerId}`;
            audio.autoplay = true;
            audio.volume = this.volumeSlider.value / 100;
            document.body.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(err => console.log('Audio play error:', err));
    }

    startTalking() {
        if (this.isTalking) return;
        this.isTalking = true;
        this.pttButton.classList.add('active');
        this.pttStatus.textContent = '🎙️ TRANSMITTING...';
        this.pttStatus.classList.add('transmitting');
        this.visualizer.classList.add('active');

        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = true;
            });
        }

        if (this.socket) {
            this.socket.emit('ptt-pressed');
        }

        this.animateVisualizer();
    }

    stopTalking() {
        if (!this.isTalking) return;
        this.isTalking = false;
        this.pttButton.classList.remove('active');
        this.pttStatus.textContent = 'Hold button to talk';
        this.pttStatus.classList.remove('transmitting');
        this.visualizer.classList.remove('active');

        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }

        if (this.socket) {
            this.socket.emit('ptt-released');
        }
    }

    setupAudioVisualization() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 64;
        source.connect(this.analyser);
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    }

    animateVisualizer() {
        if (!this.isTalking) return;
        this.analyser.getByteFrequencyData(this.dataArray);
        const bars = this.visualizer.querySelectorAll('.bar');
        bars.forEach((bar, index) => {
            const value = this.dataArray[index * 2] || 0;
            const height = Math.max(5, (value / 255) * 40);
            bar.style.height = `${height}px`;
        });
        requestAnimationFrame(() => this.animateVisualizer());
    }

    addUserToList(user) {
        const existing = document.getElementById(`user-${user.id}`);
        if (existing) return;
        const userEl = document.createElement('div');
        userEl.className = 'user-item';
        userEl.id = `user-${user.id}`;
        userEl.innerHTML = `
            <div class="user-avatar">${user.nickname.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${this.escapeHtml(user.nickname)}</div>
                <div class="user-status">Idle</div>
            </div>
            <div class="talking-indicator"></div>
        `;
        this.usersContainer.appendChild(userEl);
    }

    removeUserFromList(userId) {
        const userEl = document.getElementById(`user-${userId}`);
        if (userEl) {
            userEl.remove();
        }
    }

    updateUserTalkingStatus(userId, status) {
        const userEl = document.getElementById(`user-${userId}`);
        if (userEl) {
            if (status === 'talking') {
                userEl.classList.add('talking');
                userEl.querySelector('.user-status').textContent = '🔊 Talking...';
            } else {
                userEl.classList.remove('talking');
                userEl.querySelector('.user-status').textContent = 'Idle';
            }
        }
    }

    closePeerConnection(peerId) {
        const pc = this.peers.get(peerId);
        if (pc) {
            pc.close();
            this.peers.delete(peerId);
        }
        const audio = document.getElementById(`audio-${peerId}`);
        if (audio) {
            audio.remove();
        }
    }

    updateConnectionStatus(status) {
        this.connectionStatus.className = `connection-status ${status}`;
        this.connectionStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new WalkieTalkie();
});
