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
        
        this.chatInput = document.getElementById('chatInput');
        this.chatSendBtn = document.getElementById('chatSendBtn');
        this.chatMessages = document.getElementById('chatMessages');

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
        const isLoginPage = this.joinBtn !== null;

        if (isLoginPage) {
            this.joinBtn.addEventListener('click', () => this.joinChannel());
            this.nicknameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.joinChannel();
            });
            this.adminCheck.addEventListener('change', () => {
                this.adminPasswordGroup.classList.toggle('show', this.adminCheck.checked);
            });
        } else {
            this.nickname = 'User-' + Math.floor(Math.random() * 10000);
            this.channel = 'general';
            this.autoJoin();
        }

        if (this.pttButton) {
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
        }

        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', (e) => {
                const volume = e.target.value / 100;
                document.querySelectorAll('audio').forEach(audio => {
                    audio.volume = volume;
                });
            });
        }

        if (this.chatSendBtn) {
            this.chatSendBtn.addEventListener('click', () => this.sendChatMessage());
        }
        if (this.chatInput) {
            this.chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendChatMessage();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.isTalking && this.appScreen && this.appScreen.style.display !== 'none' && !this.isMuted) {
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
        if (!this.errorMessage) return;
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

    async autoJoin() {
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

            this.connectSocket(false, '');

        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Could not access microphone. Please allow microphone permission and try again.');
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
            if (this.isAdmin && this.adminBadge) {
                this.adminBadge.style.display = 'inline-block';
            }
            data.users.forEach(user => {
                this.addUserToList(user);
                this.createPeerConnection(user.id, true);
            });
            if (this.loginScreen) this.loginScreen.style.display = 'none';
            if (this.appScreen) this.appScreen.style.display = 'block';
            if (this.channelBadge) this.channelBadge.textContent = this.channel;
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

        this.socket.on('user-muted', (data) => {
            this.updateUserMuteStatus(data.id, data.muted);
        });

        this.socket.on('kicked', (data) => {
            if (this.kickedOverlay) {
                this.kickedOverlay.querySelector('p').textContent = data.message;
                this.kickedOverlay.classList.add('show');
            }
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
        });

        this.socket.on('muted', (data) => {
            this.isMuted = data.muted;
            if (this.isMuted) {
                if (this.pttButton) this.pttButton.disabled = true;
                if (this.pttStatus) {
                    this.pttStatus.textContent = '🔇 You are muted by admin';
                    this.pttStatus.classList.add('muted');
                }
                this.stopTalking();
            } else {
                if (this.pttButton) this.pttButton.disabled = false;
                if (this.pttStatus) {
                    this.pttStatus.textContent = 'Hold button to talk';
                    this.pttStatus.classList.remove('muted');
                }
            }
        });

        this.socket.on('chat-message', (data) => {
            this.displayChatMessage(data);
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
    }

    sendChatMessage() {
        const text = this.chatInput.value.trim();
        if (!text || !this.socket) return;
        
        this.socket.emit('chat-message', {
            text: text,
            channel: this.channel
        });
        
        this.chatInput.value = '';
    }

    displayChatMessage(data) {
        if (!this.chatMessages) return;
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message' + (data.senderId === this.socket.id ? ' own' : '');
        
        const senderName = data.senderId === this.socket.id ? 'You' : this.escapeHtml(data.nickname);
        msgEl.innerHTML = `
            <div class="msg-sender">${senderName}${data.isAdmin ? ' 👑' : ''}</div>
            <div class="msg-text">${this.escapeHtml(data.text)}</div>
        `;
        
        this.chatMessages.appendChild(msgEl);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    clearChat() {
        if (this.chatMessages) {
            this.chatMessages.innerHTML = '';
        }
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
            audio.volume = this.volumeSlider ? this.volumeSlider.value / 100 : 0.8;
            document.body.appendChild(audio);
        }
        audio.srcObject = stream;
        audio.play().catch(err => console.log('Audio play error:', err));
    }

    startTalking() {
        if (this.isTalking || this.isMuted) return;
        this.isTalking = true;
        if (this.pttButton) this.pttButton.classList.add('active');
        if (this.pttStatus) {
            this.pttStatus.textContent = '🎙️ TRANSMITTING...';
            this.pttStatus.classList.add('transmitting');
        }
        if (this.visualizer) this.visualizer.classList.add('active');

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
        if (this.pttButton) this.pttButton.classList.remove('active');
        if (this.pttStatus) {
            this.pttStatus.textContent = 'Hold button to talk';
            this.pttStatus.classList.remove('transmitting');
        }
        if (this.visualizer) this.visualizer.classList.remove('active');

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
        if (!this.usersContainer) return;
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
                const statusEl = userEl.querySelector('.user-status');
                if (statusEl) statusEl.textContent = '🔊 Talking...';
            } else {
                userEl.classList.remove('talking');
                const statusEl = userEl.querySelector('.user-status');
                if (statusEl) statusEl.textContent = 'Idle';
            }
        }
    }

    updateUserMuteStatus(userId, muted) {
        const userEl = document.getElementById(`user-${userId}`);
        if (userEl) {
            if (muted) {
                userEl.classList.add('muted');
                const statusEl = userEl.querySelector('.user-status');
                if (statusEl) statusEl.textContent = '🔇 Muted';
            } else {
                userEl.classList.remove('muted');
                const statusEl = userEl.querySelector('.user-status');
                if (statusEl) statusEl.textContent = 'Idle';
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
        if (!this.connectionStatus) return;
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
