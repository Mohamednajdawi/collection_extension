let contentTabId = null;
let contentReady = false;
let isRecording = false;
let hasRecordedData = false;

// Helper function to update status with visual feedback
function updateStatus(message, type = 'info') {
    const statusEl = document.getElementById("status");
    statusEl.textContent = message;
    statusEl.className = 'status'; // Reset to base class
    
    if (message) {
        statusEl.classList.add('show');
        if (type === 'success') {
            statusEl.classList.add('success');
        } else if (type === 'error') {
            statusEl.classList.add('error');
        } else if (type === 'warning') {
            statusEl.classList.add('warning');
        }
    } else {
        statusEl.classList.remove('show');
    }
}

function sendMessageToContent(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
            console.error("No active tab found");
            updateStatus("Error: No active tab found", 'error');
            return;
        }
        
        console.log("Sending message to content script:", message);
        
        const attemptMessage = (retryCount = 0) => {
            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Message sending failed:", chrome.runtime.lastError.message);
                    
                    // If content script not ready and we have retries left, try to inject it
                    if (retryCount < 2 && chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                        console.log("Content script not found, attempting to inject...");
                        
                        // Try to inject the content script
                        chrome.scripting.executeScript({
                            target: { tabId: tabs[0].id },
                            files: ['content.js']
                        }, () => {
                            if (chrome.runtime.lastError) {
                                console.error("Script injection failed:", chrome.runtime.lastError.message);
                                updateStatus("Error: Cannot inject content script", 'error');
                                return;
                            }
                            
                            // Wait a bit for the script to initialize, then retry
                            setTimeout(() => {
                                console.log(`Retrying message (attempt ${retryCount + 1})`);
                                attemptMessage(retryCount + 1);
                            }, 500);
                        });
                    } else {
                        updateStatus("Error: Content script not ready", 'error');
                        if (callback) callback(null);
                    }
                    return;
                }
                
                console.log("Received response from content script:", response);
                if (callback) callback(response);
            });
        };
        
        attemptMessage();
    });
}

// Start Recording
document.getElementById("startBtn").addEventListener("click", () => {
    console.log("Start button clicked");
    sendMessageToContent({ command: "startRecording" }, (response) => {
        if (response && response.status) {
            isRecording = true;
            hasRecordedData = false;
            chrome.storage.local.set({ isRecording: true, hasRecordedData: false });
            updateButtonStates();
            updateStatus("Recording started...", 'success');
            document.getElementById("stopBtn").setAttribute("data-recording", "true");
            
            // Close the popup after successful start
            setTimeout(() => {
                window.close();
            }, 100); // Small delay to show the success message briefly
        } else {
            console.error("Failed to start recording:", response);
            updateStatus("Error starting recording", 'error');
        }
    });
});

// Stop Recording
document.getElementById("stopBtn").addEventListener("click", () => {
    console.log("Stop button clicked");
    sendMessageToContent({ command: "stopRecording" }, (response) => {
        if (response && response.status) {
            isRecording = false;
            hasRecordedData = true;
            chrome.storage.local.set({ isRecording: false, hasRecordedData: true });
            updateButtonStates();
            document.getElementById("stopBtn").setAttribute("data-recording", "false");
            updateStatus(`Recording stopped. ${response.log?.length || 0} events captured.`, 'success');
        } else {
            console.error("Failed to stop recording:", response);
            updateStatus("Error stopping recording", 'error');
        }
    });
});

// Download button handler
document.getElementById("downloadBtn").addEventListener("click", () => {
    console.log("Download button clicked");
    sendMessageToContent({ command: "getLog" }, (response) => {
        if (response && response.success) {
            let logData = JSON.stringify(response.log, null, 2);
            let blob = new Blob([logData], { type: "application/json" });
            let url = URL.createObjectURL(blob);
            let a = document.createElement("a");
            a.href = url;
            a.download = "session_log.json";
            a.click();
            URL.revokeObjectURL(url);
            updateStatus("Session log downloaded successfully", 'success');
        } else {
            console.error("Failed to get log:", response);
            updateStatus("Error downloading session log", 'error');
        }
    });
});

// Analyze button handler
document.getElementById("analyzeBtn").addEventListener("click", () => {
    console.log("Analyze button clicked");
    updateStatus("Gathering data for analysis...");

    // Get eventsLog from chrome.storage.local (it now includes focus events from background.js)
    chrome.storage.local.get(["eventsLog"], (result) => {
        const eventsLogForAnalysis = result.eventsLog || [];

        if (eventsLogForAnalysis.length === 0) {
            updateStatus("No events recorded to analyze.", 'error');
            console.warn("No events in storage to analyze.");
            return;
        }

        updateStatus("Sending data to background for analysis...");
        chrome.runtime.sendMessage(
            { 
                action: "processEvents", 
                eventsLog: eventsLogForAnalysis
                // summarizedMouseIntervals is no longer sent for this primary analysis
            }, 
            (analysisResponse) => {
                if (analysisResponse) {
                    console.log("Analysis complete:", analysisResponse);
                    let analysisData = JSON.stringify(analysisResponse, null, 2);
                    let blob = new Blob([analysisData], { type: "application/json" });
                    let url = URL.createObjectURL(blob);
                    let a = document.createElement("a");
                    a.href = url;
                    a.download = "session_analysis.json";
                    a.click();
                    URL.revokeObjectURL(url);
                    updateStatus("Analysis complete and downloaded", 'success');
                } else {
                    console.error("Analysis failed in background script");
                    updateStatus("Error analyzing session data", 'error');
                }
            }
        );
    });
});

// AI Summary button handler
document.getElementById("aiSummaryBtn").addEventListener("click", () => {
    console.log("AI Summary button clicked");
    generateAISummary();
});

// Function to generate AI summary using OpenAI
async function generateAISummary() {
    updateStatus("Generating AI summary...", 'info');
    
    try {
        // Get session analysis data
        chrome.storage.local.get(["eventsLog"], (result) => {
            const eventsLogForAnalysis = result.eventsLog || [];

            if (eventsLogForAnalysis.length === 0) {
                updateStatus("No events recorded to summarize.", 'error');
                return;
            }

            // Process events to get analysis data
            chrome.runtime.sendMessage(
                { 
                    action: "processEvents", 
                    eventsLog: eventsLogForAnalysis
                }, 
                async (analysisResponse) => {
                    if (analysisResponse) {
                        console.log("Analysis data for AI:", analysisResponse);
                        
                        // Call OpenAI API
                        const aiSummary = await callOpenAI(analysisResponse);
                        
                        if (aiSummary) {
                            displayAISummary(aiSummary);
                            updateStatus("AI summary generated successfully", 'success');
                        } else {
                            updateStatus("Failed to generate AI summary", 'error');
                        }
                    } else {
                        updateStatus("Error processing data for AI summary", 'error');
                    }
                }
            );
        });
    } catch (error) {
        console.error("Error generating AI summary:", error);
        updateStatus("Error generating AI summary", 'error');
    }
}

// Function to call OpenAI API
async function callOpenAI(analysisData) {
    try {
        // Check if API key is configured
        if (!OPENAI_CONFIG.API_KEY || OPENAI_CONFIG.API_KEY === 'your_openai_api_key_here') {
            updateStatus("Please configure OpenAI API key in config.js", 'error');
            return null;
        }

        const prompt = createPromptFromAnalysis(analysisData);
        
        const response = await fetch(OPENAI_CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_CONFIG.MODEL,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at analyzing user behavior and computer usage patterns. Provide clear, actionable insights about productivity, focus patterns, and recommendations for improvement."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: OPENAI_CONFIG.MAX_TOKENS,
                temperature: OPENAI_CONFIG.TEMPERATURE
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("OpenAI API error:", errorData);
            updateStatus(`OpenAI API error: ${response.status}`, 'error');
            return null;
        }

        const data = await response.json();
        return data.choices[0].message.content;
        
    } catch (error) {
        console.error("Error calling OpenAI API:", error);
        updateStatus("Network error calling OpenAI API", 'error');
        return null;
    }
}

// Function to create a prompt from analysis data
function createPromptFromAnalysis(analysis) {
    const duration = Math.round(analysis.timeStats.duration / 1000 / 60); // Convert to minutes
    const timeInside = Math.round(analysis.timeStats.timeInsideChrome / 1000 / 60);
    const timeOutside = Math.round(analysis.timeStats.timeOutsideChrome / 1000 / 60);
    
    return `Analyze this exam session data to detect potential academic dishonesty and cheating behavior:

You are an AI exam proctor analyzing student behavior during an online examination. Your primary goal is to identify suspicious activities that may indicate cheating, unauthorized resource access, or exam violations.

EXAM SESSION DATA:
- Total exam duration: ${duration} minutes
- Time focused on exam browser: ${timeInside} minutes
- Time away from exam browser: ${timeOutside} minutes (CRITICAL METRIC)
- Total monitored events: ${analysis.totalEvents}

BEHAVIOR ANALYSIS:
- Mouse clicks: ${analysis.mouseStats.totalClicks}
- Keyboard inputs: ${analysis.keyboardStats.totalKeystrokes}
- Websites/tabs visited: ${analysis.pageStats.uniqueUrls.length}
- Mouse movement patterns: ${Math.round(analysis.mouseStats.totalMovement)} pixels
- Window/tab switching frequency: ${JSON.stringify(analysis.clickDetails)}
- Time distribution: ${JSON.stringify(analysis.timeStats)}
- Page navigation patterns: ${JSON.stringify(analysis.pageStats)}
- Keystroke patterns: ${JSON.stringify(analysis.keyboardStats)}
- Mouse interaction data: ${JSON.stringify(analysis.mouseStats)}
- Text input analysis: ${JSON.stringify(analysis.textStats)}
- UI element interactions: ${JSON.stringify(analysis.clicksByElement)}
- Key usage frequency: ${JSON.stringify(analysis.keyboardStats.mostUsedKeys)}

TYPING BEHAVIOR:
- Words typed during exam: ${analysis.textStats.totalWordsTyped}
- Characters typed: ${analysis.textStats.totalCharactersTyped}
- Typing speed: ${analysis.textStats.typingSpeed.averageWPM} WPM
- Text deletions/corrections: ${analysis.textStats.deletions}

SUSPICIOUS ACTIVITY INDICATORS:
Most clicked elements: ${Object.entries(analysis.clicksByElement).slice(0, 5).map(([element, count]) => `- ${element}: ${count} clicks`).join('\n')}

Most used keys: ${Object.entries(analysis.keyboardStats.mostUsedKeys).slice(0, 10).map(([key, count]) => `- "${key}": ${count} times`).join('\n')}

REQUIRED ANALYSIS:
1. **CHEATING RISK ASSESSMENT**: Provide a risk score (LOW/MEDIUM/HIGH) based on:
   - Time spent outside exam browser (high risk if >10% of total time)
   - Unauthorized website access
   - Suspicious copy-paste patterns (Ctrl+C, Ctrl+V frequency)
   - Tab switching behavior
   - Unusual typing patterns

2. **VIOLATION DETECTION**: Flag potential violations:
   - External resource access (non-exam websites)
   - Communication attempts (social media, messaging)
   - Search engine usage
   - File access patterns
   - Screen sharing or recording software usage

3. **DETAILED FINDINGS**: List all websites visited and typed content for manual review

4. **RECOMMENDATION**: Should this exam session be flagged for academic integrity review?

Provide a clear, objective assessment focusing on academic integrity violations and suspicious behavior patterns.`;
}

// Function to display AI summary in a modal
function displayAISummary(summary) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
    `;
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
    `;
    
    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
            <h2 style="margin: 0; color: #333; font-size: 24px;">🤖 AI Session Summary</h2>
            <button id="closeModal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666; padding: 0; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;">×</button>
        </div>
        <div style="white-space: pre-wrap; color: #444; font-size: 14px;">${summary}</div>
        <div style="margin-top: 20px; text-align: right;">
            <button id="downloadSummary" style="background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin-right: 10px; font-size: 14px;">Download Summary</button>
            <button id="closeSummary" style="background: #666; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px;">Close</button>
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Add hover effect to close button
    const closeBtn = modalContent.querySelector('#closeModal');
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.backgroundColor = '#f0f0f0';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.backgroundColor = 'transparent';
    });
    
    // Close modal handlers
    const closeModal = () => {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    };
    
    modalContent.querySelector('#closeModal').addEventListener('click', closeModal);
    modalContent.querySelector('#closeSummary').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    // Download summary handler
    modalContent.querySelector('#downloadSummary').addEventListener('click', () => {
        const blob = new Blob([summary], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ai_session_summary.txt';
        a.click();
        URL.revokeObjectURL(url);
    });
}


function updateButtonStates() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const aiSummaryBtn = document.getElementById("aiSummaryBtn");
    const clearLogBtn = document.getElementById("clearLogBtn");

    const newStates = {
        start: !contentReady || isRecording,
        stop: !isRecording,
        download: !hasRecordedData || isRecording,
        analyze: !hasRecordedData || isRecording,
        aiSummary: !hasRecordedData || isRecording,
        clear: !hasRecordedData || isRecording
    };

    startBtn.disabled = newStates.start;
    stopBtn.disabled = newStates.stop;
    downloadBtn.disabled = newStates.download;
    analyzeBtn.disabled = newStates.analyze;
    aiSummaryBtn.disabled = newStates.aiSummary;
    clearLogBtn.disabled = newStates.clear;

    // Update recording state visual indicator
    stopBtn.setAttribute("data-recording", isRecording.toString());
    
    console.log("Button states updated:", {
        contentReady,
        isRecording,
        hasRecordedData,
        buttonStates: {
            startDisabled: newStates.start,
            stopDisabled: newStates.stop,
            downloadDisabled: newStates.download,
            analyzeDisabled: newStates.analyze,
            aiSummaryDisabled: newStates.aiSummary,
            clearDisabled: newStates.clear
        }
    });
}

function setContentReady(tabId) {
    contentReady = true;
    contentTabId = tabId;
    
    console.log("Setting content ready, checking storage state...");
    
    // Get state from storage and ensure consistency
    chrome.storage.local.get(["recording", "isRecording", "hasRecordedData", "eventsLog"], (result) => {
        console.log("Storage state retrieved:", result);
        
        // Check both 'recording' and 'isRecording' for compatibility
        const storageRecording = result.recording || result.isRecording || false;
        const storageHasData = result.hasRecordedData || (result.eventsLog && result.eventsLog.length > 0);
        const eventCount = result.eventsLog ? result.eventsLog.length : 0;
        
        console.log("Computed state:", { storageRecording, storageHasData, eventCount });
        
        // Update local state to match storage
        isRecording = storageRecording;
        hasRecordedData = storageHasData;
        
        updateButtonStates();
        
        // Set appropriate status message
        if (storageRecording) {
            updateStatus("Recording in progress...", 'success');
            console.log("Popup state: Recording in progress");
        } else if (storageHasData && eventCount > 0) {
            updateStatus(`Ready to analyze. ${eventCount} events captured.`, 'success');
            console.log("Popup state: Ready to analyze with", eventCount, "events");
        } else {
            updateStatus("Ready to record", 'success');
            console.log("Popup state: Ready to record");
        }
        
        console.log("Final popup state:", { 
            isRecording, 
            hasRecordedData, 
            eventCount,
            buttonsState: {
                start: !isRecording,
                stop: isRecording,
                download: hasRecordedData && !isRecording,
                analyze: hasRecordedData && !isRecording
            }
        });
    });
}

// Listen for the ready message from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.ready && sender.tab) {
        setContentReady(sender.tab.id);
    } else if (message.action === "recordingStopped") {
        // Handle recording stopped from floating button
        console.log("Received recording stopped notification from content script");
        
        // Update local state
        isRecording = false;
        hasRecordedData = message.hasData || true;
        
        // Update storage
        chrome.storage.local.set({ 
            isRecording: false, 
            hasRecordedData: true 
        }, () => {
            // Update UI
            updateButtonStates();
            updateStatus("Recording stopped via floating button", 'success');
            
            // Get event count for status
            chrome.storage.local.get(["eventsLog"], (result) => {
                const eventCount = result.eventsLog ? result.eventsLog.length : 0;
                updateStatus(`Recording stopped. ${eventCount} events captured.`, 'success');
            });
        });
    }
});

// Add a function to force refresh the popup state (useful for debugging)
function forceRefreshState() {
    console.log("Force refreshing popup state...");
    chrome.storage.local.get(["recording", "isRecording", "hasRecordedData", "eventsLog"], (result) => {
        console.log("Current storage contents:", result);
        
        const actualRecording = result.recording || result.isRecording || false;
        const actualHasData = result.hasRecordedData || (result.eventsLog && result.eventsLog.length > 0);
        
        console.log("Before update:", { isRecording, hasRecordedData });
        
        isRecording = actualRecording;
        hasRecordedData = actualHasData;
        
        console.log("After update:", { isRecording, hasRecordedData });
        
        updateButtonStates();
        
        const eventCount = result.eventsLog ? result.eventsLog.length : 0;
        if (actualRecording) {
            updateStatus("Recording in progress...", 'success');
        } else if (actualHasData && eventCount > 0) {
            updateStatus(`Ready to analyze. ${eventCount} events captured.`, 'success');
        } else {
            updateStatus("Ready to record", 'success');
        }
    });
}

// Check content script status when popup opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {ping: true}, (response) => {
            if (chrome.runtime.lastError) {
                console.log("Content script not yet loaded in this tab.");
                updateStatus("Content script not ready", 'error');
                
                // Even if content script isn't ready, try to refresh state from storage
                setTimeout(forceRefreshState, 100);
            } else if (response && response.pong) {
                setContentReady(tabs[0].id);
                
                // Double-check state from storage when popup opens
                setTimeout(() => {
                    forceRefreshState();
                }, 100);
            }
        });
    } else {
        updateStatus("Error: No active tab found", 'error');
    }
});

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('clearLogBtn').addEventListener('click', function() {
      // Clear the log in chrome.storage.local
      chrome.storage.local.set({ eventsLog: [] }, function() {
          console.log('Event log cleared.');
          // Optionally, update the UI to reflect the cleared log
          updateStatus("Event log has been cleared.", 'info');
          hasRecordedData = false; // Reset the state
          chrome.storage.local.set({ hasRecordedData: false });
          updateButtonStates(); // Update button states
      });
  });
});
  