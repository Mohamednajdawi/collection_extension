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
        // Expect eventsLog and summarizedMouseIntervals from popup.js
        const processedData = processEventLog(message.eventsLog || [], message.summarizedMouseIntervals || []);
        sendResponse(processedData);
        return true; // For async response
    }
    return true;
});

// Helper to initialize the main stats object
function initializeStats(events) {
    const firstEvent = events[0] || {};
    const lastEvent = events[events.length - 1] || {};

    return {
        totalEvents: events.length,
        eventTypes: {},
        clicksByElement: {},
        clickDetails: [], // New for detailed click events
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
            startTime: firstEvent.timestamp,
            endTime: lastEvent.timestamp,
            duration: 0,
            inactivityPeriods: 0,
            timeInsideWindow: 0, // New
            timeOutsideWindow: 0 // New
        },
        pageStats: {
            uniqueUrls: new Set(),
            uniqueTabNames: new Set(), // New
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
        typingDetails: [] // New for detailed typing events
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
    stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;

    handlePageTracking(event, stats.pageStats, loopState);

    if (event.type === 'click') {
        handleClickEvent(event, stats.mouseStats, stats.clicksByElement);
        
        // New: Populate clickDetails
        const targetType = event.targetInfo ? event.targetInfo.split('[')[0] : 'unknown';
        const targetValue = event.targetInfo || 'N/A';
        stats.clickDetails.push({
            link: event.url || 'N/A',
            tabName: event.tabName || 'N/A',
            clickedElementInfo: event.targetInfo || 'N/A',
            timestamp: event.timestamp,
            event_description: `Clicked on ${targetType} '${targetValue}' in tab '${event.tabName || 'Unknown Tab'}' at ${event.url || 'Unknown URL'}`
        });
    } else if (event.type === 'keydown') {
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


function finalizeStats(stats, loopState, events, summarizedMouseIntervals) {
    if (stats.timeStats.startTime && stats.timeStats.endTime) {
        stats.timeStats.duration = new Date(stats.timeStats.endTime) - new Date(stats.timeStats.startTime);
    }

    stats.pageStats.uniqueUrls = Array.from(stats.pageStats.uniqueUrls);
    stats.pageStats.uniqueTabNames = Array.from(stats.pageStats.uniqueTabNames); // Convert Set to Array

    stats.keyboardStats.mostUsedKeys = Object.entries(stats.keyboardStats.mostUsedKeys)
        .sort(([, a], [, b]) => b - a)
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});
    
    if (loopState.currentField && loopState.fieldStartTime && events.length > 0) {
        const lastEventTimestamp = events[events.length - 1].timestamp;
        const timeInField = new Date(lastEventTimestamp) - new Date(loopState.fieldStartTime);
        stats.textStats.fieldFocusTime[loopState.currentField] =
            (stats.textStats.fieldFocusTime[loopState.currentField] || 0) + timeInField;
    }

    // Process summarizedMouseIntervals for timeInside/OutsideWindow
    if (summarizedMouseIntervals && summarizedMouseIntervals.length > 0) {
        summarizedMouseIntervals.forEach(interval => {
            if (interval.status === 'inside') {
                stats.timeStats.timeInsideWindow += (interval.durationSeconds * 1000); // Store in ms
            } else if (interval.status === 'outside') {
                stats.timeStats.timeOutsideWindow += (interval.durationSeconds * 1000); // Store in ms
            }
        });
    }

    populateFieldMetadata(stats.textStats);
    // Pass stats.typingDetails to be populated by finalizeTextAnalysis
    finalizeTextAnalysis(stats.textStats, loopState, stats.typingDetails);
}


function processEventLog(events, summarizedMouseIntervals) {
    if (!events || events.length === 0) {
        const emptyStats = initializeStats([]);
        // Still process mouse intervals if they exist, even with no other events
        if (summarizedMouseIntervals && summarizedMouseIntervals.length > 0) {
             summarizedMouseIntervals.forEach(interval => {
                if (interval.status === 'inside') {
                    emptyStats.timeStats.timeInsideWindow += (interval.durationSeconds * 1000);
                } else if (interval.status === 'outside') {
                    emptyStats.timeStats.timeOutsideWindow += (interval.durationSeconds * 1000);
                }
            });
        }
        return emptyStats; 
    }
    const stats = initializeStats(events);
    const loopState = initializeLoopState();

    events.forEach(event => {
        processSingleEvent(event, stats, loopState);
    });

    finalizeStats(stats, loopState, events, summarizedMouseIntervals);
    return stats;
}
