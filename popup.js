let contentTabId = null;
let contentReady = false;

function sendMessageToContent(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
            console.error("No active tab found");
            document.getElementById("status").textContent = "Error: No active tab found";
            return;
        }
        
        console.log("Sending message to content script:", message);
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Message sending failed:", chrome.runtime.lastError);
                document.getElementById("status").textContent = "Error: Content script not ready";
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

    // First, send message to clear the log
    sendMessageToContent({ command: "clearLog" }, (clearLogResponse) => {
        if (clearLogResponse && clearLogResponse.success) {
            console.log("Log cleared successfully. Starting recording...");
            document.getElementById("status").textContent = "Log cleared. Starting recording...";

            // Then, send message to start recording
            sendMessageToContent({ command: "startRecording" }, (startRecordingResponse) => {
                if (startRecordingResponse && startRecordingResponse.status) {
                    console.log("Recording started:", startRecordingResponse);
                    document.getElementById("status").textContent = "Recording started...";
                } else {
                    console.error("Failed to start recording:", startRecordingResponse);
                    document.getElementById("status").textContent = "Error starting recording";
                }
            });
        } else {
            console.error("Failed to clear log:", clearLogResponse);
            document.getElementById("status").textContent = "Error clearing log before recording";
        }
    });
});

// Stop Recording
document.getElementById("stopBtn").addEventListener("click", () => {
    console.log("Stop button clicked");
    sendMessageToContent({ command: "stopRecording" }, (response) => {
        if (response && response.status) {
            console.log("Recording stopped. Events captured:", response.log?.length || 0);
            document.getElementById("status").textContent = "Recording stopped.";
        } else {
            console.error("Failed to stop recording:", response);
            document.getElementById("status").textContent = "Error stopping recording";
        }
    });
});

// Download the log as a JSON file
document.getElementById("downloadBtn").addEventListener("click", () => {
    console.log("Download button clicked");
    sendMessageToContent({ command: "getLog" }, (response) => {
        if (!response || !response.log) {
            console.error("No log data available:", response);
            document.getElementById("status").textContent = "Error: No log data available";
            return;
        }
        console.log("Received log data. Events:", response.log.length);
        let logData = JSON.stringify(response.log, null, 2);
        let blob = new Blob([logData], { type: "application/json" });
        let url = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = url;
        a.download = "session_log.json";
        a.click();
        URL.revokeObjectURL(url);
    });
});

function setContentReady(tabId) {
    contentReady = true;
    contentTabId = tabId;
    document.getElementById("startBtn").disabled = false;
    document.getElementById("stopBtn").disabled = false;
    document.getElementById("downloadBtn").disabled = false;
    document.getElementById("status").textContent = "Ready to record.";
}

// Listen for the ready message from the content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.ready && sender.tab) {
        setContentReady(sender.tab.id);
    }
});

//Disable buttons by default.
document.getElementById("startBtn").disabled = true;
document.getElementById("stopBtn").disabled = true;
document.getElementById("downloadBtn").disabled = true;

// Get the current tab when popup opens, and check if the content script is already there.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
        //Try sending a message. If no response, then we know the content script isn't present.
        chrome.tabs.sendMessage(tabs[0].id, {ping: true}, (response) => {
            if (chrome.runtime.lastError) {
                console.log("Content script not yet loaded in this tab.");
                document.getElementById("status").textContent = "Content script not ready";
            } else if (response && response.pong) {
                setContentReady(tabs[0].id);
            }
        });
    } else {
        document.getElementById("status").textContent = "Error: No active tab found";
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
  