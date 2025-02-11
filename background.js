chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Although we don't do anything specific here, this listener
    // is necessary to prevent the "Receiving end does not exist" error.
    // The popup is sending messages, and *something* needs to be listening,
    // even if it doesn't process the messages.
    console.log("Message received in background:", message);

    // You could add logic here to handle messages if needed, but for this
    // example, the content script handles everything.

    // It is important to return true from this function, to indicate that sendResponse will be called asynchronously.
    return true;
});
