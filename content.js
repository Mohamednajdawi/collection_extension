let recording = false;
let eventsLog = [];

// Generic event handler that records details from events.
function recordEvent(e) {
  try {
    if (!recording) {
      console.warn("Received event while not recording:", e.type);
      return;
    }

    let eventData = {
      type: e.type,
      timestamp: Date.now(),
      target: getElementXPath(e.target)
    };

    // For keyboard events
    if (e.type.startsWith("key")) {
      eventData.key = e.key;
      eventData.code = e.code;
      eventData.ctrlKey = e.ctrlKey;
      eventData.shiftKey = e.shiftKey;
      eventData.altKey = e.altKey;
      eventData.metaKey = e.metaKey;
      eventData.repeat = e.repeat;
      eventData.location = e.location;
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
      } else {
        eventData.value = e.target.value;
      }
    }

    eventsLog.push(eventData);
    console.log(`Event recorded (${e.type}). Total events: ${eventsLog.length}`, eventData);
  } catch (error) {
    console.error("Error recording event:", error);
  }
}

// Attach listeners when recording starts.
function startRecording() {
  try {
    if (recording) {
      console.log("Recording already in progress");
      return;
    }
    console.log("Starting recording...");
    recording = true;
    eventsLog = [];

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

    console.log("Recording started successfully. All event listeners attached.");
  } catch (error) {
    console.error("Error starting recording:", error);
    recording = false;
    throw error;
  }
}

// Remove listeners when recording stops.
function stopRecording() {
  try {
    if (!recording) {
      console.log("No recording in progress");
      return;
    }
    
    recording = false;

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

    console.log("Recording stopped successfully. Total events captured:", eventsLog.length);
  } catch (error) {
    console.error("Error stopping recording:", error);
    throw error;
  }
}

// Listen for messages from the popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    console.log("Received message:", message);
    if (message.command === "startRecording") {
      startRecording();
      sendResponse({ status: "recording started", success: true });
    } else if (message.command === "stopRecording") {
      stopRecording();
      console.log(`Stopping recording. Total events captured: ${eventsLog.length}`);
      sendResponse({ status: "recording stopped", success: true, log: eventsLog });
    } else if (message.command === "getLog") {
      console.log(`Getting log. Current events: ${eventsLog.length}`);
      sendResponse({ log: eventsLog, success: true });
    } else if (message.ping) {
      sendResponse({pong: true, success: true});
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ error: error.message, success: false });
  }
  return true; // Keep the message channel open for async response
});

// Send a ready message to the popup when the content script loads.
try {
  chrome.runtime.sendMessage({ ready: true }, (response) => {
    if (chrome.runtime.lastError) {
      console.log("Popup not ready to receive ready message");
    }
  });
} catch (error) {
  console.error("Error sending ready message:", error);
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
