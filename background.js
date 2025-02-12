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
        chrome.storage.local.get(["eventsLog"], (result) => {
            const processedData = processEventLog(result.eventsLog || []);
            sendResponse(processedData);
        });
        return true; // For async response
    }
    return true;
});

function processEventLog(events) {
    // Initialize statistics object with text-specific metrics
    const stats = {
        totalEvents: events.length,
        eventTypes: {},
        clicksByElement: {},
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
            startTime: events[0]?.timestamp,
            endTime: events[events.length - 1]?.timestamp,
            duration: 0
        },
        pageStats: {
            uniqueUrls: new Set(),
            timePerPage: {}
        },
        textStats: {
            totalCharactersTyped: 0,
            totalWordsTyped: 0,
            textByInput: {}, // Track text by input field
            commonWords: {},
            languageStats: {
                sentences: 0,
                averageWordLength: 0,
                punctuationCount: {},
            },
            inputFields: [], // List of all input fields interacted with
            letterSequence: [], // Track every letter in order
            textByField: {}, // Track text by input field
            fieldHistory: {}, // Track changes in each field
            deletions: 0,
            insertions: 0,
            replacements: 0,
            fieldFocusTime: {}, // Track time spent in each field
            typingSpeed: {
                averageWPM: 0,
                peakWPM: 0,
                timestamps: [] // For calculating typing speed
            },
            finalValues: {}, // Add this to track final values for each field
            fieldMetadata: {}, // Add this to store field context
            finalTextByField: {}, // New object to store only final text values
        }
    };

    let lastTimestamp = null;
    let currentPage = null;
    let pageStartTime = null;
    let currentInputField = null;
    let currentInputText = '';
    let lastTypingTime = null;
    let currentField = null;
    let fieldStartTime = null;
    let characterCount = 0;
    let timeIntervals = [];

    events.forEach((event, index) => {
        // Count event types
        stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;

        // Track unique URLs
        if (event.url) {
            stats.pageStats.uniqueUrls.add(event.url);
            
            if (currentPage !== event.url) {
                if (currentPage && pageStartTime) {
                    const timeOnPage = new Date(event.timestamp) - new Date(pageStartTime);
                    stats.pageStats.timePerPage[currentPage] = 
                        (stats.pageStats.timePerPage[currentPage] || 0) + timeOnPage;
                }
                currentPage = event.url;
                pageStartTime = event.timestamp;
            }
        }

        // Process click events
        if (event.type === 'click') {
            stats.mouseStats.totalClicks++;
            stats.mouseStats.clickHeatmap.push({
                x: event.clickX,
                y: event.clickY,
                target: event.targetInfo
            });

            // Track clicks by element type
            const elementType = event.targetInfo.split('[')[0]; // Get base element type
            stats.clicksByElement[elementType] = (stats.clicksByElement[elementType] || 0) + 1;
        }

        // Process keyboard events
        if (event.type === 'keydown') {
            stats.keyboardStats.totalKeystrokes++;
            stats.keyboardStats.mostUsedKeys[event.key] = 
                (stats.keyboardStats.mostUsedKeys[event.key] || 0) + 1;
        }

        // Calculate mouse movement
        if (event.type === 'mousemove' && event.movementX && event.movementY) {
            stats.mouseStats.totalMovement += 
                Math.sqrt(event.movementX ** 2 + event.movementY ** 2);
        }

        // Track timing
        if (lastTimestamp) {
            const timeDiff = new Date(event.timestamp) - new Date(lastTimestamp);
            if (timeDiff > 2000) { // Gap of more than 2 seconds
                stats.timeStats.inactivityPeriods = 
                    (stats.timeStats.inactivityPeriods || 0) + 1;
            }
        }
        lastTimestamp = event.timestamp;

        // Process text input events
        if (event.type === 'keydown' && event.targetInfo) {
            const isTextInput = event.isTextInput;
            const fieldId = event.fieldIdentifier;

            if (isTextInput) {
                // Track field changes
                if (currentField !== fieldId) {
                    if (currentField && fieldStartTime) {
                        // Calculate time spent in previous field
                        const timeInField = new Date(event.timestamp) - new Date(fieldStartTime);
                        stats.textStats.fieldFocusTime[currentField] = 
                            (stats.textStats.fieldFocusTime[currentField] || 0) + timeInField;
                    }
                    currentField = fieldId;
                    fieldStartTime = event.timestamp;
                }

                // Record the letter and its metadata
                if (event.key.length === 1) { // Single character
                    stats.textStats.letterSequence.push({
                        letter: event.key,
                        timestamp: event.timestamp,
                        field: fieldId,
                        position: event.cursorPosition,
                        context: event.inputValue
                    });

                    // Calculate typing speed
                    if (lastTypingTime) {
                        const timeDiff = new Date(event.timestamp) - new Date(lastTypingTime);
                        timeIntervals.push(timeDiff);
                    }
                    lastTypingTime = event.timestamp;
                    characterCount++;

                } else if (event.key === 'Backspace') {
                    stats.textStats.deletions++;
                } else if (event.key === 'Delete') {
                    stats.textStats.deletions++;
                }

                // Track field content
                stats.textStats.textByField[fieldId] = event.inputValue;

                // Add to field history
                if (!stats.textStats.fieldHistory[fieldId]) {
                    stats.textStats.fieldHistory[fieldId] = [];
                }
                stats.textStats.fieldHistory[fieldId].push({
                    timestamp: event.timestamp,
                    key: event.key,
                    value: event.inputValue
                });

                // Store only the final value for each field
                if (event.inputValue !== undefined) {
                    stats.textStats.finalTextByField[fieldId] = event.inputValue;
                }
            }
        }

        // Process paste events
        if (event.type === 'paste' && event.pastedText) {
            const fieldId = event.fieldIdentifier;
            if (fieldId) {
                const currentText = stats.textStats.finalTextByField[fieldId] || '';
                stats.textStats.finalTextByField[fieldId] = currentText + event.pastedText;
            }
        }

        // Track input values (both from keydown and input events)
        if ((event.type === 'input' || event.type === 'keydown') && event.targetInfo) {
            const fieldId = event.fieldIdentifier || event.targetInfo;
            
            // Store the latest value
            if (event.value || event.inputValue) {
                stats.textStats.finalValues[fieldId] = {
                    value: event.value || event.inputValue,
                    timestamp: event.timestamp,
                    tabName: event.tabName,
                    url: event.url,
                    fieldInfo: event.targetInfo
                };
            }

            // Store field metadata if we haven't already
            if (!stats.textStats.fieldMetadata[fieldId]) {
                // Extract the last element of targetInfo
                const targetInfoParts = event.targetInfo.split(',');
                const lastTargetInfo = targetInfoParts[targetInfoParts.length - 1].trim();

                stats.textStats.fieldMetadata[fieldId] = {
                    tabName: event.tabName,
                    url: event.url,
                    targetInfo: lastTargetInfo, // Use the extracted value
                    firstInteraction: event.timestamp
                };
            }
        }
    });

    // Process final text analysis
    if (currentInputField && currentInputText) {
        stats.textStats.textByInput[currentInputField] = 
            (stats.textStats.textByInput[currentInputField] || '') + currentInputText;
    }

    // Analyze all collected text
    let allText = Object.values(stats.textStats.textByInput).join(' ');
    let words = allText.toLowerCase().split(/\s+/).filter(word => word.length > 0);
    
    // Calculate word frequencies
    words.forEach(word => {
        stats.textStats.commonWords[word] = (stats.textStats.commonWords[word] || 0) + 1;
    });

    // Sort common words by frequency
    stats.textStats.commonWords = Object.entries(stats.textStats.commonWords)
        .sort(([,a], [,b]) => b - a)
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

    // Calculate average word length
    if (words.length > 0) {
        const totalLength = words.reduce((sum, word) => sum + word.length, 0);
        stats.textStats.languageStats.averageWordLength = totalLength / words.length;
    }

    // Calculate total duration
    if (stats.timeStats.startTime && stats.timeStats.endTime) {
        stats.timeStats.duration = 
            new Date(stats.timeStats.endTime) - new Date(stats.timeStats.startTime);
    }

    // Convert Sets to Arrays for JSON serialization
    stats.pageStats.uniqueUrls = Array.from(stats.pageStats.uniqueUrls);

    // Sort most used keys
    stats.keyboardStats.mostUsedKeys = Object.entries(stats.keyboardStats.mostUsedKeys)
        .sort(([,a], [,b]) => b - a)
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

    // Calculate typing speed metrics
    if (timeIntervals.length > 0) {
        // Calculate average WPM (assuming 5 characters per word)
        const averageInterval = timeIntervals.reduce((a, b) => a + b, 0) / timeIntervals.length;
        const charactersPerMinute = (60000 / averageInterval) * characterCount;
        stats.textStats.typingSpeed.averageWPM = Math.round(charactersPerMinute / 5);

        // Calculate peak WPM (using a 5-second window)
        const windowSize = 5000; // 5 seconds
        let maxCharsInWindow = 0;
        let windowStart = new Date(stats.textStats.letterSequence[0].timestamp);
        let windowChars = 0;

        stats.textStats.letterSequence.forEach(letter => {
            const letterTime = new Date(letter.timestamp);
            while (letterTime - windowStart > windowSize) {
                windowStart = new Date(windowStart.getTime() + 1000);
                windowChars--;
            }
            windowChars++;
            maxCharsInWindow = Math.max(maxCharsInWindow, windowChars);
        });

        stats.textStats.typingSpeed.peakWPM = Math.round((maxCharsInWindow * 12) / 5); // Convert to WPM
    }

    // Replace the detailed text history with just the final values
    stats.textStats.inputSummary = Object.entries(stats.textStats.finalTextByField)
        .map(([fieldId, finalText]) => ({
            field: fieldId,
            finalValue: finalText,
            fieldInfo: stats.textStats.fieldMetadata[fieldId]?.targetInfo || ''
        }));

    return stats;
}
