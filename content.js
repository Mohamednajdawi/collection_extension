let recording = false;

// Generic event handler that records details from events.
function recordEvent(e) {
  chrome.storage.local.get(["recording"], (result) => { // Only check if recording
    if (result.recording) {
      let eventData = {
        type: e.type,
        timestamp: new Date().toISOString(),
        target: getElementXPath(e.target),
        targetInfo: getTargetInfo(e.target),
        url: window.location.href,
        tabName: document.title
      };

      // For keyboard events
      if (e.type === "keydown" || e.type === "keyup") {
        eventData.key = e.key;
        eventData.code = e.code;
      }

      // For click events
      if (e.type === "click") {
        eventData.clickX = e.clientX;
        eventData.clickY = e.clientY;
        eventData.targetTag = e.target.tagName;
        eventData.targetId = e.target.id;
        eventData.targetClasses = Array.from(e.target.classList);
        eventData.targetRoles = e.target.getAttribute('role') ? [e.target.getAttribute('role')] : [];
      }

      // For mouse events
      if (e.type.startsWith("mouse") || e.type === "click") {
        eventData.x = e.clientX;
        eventData.y = e.clientY;
        eventData.screenX = e.screenX;
        eventData.screenY = e.screenY;
        eventData.button = e.button;
        eventData.ctrlKey = e.ctrlKey;
        eventData.shiftKey = e.shiftKey;
        eventData.altKey = e.altKey;
        eventData.metaKey = e.metaKey;
        eventData.movementX = e.movementX;
        eventData.movementY = e.movementY;
        eventData.offsetX = e.offsetX;
        eventData.offsetY = e.offsetY;
        if (e.relatedTarget) {
          eventData.relatedTarget = getElementXPath(e.relatedTarget);
        }
      }

      // For scroll events
      if (e.type === 'scroll') {
        eventData.scrollX = window.scrollX;
        eventData.scrollY = window.scrollY;
        eventData.scrollLeft = e.target.scrollLeft;
        eventData.scrollTop = e.target.scrollTop;
      }

      // For form events
      if (e.type === 'input' || e.type === 'change') {
        if (e.target.tagName.toLowerCase() === 'select') {
          eventData.value = e.target.options[e.target.selectedIndex].value;
        } else if (e.target.type === 'checkbox' || e.target.type === 'radio') {
          eventData.value = e.target.checked;
        } else if (e.target.isContentEditable) {
          eventData.value = e.target.textContent;
        } else {
          eventData.value = e.target.value;
        }
        eventData.fieldIdentifier = getFieldIdentifier(e.target);
        eventData.isTextInput = e.target.tagName === 'INPUT' || 
                                e.target.tagName === 'TEXTAREA' || 
                                e.target.isContentEditable;
      }

      // Send the event data to the background script
      chrome.runtime.sendMessage({ action: "recordEvent", eventData: eventData });
    }
  });
}

// Add URL change detection using History API
let lastUrl = window.location.href;
new MutationObserver(() => {
  const url = window.location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log("URL changed to:", url);
    chrome.storage.local.get(["recording"], (result) => {
      if (result.recording) {
        console.log("Re-attaching listeners due to URL change");
        attachListeners(true);
      }
    });
  }
}).observe(document, { subtree: true, childList: true });

// Also handle URL changes through History API
window.addEventListener('popstate', () => {
  chrome.storage.local.get(["recording"], (result) => {
    if (result.recording) {
      console.log("Re-attaching listeners due to popstate");
      attachListeners(true);
    }
  });
});

// Modify the startRecording function to better handle persistence
function startRecording() {
  console.log("Starting recording...");
  // No need to get the old eventsLog, we are starting fresh.
  chrome.storage.local.set({ 
    recording: true, 
    eventsLog: [], // Always start with an empty log
    recordingStartTime: Date.now() // Add timestamp to track session
  }, () => {
    attachListeners(false); // Indicate a new recording, not resuming
  });
}

// Remove listeners when recording stops.
function stopRecording() {
  console.log("Stopping recording...");
  chrome.storage.local.set({ recording: false }, () => {
    // Pass mouseIntervals array to the function
    summarizeMouseIntervals(mouseIntervals);
    detachListeners();
  });
}

// Add new helper function to summarize intervals
function summarizeMouseIntervals(intervals) {
  console.log("Summarizing mouse intervals...");
  if (intervals.length === 0) return;
  
  let summaries = [];
  let currentInterval = {
    status: intervals[0].status,
    startTime: new Date(intervals[0].timestamp),
    endTime: new Date(intervals[0].timestamp)
  };
  
  for (let i = 1; i < intervals.length; i++) {
    const currentStatus = intervals[i].status;
    const currentTime = new Date(intervals[i].timestamp);
    
    if (currentStatus === currentInterval.status) {
      currentInterval.endTime = currentTime;
    } else {
      // Calculate duration in seconds
      const durationMs = currentInterval.endTime - currentInterval.startTime;
      const durationSec = (durationMs / 1000).toFixed(1);
      
      summaries.push({
        status: currentInterval.status,
        startTime: currentInterval.startTime.toISOString(),
        endTime: currentInterval.endTime.toISOString(),
        durationSeconds: parseFloat(durationSec)
      });
      
      // Start new interval
      currentInterval = {
        status: currentStatus,
        startTime: currentTime,
        endTime: currentTime
      };
    }
  }
  
  // Don't forget to add the last interval
  const durationMs = currentInterval.endTime - currentInterval.startTime;
  const durationSec = (durationMs / 1000).toFixed(1);
  summaries.push({
    status: currentInterval.status,
    startTime: currentInterval.startTime.toISOString(),
    endTime: currentInterval.endTime.toISOString(),
    durationSeconds: parseFloat(durationSec)
  });

  console.log('Mouse Interval Summary:', summaries);
  return summaries;
}

// ----- Mouse Inside/Outside Check -----
// This code tracks whether the mouse is inside the window or not,
// by directly recording mouseenter and mouseleave events.
let mouseIntervals = []; // Stores { timestamp: string, status: 'inside'|'outside' }

function recordMouseStatusChangeEvent(status) {
    if (recording) { // Only record if recording is active
        const timestamp = new Date().toISOString();
        console.log(`Mouse event: ${status} at ${timestamp}`);
        mouseIntervals.push({ timestamp, status });
    }
}

window.addEventListener('mouseover', () => {
    // More specific check to ensure it's the main document area
    // This basic version assumes any mouseover within the window means 'inside'
    // For more complex scenarios with iframes, additional logic might be needed.
    recordMouseStatusChangeEvent('inside');
});

window.addEventListener('mouseout', (e) => {
    e = e || window.event;
    var from = e.relatedTarget || e.toElement;
    if (!from || from.nodeName === "HTML") {
        recordMouseStatusChangeEvent('outside');
    }
});

// Listen for messages from the popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);
  
  if (message.command === "startRecording") {
    startRecording();
    sendResponse({ status: "recording started", success: true });
  } else if (message.command === "stopRecording") {
    stopRecording();
    chrome.storage.local.get(["eventsLog"], (result) => {
      console.log(`Stopping recording. Total events captured: ${result.eventsLog ? result.eventsLog.length : 0}`);
      sendResponse({ status: "recording stopped", success: true, log: result.eventsLog || [] });
    });
  } else if (message.command === "getLog") {
    chrome.storage.local.get(["eventsLog"], (result) => {
      console.log(`Getting log. Current events: ${result.eventsLog ? result.eventsLog.length : 0}`);
      sendResponse({ log: result.eventsLog || [], success: true });
    });
  } else if (message.ping) {
    sendResponse({ pong: true, success: true });
  } else if (message.action === "clearHistory") {
    localStorage.removeItem('chatHistory');
    console.log("Chat history cleared from content.js");
    sendResponse({ success: true });
    return true;
  } else if (message.command === "clearLog") {
    chrome.storage.local.set({ eventsLog: [] }, () => {
      console.log("Event log cleared in content.js");
      sendResponse({ success: true });
    });
    return true;
  }
  // New branch: Return mouse in/out intervals.
  else if (message.command === "getMouseIntervals") {
    sendResponse({ intervals: mouseIntervals, success: true });
  }
  // Add this to the chrome.runtime.onMessage.addListener section
  else if (message.command === "summarizeMouseIntervals") {
    const summaries = summarizeMouseIntervals(message.intervals);
    sendResponse(summaries);
  }
  
  return true; // Keep the message channel open for async responses.
});

// On initial load, check if we should be recording and handle existing data
chrome.storage.local.get(["recording", "recordingStartTime"], (result) => {
  if (result.recording) {
    console.log("Resuming recording from previous session");
    attachListeners(true);
  }
});

// Helper function to get descriptive target information.
function getTargetInfo(target) {
  let info = "";

    if (target.tagName) {
        info += target.tagName.toLowerCase();
    }

    if (target.id) {
        info += `#${target.id}`;
    }

    if (target.name) {
        info += `[name="${target.name}"]`;
    }
  if (target.type) {
    info += `[type="${target.type}"]`
  }

    if (target.textContent) {
        info += `: "${target.textContent.substring(0, 100).trim()}"`; // Limit length
    }
  if(target.value && (target.type === 'submit' || target.type === 'button')) {
    info += ` (value: ${target.value})`;
  }

    return info;
}

// Helper functions remain unchanged
function getElementXPath(element) {
  if (element && element.id)
    return '//*[@id="' + element.id + '"]';
  else
    return getElementTreeXPath(element);
}

function getElementTreeXPath(element) {
  const paths = [];

  // Use nodeName (instead of tagName) to get the proper node name for SVG elements
  for (; element && element.nodeType === Node.ELEMENT_NODE; element = element.parentNode) {
    let index = 0;
    for (let sibling = element.previousSibling; sibling; sibling = sibling.previousSibling) {
      if (sibling.nodeType === Node.DOCUMENT_TYPE_NODE)
        continue;
      if (sibling.nodeName === element.nodeName)
        ++index;
    }

    const tagName = element.nodeName.toLowerCase();
    const pathIndex = (index ? "[" + (index + 1) + "]" : "");
    paths.splice(0, 0, tagName + pathIndex);
  }

  return paths.length ? "/" + paths.join("/") : null;
}

// Helper function to get cursor position
function getCursorPosition(element) {
    if (element.selectionStart !== undefined) {
        return element.selectionStart;
    } else if (window.getSelection) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            return range.startOffset;
        }
    }
    return null;
}

// Helper function to get a unique identifier for the input field
function getFieldIdentifier(element) {
    return `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.name ? '[name=' + element.name + ']' : ''}`;
}

function attachListeners(resuming) {
  // Mouse Events
  document.addEventListener('click', recordEvent, true);
  document.addEventListener('mousedown', recordEvent, true);
  document.addEventListener('mouseup', recordEvent, true);
  document.addEventListener('mousemove', recordEvent, true);
  document.addEventListener('contextmenu', recordEvent, true);

  // Keyboard Events
  document.addEventListener('keydown', recordEvent, true);
  document.addEventListener('keyup', recordEvent, true);

  // Scroll event
  document.addEventListener('scroll', recordEvent, true);
  
  //Form Events
  document.addEventListener('input', recordEvent, true);
  document.addEventListener('change', recordEvent, true);
  document.addEventListener('submit', recordEvent, true);

  // Add paste event listener
  document.addEventListener('paste', function(e) {
    if (recording) {
      const pastedText = e.clipboardData.getData('text');
      const targetInfo = e.target.tagName.toLowerCase() +
        (e.target.id ? '#' + e.target.id : '') +
        (e.target.className ? '.' + e.target.className.replace(/ /g, '.') : '');

      const eventData = {
        type: 'paste',
        timestamp: new Date().toISOString(),
        pastedText: pastedText,
        targetInfo: targetInfo,
        url: window.location.href
      };

      chrome.runtime.sendMessage({ action: "recordEvent", eventData });
    }
  });

  // Enhance keydown event listener to capture text input
  document.addEventListener('keydown', function(e) {
    if (recording) {
      const targetInfo = e.target.tagName.toLowerCase() +
        (e.target.id ? '#' + e.target.id : '') +
        (e.target.className ? '.' + e.target.className.replace(/ /g, '.') : '') +
        (e.target.type ? '[type="' + e.target.type + '"]' : '');

      // Create event data with detailed text information
      const eventData = {
        type: 'keydown',
        timestamp: new Date().toISOString(),
        key: e.key,
        targetInfo: targetInfo,
        url: window.location.href,
        isTextInput: e.target.tagName === 'INPUT' || 
                    e.target.tagName === 'TEXTAREA' || 
                    e.target.isContentEditable,
        inputValue: e.target.value || e.target.textContent || '',
        // Add cursor position for more detailed analysis
        cursorPosition: getCursorPosition(e.target),
        // Add field identifier
        fieldIdentifier: getFieldIdentifier(e.target)
      };

      chrome.runtime.sendMessage({ action: "recordEvent", eventData });
    }
  });

  if (!resuming) { // For a new recording session
    console.log("Recording started successfully. All event listeners attached.");
    // Add an initial mouse status event when recording starts
    // This helps establish the state at the beginning of the recording period.
    const initialStatus = document.hasFocus() ? 'inside' : 'outside';
    // Use a slight delay to ensure this is after recordingStartTime is set, or pass recordingStartTime
    // For simplicity, record immediately. This timestamp will be very close to recordingStartTime.
    const initialTimestamp = new Date().toISOString();
    mouseIntervals = []; // Clear any previous mouse intervals from a prior session segment if any
    mouseIntervals.push({ timestamp: initialTimestamp, status: initialStatus });
    console.log(`Initial mouse status: ${initialStatus} at ${initialTimestamp}`);

  } else {
    console.log("Resuming recording. All event listeners re-attached.");
  }
}

function detachListeners() {
  // Remove Mouse Event Listeners
  document.removeEventListener('click', recordEvent, true);
  document.removeEventListener('mousedown', recordEvent, true);
  document.removeEventListener('mouseup', recordEvent, true);
  document.removeEventListener('mousemove', recordEvent, true);
  document.removeEventListener('contextmenu', recordEvent, true);

  // Remove Keyboard Event Listeners
  document.removeEventListener('keydown', recordEvent, true);
  document.removeEventListener('keyup', recordEvent, true);

  // Remove Scroll Event Listener
  document.removeEventListener('scroll', recordEvent, true);

  //Form Events
  document.removeEventListener('input', recordEvent, true);
  document.removeEventListener('change', recordEvent, true);
  document.removeEventListener('submit', recordEvent, true);

  console.log("Event listeners detached.");
}
