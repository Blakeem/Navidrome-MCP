# macOS Troubleshooting Guide for Navidrome MCP Server

## Common Issues and Solutions

### Claude Desktop Crashes on Startup

If Claude Desktop crashes immediately after adding the Navidrome MCP configuration, this is typically due to one of these issues:

#### Issue 1: Node.js Path Not Found

**Symptoms:**
- Claude crashes on startup after adding `claude_desktop_config.json`
- Error in logs: `spawn node ENOENT`

**Solution:**

Claude Desktop on macOS looks for executables in specific paths. If you installed Node.js via Homebrew, you may need to create symlinks:

```bash
# For standard Homebrew Node.js installation
ln -s $(which node) /usr/local/bin/node

# For Apple Silicon Macs with Homebrew in /opt/homebrew
ln -s $(which node) /opt/homebrew/bin/node

# If you installed a specific Node version (e.g., node@22)
ln -s /opt/homebrew/opt/node@22/bin/node /opt/homebrew/bin/node
```

#### Issue 2: Working Directory Access Error

**Symptoms:**
- Running the server manually shows: `Error: ENOENT: no such file or directory, uv_cwd`
- Claude crashes when trying to start the MCP server

**Solution:**

This has been fixed in the latest version. Please update to the latest code:

```bash
cd /path/to/navidrome-mcp
git pull
pnpm install
pnpm build
```

#### Issue 3: Invalid JSON Configuration

**Symptoms:**
- Claude crashes immediately after editing `claude_desktop_config.json`

**Solution:**

Validate your JSON configuration. Common mistakes:
- Trailing commas after the last item in objects or arrays
- Missing quotes around string values
- Using single quotes instead of double quotes

Valid example:
```json
{
  "mcpServers": {
    "navidrome": {
      "command": "node",
      "args": ["/Users/your-username/navidrome-mcp/dist/index.js"],
      "env": {
        "NAVIDROME_URL": "https://your-server.com",
        "NAVIDROME_USERNAME": "your-username",
        "NAVIDROME_PASSWORD": "your-password",
        "LASTFM_API_KEY": "your-api-key",
        "RADIO_BROWSER_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/your-username/Navidrome-MCP)",
        "LYRICS_PROVIDER": "lrclib",
        "LRCLIB_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/your-username/Navidrome-MCP)"
      }
    }
  }
}
```

### Testing Your Setup

#### Step 1: Verify Node.js Installation

```bash
# Check if Node.js is installed and accessible
which node
node --version

# Should output something like:
# /opt/homebrew/bin/node
# v20.19.4
```

#### Step 2: Test the Server Manually

```bash
# Navigate to your Navidrome MCP directory
cd /path/to/navidrome-mcp

# Test with your credentials
NAVIDROME_URL="https://your-server.com" \
NAVIDROME_USERNAME="your-username" \
NAVIDROME_PASSWORD="your-password" \
node dist/index.js

# You should see:
# [INFO] Navidrome client initialized
# [INFO] Navidrome MCP Server started successfully
```

Press `Ctrl+C` to stop the test server.

#### Step 3: Enable Debug Mode

For troubleshooting, add debug mode to your configuration:

```json
{
  "mcpServers": {
    "navidrome": {
      "command": "node",
      "args": ["/Users/your-username/navidrome-mcp/dist/index.js"],
      "env": {
        "NAVIDROME_URL": "https://your-server.com",
        "NAVIDROME_USERNAME": "your-username",
        "NAVIDROME_PASSWORD": "your-password",
        "LASTFM_API_KEY": "your-api-key",
        "RADIO_BROWSER_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/your-username/Navidrome-MCP)",
        "LYRICS_PROVIDER": "lrclib",
        "LRCLIB_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/your-username/Navidrome-MCP)",
        "DEBUG": "true"
      }
    }
  }
}
```

This will output additional diagnostic information when the server starts.

### Checking Claude Desktop Logs

View Claude Desktop logs for error details:

```bash
# View MCP-related logs
tail -f ~/Library/Logs/Claude/mcp*.log

# View main Claude logs
tail -f ~/Library/Logs/Claude/claude.log
```

### Complete Reset Procedure

If Claude continues to crash even after removing the configuration:

```bash
# 1. Remove Claude completely (if installed via Homebrew)
brew uninstall --zap claude

# 2. Clean up configuration and cache
rm -rf ~/Library/Application\ Support/Claude
rm -rf ~/Library/Caches/Claude
rm -rf ~/Library/Logs/Claude

# 3. Reinstall Claude
brew install --cask claude

# 4. Start Claude first WITHOUT any MCP configuration
# 5. Once confirmed working, carefully add your MCP configuration
```

### Permissions Issues

On macOS Catalina and later, terminal applications may need additional permissions:

1. Open **System Settings** > **Privacy & Security**
2. Select **Full Disk Access** or **Files and Folders**
3. Add Claude Desktop to the allowed applications
4. Restart Claude Desktop

### Still Having Issues?

If you're still experiencing problems:

1. **Collect Diagnostic Information:**
   ```bash
   # System info
   sw_vers
   node --version
   which node
   
   # Test the server with debug mode
   DEBUG=true node /path/to/navidrome-mcp/dist/index.js
   ```

2. **Check Recent Changes:**
   ```bash
   cd /path/to/navidrome-mcp
   git status
   git log --oneline -5
   ```

3. **Report the Issue:**
   Open an issue at https://github.com/Blakeem/Navidrome-MCP/issues with:
   - Your macOS version
   - Node.js version and installation method
   - The exact error message from Claude logs
   - Your `claude_desktop_config.json` (with passwords redacted)
   - Output from the diagnostic commands above

## Prevention Tips

1. **Always Use Absolute Paths:** Never use relative paths like `./dist/index.js` in your configuration
2. **Test Manually First:** Always test the server manually before adding to Claude Desktop
3. **Keep Claude Updated:** Ensure you're running the latest version of Claude Desktop
4. **Backup Your Config:** Keep a backup of working configurations before making changes

## Recent Fixes

### Version Updates (Latest)

- **Fixed `uv_cwd` Error:** The server no longer crashes when `process.cwd()` is unavailable
- **Improved Error Handling:** Better diagnostic output for troubleshooting startup issues
- **Conditional .env Loading:** Only attempts to load `.env` file when environment variables are missing

To get these fixes:
```bash
cd /path/to/navidrome-mcp
git pull
pnpm install
pnpm build
```