class DynamicVoiceAgent {
    constructor() {
        this.room = null;
        this.isConnected = false;
        this.isMuted = false;
        this.localAudioTrack = null;
        this.currentRoomName = null;
        this.participantName = null;
        this.sessionId = this.generateSessionId();
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        this.currentIntent = null;
        this.detectedUserData = {};
        this.conversationLog = [];
        
        // Transcript handling
        this.interimTranscript = "";
        this.finalTranscript = "";
        this.lastTranscriptUpdate = Date.now();
        
        this.bindEvents();
        this.updateDisplay();
    }
    
    generateSessionId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `session_${timestamp}_${random}`;
    }
    
    updateDisplay() {
        const roomInput = document.getElementById('roomName');
        if (roomInput) {
            roomInput.style.display = 'none';
            const label = document.querySelector('label[for="roomName"]');
            if (label) label.style.display = 'none';
        }
        
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.innerHTML = `
                <div class="session-info">
                    <strong>Session ID:</strong> <code>${this.sessionId}</code><br>
                    <strong>Status:</strong> Ready to connect to Alive5 Support<br>
                    <strong>Features:</strong> Dynamic Intent Detection, Real-time Analytics
                </div>
            `;
            statusEl.className = 'status info';
            statusEl.style.display = 'block';
        }
        
        const joinBtn = document.getElementById('joinBtn');
        if (joinBtn) {
            joinBtn.disabled = false;
            joinBtn.textContent = 'Join Voice Chat';
        }
    }
    
    bindEvents() {
        document.getElementById('joinForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.joinRoom();
        });
        
        document.getElementById('muteBtn').addEventListener('click', () => {
            this.toggleMute();
        });
        
        document.getElementById('disconnectBtn').addEventListener('click', () => {
            this.disconnect();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'r' && e.ctrlKey && !this.isConnected) {
                e.preventDefault();
                this.reconnect();
            }
        });
        
        window.addEventListener('beforeunload', () => {
            if (this.isConnected) {
                this.disconnect(false);
            }
        });
    }
    
    async joinRoom() {
        this.participantName = document.getElementById('participantName').value.trim();
        
        if (!this.participantName) {
            this.showStatus('Please enter your name', 'error');
            return;
        }
        
        if (this.connectionAttempts >= this.maxConnectionAttempts) {
            this.showStatus('Maximum connection attempts reached. Please refresh the page.', 'error');
            return;
        }
        
        try {
            this.connectionAttempts++;
            this.showStatus('Connecting to Alive5 Support with dynamic intent detection...', 'connecting');
            document.getElementById('joinBtn').disabled = true;
            
            // Get connection details
            const response = await fetch('https://voice-agent-livekit-backend-9f8ec30b9fba.herokuapp.com/api/connection_details', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    participant_name: this.participantName,
                    user_data: {
                        session_start: new Date().toISOString()
                    }
                })
            });
            
            if (!response.ok) throw new Error('Failed to get connection details');
            const connectionDetails = await response.json();
            console.log('Connection details received:', connectionDetails);
            
            this.currentRoomName = connectionDetails.roomName;
            
            // Create room with proper configuration
            this.room = new LivekitClient.Room({
                adaptiveStream: true,
                dynacast: true,
                reconnectPolicy: {
                    nextRetryDelayInMs: (context) => {
                        console.log('Reconnection attempt:', context.retryCount);
                        return Math.min(1000 * Math.pow(2, context.retryCount), 30000);
                    },
                    maxRetries: 5,
                },
                publishDefaults: {
                    videoSimulcastLayers: [],
                    audioPreset: LivekitClient.AudioPresets.speech,
                }
            });
            
            this.setupRoomEvents();
            
            // Connect to room
            await this.room.connect(connectionDetails.serverUrl, connectionDetails.participantToken);
            await this.enableMicrophone();
            
            this.isConnected = true;
            this.connectionAttempts = 0;
            
            this.showStatus(`
                Connected to Alive5 Support!<br>
                Room: ${this.currentRoomName}<br>
                Scott is joining... (This may take 10-15 seconds)<br>
                Dynamic intent detection is active
            `, 'connected');
            
            this.showControls();
            this.initializeConversationLog();
            
            // Set up worker response timeout
            this.workerTimeout = setTimeout(() => {
                this.checkWorkerResponse();
            }, 20000); // 20 seconds timeout
            
        } catch (error) {
            console.error('Connection failed:', error);
            this.showStatus(`Connection failed: ${error.message}`, 'error');
            document.getElementById('joinBtn').disabled = false;
            
            if (this.room) {
                try {
                    await this.room.disconnect();
                } catch (e) {
                    console.warn('Error disconnecting after failed connection:', e);
                }
                this.room = null;
            }
        }
    }
    
    setupRoomEvents() {
        // Handle connection state
        this.room.on(LivekitClient.RoomEvent.Connected, () => {
            this.isConnected = true;
            this.showStatus('Connected to Alive5 Dynamic Voice Support', 'connected');
            document.getElementById('controls').classList.add('show');
            document.getElementById('joinBtn').disabled = true;
            
            this.createTranscriptContainer();
            console.log('Room connected - transcript container created');
        });
        
        // Handle participant metadata changes (worker status signals)
        this.room.on(LivekitClient.RoomEvent.ParticipantMetadataChanged, (metadata, participant) => {
            if (participant.isAgent) {
                try {
                    const statusData = JSON.parse(metadata);
                    this.handleWorkerStatus(statusData);
                } catch (e) {
                    console.warn('Failed to parse worker status metadata:', e);
                }
            }
        });
        
        this.room.on(LivekitClient.RoomEvent.Disconnected, () => {
            this.isConnected = false;
            this.handleDisconnection();
        });
        
        // Handle audio tracks from agent
        this.room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log('Track subscribed:', track.kind, 'from participant:', participant.identity);
            
            if (track.kind === 'audio') {
                let audioElement = document.getElementById(`audio-${participant.sid}`);
                if (!audioElement) {
                    audioElement = document.createElement('audio');
                    audioElement.id = `audio-${participant.sid}`;
                    audioElement.autoplay = true;
                    audioElement.controls = false;
                    document.body.appendChild(audioElement);
                    console.log('Created audio element for', participant.identity);
                }
                
                track.attach(audioElement);
                audioElement.volume = 1.0;
                
                try {
                    audioElement.play()
                        .then(() => console.log('Audio playback started'))
                        .catch(err => console.error('Audio playback failed:', err));
                } catch (e) {
                    console.warn('Audio play error:', e);
                }
            }
        });
        
        this.room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            if (track.kind === 'audio') {
                const audioElement = document.getElementById(`audio-${participant.sid}`);
                if (audioElement) {
                    track.detach(audioElement);
                    audioElement.remove();
                }
            }
        });
        
        // ENHANCED: Register text stream handler for transcriptions with better real-time handling
        this.room.registerTextStreamHandler('lk.transcription', async (reader, participantInfo) => {
            try {
                const message = await reader.readAll();
                console.log('📝 Transcription received:', { 
                    message, 
                    participantInfo: participantInfo.identity, 
                    attributes: reader.info.attributes,
                    myName: this.participantName 
                });
                
                // More robust check for user vs agent transcription
                const isUserTranscript = reader.info.attributes && reader.info.attributes['lk.transcribed_track_id'];
                const isAgentIdentity = participantInfo.identity && (
                    participantInfo.identity.includes('agent') || 
                    participantInfo.identity.includes('Scott') ||
                    participantInfo.identity === 'Scott_AI_Agent'
                );
                
                console.log('🔍 Transcript analysis:', { 
                    isUserTranscript, 
                    isAgentIdentity, 
                    participantIdentity: participantInfo.identity,
                    decision: isUserTranscript && !isAgentIdentity ? 'USER' : 'SKIP/AGENT'
                });
                
                if (isUserTranscript && !isAgentIdentity) {
                    // This is definitely a user's speech transcription
                    console.log('👤 Processing as USER transcript:', message);
                    this.handleUserTranscription(message, participantInfo, reader.info.attributes);
                } else if (isAgentIdentity || (!isUserTranscript && participantInfo.identity !== this.participantName)) {
                    // This is likely agent speech - but we'll handle it via our custom agent transcript stream
                    console.log('🤖 Skipping potential agent transcript (will be handled by custom stream):', message);
                } else {
                    // Fallback - check content or other attributes
                    console.log('❓ Ambiguous transcript, treating as user:', message);
                    this.handleUserTranscription(message, participantInfo, reader.info.attributes);
                }
            } catch (error) {
                console.error('Error processing transcription:', error);
            }
        });
        
        // Register handler for chat messages (text input)
        this.room.registerTextStreamHandler('lk.chat', async (reader, participantInfo) => {
            try {
                const message = await reader.readAll();
                console.log('Chat message received:', message, 'from:', participantInfo.identity);
                
                // Handle chat messages if needed
                this.addLogEntry({
                    speaker: participantInfo.identity,
                    message: message,
                    type: 'chat'
                });
            } catch (error) {
                console.error('Error processing chat message:', error);
            }
        });

        // ENHANCED: Register handler for agent transcript messages
        this.room.registerTextStreamHandler('lk.agent.transcript', async (reader, participantInfo) => {
            try {
                const data = await reader.readAll();
                console.log('Agent transcript data received:', data, 'from:', participantInfo.identity);
                
                try {
                    // Try to parse as JSON first (data format)
                    const parsed = JSON.parse(data);
                    if (parsed.type === 'agent_transcript') {
                        this.handleAgentTranscription(parsed.message, { identity: parsed.speaker });
                        return;
                    }
                } catch (e) {
                    // If not JSON, treat as plain text
                    this.handleAgentTranscription(data, { identity: 'Scott_AI_Agent' });
                }
            } catch (error) {
                console.error('Error processing agent transcript:', error);
            }
        });

        // Also register data handler for agent transcripts (fallback)
        this.room.on(LivekitClient.RoomEvent.DataReceived, (payload, participant, kind, topic) => {
            if (topic === 'lk.agent.transcript') {
                try {
                    const data = JSON.parse(new TextDecoder().decode(payload));
                    if (data.type === 'agent_transcript') {
                        console.log('🤖 Agent transcript via data received:', data);
                        this.handleAgentTranscription(data.message, { identity: data.speaker });
                    }
                } catch (error) {
                    console.error('Error processing agent transcript data:', error);
                }
            } else if (topic === 'lk.conversation.control') {
                try {
                    const data = JSON.parse(new TextDecoder().decode(payload));
                    if (data.type === 'conversation_end') {
                        console.log('🔚 Conversation end signal received:', data);
                        this.handleConversationEnd(data);
                    }
                } catch (error) {
                    console.error('Error processing conversation control data:', error);
                }
            } else if (topic) {
                console.log('📨 Other data received:', { topic, participant: participant?.identity, data: new TextDecoder().decode(payload) });
            }
        });
    }
    
    handleUserTranscription(transcriptText, participantInfo, attributes = {}) {
        console.log('User transcription:', transcriptText, 'from:', participantInfo.identity);
        
        // Check if this is a final transcript or interim
        const isFinal = attributes['lk.transcript.final'] === 'true' || !attributes['lk.transcript.interim'];
        
        // Update transcript display with proper interim/final handling
        this.updateTranscriptDisplay(transcriptText, isFinal);
        
        // Only add to conversation log and send for intent detection if it's final
        if (isFinal && transcriptText.trim()) {
            // Check if this looks like a farewell
            const isFarewell = this.detectFarewell(transcriptText);
            
            // Add to conversation log with clear user identification
            this.addLogEntry({
                speaker: `👤 ${this.participantName || 'You'}`,
                message: transcriptText,
                type: 'user'
            });
            
            // Show farewell detection
            if (isFarewell) {
                console.log('👋 Farewell detected in user message:', transcriptText);
                this.addLogEntry({
                    speaker: 'System',
                    message: '👋 Farewell detected - ending conversation...',
                    type: 'system'
                });
                
                this.showToast('Ending conversation...', 'info');
                
                // Trigger conversation end after a brief delay to allow agent response
                setTimeout(() => {
                    this.handleConversationEnd('User said goodbye');
                }, 3000); // 3 second delay to allow agent to respond with farewell
            }
            
            // Send transcript to backend for flow processing
            this.sendTranscriptForFlowProcessing(transcriptText);
        }
    }

    detectFarewell(message) {
        /**
         * Simple farewell detection on frontend (backup to worker detection)
         */
        const messageLower = message.toLowerCase().trim();
        const farewellKeywords = [
            'bye', 'goodbye', 'see you', 'that\'s all', 'thats all', 'i\'m done', 
            'im done', 'thank you bye', 'thanks bye', 'gotta go', 'have to go'
        ];
        
        return farewellKeywords.some(keyword => messageLower.includes(keyword));
    }
    
    handleAgentTranscription(transcriptText, participantInfo) {
        console.log('Agent transcription:', transcriptText, 'from:', participantInfo.identity);
        
        // Ensure this is clearly marked as coming from the agent, not the user
        const agentIdentity = participantInfo.identity === 'Scott_AI_Agent' ? '🤖 Scott (AI)' : 
                             participantInfo.identity && participantInfo.identity.includes('Scott') ? '🤖 Scott (AI)' : 
                             '🤖 AI Assistant';
        
        // Add agent response to conversation log with clear agent identification
        this.addLogEntry({
            speaker: agentIdentity,
            message: transcriptText,
            type: 'agent'
        });
        
        // Update transcript display to show agent's speech
        const status = document.getElementById('transcript-status');
        if (status) {
            status.textContent = 'Scott responding...';
            status.className = 'agent-speaking';
            status.style.background = '#e3f2fd';
            status.style.color = '#1565c0';
            
            // Reset status after agent finishes speaking
            setTimeout(() => {
                if (status) {
                    status.textContent = 'Listening...';
                    status.className = 'listening';
                    status.style.background = '#e8f5e8';
                    status.style.color = '#2d5a2d';
                }
            }, 3000);
        }
    }

    handleConversationEnd(data) {
        console.log('🔚 Handling conversation end:', data);
        
        // Add system message about conversation ending
        this.addLogEntry({
            speaker: 'System',
            message: '👋 Conversation ended by user request. Disconnecting...',
            type: 'system'
        });
        
        // Show toast notification
        this.showToast('Conversation ended. Disconnecting...', 'info');
        
        // Update status
        this.showStatus('Conversation ended. Disconnecting...', 'info');
        
        // Disconnect after a short delay to allow farewell message to be heard
        setTimeout(() => {
            this.disconnect(true);
        }, 3000); // 3 second delay for polite farewell
    }
    
    async sendTranscriptForFlowProcessing(transcript) {
        try {
            // Send transcript to backend for flow processing
            const response = await fetch('https://voice-agent-livekit-backend-9f8ec30b9fba.herokuapp.com/api/process_flow_message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    room_name: this.currentRoomName,
                    user_message: transcript
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('Flow processing result:', result);
                
                // Handle flow result
                if (result.flow_result) {
                    this.handleFlowResult(result.flow_result);
                }
            }
        } catch (error) {
            console.warn('Failed to send transcript for flow processing:', error);
        }
    }
    
    handleFlowResult(flowResult) {
        const flowType = flowResult.type;
        const response = flowResult.response;
        
        console.log('Handling flow result:', flowType, response);
        
        // Add flow information to conversation log
        this.addLogEntry({
            speaker: 'System',
            message: `Flow: ${flowType} - ${response}`,
            type: 'system'
        });
        
        // Update intent display if flow started
        if (flowType === 'flow_started') {
            const flowName = flowResult.flow_name || 'Unknown';
            this.handleIntentUpdate(flowName, 'Flow System');
        }
    }
    
    updateTranscriptDisplay(transcriptText, isFinal) {
        if (!transcriptText || transcriptText.trim() === '') return;
        
        const interimElement = document.getElementById('interim-transcript');
        const finalElement = document.getElementById('final-transcript');
        
        if (!interimElement || !finalElement) {
            console.warn('Transcript elements not found');
            this.createTranscriptContainer();
            return;
        }
        
        if (isFinal) {
            // Add final transcript with smooth transition
            const newFinalText = this.finalTranscript + (this.finalTranscript ? ' ' : '') + transcriptText;
            this.finalTranscript = newFinalText;
            this.interimTranscript = '';
            
            finalElement.textContent = this.finalTranscript;
            interimElement.textContent = '';
            
            // Add visual feedback for completed speech
            finalElement.classList.add('updated');
            setTimeout(() => finalElement.classList.remove('updated'), 1000);
        } else {
            // Show interim transcript with typing effect
            this.interimTranscript = transcriptText;
            interimElement.textContent = this.interimTranscript;
            interimElement.classList.add('typing');
        }
        
        // Update status with better feedback
        const status = document.getElementById('transcript-status');
        if (status) {
            if (!isFinal && transcriptText.trim()) {
                status.textContent = 'Speaking...';
                status.className = 'transcribing';
            } else if (isFinal) {
                status.textContent = 'Processing...';
                status.className = 'processing';
                // Reset to listening after a short delay
                setTimeout(() => {
                    if (status) {
                        status.textContent = 'Listening...';
                        status.className = 'listening';
                    }
                }, 1500);
            } else {
                status.textContent = 'Listening...';
                status.className = 'listening';
            }
        }
        
        // Auto-scroll transcript container
        const transcriptBody = document.getElementById('transcript-body');
        if (transcriptBody) {
            transcriptBody.scrollTop = transcriptBody.scrollHeight;
        }
        
        this.lastTranscriptUpdate = Date.now();
    }
    
    createTranscriptContainer() {
        if (document.getElementById('transcript-container')) {
            return; // Already exists
        }
        
        const container = document.createElement('div');
        container.id = 'transcript-container';
        container.className = 'transcript-container show';
        container.style.cssText = `
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 1rem;
            margin: 1rem 0;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            border: 1px solid #e1e8ed;
            transition: all 0.3s ease;
        `;
        
        container.innerHTML = `
            <div class="transcript-header" style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0.75rem;
                padding-bottom: 0.5rem;
                border-bottom: 1px solid #e1e8ed;
            ">
                <span style="font-weight: 600; color: #2c3e50;">🎤 Live Transcript</span>
                <span id="transcript-status" class="listening" style="
                    font-size: 0.85rem;
                    padding: 0.25rem 0.5rem;
                    border-radius: 12px;
                    background: #e8f5e8;
                    color: #2d5a2d;
                    font-weight: 500;
                ">Listening...</span>
            </div>
            <div id="transcript-body" class="transcript-body" style="
                max-height: 150px;
                overflow-y: auto;
                padding: 0.5rem;
                background: #f8f9fa;
                border-radius: 8px;
                border: 1px solid #e9ecef;
                font-family: 'Segoe UI', system-ui, sans-serif;
                line-height: 1.5;
            ">
                <div id="final-transcript" class="transcript-text final" style="
                    color: #2c3e50;
                    margin-bottom: 0.5rem;
                    transition: all 0.3s ease;
                "></div>
                <div id="interim-transcript" class="transcript-text interim" style="
                    color: #6c757d;
                    font-style: italic;
                    opacity: 0.8;
                    border-left: 3px solid #007bff;
                    padding-left: 0.5rem;
                    transition: all 0.3s ease;
                "></div>
            </div>
        `;
        
        const controls = document.getElementById('controls');
        if (controls && controls.parentNode) {
            controls.parentNode.insertBefore(container, controls.nextSibling);
        } else {
            document.querySelector('.container').appendChild(container);
        }
        
        // Add dynamic styles
        const style = document.createElement('style');
        style.textContent = `
            .transcript-text.updated {
                background-color: #e8f5e8 !important;
                transform: scale(1.02);
            }
            
            .transcript-text.typing {
                animation: pulse 1.5s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 0.8; }
                50% { opacity: 1; }
            }
            
            #transcript-status.transcribing {
                background: #fff3cd !important;
                color: #856404 !important;
            }
            
            #transcript-status.processing {
                background: #d1ecf1 !important;
                color: #0c5460 !important;
            }
            
            #transcript-status.listening {
                background: #e8f5e8 !important;
                color: #2d5a2d !important;
            }
        `;
        document.head.appendChild(style);
        
        console.log('Enhanced transcript container created');
    }
    
    initializeConversationLog() {
        const logContainer = document.createElement('div');
        logContainer.id = 'conversationLog';
        logContainer.className = 'conversation-log';
        logContainer.innerHTML = `
            <h4>🎯 Conversation Analytics</h4>
            <div class="intent-status">
                <span class="current-intent">Current Intent: <strong id="current-intent-display">${this.currentIntent || 'Detecting...'}</strong></span>
                <span class="auto-detection">🤖 Live detection</span>
            </div>
            <div class="log-entries" id="logEntries"></div>
        `;
        
        const container = document.querySelector('.container');
        if (container) {
            // Add margin instead of divider for cleaner look
            logContainer.style.marginTop = '2rem';
            container.appendChild(logContainer);
        }
    }
    
    addLogEntry(entry) {
        if (!entry || !entry.message) {
            console.warn('Invalid log entry:', entry);
            return;
        }
        
        if (!entry.timestamp) {
            entry.timestamp = new Date().toISOString();
        }
        
        this.conversationLog.push(entry);
        
        let logContainer = document.querySelector('.conversation-log');
        if (!logContainer) {
            this.initializeConversationLog();
            logContainer = document.querySelector('.conversation-log');
        }
        
        const logEntries = logContainer.querySelector('.log-entries');
        if (!logEntries) return;
        
        const logEntryEl = document.createElement('div');
        logEntryEl.className = `log-entry ${entry.type || ''}`;
        
        // Enhanced styling based on entry type
        const entryStyles = {
            user: 'background: #e3f2fd; border-left: 4px solid #2196f3; margin: 0.5rem 0; padding: 0.75rem; border-radius: 8px;',
            agent: 'background: #f3e5f5; border-left: 4px solid #9c27b0; margin: 0.5rem 0; padding: 0.75rem; border-radius: 8px;',
            system: 'background: #fff3e0; border-left: 4px solid #ff9800; margin: 0.5rem 0; padding: 0.5rem; border-radius: 6px; font-size: 0.9rem;',
            chat: 'background: #e8f5e8; border-left: 4px solid #4caf50; margin: 0.5rem 0; padding: 0.75rem; border-radius: 8px;'
        };
        
        logEntryEl.style.cssText = entryStyles[entry.type] || entryStyles.user;
        
        let displayTime;
        try {
            const entryTime = new Date(entry.timestamp);
            displayTime = entryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) {
            displayTime = 'now';
        }
        
        logEntryEl.innerHTML = `
            <div class="log-header" style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0.5rem;
                font-size: 0.85rem;
                opacity: 0.8;
            ">
                <span class="speaker" style="font-weight: 600; color: #2c3e50;">${entry.speaker || 'Unknown'}</span>
                <span class="timestamp" style="color: #6c757d;">${displayTime}</span>
            </div>
            <div class="log-message" style="
                color: #2c3e50;
                line-height: 1.4;
                word-wrap: break-word;
            ">${entry.message}</div>
        `;
        
        if (entry.intent) {
            const intentSpan = document.createElement('span');
            intentSpan.className = 'intent-change';
            intentSpan.style.cssText = `
                background: #4caf50;
                color: white;
                padding: 0.2rem 0.5rem;
                border-radius: 12px;
                font-size: 0.75rem;
                margin-left: 0.5rem;
            `;
            intentSpan.textContent = `Intent: ${entry.intent}`;
            logEntryEl.querySelector('.log-header').appendChild(intentSpan);
        }
        
        logEntries.appendChild(logEntryEl);
        
        // Smooth scroll to new entry
        logEntryEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Fade in animation
        logEntryEl.style.opacity = '0';
        logEntryEl.style.transform = 'translateY(10px)';
        setTimeout(() => {
            logEntryEl.style.transition = 'all 0.3s ease';
            logEntryEl.style.opacity = '1';
            logEntryEl.style.transform = 'translateY(0)';
        }, 10);
        
        return logEntryEl;
    }
    
    handleIntentUpdate(intent, source) {
        if (!intent) return;
        
        const oldIntent = this.currentIntent;
        this.currentIntent = intent;
        
        const intentElement = document.getElementById('current-intent-display');
        if (intentElement) {
            const intentLabels = {
                sales: 'Sales & Pricing',
                support: 'Technical Support',
                billing: 'Billing & Account',
                general: 'General Inquiry'
            };
            
            intentElement.textContent = intentLabels[intent] || intent;
            intentElement.classList.add('updated');
            
            setTimeout(() => {
                intentElement.classList.remove('updated');
            }, 2000);
        }
        
        if (oldIntent !== intent) {
            this.addLogEntry({
                speaker: 'System',
                message: `Intent detected: ${intent} (by ${source})`,
                type: 'system',
                intent: intent
            });
            
            this.showToast(`Intent detected: ${intent}`, 'intent-change');
        }
        
        // Update session on backend
        this.updateSessionIntent(intent);
    }
    
    async updateSessionIntent(intent) {
        try {
            await fetch('https://voice-agent-livekit-backend-9f8ec30b9fba.herokuapp.com/api/sessions/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    room_name: this.currentRoomName,
                    intent: intent,
                    user_data: this.detectedUserData,
                    status: 'active'
                })
            });
        } catch (error) {
            console.warn('Failed to update session intent:', error);
        }
    }
    
    updateUserData(userData) {
        if (!userData || typeof userData !== 'object') return;
        
        this.detectedUserData = { ...this.detectedUserData, ...userData };
        
        const dataPoints = [];
        for (const [key, value] of Object.entries(userData)) {
            if (value) {
                const formattedKey = key
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/^./, str => str.toUpperCase());
                
                dataPoints.push(`<strong>${formattedKey}:</strong> ${value}`);
            }
        }
        
        if (dataPoints.length > 0) {
            this.addLogEntry({
                speaker: 'System',
                message: `User information detected:<br>${dataPoints.join('<br>')}`,
                type: 'system'
            });
            
            this.showToast('User information detected', 'user-data');
        }
    }
    
    showToast(message, type = 'info') {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
            `;
            document.body.appendChild(toastContainer);
        }
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const iconMap = {
            'intent-change': '🔄',
            'user-data': '👤',
            'info': 'ℹ️',
            'error': '❌'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">${iconMap[type] || iconMap.info}</div>
            <div class="toast-content">${message}</div>
        `;
        
        toast.style.cssText = `
            background-color: ${type === 'intent-change' ? '#4a6da7' : type === 'error' ? '#d73027' : '#444'};
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            margin-bottom: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
            opacity: 0;
            transform: translateX(50px);
        `;
        
        toastContainer.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        }, 10);
        
        // Auto-remove
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(50px)';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
    
    async enableMicrophone() {
        try {
            this.localAudioTrack = await LivekitClient.createLocalAudioTrack({
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000,
            });
            
            await this.room.localParticipant.publishTrack(this.localAudioTrack);
            console.log('Microphone enabled with speech optimization');
        } catch (error) {
            console.error('Failed to enable microphone:', error);
            throw new Error('Microphone access denied. Please allow microphone access and try again.');
        }
    }
    
    toggleMute() {
        if (!this.localAudioTrack || !this.isConnected) return;
        
        this.isMuted = !this.isMuted;
        this.localAudioTrack.mute(this.isMuted);
        
        const btn = document.getElementById('muteBtn');
        btn.textContent = this.isMuted ? '🔊 Unmute' : '🔇 Mute';
        btn.classList.toggle('muted', this.isMuted);
        
        this.showStatus(
            this.isMuted ? 'Microphone muted' : 'Microphone unmuted', 
            this.isMuted ? 'warning' : 'connected'
        );
        
        this.addLogEntry({
            speaker: 'System',
            message: this.isMuted ? 'Microphone muted' : 'Microphone unmuted',
            type: 'system'
        });
    }
    
    async sendTextMessage(text) {
        if (!this.room || !this.isConnected) return;
        
        try {
            await this.room.localParticipant.sendText(text, {
                topic: 'lk.chat'
            });
            
            this.addLogEntry({
                speaker: 'You',
                message: text,
                type: 'text-input'
            });
        } catch (error) {
            console.error('Failed to send text message:', error);
        }
    }
    
    async disconnect(showMessage = true) {
        if (!this.room) return;
        
        try {
            if (this.isConnected) {
                await this.room.disconnect();
                console.log('Disconnected from room:', this.currentRoomName);
                
                if (this.currentRoomName) {
                    fetch(`https://voice-agent-livekit-backend-9f8ec30b9fba.herokuapp.com/api/rooms/${this.currentRoomName}`, {
                        method: 'DELETE'
                    }).catch(e => console.warn('Session cleanup notification failed:', e));
                }
            }
        } catch (error) {
            console.error('Error during disconnect:', error);
        } finally {
            this.room = null;
            if (showMessage) {
                this.handleDisconnection();
            }
        }
    }
    
    handleDisconnection() {
        this.isConnected = false;
        this.hideControls();
        this.currentRoomName = null;
        
        // Cleanup audio elements
        document.querySelectorAll('audio').forEach(el => {
            try {
                if (el.srcObject) {
                    const tracks = el.srcObject.getTracks();
                    tracks.forEach(track => track.stop());
                }
                el.srcObject = null;
                el.remove();
            } catch (e) {
                console.warn('Error cleaning up audio element:', e);
            }
        });
        
        document.querySelectorAll('video').forEach(el => el.remove());
        
        const summary = this.generateSessionSummary();
        this.showStatus(`
            Session Ended<br>
            ${summary}<br>
            Click "Join Voice Chat" to start a new session.
        `, 'info');
        
        document.getElementById('joinBtn').disabled = false;
        document.getElementById('joinBtn').textContent = 'Join Voice Chat';
        
        // Reset for next session
        this.currentIntent = null;
        this.detectedUserData = {};
        this.conversationLog = [];
        this.sessionId = this.generateSessionId();
        this.updateDisplay();
    }
    
    generateSessionSummary() {
        const duration = this.conversationLog.length > 0 ? 
            `Duration: ${Math.ceil(this.conversationLog.length / 2)} exchanges` : 
            'Brief session';
        
        const finalIntent = this.currentIntent || 'Unknown';
        const dataCollected = Object.keys(this.detectedUserData).length > 0 ? 
            'User data collected' : 
            'No data collected';
        
        return `Final Intent: ${finalIntent} | ${duration} | ${dataCollected}`;
    }
    
    async reconnect() {
        if (!this.isConnected) {
            this.connectionAttempts = 0;
            await this.joinRoom();
        }
    }
    
    showStatus(message, type) {
        const el = document.getElementById('status');
        el.innerHTML = message;
        el.className = `status ${type}`;
        el.style.display = 'block';
    }
    
    showControls() {
        document.getElementById('controls').classList.add('show');
    }
    
    checkWorkerResponse() {
        // Check if we've received any agent responses
        const hasAgentResponse = this.conversationLog.some(log => 
            log.type === 'agent' || log.sender === 'Scott'
        );
        
        if (!hasAgentResponse) {
            this.showStatus(`
                ⚠️ Worker Connection Issue<br>
                The voice agent is not responding. This may be due to:<br>
                • Backend server not running<br>
                • Worker initialization timeout<br>
                • Network connectivity issues<br><br>
                <strong>Please try:</strong><br>
                1. Refresh the page and try again<br>
                2. Check if the backend is running<br>
                3. Contact support if the issue persists
            `, 'error');
            
            // Add a retry button
            const retryBtn = document.createElement('button');
            retryBtn.textContent = '🔄 Retry Connection';
            retryBtn.className = 'retry-btn';
            retryBtn.onclick = () => {
                this.reconnect();
            };
            
            const statusEl = document.getElementById('status');
            statusEl.appendChild(retryBtn);
        }
    }
    
    handleWorkerStatus(statusData) {
        const { worker_status, message, timestamp } = statusData;
        console.log('Worker status update:', statusData);
        
        switch (worker_status) {
            case 'ready':
                this.showStatus(`
                    ✅ Worker Ready<br>
                    ${message}<br>
                    <small>Connected at: ${new Date(timestamp).toLocaleTimeString()}</small>
                `, 'connected');
                break;
                
            case 'backend_down':
                this.showStatus(`
                    ⚠️ Backend Server Down<br>
                    ${message}<br>
                    <small>Worker is trying to reconnect automatically...</small>
                `, 'warning');
                break;
                
            case 'retrying':
                this.showStatus(`
                    🔄 Reconnecting...<br>
                    ${message}<br>
                    <small>Attempting to restore connection...</small>
                `, 'connecting');
                break;
                
            case 'reconnected':
                this.showStatus(`
                    ✅ Connection Restored<br>
                    ${message}<br>
                    <small>Backend is back online!</small>
                `, 'connected');
                break;
                
            case 'failed':
                this.showStatus(`
                    ❌ Connection Failed<br>
                    ${message}<br>
                    <small>Please refresh the page and try again</small>
                `, 'error');
                break;
                
            default:
                console.log('Unknown worker status:', worker_status);
        }
    }
    
    hideControls() {
        document.getElementById('controls').classList.remove('show');
        
        const muteBtn = document.getElementById('muteBtn');
        muteBtn.textContent = '🔇 Mute';
        muteBtn.classList.remove('muted');
        this.isMuted = false;
        
        const logContainer = document.getElementById('conversationLog');
        if (logContainer) {
            logContainer.remove();
        }
        
        const transcriptContainer = document.getElementById('transcript-container');
        if (transcriptContainer) {
            transcriptContainer.classList.remove('show');
            transcriptContainer.style.display = 'none';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DynamicVoiceAgent();
});