let contentTabId = null;
let contentReady = false;
let isRecording = false;
let hasRecordedData = false;

// Helper function to update status with visual feedback
function updateStatus(message, type = 'info') {
    const statusEl = document.getElementById("status");
    statusEl.textContent = message;
    statusEl.className = ''; // Reset classes
    
    if (type === 'success') {
        statusEl.classList.add('status-success');
    } else if (type === 'error') {
        statusEl.classList.add('status-error');
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
            updateStatus("Recording in progress...", 'success');
            document.getElementById("stopBtn").setAttribute("data-recording", "true");
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



function updateButtonStates() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const clearLogBtn = document.getElementById("clearLogBtn");

    const newStates = {
        start: !contentReady || isRecording,
        stop: !isRecording,
        download: !hasRecordedData || isRecording,
        analyze: !hasRecordedData || isRecording,
        clear: !hasRecordedData || isRecording
    };

    startBtn.disabled = newStates.start;
    stopBtn.disabled = newStates.stop;
    downloadBtn.disabled = newStates.download;
    analyzeBtn.disabled = newStates.analyze;
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
  