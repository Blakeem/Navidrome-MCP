# User Management API

## Overview
User management endpoints for creating, reading, updating, and deleting users. User endpoints require authentication and some operations are admin-only.

## Base URL
`/api/user`

## Standard REST Endpoints

### GET /api/user
List all users (admin-only).

**Query Parameters:**
- `_start` (number): Starting index for pagination (default: 0)
- `_end` (number): Ending index for pagination
- `_sort` (string): Field to sort by
- `_order` (string): Sort order (ASC/DESC)
- `filter` (string): JSON filter criteria

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "userName": "string",
    "name": "string",
    "email": "string",
    "isAdmin": boolean,
    "lastAccessAt": "ISO-8601 timestamp",
    "lastLoginAt": "ISO-8601 timestamp",
    "createdAt": "ISO-8601 timestamp",
    "updatedAt": "ISO-8601 timestamp"
  }
]
```

**Response Headers:**
- `X-Total-Count`: Total number of users

**Error Responses:**
- 401 Unauthorized: Not authenticated
- 403 Forbidden: Not an admin user

### GET /api/user/{id}
Get a specific user by ID (admin-only or own user).

**Response (200 OK):**
```json
{
  "id": "string",
  "userName": "string",
  "name": "string",
  "email": "string",
  "isAdmin": boolean,
  "lastAccessAt": "ISO-8601 timestamp",
  "lastLoginAt": "ISO-8601 timestamp",
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

**Error Responses:**
- 401 Unauthorized: Not authenticated
- 403 Forbidden: Cannot access other users (non-admin)
- 404 Not Found: User not found

### POST /api/user
Create a new user (admin-only).

**Request Body:**
```json
{
  "userName": "string (required)",
  "name": "string",
  "email": "string",
  "password": "string (required)",
  "isAdmin": boolean
}
```

**Response (201 Created):**
```json
{
  "id": "string",
  "userName": "string",
  "name": "string",
  "email": "string",
  "isAdmin": boolean,
  "createdAt": "ISO-8601 timestamp"
}
```

**Error Responses:**
- 400 Bad Request: Invalid input
- 401 Unauthorized: Not authenticated
- 403 Forbidden: Not an admin user
- 409 Conflict: Username already exists

### PUT /api/user/{id}
Update a user (admin-only or own user with restrictions).

**Request Body:**
```json
{
  "name": "string",
  "email": "string",
  "password": "string",
  "isAdmin": boolean  // Admin-only field
}
```

**Response (200 OK):**
Updated user object

**Error Responses:**
- 400 Bad Request: Invalid input
- 401 Unauthorized: Not authenticated
- 403 Forbidden: Cannot modify other users or admin status
- 404 Not Found: User not found

### DELETE /api/user/{id}
Delete a user (admin-only).

**Response (200 OK):**
```json
{
  "id": "string"
}
```

**Error Responses:**
- 401 Unauthorized: Not authenticated
- 403 Forbidden: Not an admin user
- 404 Not Found: User not found
- 409 Conflict: Cannot delete the last admin user

## User Permissions

| Action | Own User | Other Users | Admin Required |
|--------|----------|-------------|----------------|
| List all | No | No | Yes |
| View | Yes | No | Yes (for others) |
| Create | No | No | Yes |
| Update | Partial* | No | Yes (for others) |
| Delete | No | No | Yes |

*Non-admin users can only update their own name, email, and password