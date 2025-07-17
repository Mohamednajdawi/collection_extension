// Ensure content script is properly initialized
let isInitialized = false;
let recording = false;

// Initialization function to ensure everything is set up
function initializeContentScript() {
    if (isInitialized) return;
    
    console.log("Initializing content script...");
    
    // Send ready signal to popup
    try {
        chrome.runtime.sendMessage({ ready: true });
    } catch (error) {
        console.log("Could not send ready message:", error);
    }
    
    // Check if we should be recording from a previous session
    chrome.storage.local.get(["recording"], (result) => {
        if (result.recording) {
            console.log("Resuming recording from previous session");
            recording = true;
            
            // Attach listeners
            try {
                attachListeners(true);
            } catch (error) {
                console.error("Error attaching listeners during resume:", error);
            }
            
            // Show floating stop button
            try {
                createFloatingStopButton();
                console.log("Floating stop button restored after page navigation");
            } catch (error) {
                console.error("Error creating floating button during resume:", error);
            }
        }
    });
    
    isInitialized = true;
    console.log("Content script initialized successfully");
}

// Call initialization immediately and on DOM ready
initializeContentScript();

// Also initialize when DOM is ready (in case script loads before DOM)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
    // DOM is already ready
    initializeContentScript();
}

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

// Handler for mouse enter events
function handleMouseEnter(e) {
  chrome.storage.local.get(["recording"], (result) => {
    if (result.recording) {
      const eventData = {
        type: 'mouse_enter_chrome',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        tabName: document.title,
        mousePresent: true
      };
      chrome.runtime.sendMessage({ action: "recordEvent", eventData: eventData });
    }
  });
}

// Handler for mouse leave events
function handleMouseLeave(e) {
  chrome.storage.local.get(["recording"], (result) => {
    if (result.recording) {
      const eventData = {
        type: 'mouse_leave_chrome',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        tabName: document.title,
        mousePresent: false
      };
      chrome.runtime.sendMessage({ action: "recordEvent", eventData: eventData });
    }
  });
}

// Handler for visibility change events
function handleVisibilityChange() {
  chrome.storage.local.get(["recording"], (result) => {
    if (result.recording) {
      const eventData = {
        type: 'page_visibility_change',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        tabName: document.title,
        visible: !document.hidden,
        visibilityState: document.visibilityState
      };
      chrome.runtime.sendMessage({ action: "recordEvent", eventData: eventData });
    }
  });
}

// Handler for window focus events
function handleWindowFocus() {
  chrome.storage.local.get(["recording"], (result) => {
    if (result.recording) {
      const eventData = {
        type: 'window_focus',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        tabName: document.title,
        focused: true
      };
      chrome.runtime.sendMessage({ action: "recordEvent", eventData: eventData });
    }
  });
}

// Handler for window blur events
function handleWindowBlur() {
  chrome.storage.local.get(["recording"], (result) => {
    if (result.recording) {
      const eventData = {
        type: 'window_blur',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        tabName: document.title,
        focused: false
      };
      chrome.runtime.sendMessage({ action: "recordEvent", eventData: eventData });
    }
  });
}

// Add URL change detection using History API
let lastUrl = window.location.href;

// More robust URL change detection
function handleUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log("URL changed to:", currentUrl);
        
        chrome.storage.local.get(["recording"], (result) => {
            if (result.recording) {
                console.log("Re-attaching listeners due to URL change");
                
                // Small delay to ensure page elements are ready
                setTimeout(() => {
                    try {
                        detachListeners();
                        attachListeners(true);
                        
                        // Recreate floating button after navigation
                        if (!floatingButton) {
                            createFloatingStopButton();
                            console.log("Floating stop button recreated after URL change");
                        }
                    } catch (error) {
                        console.error("Error during URL change handling:", error);
                    }
                }, 100);
            }
        });
    }
}

// Multiple ways to detect URL changes for better reliability
new MutationObserver(() => {
    handleUrlChange();
}).observe(document, { subtree: true, childList: true });

// Handle pushState/replaceState
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
    originalPushState.apply(this, args);
    setTimeout(handleUrlChange, 50);
};

history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    setTimeout(handleUrlChange, 50);
};

// Handle popstate events
window.addEventListener('popstate', () => {
    setTimeout(handleUrlChange, 50);
});

// Handle hashchange events
window.addEventListener('hashchange', () => {
    setTimeout(handleUrlChange, 50);
});

// Modify the startRecording function to better handle persistence
function startRecording() {
  console.log("Starting recording...");
  
  // Set recording state immediately
  recording = true;
  
  // Clear any existing events and start fresh
  chrome.storage.local.set({ 
    recording: true, 
    eventsLog: [], // Always start with an empty log
    recordingStartTime: Date.now() // Add timestamp to track session
  }, () => {
    if (chrome.runtime.lastError) {
        console.error("Error setting storage:", chrome.runtime.lastError);
        recording = false;
        return;
    }
    
    console.log("Storage set successfully, capturing initial state...");
    
    // Capture initial state events
    try {
        captureInitialState();
    } catch (error) {
        console.error("Error capturing initial state:", error);
    }
    
    // Attach event listeners
    try {
        attachListeners(false); // Indicate a new recording, not resuming
        console.log("Recording started successfully");
    } catch (error) {
        console.error("Error attaching listeners:", error);
        recording = false;
        chrome.storage.local.set({ recording: false });
        return;
    }
    
    // Show floating stop button
    try {
        createFloatingStopButton();
    } catch (error) {
        console.error("Error creating floating button:", error);
    }
  });
}

// Function to capture initial state when recording starts
function captureInitialState() {
  const timestamp = new Date().toISOString();
  
  // Capture initial window focus state
  const windowFocusEvent = {
    type: 'window_focus',
    timestamp: timestamp,
    url: window.location.href,
    tabName: document.title,
    focused: document.hasFocus()
  };
  chrome.runtime.sendMessage({ action: "recordEvent", eventData: windowFocusEvent });

  // Capture initial page visibility state
  const visibilityEvent = {
    type: 'page_visibility_change',
    timestamp: timestamp,
    url: window.location.href,
    tabName: document.title,
    visible: !document.hidden,
    visibilityState: document.visibilityState
  };
  chrome.runtime.sendMessage({ action: "recordEvent", eventData: visibilityEvent });

  // Capture initial mouse presence (assume present when recording starts)
  const mouseEvent = {
    type: 'mouse_enter_chrome',
    timestamp: timestamp,
    url: window.location.href,
    tabName: document.title,
    mousePresent: true
  };
  chrome.runtime.sendMessage({ action: "recordEvent", eventData: mouseEvent });
}

// Remove listeners when recording stops.
function stopRecording() {
  console.log("Stopping recording...");
  recording = false;
  
  // Remove floating button first
  try {
    removeFloatingStopButton();
  } catch (error) {
    console.error("Error removing floating button:", error);
  }
  
  chrome.storage.local.set({ recording: false }, () => {
    if (chrome.runtime.lastError) {
        console.error("Error updating storage:", chrome.runtime.lastError);
    }
    
    try {
        detachListeners();
        console.log("Recording stopped successfully");
    } catch (error) {
        console.error("Error detaching listeners:", error);
    }
  });
}

function attachListeners(resuming) {
  // Mouse Events
  document.addEventListener('click', recordEvent, true);
  document.addEventListener('mousedown', recordEvent, true);
  document.addEventListener('mouseup', recordEvent, true);
  document.addEventListener('mousemove', recordEvent, true);
  document.addEventListener('contextmenu', recordEvent, true);
  
  // Mouse enter/leave events for tracking when mouse is in/out of Chrome window
  document.addEventListener('mouseenter', handleMouseEnter, true);
  document.addEventListener('mouseleave', handleMouseLeave, true);
  
  // Page visibility events for better focus detection
  document.addEventListener('visibilitychange', handleVisibilityChange, true);
  
  // Window focus/blur events
  window.addEventListener('focus', handleWindowFocus, true);
  window.addEventListener('blur', handleWindowBlur, true);

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
    chrome.storage.local.get(["recording"], (result) => {
      if (result.recording) {
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
  });

  // Enhanced keydown event listener to capture additional text input details
  document.addEventListener('keydown', function(e) {
    chrome.storage.local.get(["recording"], (result) => {
      if (result.recording) {
        const targetInfo = e.target.tagName.toLowerCase() +
          (e.target.id ? '#' + e.target.id : '') +
          (e.target.className ? '.' + e.target.className.replace(/ /g, '.') : '') +
          (e.target.type ? '[type="' + e.target.type + '"]' : '');

        // Create event data with detailed text information
        const eventData = {
          type: 'keydown_enhanced', // Use different type to avoid duplicate with recordEvent
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
  });

  if (resuming) {
    console.log("Resuming recording. All event listeners re-attached.");
  } else {
    console.log("Recording started successfully. All event listeners attached.");
  }
}

function detachListeners() {
  // Remove Mouse Event Listeners
  document.removeEventListener('click', recordEvent, true);
  document.removeEventListener('mousedown', recordEvent, true);
  document.removeEventListener('mouseup', recordEvent, true);
  document.removeEventListener('mousemove', recordEvent, true);
  document.removeEventListener('contextmenu', recordEvent, true);
  
  // Remove Mouse enter/leave event listeners
  document.removeEventListener('mouseenter', handleMouseEnter, true);
  document.removeEventListener('mouseleave', handleMouseLeave, true);
  
  // Remove Page visibility event listeners
  document.removeEventListener('visibilitychange', handleVisibilityChange, true);
  
  // Remove Window focus/blur event listeners
  window.removeEventListener('focus', handleWindowFocus, true);
  window.removeEventListener('blur', handleWindowBlur, true);

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
  
  
  return true; // Keep the message channel open for async responses.
});

// Floating stop button functionality
let floatingButton = null;

function createFloatingStopButton() {
    // Remove existing button if any
    removeFloatingStopButton();
    
    // Create the floating button
    floatingButton = document.createElement('div');
    floatingButton.id = 'session-recorder-stop-btn';
    floatingButton.innerHTML = `
        <div class="stop-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M6 6h12v12H6z"/>
            </svg>
        </div>
        <span class="stop-text">Stop Recording</span>
    `;
    
    // Apply styles
    floatingButton.style.cssText = `
        position: fixed !important;
        top: 20px !important;
        right: 20px !important;
        z-index: 999999 !important;
        background: linear-gradient(135deg, #ff4757, #ff3838) !important;
        color: white !important;
        border: none !important;
        border-radius: 25px !important;
        padding: 12px 20px !important;
        cursor: pointer !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        box-shadow: 0 4px 15px rgba(255, 71, 87, 0.4) !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        transition: all 0.3s ease !important;
        user-select: none !important;
        backdrop-filter: blur(10px) !important;
        animation: slideInFromRight 0.5s ease-out !important;
    `;
    
    // Add hover effects
    floatingButton.addEventListener('mouseenter', () => {
        floatingButton.style.transform = 'scale(1.05)';
        floatingButton.style.boxShadow = '0 6px 20px rgba(255, 71, 87, 0.6)';
    });
    
    floatingButton.addEventListener('mouseleave', () => {
        floatingButton.style.transform = 'scale(1)';
        floatingButton.style.boxShadow = '0 4px 15px rgba(255, 71, 87, 0.4)';
    });
    
    // Add click handler
    floatingButton.addEventListener('click', () => {
        console.log("Floating stop button clicked");
        
        // Add click animation
        floatingButton.style.transform = 'scale(0.95)';
        setTimeout(() => {
            floatingButton.style.transform = 'scale(1)';
        }, 150);
        
        // Stop recording and ensure storage is updated
        stopRecording();
        
        // Force update storage state immediately
        chrome.storage.local.set({ 
            recording: false,
            isRecording: false,
            hasRecordedData: true
        }, () => {
            console.log("Storage updated after floating button click");
            
            // Get final event count for confirmation
            chrome.storage.local.get(["eventsLog"], (result) => {
                const eventCount = result.eventsLog ? result.eventsLog.length : 0;
                console.log(`Recording stopped via floating button. ${eventCount} events captured.`);
                
                // Show confirmation
                showStopConfirmation();
                
                // Try to notify popup if it's open (this might fail if popup is closed, which is fine)
                try {
                    chrome.runtime.sendMessage({ 
                        action: "recordingStopped", 
                        hasData: true,
                        eventCount: eventCount
                    });
                    console.log("Sent recording stopped notification to popup");
                } catch (error) {
                    console.log("Could not notify popup (likely closed):", error);
                }
            });
        });
    });
    
    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInFromRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutToRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
        
        #session-recorder-stop-btn .stop-text {
            white-space: nowrap !important;
        }
        
        @media (max-width: 768px) {
            #session-recorder-stop-btn {
                padding: 10px 16px !important;
                font-size: 12px !important;
            }
            #session-recorder-stop-btn .stop-text {
                display: none !important;
            }
        }
    `;
    document.head.appendChild(style);
    
    // Append to body
    document.body.appendChild(floatingButton);
    
    console.log("Floating stop button created");
}

function removeFloatingStopButton() {
    if (floatingButton) {
        // Add exit animation
        floatingButton.style.animation = 'slideOutToRight 0.3s ease-in';
        
        setTimeout(() => {
            if (floatingButton && floatingButton.parentNode) {
                floatingButton.parentNode.removeChild(floatingButton);
            }
            floatingButton = null;
        }, 300);
        
        console.log("Floating stop button removed");
    }
}

function showStopConfirmation() {
    // Create a temporary confirmation message
    const confirmation = document.createElement('div');
    confirmation.innerHTML = '✓ Recording Stopped';
    confirmation.style.cssText = `
        position: fixed !important;
        top: 20px !important;
        right: 20px !important;
        z-index: 1000000 !important;
        background: #2ed573 !important;
        color: white !important;
        padding: 12px 20px !important;
        border-radius: 25px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        box-shadow: 0 4px 15px rgba(46, 213, 115, 0.4) !important;
        animation: slideInFromRight 0.3s ease-out !important;
    `;
    
    document.body.appendChild(confirmation);
    
    // Remove after 3 seconds
    setTimeout(() => {
        if (confirmation && confirmation.parentNode) {
            confirmation.style.animation = 'slideOutToRight 0.3s ease-in';
            setTimeout(() => {
                if (confirmation.parentNode) {
                    confirmation.parentNode.removeChild(confirmation);
                }
            }, 300);
        }
    }, 3000);
}

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
