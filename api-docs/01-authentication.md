# Authentication API

## Overview
Navidrome uses JWT (JSON Web Token) based authentication for API access. All protected endpoints require a valid JWT token in the Authorization header.

## Endpoints

### POST /auth/login
Authenticates a user and returns a JWT token.

**Request:**
- Content-Type: `application/json`

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response (200 OK):**
```json
{
  "id": "string",              // User ID
  "name": "string",            // Display name
  "username": "string",        // Username
  "isAdmin": boolean,          // Admin status
  "token": "string",           // JWT token for API authentication
  "subsonicSalt": "string",    // Salt for Subsonic API authentication
  "subsonicToken": "string",   // Token for Subsonic API authentication
  "avatar": "string"           // Optional: Gravatar URL if enabled
}
```

**Error Responses:**
- 401 Unauthorized: Invalid username or password
- 422 Unprocessable Entity: Invalid request body
- 500 Internal Server Error: Server error

**Rate Limiting:**
- Default: 5 requests per minute (configurable)
- Headers returned: `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`

### POST /auth/createAdmin
Creates the first admin user. Only available when no users exist.

**Request:**
- Content-Type: `application/json`

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response (200 OK):**
Same as `/auth/login` response

**Error Responses:**
- 403 Forbidden: Admin user already exists
- 422 Unprocessable Entity: Invalid request body
- 500 Internal Server Error: Server error

## Authentication Headers

For all protected endpoints, include the JWT token in one of these ways:

1. **Authorization Header (recommended):**
   ```
   Authorization: Bearer <token>
   ```

2. **Cookie:**
   ```
   jwt=<token>
   ```

3. **Query Parameter:**
   ```
   ?jwt=<token>
   ```

## Token Management

- Tokens are automatically refreshed on each request
- New token is returned in response header: `x-nd-authorization`
- Default token expiration: 48 hours (configurable)
- Tokens contain:
  - `sub`: username
  - `uid`: user ID
  - `adm`: admin status
  - `iat`: issued at timestamp
  - `exp`: expiration timestamp

## Reverse Proxy Authentication

Navidrome supports authentication via reverse proxy headers when configured. The proxy must:
1. Be whitelisted in server configuration
2. Send username in configured header (default: `Remote-User`)
3. Users will be auto-created on first login