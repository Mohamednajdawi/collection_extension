chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Although we don't do anything specific here, this listener
    // is necessary to prevent the "Receiving end does not exist" error.
    // The popup is sending messages, and *something* needs to be listening,
    // even if it doesn't process the messages.
    console.log("Message received in background:", message);

    // You could add logic here to handle messages if needed, but for this
    // example, the content script handles everything.

    // It is important to return true from this function, to indicate that sendResponse will be called asynchronously.
    if (message.action === "recordEvent") {
        chrome.storage.local.get(["recording", "eventsLog"], (result) => {
            if (result.recording) {
                let updatedEventsLog = result.eventsLog || [];
                updatedEventsLog.push(message.eventData);
                chrome.storage.local.set({ eventsLog: updatedEventsLog });
                // TEMPORARY DEBUGGING: Log the URL of the tab that sent the event
                console.log("Event received from:", sender.tab ? sender.tab.url : "No tab information");
            }
        });
    } else if (message.action === "processEvents") {
        // Handle async processing properly
        (async () => {
            try {
                console.log("Processing events, total:", message.eventsLog?.length || 0);
                const processedData = await processEventLog(message.eventsLog || []); 
                console.log("Processing complete, sending response:", processedData);
                sendResponse(processedData);
            } catch (error) {
                console.error("Error processing events:", error);
                sendResponse(null);
            }
        })();
        return true; // Keep the message channel open for async response
    }
    return true;
});

// Listener for window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
    chrome.storage.local.get(["recording", "eventsLog"], (result) => {
        // Only record focus changes if a recording session is active
        if (result.recording) {
            const isFocused = windowId !== chrome.windows.WINDOW_ID_NONE && windowId !== undefined;
            const focusEventData = {
                type: 'window_focus_change',
                timestamp: new Date().toISOString(),
                focused: isFocused,
                windowId: windowId // Store windowId for debugging or future use
            };
            
            let updatedEventsLog = result.eventsLog || [];
            updatedEventsLog.push(focusEventData);
            chrome.storage.local.set({ eventsLog: updatedEventsLog });
            console.log('Window focus change event recorded:', focusEventData);
        }
    });
});

// Helper to initialize the main stats object
function initializeStats(events) {
    // Define all focus-related event types that should be excluded from regular event counts
    const focusEventTypes = [
        'window_focus_change', 
        'mouse_enter_chrome', 
        'mouse_leave_chrome', 
        'page_visibility_change', 
        'window_focus', 
        'window_blur'
    ];
    
    // Find first and last non-focus events for proper timing
    const nonFocusEvents = events.filter(e => !focusEventTypes.includes(e.type));
    const firstEvent = nonFocusEvents[0] || events[0] || {};
    const lastEvent = events.length > 0 ? events[events.length - 1] : {}; // Consider all events for end time

    return {
        totalEvents: nonFocusEvents.length, // Count only non-focus events
        eventTypes: {},
        clicksByElement: {},
        clickDetails: [],
        keyboardStats: {
            totalKeystrokes: 0,
            mostUsedKeys: {}
        },
        mouseStats: {
            totalClicks: 0,
            totalMovement: 0,
            clickHeatmap: []
        },
        timeStats: {
            startTime: firstEvent.timestamp, // Based on first non-focus or absolute first event
            endTime: lastEvent.timestamp,    // Based on absolute last event
            duration: 0,
            inactivityPeriods: 0,
            timeInsideChrome: 0, // New: Focus-based
            timeOutsideChrome: 0 // New: Focus-based
        },
        pageStats: {
            uniqueUrls: new Set(),
            uniqueTabNames: new Set(),
            timePerPage: {}
        },
        textStats: {
            totalCharactersTyped: 0,
            totalWordsTyped: 0,
            commonWords: {},
            languageStats: {
                sentences: 0,
                averageWordLength: 0,
                punctuationCount: {},
            },
            letterSequence: [],
            fieldHistory: {},
            deletions: 0,
            fieldFocusTime: {},
            typingSpeed: {
                averageWPM: 0,
                peakWPM: 0,
            },
            finalValues: {},
            fieldMetadata: {},
            inputSummary: []
        },
        typingDetails: []
    };
}

// Helper to initialize variables that change during the loop
function initializeLoopState() {
    return {
        lastTimestamp: null,
        currentPage: null,
        pageStartTime: null,
        currentField: null,
        fieldStartTime: null,
        characterCountForTypingSpeed: 0,
        typingIntervals: [], // stores time diffs between typed characters
        lastTypingTime: null
    };
}

function handlePageTracking(event, pageStats, loopState) {
        if (event.url) {
        pageStats.uniqueUrls.add(event.url);
    }
    if (event.tabName) {
        pageStats.uniqueTabNames.add(event.tabName);
    }
    if (event.url) {
        if (loopState.currentPage !== event.url) {
            if (loopState.currentPage && loopState.pageStartTime) {
                const timeOnPage = new Date(event.timestamp) - new Date(loopState.pageStartTime);
                pageStats.timePerPage[loopState.currentPage] =
                    (pageStats.timePerPage[loopState.currentPage] || 0) + timeOnPage;
            }
            loopState.currentPage = event.url;
            loopState.pageStartTime = event.timestamp;
        }
    }
}

function handleClickEvent(event, mouseStats, clicksByElement) {
    mouseStats.totalClicks++;
    mouseStats.clickHeatmap.push({
                x: event.clickX,
                y: event.clickY,
                target: event.targetInfo
            });
    const elementType = event.targetInfo ? event.targetInfo.split('[')[0] : 'unknown';
    clicksByElement[elementType] = (clicksByElement[elementType] || 0) + 1;
}

function handleMouseMoveEvent(event, mouseStats) {
    if (event.movementX !== undefined && event.movementY !== undefined) {
        mouseStats.totalMovement += Math.sqrt(event.movementX ** 2 + event.movementY ** 2);
    }
}

function handleKeydownEvent(event, keyboardStats, textStats, loopState) {
    keyboardStats.totalKeystrokes++;
    keyboardStats.mostUsedKeys[event.key] = (keyboardStats.mostUsedKeys[event.key] || 0) + 1;

    if (event.targetInfo && event.isTextInput) {
        const fieldId = event.fieldIdentifier || event.targetInfo; // Use a consistent fieldId

        // Field focus time
        if (loopState.currentField !== fieldId) {
            if (loopState.currentField && loopState.fieldStartTime) {
                const timeInField = new Date(event.timestamp) - new Date(loopState.fieldStartTime);
                textStats.fieldFocusTime[loopState.currentField] =
                    (textStats.fieldFocusTime[loopState.currentField] || 0) + timeInField;
            }
            loopState.currentField = fieldId;
            loopState.fieldStartTime = event.timestamp;
        }

        // Letter sequence and typing speed data
        if (event.key && event.key.length === 1) { // Single character
            textStats.letterSequence.push({
                        letter: event.key,
                        timestamp: event.timestamp,
                        field: fieldId,
                        position: event.cursorPosition,
                context: event.inputValue // Capture context at the time of keydown
            });
            loopState.characterCountForTypingSpeed++;
            if (loopState.lastTypingTime) {
                const timeDiff = new Date(event.timestamp) - new Date(loopState.lastTypingTime);
                loopState.typingIntervals.push(timeDiff);
            }
            loopState.lastTypingTime = event.timestamp;
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            textStats.deletions++;
        }

        // Field history
        if (!textStats.fieldHistory[fieldId]) {
            textStats.fieldHistory[fieldId] = [];
        }
        textStats.fieldHistory[fieldId].push({
                    timestamp: event.timestamp,
                    key: event.key,
            value: event.inputValue // Value at the time of keydown
        });
    }
}

function handlePasteEvent(event, textStats) {
    const fieldId = event.fieldIdentifier || event.targetInfo;
    if (fieldId && event.pastedText) {
        // Update finalValues directly as paste is an explicit input action
        const currentFinalValue = textStats.finalValues[fieldId]?.value || '';
        textStats.finalValues[fieldId] = {
            value: currentFinalValue + event.pastedText, // Append pasted text
            timestamp: event.timestamp,
            tabName: event.tabName,
            url: event.url,
            fieldInfo: event.targetInfo
        };
        // Potentially add to fieldHistory as well if detailed paste logging is needed
        if (!textStats.fieldHistory[fieldId]) {
            textStats.fieldHistory[fieldId] = [];
        }
        textStats.fieldHistory[fieldId].push({
            timestamp: event.timestamp,
            key: 'Paste', // Indicate paste event
            value: textStats.finalValues[fieldId].value // The new combined value
        });
    }
}


function handleGeneralEventTiming(event, timeStats, loopState) {
    if (loopState.lastTimestamp) {
        const timeDiff = new Date(event.timestamp) - new Date(loopState.lastTimestamp);
        if (timeDiff > 2000) { // Gap of more than 2 seconds
            timeStats.inactivityPeriods = (timeStats.inactivityPeriods || 0) + 1;
        }
    }
    loopState.lastTimestamp = event.timestamp;
}

function processSingleEvent(event, stats, loopState) {
    // Handle focus and mouse presence events for time calculation but don't count them in regular event stats
    if (event.type === 'window_focus_change' || 
        event.type === 'mouse_enter_chrome' || 
        event.type === 'mouse_leave_chrome' ||
        event.type === 'page_visibility_change' ||
        event.type === 'window_focus' ||
        event.type === 'window_blur') {
        // Count these in eventTypes for visibility but don't process them further
        stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;
        return; 
    }

    stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;
    handlePageTracking(event, stats.pageStats, loopState);

    if (event.type === 'click') {
        handleClickEvent(event, stats.mouseStats, stats.clicksByElement);
        const targetType = event.targetInfo ? event.targetInfo.split('[')[0] : 'unknown';
        const targetValue = event.targetInfo || 'N/A';
        stats.clickDetails.push({
            link: event.url || 'N/A',
            tabName: event.tabName || 'N/A',
            clickedElementInfo: event.targetInfo || 'N/A',
            timestamp: event.timestamp,
            event_description: `Clicked on ${targetType} '${targetValue}' in tab '${event.tabName || 'Unknown Tab'}' at ${event.url || 'Unknown URL'}`
        });
    } else if (event.type === 'keydown' || event.type === 'keydown_enhanced') {
        handleKeydownEvent(event, stats.keyboardStats, stats.textStats, loopState);
    } else if (event.type === 'mousemove') {
        handleMouseMoveEvent(event, stats.mouseStats);
    } else if (event.type === 'paste' && event.pastedText) {
        handlePasteEvent(event, stats.textStats);
    }

    if (event.type === 'input' && event.targetInfo) {
         const fieldId = event.fieldIdentifier || event.targetInfo;
         if (event.value !== undefined ) {
            stats.textStats.finalValues[fieldId] = {
                value: event.value,
                timestamp: event.timestamp,
                tabName: event.tabName,
                url: event.url,
                fieldInfo: event.targetInfo 
            };
        }
    }
    handleGeneralEventTiming(event, stats.timeStats, loopState);
}

function populateFieldMetadata(textStats) {
    for (const fieldId in textStats.finalValues) {
        if (textStats.finalValues.hasOwnProperty(fieldId)) {
            const finalValueEntry = textStats.finalValues[fieldId];
            let targetInfoForMetadata = finalValueEntry.fieldInfo;
            if (typeof finalValueEntry.fieldInfo === 'string') {
                const targetInfoParts = finalValueEntry.fieldInfo.split(',');
                targetInfoForMetadata = targetInfoParts[targetInfoParts.length - 1].trim();
            }
            textStats.fieldMetadata[fieldId] = {
                tabName: finalValueEntry.tabName,
                url: finalValueEntry.url,
                targetInfo: targetInfoForMetadata,
                // Timestamp of the final value is more relevant here than "firstInteraction"
                // if metadata is tied to the final state.
                interactionTimestamp: finalValueEntry.timestamp 
            };
        }
    }
}

function finalizeTextAnalysis(textStats, loopState, allTypingDetails) {
    let allFinalText = Object.values(textStats.finalValues)
        .map(fv => fv.value)
        .filter(v => typeof v === 'string')
        .join(' ');
        
    let words = allFinalText.toLowerCase().split(/\\s+/).filter(word => word.length > 0);
    textStats.totalWordsTyped = words.length; 

    words.forEach(word => {
        textStats.commonWords[word] = (textStats.commonWords[word] || 0) + 1;
    });
    textStats.commonWords = Object.entries(textStats.commonWords)
        .sort(([, a], [, b]) => b - a)
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

    if (words.length > 0) {
        const totalLength = words.reduce((sum, word) => sum + word.length, 0);
        textStats.languageStats.averageWordLength = totalLength / words.length;
        textStats.totalCharactersTyped = totalLength; 
    }
    
    if (loopState.typingIntervals.length > 0 && loopState.characterCountForTypingSpeed > 0) {
        const totalTypingTimeMs = loopState.typingIntervals.reduce((a, b) => a + b, 0);
        if (totalTypingTimeMs > 0) {
            const charactersPerMinute = (loopState.characterCountForTypingSpeed / totalTypingTimeMs) * 60000;
            textStats.typingSpeed.averageWPM = Math.round(charactersPerMinute / 5);
            let minInterval = Math.min(...loopState.typingIntervals.filter(interval => interval > 0));
            if (minInterval > 0 && Number.isFinite(minInterval)) {
                 const peakCharsPerMinute = (1 / minInterval) * 60000;
                 textStats.typingSpeed.peakWPM = Math.round(peakCharsPerMinute / 5);
            } else {
                textStats.typingSpeed.peakWPM = textStats.typingSpeed.averageWPM > 0 ? textStats.typingSpeed.averageWPM : 0;
            }
        } else {
             textStats.typingSpeed.averageWPM = 0;
             textStats.typingSpeed.peakWPM = 0;
        }
    }
    
    textStats.inputSummary = Object.entries(textStats.finalValues)
        .map(([fieldId, finalValueEntry]) => {
             let targetInfoSummary = finalValueEntry.fieldInfo;
             if (typeof finalValueEntry.fieldInfo === 'string') {
                const targetInfoParts = finalValueEntry.fieldInfo.split(',');
                targetInfoSummary = targetInfoParts[targetInfoParts.length - 1].trim();
            }
            // Populate allTypingDetails here
            allTypingDetails.push({
                link: finalValueEntry.url || 'N/A',
                tabName: finalValueEntry.tabName || 'N/A',
                typed_text: finalValueEntry.value,
                fieldId: fieldId, // Keep the original fieldId for reference
                fieldInfo: targetInfoSummary,
                timestamp: finalValueEntry.timestamp,
                event_description: `Typed '${finalValueEntry.value}' into field '${targetInfoSummary}' in tab '${finalValueEntry.tabName || 'Unknown Tab'}' at ${finalValueEntry.url || 'Unknown URL'}`
            });
            return {
                field: fieldId, 
                finalValue: finalValueEntry.value,
                fieldInfo: targetInfoSummary, 
                timestamp: finalValueEntry.timestamp
            };
        });
}

function calculateFocusTimes(allSortedEvents, stats) {
    stats.timeStats.timeInsideChrome = 0;
    stats.timeStats.timeOutsideChrome = 0;

    if (allSortedEvents.length === 0 || !stats.timeStats.startTime) {
        return;
    }

    let lastEventTime = new Date(stats.timeStats.startTime);
    let windowFocused = true; // Default to true - user is actively starting recording
    let mousePresent = true; // Default to true
    let pageVisible = true; // Default to true
    
    // Track mouse leave/enter pairs for debouncing
    let mouseEventHistory = [];
    const MOUSE_DEBOUNCE_MS = 2000; // 2 seconds debounce for mouse events
    const MIN_OUTSIDE_DURATION_MS = 5000; // Minimum 5 seconds to count as "outside"

    // Enhanced initial state detection with better fallbacks
    const firstWindowFocusEvent = allSortedEvents.find(e => 
        e.type === 'window_focus_change' || e.type === 'window_focus' || e.type === 'window_blur'
    );
    const firstMouseEvent = allSortedEvents.find(e => 
        e.type === 'mouse_enter_chrome' || e.type === 'mouse_leave_chrome'
    );
    const firstVisibilityEvent = allSortedEvents.find(e => 
        e.type === 'page_visibility_change'
    );

    // Set initial states with better logic
    if (firstWindowFocusEvent) {
        if (firstWindowFocusEvent.type === 'window_focus_change') {
            windowFocused = firstWindowFocusEvent.focused !== false;
        } else if (firstWindowFocusEvent.type === 'window_focus') {
            windowFocused = true;
        } else if (firstWindowFocusEvent.type === 'window_blur') {
            windowFocused = false;
        }
    }

    if (firstMouseEvent) {
        mousePresent = firstMouseEvent.mousePresent !== false;
    }

    if (firstVisibilityEvent) {
        pageVisible = firstVisibilityEvent.visible !== false;
    }

    // Helper function to determine if user is actively using Chrome
    function isActivelyUsingChrome(focused, visible, mousePresent, eventTime, mouseHistory) {
        // Primary indicator: window focus and page visibility
        const basicActivity = focused && visible;
        
        // If basic activity is true, user is definitely active
        if (basicActivity) return true;
        
        // If window is not focused, check for recent mouse activity
        if (!focused && mousePresent) {
            // Would return TRUE here - mouse present during temporary focus loss-
            return true;
        }
        
        // If page is not visible but window is focused, still consider active
        if (focused && !visible) return true;
        
        return false;
    }

    // Process events with improved logic
    for (let i = 0; i < allSortedEvents.length; i++) {
        const event = allSortedEvents[i];
        const eventTime = new Date(event.timestamp);

        if (eventTime < new Date(stats.timeStats.startTime)) continue;
        if (stats.timeStats.endTime && eventTime > new Date(stats.timeStats.endTime)) {
            const durationMs = new Date(stats.timeStats.endTime) - lastEventTime;
            if (durationMs > 0) {
                const isActive = isActivelyUsingChrome(windowFocused, pageVisible, mousePresent, eventTime, mouseEventHistory);
                if (isActive) {
                    stats.timeStats.timeInsideChrome += durationMs;
                } else {
                    // Only count as outside if duration is significant
                    if (durationMs >= MIN_OUTSIDE_DURATION_MS) {
                        stats.timeStats.timeOutsideChrome += durationMs;
                    } else {
                        // Treat brief periods as inside Chrome (likely UI interactions)
                        stats.timeStats.timeInsideChrome += durationMs;
                    }
                }
            }
            lastEventTime = new Date(stats.timeStats.endTime);
            break; 
        }

        const durationMs = eventTime - lastEventTime;

        if (durationMs > 0) {
            const isActive = isActivelyUsingChrome(windowFocused, pageVisible, mousePresent, eventTime, mouseEventHistory);
            if (isActive) {
                stats.timeStats.timeInsideChrome += durationMs;
            } else {
                // Apply minimum duration check for outside time
                if (durationMs >= MIN_OUTSIDE_DURATION_MS) {
                    stats.timeStats.timeOutsideChrome += durationMs;
                } else {
                    // Treat brief periods as inside Chrome
                    stats.timeStats.timeInsideChrome += durationMs;
                }
            }
        }

        // Update states based on event type with improved handling
        if (event.type === 'window_focus_change') {
            windowFocused = event.focused !== false;
            // Window focus is the most reliable indicator, clear mouse ambiguity
            if (windowFocused) {
                mouseEventHistory = []; // Reset mouse history when window regains focus
            }
        } else if (event.type === 'window_focus') {
            windowFocused = true;
            mouseEventHistory = [];
        } else if (event.type === 'window_blur') {
            windowFocused = false;
        } else if (event.type === 'mouse_enter_chrome') {
            mousePresent = true;
            mouseEventHistory.push({ type: 'enter', timestamp: event.timestamp });
            // Limit history size
            if (mouseEventHistory.length > 10) {
                mouseEventHistory = mouseEventHistory.slice(-5);
            }
        } else if (event.type === 'mouse_leave_chrome') {
            // Apply debouncing logic for mouse leave events
            const lastMouseEnter = mouseEventHistory.filter(e => e.type === 'enter').pop();
            if (lastMouseEnter) {
                const timeSinceEnter = eventTime - new Date(lastMouseEnter.timestamp);
                if (timeSinceEnter < MOUSE_DEBOUNCE_MS) {
                    // Ignore rapid mouse leave after recent enter (likely UI interaction)
                    continue;
                }
            }
            
            mousePresent = false;
            mouseEventHistory.push({ type: 'leave', timestamp: event.timestamp });
            if (mouseEventHistory.length > 10) {
                mouseEventHistory = mouseEventHistory.slice(-5);
            }
        } else if (event.type === 'page_visibility_change') {
            pageVisible = event.visible !== false;
        }
        
        lastEventTime = eventTime;
    }

    // Handle final duration from last event to session end
    if (stats.timeStats.endTime) {
        const sessionEndTime = new Date(stats.timeStats.endTime);
        if (sessionEndTime > lastEventTime) {
            const finalDurationMs = sessionEndTime - lastEventTime;
            const isActive = isActivelyUsingChrome(windowFocused, pageVisible, mousePresent, sessionEndTime, mouseEventHistory);
            if (isActive) {
                stats.timeStats.timeInsideChrome += finalDurationMs;
            } else {
                if (finalDurationMs >= MIN_OUTSIDE_DURATION_MS) {
                    stats.timeStats.timeOutsideChrome += finalDurationMs;
                } else {
                    stats.timeStats.timeInsideChrome += finalDurationMs;
                }
            }
        }
    }
    
    // Enhanced validation and correction
    const totalFocusTime = stats.timeStats.timeInsideChrome + stats.timeStats.timeOutsideChrome;
    const discrepancy = Math.abs(totalFocusTime - stats.timeStats.duration);
    
    console.log(`Enhanced time calculation:`, {
        inside: stats.timeStats.timeInsideChrome,
        outside: stats.timeStats.timeOutsideChrome,
        total: totalFocusTime,
        duration: stats.timeStats.duration,
        discrepancy: discrepancy
    });
    
    // Auto-correct significant discrepancies
    if (discrepancy > 1000 && stats.timeStats.duration > 0) { 
        console.warn(`Correcting time discrepancy of ${discrepancy}ms`);
        const ratio = stats.timeStats.duration / totalFocusTime;
        stats.timeStats.timeInsideChrome = Math.round(stats.timeStats.timeInsideChrome * ratio);
        stats.timeStats.timeOutsideChrome = stats.timeStats.duration - stats.timeStats.timeInsideChrome;
    }
    
    // Ensure non-negative values
    stats.timeStats.timeInsideChrome = Math.max(0, stats.timeStats.timeInsideChrome);
    stats.timeStats.timeOutsideChrome = Math.max(0, stats.timeStats.timeOutsideChrome);
}

function finalizeStats(stats, loopState, events) { // events here is the original sorted log for other stats
    if (stats.timeStats.startTime && stats.timeStats.endTime) {
        stats.timeStats.duration = new Date(stats.timeStats.endTime) - new Date(stats.timeStats.startTime);
    } else if (events.length > 0) { // Fallback if endTime wasn't perfectly set by last event
        const lastEv = events[events.length - 1];
        if (lastEv) stats.timeStats.endTime = lastEv.timestamp;
        if (stats.timeStats.startTime && stats.timeStats.endTime) {
             stats.timeStats.duration = new Date(stats.timeStats.endTime) - new Date(stats.timeStats.startTime);
        }
    }

    // Calculate focus-based times using ALL events from storage (including focus changes)
    // This requires access to the full log as passed to processEventLog initially
    // For simplicity, assuming 'events' passed to finalizeStats is the full unfiltered list here.
    // If not, processEventLog needs to pass the original full list to finalizeStats too.
    // Let's assume processEventLog ensures 'events' IS the full list from storage for this.
    calculateFocusTimes(events, stats); 

    stats.pageStats.uniqueUrls = Array.from(stats.pageStats.uniqueUrls);
    stats.pageStats.uniqueTabNames = Array.from(stats.pageStats.uniqueTabNames);

    stats.keyboardStats.mostUsedKeys = Object.entries(stats.keyboardStats.mostUsedKeys)
        .sort(([, a], [, b]) => b - a)
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});
    
    if (loopState.currentField && loopState.fieldStartTime && events.length > 0) {
        const actualLastEvent = events.filter(e => e.type !== 'window_focus_change').pop();
        if (actualLastEvent) {
            const timeInField = new Date(actualLastEvent.timestamp) - new Date(loopState.fieldStartTime);
            stats.textStats.fieldFocusTime[loopState.currentField] =
                (stats.textStats.fieldFocusTime[loopState.currentField] || 0) + timeInField;
        }
    }

    populateFieldMetadata(stats.textStats);
    finalizeTextAnalysis(stats.textStats, loopState, stats.typingDetails);
}

async function processEventLog(allEventsFromStorage) { 
    try {
        console.log("Starting event log processing...");
        
        if (!allEventsFromStorage || allEventsFromStorage.length === 0) {
            console.log("No events to process, returning empty stats");
            return initializeStats([]);
        }

        // Sort all events by timestamp first, as focus events are mixed in
        const sortedEvents = [...allEventsFromStorage].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        console.log("Sorted events count:", sortedEvents.length);

        // Inject initial state events if they don't exist at the beginning
        const firstEventTime = sortedEvents[0].timestamp;
        const initialEvents = [];

        // Check if we have initial state events
        const hasInitialWindowFocus = sortedEvents.some(e => 
            (e.type === 'window_focus_change' || e.type === 'window_focus' || e.type === 'window_blur') &&
            new Date(e.timestamp).getTime() <= new Date(firstEventTime).getTime() + 100
        );
        
        const hasInitialMouseEvent = sortedEvents.some(e => 
            (e.type === 'mouse_enter_chrome' || e.type === 'mouse_leave_chrome') &&
            new Date(e.timestamp).getTime() <= new Date(firstEventTime).getTime() + 100
        );
        
        const hasInitialVisibilityEvent = sortedEvents.some(e => 
            e.type === 'page_visibility_change' &&
            new Date(e.timestamp).getTime() <= new Date(firstEventTime).getTime() + 100
        );

        // Inject missing initial state events with timestamps slightly before the first event
        const initialTimestamp = new Date(new Date(firstEventTime).getTime() - 50).toISOString();

        if (!hasInitialWindowFocus) {
            // Simplified: assume focused initially (most common case when recording starts)
            initialEvents.push({
                type: 'window_focus_change',
                timestamp: initialTimestamp,
                focused: true,
                windowId: -1
            });
        }

        if (!hasInitialMouseEvent) {
            // Assume mouse is present initially when recording starts
            initialEvents.push({
                type: 'mouse_enter_chrome',
                timestamp: initialTimestamp,
                mousePresent: true
            });
        }

        if (!hasInitialVisibilityEvent) {
            // Assume page is visible initially when recording starts
            initialEvents.push({
                type: 'page_visibility_change',
                timestamp: initialTimestamp,
                visible: true,
                visibilityState: 'visible'
            });
        }

        // Combine initial events with sorted events
        const completeEventList = [...initialEvents, ...sortedEvents].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        console.log("Complete event list count:", completeEventList.length);

        const stats = initializeStats(completeEventList); // Initialize with complete sorted events for correct start/end times
        const loopState = initializeLoopState();

        // Iterate through complete event list for general processing
        completeEventList.forEach(event => {
            processSingleEvent(event, stats, loopState);
        });

        // Pass the complete event list to finalizeStats for focus time calculation
        finalizeStats(stats, loopState, completeEventList);
        
        console.log("Event processing completed successfully");
        console.log("Final stats preview:", {
            totalEvents: stats.totalEvents,
            timeInsideChrome: stats.timeStats.timeInsideChrome,
            timeOutsideChrome: stats.timeStats.timeOutsideChrome,
            duration: stats.timeStats.duration
        });
        
        return stats;
    } catch (error) {
        console.error("Error in processEventLog:", error);
        console.error("Stack trace:", error.stack);
        // Return empty stats rather than throwing
        return initializeStats([]);
    }
}
