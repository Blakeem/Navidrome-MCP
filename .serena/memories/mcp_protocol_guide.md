# Navidrome MCP Server - MCP Protocol Guide

## MCP Protocol Overview
The Model Context Protocol (MCP) enables AI assistants to interact with external systems:
- **Communication**: JSON-RPC over STDIO (not REST APIs)
- **Server Mode**: Runs as subprocess, communicates via stdin/stdout
- **Protocol**: JSON-RPC 2.0 standard
- **Data Flow**: Bidirectional messaging between client and server

## MCP Resources vs Tools

### Resources (Read-Only Data)
Resources provide contextual information to LLMs:
- **Purpose**: Static data for AI context
- **Examples**: Server status, library statistics, recent songs
- **Identification**: Unique URIs (e.g., `navidrome://server/status`)
- **No Side Effects**: Read-only operations only

### Tools (Executable Functions)
Tools perform actions with potential side effects:
- **Purpose**: Executable operations that modify state
- **Examples**: Search songs, create playlists, test connections
- **Parameters**: Accept structured input parameters
- **Side Effects**: Can modify server state or external systems

## Testing with MCP Inspector

### Installation and Basic Usage
```bash
# Install MCP Inspector globally
npm install -g @modelcontextprotocol/inspector

# Build project first
pnpm build

# Start inspector with web UI
npx @modelcontextprotocol/inspector node dist/index.js

# Use CLI mode for scripted testing
npx @modelcontextprotocol/inspector --cli node dist/index.js --method <method>
```

### CLI Testing Examples

#### Tools Testing
```bash
# List all available tools
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Test connection tool
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name test_connection \
  --tool-arg includeServerInfo=true

# Search songs with parameters
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name list_songs \
  --tool-arg limit=5 \
  --tool-arg offset=0
```

#### Resources Testing
```bash
# List all available resources
npx @modelcontextprotocol/inspector --cli node dist/index.js --method resources/list

# Read server status resource
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method resources/read \
  --uri "navidrome://server/status"

# Read recent songs resource
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method resources/read \
  --uri "navidrome://library/recent-songs"
```

## Development Integration

### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "navidrome": {
      "command": "node",
      "args": ["/path/to/navidrome-mcp/dist/index.js"],
      "env": {
        "NAVIDROME_URL": "http://your-server:4533",
        "NAVIDROME_USERNAME": "username", 
        "NAVIDROME_PASSWORD": "password"
      }
    }
  }
}
```

### Testing Workflow
1. **Build**: `pnpm build`
2. **List Capabilities**: Test tools/resources listing
3. **Individual Tools**: Test each tool with various parameters
4. **Error Handling**: Test with invalid inputs/missing auth
5. **Integration**: Test with actual Navidrome server
6. **Performance**: Monitor response times and caching

## Common Issues and Debugging

### Connection Issues
- Verify Navidrome server is running and accessible
- Check environment variables are properly set
- Test authentication credentials manually
- Verify network connectivity to server

### Protocol Issues  
- Ensure JSON-RPC format compliance
- Check STDIO communication is not buffered
- Verify proper error response formatting
- Test with minimal MCP Inspector examples first

### Development Tips
- Use `DEBUG=true` environment variable for detailed logging
- Test tools individually before integration testing
- Use web UI inspector for interactive debugging
- Monitor server logs for authentication and API issues