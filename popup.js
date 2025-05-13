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
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Message sending failed:", chrome.runtime.lastError);
                updateStatus("Error: Content script not ready", 'error');
                return;
            }
            console.log("Received response from content script:", response);
            if (callback) callback(response);
        });
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

    let eventsLog = null;
    let rawMouseIntervals = null;

    // 1. Get Event Log
    sendMessageToContent({ command: "getLog" }, (logResponse) => {
        if (logResponse && logResponse.success) {
            eventsLog = logResponse.log;
            checkIfAllDataFetched();
        } else {
            console.error("Failed to get log:", logResponse);
            updateStatus("Error fetching event log for analysis", 'error');
        }
    });

    // 2. Get Raw Mouse Intervals (no longer summarizing them here)
    sendMessageToContent({ command: "getMouseIntervals" }, (mouseResponse) => {
        if (mouseResponse && mouseResponse.success) {
            rawMouseIntervals = mouseResponse.intervals;
            checkIfAllDataFetched();
        } else {
            console.error("Failed to get raw mouse intervals:", mouseResponse);
            updateStatus("Error fetching raw mouse data", 'error');
        }
    });

    function checkIfAllDataFetched() {
        if (eventsLog !== null && rawMouseIntervals !== null) {
            updateStatus("Sending data to background for analysis...");
            chrome.runtime.sendMessage(
                { 
                    action: "processEvents", 
                    eventsLog: eventsLog, 
                    rawMouseIntervals: rawMouseIntervals
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
        }
    }
});

// Download Mouse Intervals button handler
document.getElementById("downloadMouseIntervalsBtn").addEventListener("click", () => {
    console.log("Download Mouse Intervals button clicked");
    updateStatus("Processing mouse data...");
    sendMessageToContent({ command: "getMouseIntervals" }, (response) => {
        if (response && response.success) {
            const rawIntervals = response.intervals;
            
            sendMessageToContent({ command: "summarizeMouseIntervals", intervals: rawIntervals }, (summaryResponse) => {
                const combinedData = {
                    rawIntervals: rawIntervals,
                    summaries: summaryResponse
                };
                
                let intervalsData = JSON.stringify(combinedData, null, 2);
                let blob = new Blob([intervalsData], { type: "application/json" });
                let url = URL.createObjectURL(blob);
                let a = document.createElement("a");
                a.href = url;
                a.download = "mouse_intervals_with_summaries.json";
                a.click();
                URL.revokeObjectURL(url);
                updateStatus("Mouse data downloaded successfully", 'success');
            });
        } else {
            console.error("Failed to get mouse intervals:", response);
            updateStatus("Error downloading mouse data", 'error');
        }
    });
});

function updateButtonStates() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const downloadMouseIntervalsBtn = document.getElementById("downloadMouseIntervalsBtn");

    startBtn.disabled = !contentReady || isRecording;
    stopBtn.disabled = !isRecording;
    downloadBtn.disabled = !hasRecordedData || isRecording;
    analyzeBtn.disabled = !hasRecordedData || isRecording;
    downloadMouseIntervalsBtn.disabled = !hasRecordedData || isRecording;

    // Update recording state visual indicator
    stopBtn.setAttribute("data-recording", isRecording.toString());
}

function setContentReady(tabId) {
    contentReady = true;
    contentTabId = tabId;
    
    chrome.storage.local.get(["isRecording", "hasRecordedData"], (result) => {
        isRecording = result.isRecording || false;
        hasRecordedData = result.hasRecordedData || false;
        updateButtonStates();
    });
    
    updateStatus("Ready to record", 'success');
}

// Listen for the ready message from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.ready && sender.tab) {
        setContentReady(sender.tab.id);
    }
});

// Check content script status when popup opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {ping: true}, (response) => {
            if (chrome.runtime.lastError) {
                console.log("Content script not yet loaded in this tab.");
                updateStatus("Content script not ready", 'error');
            } else if (response && response.pong) {
                setContentReady(tabs[0].id);
            }
        });
    } else {
        updateStatus("Error: No active tab found", 'error');
    }
});

document.addEventListener('DOMContentLoaded', function () {
  const startBurromButton = document.getElementById('startBurrom'); // Assuming 'startBurrom' is the ID of your button

  if (startBurromButton) {
    startBurromButton.addEventListener('click', function() {
      // Send a message to content.js to clear the chat history
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "clearHistory"}, function(response) {
          if(response && response.success){
            console.log("Chat history cleared successfully");
          } else {
            console.error("Failed to clear chat history");
          }
        });
      });
      // ... rest of your button click logic (e.g., starting the bot) ...
    });
  }
  // ... rest of your popup.js code ...
});
  