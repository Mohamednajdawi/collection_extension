// OpenAI Configuration
// IMPORTANT: Replace 'your_openai_api_key_here' with your actual OpenAI API key
// You can get your API key from: https://platform.openai.com/api-keys

const OPENAI_CONFIG = {
    API_KEY: 'your_openai_api_key_here', // Replace with your actual API key
    MODEL: 'gpt-4.1-mini-2025-04-14', // More cost-effective model
    MAX_TOKENS: 1500,
    TEMPERATURE: 0.7,
    API_URL: 'https://api.openai.com/v1/chat/completions'
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OPENAI_CONFIG;
} 