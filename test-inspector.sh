#!/bin/bash

# Test script for MCP Inspector
# This script helps test the Navidrome MCP server using the official MCP Inspector

echo "🔍 Testing Navidrome MCP Server with Inspector"
echo "=============================================="
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Please copy .env.example to .env and configure your Navidrome credentials."
    echo ""
    echo "Example:"
    echo "  cp .env.example .env"
    echo "  # Then edit .env with your Navidrome server details"
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

echo "📋 Configuration:"
echo "  Navidrome URL: $NAVIDROME_URL"
echo "  Username: $NAVIDROME_USERNAME"
echo "  Debug: ${DEBUG:-false}"
echo "  Cache TTL: ${CACHE_TTL:-300}s"
echo "  Token Expiry: ${TOKEN_EXPIRY:-86400}s"
echo ""

# Build the project if needed
if [ ! -d "dist" ]; then
    echo "🔨 Building project..."
    pnpm build
fi

echo "🚀 Starting MCP Inspector..."
echo "The Inspector UI will open in your browser at http://localhost:6274"
echo ""
echo "To test the server:"
echo "1. The Inspector should open automatically"
echo "2. You should see the 'test_connection' tool listed"
echo "3. Click on the tool to test it"
echo "4. Check the response to verify authentication works"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Run the MCP Inspector with our built server
npx @modelcontextprotocol/inspector node dist/index.js