# Testing the Navidrome MCP Server

This document explains how to test the Navidrome MCP server using the official MCP Inspector.

## What is MCP Inspector?

The MCP Inspector is an official developer tool for testing and debugging MCP servers. It provides:
- A web-based UI for interacting with your MCP server
- Real-time testing of tools, resources, and prompts
- Request/response visualization
- Error debugging capabilities

## How MCP Works

MCP (Model Context Protocol) servers communicate via:
- **STDIO transport**: The server runs as a subprocess and communicates via standard input/output
- **SSE transport**: Server-Sent Events over HTTP
- **HTTP transport**: Standard HTTP requests

Our Navidrome MCP server uses STDIO transport by default, which means it:
1. Starts as a Node.js process
2. Receives JSON-RPC messages via stdin
3. Sends responses via stdout
4. Uses stderr for logging (when DEBUG=true)

## Quick Start

### 1. Configure Environment

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your Navidrome server details:
```env
NAVIDROME_URL=http://192.168.86.100:4533
NAVIDROME_USERNAME=your_username
NAVIDROME_PASSWORD=your_password
DEBUG=true  # Enable debug logging during testing
```

### 2. Build the Project

```bash
pnpm build
```

### 3. Run with MCP Inspector

You have several options:

#### Option A: Use npm scripts (Recommended)
```bash
# Test the built version
pnpm inspector

# Test in development mode (auto-recompile)
pnpm inspector:dev
```

#### Option B: Use the test script
```bash
./test-inspector.sh
```

#### Option C: Run directly
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### 4. Using the Inspector

1. The Inspector will automatically open in your browser at `http://localhost:6274`
2. You should see the server connected with a green status
3. Navigate to the **Tools** tab
4. You should see `test_connection` listed
5. Click on the tool to expand it
6. Optionally toggle "Include Server Info" 
7. Click **Run Tool** to test the connection

## Expected Results

### Successful Connection
```json
{
  "success": true,
  "message": "Successfully connected to Navidrome server",
  "serverInfo": {
    "url": "Connected to Navidrome",
    "authenticated": true,
    "timestamp": "2025-08-29T20:30:00.000Z"
  }
}
```

### Failed Connection
```json
{
  "success": false,
  "message": "Connection failed: Authentication failed: 401"
}
```

## Testing Without Inspector

You can also test the server directly using the CLI mode:

```bash
# List available tools
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Call the test_connection tool
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name test_connection \
  --tool-arg includeServerInfo=true
```

## Debugging Tips

1. **Enable Debug Logging**: Set `DEBUG=true` in your `.env` file
2. **Check Server Logs**: Look at the console output where you ran the inspector
3. **Verify Credentials**: Ensure your Navidrome credentials are correct
4. **Test Navidrome Directly**: Try accessing your Navidrome URL in a browser
5. **Check Network**: Ensure the Navidrome server is reachable from your machine

## Common Issues

### "Authentication failed: 401"
- Check your username and password in `.env`
- Verify the credentials work in Navidrome's web UI

### "Connection refused"
- Verify the NAVIDROME_URL is correct
- Check if Navidrome server is running
- Ensure no firewall is blocking the connection

### "Tool not found"
- Make sure you've built the project (`pnpm build`)
- Verify the server started successfully

## Next Steps

Once the test connection works:
1. You can implement additional tools in `src/tools/`
2. Add resources in `src/resources/`
3. Test each new feature using the Inspector
4. Use the Inspector's export feature to generate configuration for Claude Desktop

## License

Documentation licensed under CC-BY-SA-4.0