class WalkieTalkie {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = new Map();
        this.nickname = '';
        this.channel = 'general';
        this.isTalking = false;
        this.isAdmin = false;
        this.isMuted = false;
        this.isCamOn = false;
        this.isMicOn = true;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;

        this.loginScreen = document.getElementById('loginScreen');
        this.appScreen = document.getElementById('appScreen');
        this.nicknameInput = document.getElementById('nicknameInput');
        this.channelInput = document.getElementById('channelInput');
        this.adminCheck = document.getElementById('adminCheck');
        this.adminPasswordGroup = document.getElementById('adminPasswordGroup');
        this.adminPassword = document.getElementById('adminPassword');
        this.errorMessage = document.getElementById('errorMessage');
        this.joinBtn = document.getElementById('joinBtn');
        this.pttButton = document.getElementById('pttButton');
        this.pttStatus = document.getElementById('pttStatus');
        this.usersContainer = document.getElementById('usersContainer');
        this.channelBadge = document.getElementById('channelBadge');
        this.adminBadge = document.getElementById('adminBadge');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.visualizer = document.getElementById('visualizer');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.kickedOverlay = document.getElementById('kickedOverlay');
        this.localVideo = document.getElementById('localVideo');
        this.videoGrid = document.getElementById('videoGrid');
        this.camBtn = document.getElementById('camBtn');
        this.micBtn = document.getElementById('micBtn');
        this.leaveBtn = document.getElementById('leaveBtn');

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

        this.adminCheck.addEventListener('change', () => {
            this.adminPasswordGroup.classList.toggle('show', this.adminCheck.checked);
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

        this.camBtn.addEventListener('click', () => this.toggleCamera());
        this.micBtn.addEventListener('click', () => this.toggleMic());
        this.leaveBtn.addEventListener('click', () => this.leaveChannel());

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.isTalking && this.appScreen.style.display !== 'none' && !this.isMuted) {
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

    showError(msg) {
        this.errorMessage.textContent = msg;
        this.errorMessage.classList.add('show');
        setTimeout(() => this.errorMessage.classList.remove('show'), 4000);
    }

    async joinChannel() {
        this.nickname = this.nicknameInput.value.trim() || 'Anonymous';
        this.channel = this.channelInput.value.trim() || 'general';
        const isAdmin = this.adminCheck.checked;
        const adminPassword = isAdmin ? this.adminPassword.value : '';

        if (this.nickname.length < 2) {
            this.showError('Please enter a nickname (at least 2 characters)');
            return;
        }

        if (isAdmin && !adminPassword) {
            this.showError('Please enter admin password');
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

            this.localVideo.srcObject = this.localStream;

            this.setupAudioVisualization();

            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });

            this.connectSocket(isAdmin, adminPassword);

        } catch (err) {
            console.error('Error accessing microphone:', err);
            this.showError('Could not access microphone. Please allow microphone permission and try again.');
        }
    }

    connectSocket(isAdmin, adminPassword) {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus('connected');
            this.socket.emit('join', {
                nickname: this.nickname,
                channel: this.channel,
                isAdmin: isAdmin,
                adminPassword: adminPassword
            });
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('join-error', (data) => {
            this.showError(data.message);
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
        });

        this.socket.on('join-success', (data) => {
            this.isAdmin = data.isAdmin;
            if (this.isAdmin) {
                this.adminBadge.style.display = 'inline-block';
            }
            data.users.forEach(user => {
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
            this.removeRemoteVideo(user.id);
        });

        this.socket.on('user-talking', (data) => {
            this.updateUserTalkingStatus(data.id, data.status);
        });

        this.socket.on('user-muted', (data) => {
            this.updateUserMuteStatus(data.id, data.muted);
        });

        this.socket.on('kicked', (data) => {
            this.kickedOverlay.querySelector('p').textContent = data.message;
            this.kickedOverlay.classList.add('show');
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
        });

        this.socket.on('muted', (data) => {
            this.isMuted = data.muted;
            if (this.isMuted) {
                this.pttButton.disabled = true;
                this.pttStatus.textContent = '🔇 You are muted by admin';
                this.pttStatus.classList.add('muted');
                this.stopTalking();
            } else {
                this.pttButton.disabled = false;
                this.pttStatus.textContent = 'Hold button to talk';
                this.pttStatus.classList.remove('muted');
            }
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
                this.addRemoteVideo(peerId, event.streams[0]);
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

    addRemoteVideo(peerId, stream) {
        let container = document.getElementById(`video-container-${peerId}`);
        if (!container) {
            container = document.createElement('div');
            container.className = 'video-container';
            container.id = `video-container-${peerId}`;
            
            const video = document.createElement('video');
            video.id = `video-${peerId}`;
            video.autoplay = true;
            video.playsInline = true;
            
            const label = document.createElement('span');
            label.className = 'video-label';
            label.id = `video-label-${peerId}`;
            
            const muteIcon = document.createElement('span');
            muteIcon.className = 'video-mute-icon';
            muteIcon.textContent = '🔇';
            
            container.appendChild(video);
            container.appendChild(label);
            container.appendChild(muteIcon);
            this.videoGrid.appendChild(container);
        }
        const video = container.querySelector('video');
        video.srcObject = stream;
        video.play().catch(err => console.log('Video play error:', err));
        
        const user = Array.from(this.usersContainer.children).find(el => el.id === `user-${peerId}`);
        if (user) {
            const name = user.querySelector('.user-name');
            if (name) {
                document.getElementById(`video-label-${peerId}`).textContent = name.textContent.replace('ADMIN', '').trim();
            }
        }
    }

    removeRemoteVideo(peerId) {
        const container = document.getElementById(`video-container-${peerId}`);
        if (container) {
            container.remove();
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

    async toggleCamera() {
        if (!this.localStream) return;
        
        const videoTracks = this.localStream.getVideoTracks();
        
        if (this.isCamOn) {
            videoTracks.forEach(track => {
                track.stop();
                this.localStream.removeTrack(track);
            });
            this.isCamOn = false;
            this.camBtn.classList.remove('active');
            this.localVideo.srcObject = this.localStream;
        } else {
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                const videoTrack = videoStream.getVideoTracks()[0];
                this.localStream.addTrack(videoTrack);
                this.isCamOn = true;
                this.camBtn.classList.add('active');
                this.localVideo.srcObject = this.localStream;
                
                this.peers.forEach((pc, peerId) => {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    } else {
                        pc.addTrack(videoTrack, this.localStream);
                    }
                });
            } catch (err) {
                console.error('Error accessing camera:', err);
                this.showError('Could not access camera');
            }
        }
    }

    toggleMic() {
        if (!this.localStream) return;
        
        const audioTracks = this.localStream.getAudioTracks();
        this.isMicOn = !this.isMicOn;
        
        audioTracks.forEach(track => {
            track.enabled = this.isMicOn;
        });
        
        if (this.isMicOn) {
            this.micBtn.classList.remove('off');
            this.micBtn.classList.add('active');
        } else {
            this.micBtn.classList.remove('active');
            this.micBtn.classList.add('off');
        }
    }

    leaveChannel() {
        if (this.socket) {
            this.socket.disconnect();
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        location.reload();
    }

    startTalking() {
        if (this.isTalking || this.isMuted || !this.isMicOn) return;
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
        if (!this.isMuted) {
            this.pttStatus.textContent = 'Hold button to talk';
        }
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
        userEl.className = 'user-item' + (user.isAdmin ? ' admin' : '');
        userEl.id = `user-${user.id}`;
        
        const adminActions = this.isAdmin && !user.isAdmin ? `
            <div class="admin-actions">
                <button class="admin-btn kick" onclick="walkieTalkie.kickUser('${user.id}')">Kick</button>
                <button class="admin-btn mute" id="mute-btn-${user.id}" onclick="walkieTalkie.muteUser('${user.id}')">Mute</button>
            </div>
        ` : '';
        
        userEl.innerHTML = `
            <div class="user-avatar">
                ${user.nickname.charAt(0).toUpperCase()}
                ${user.isAdmin ? '<span class="admin-icon">👑</span>' : ''}
            </div>
            <div class="user-info">
                <div class="user-name">${this.escapeHtml(user.nickname)}${user.isAdmin ? '<span class="admin-label">ADMIN</span>' : ''}</div>
                <div class="user-status">Idle</div>
            </div>
            <div class="talking-indicator"></div>
            ${adminActions}
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

    updateUserMuteStatus(userId, muted) {
        const userEl = document.getElementById(`user-${userId}`);
        if (userEl) {
            if (muted) {
                userEl.classList.add('muted');
                userEl.querySelector('.user-status').textContent = '🔇 Muted';
            } else {
                userEl.classList.remove('muted');
                userEl.querySelector('.user-status').textContent = 'Idle';
            }
            const muteBtn = document.getElementById(`mute-btn-${userId}`);
            if (muteBtn) {
                muteBtn.textContent = muted ? 'Unmute' : 'Mute';
                muteBtn.className = muted ? 'admin-btn unmute' : 'admin-btn mute';
                muteBtn.setAttribute('onclick', muted ? 
                    `walkieTalkie.unmuteUser('${userId}')` : 
                    `walkieTalkie.muteUser('${userId}')`);
            }
        }
        const videoContainer = document.getElementById(`video-container-${userId}`);
        if (videoContainer) {
            videoContainer.classList.toggle('muted', muted);
        }
    }

    kickUser(userId) {
        if (this.socket && this.isAdmin) {
            this.socket.emit('kick-user', { targetId: userId });
        }
    }

    muteUser(userId) {
        if (this.socket && this.isAdmin) {
            this.socket.emit('mute-user', { targetId: userId });
        }
    }

    unmuteUser(userId) {
        if (this.socket && this.isAdmin) {
            this.socket.emit('unmute-user', { targetId: userId });
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

let walkieTalkie;
document.addEventListener('DOMContentLoaded', () => {
    walkieTalkie = new WalkieTalkie();
});
