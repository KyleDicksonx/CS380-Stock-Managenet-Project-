## CS380 Inventory Management System

## Default Login

Username : Tester001
Password : P@ssw0rd123

## Testing Login

Username : 1
Password : 1

## Authors

Github:
@KyleDicksonx
@Jhkpop
@FAC68

## Overview

A full-stack inventory management system built with a JavaScript backend, MySQL database, and vanilla HTML/CSS/JS frontend. Product data is sourced from the [Platzi Fake Store API](https://fakeapi.platzi.com/).

## Setup

This is the settup for the nodejs version. For the settup for the exe version, please see the exe branch. 

1. Install dependencies:
   Install NodeJS and run 'npm install' in the root directory of the project
  
2. Configure your MySQL connection in the server config.
	/backend/server.js 
		Lines 29-31

3. Start the server:
   Open the cmd window in the root directory and run : node backend/server.js
   
   OR
   
   Run : start.bat
	If you edit the localhost port the start.bat will not work. 
	
   The database schema is rebuilt automatically on every server start because the API changes and deletes products daily.

4. Navigate to `http://localhost:<port>` if you did not use start.bat and log in with the default credentials above.
	Default port is 3000

## Database Schema

**Users**
| Column       | Type    | Notes               |
|--------------|---------|---------------------|
| UserID       | INT     | Primary key, auto   |
| Username     | VARCHAR | 5–40 chars, unique  |
| PasswordHash | VARCHAR | SHA2-256            |

**Products**
| Column    | Type | Notes                                   |
|-----------|------|-----------------------------------------|
| ProductID | INT  | Primary key, mirrors API ID             |
| Stock     | INT  | 0 – 2,147,483,647; random 1-50 on seed  |

## Validation Rules

### Username
- 5–40 characters
- ASCII printable characters only
- Must be unique

### Password
- 8–40 characters
- ASCII characters only
- Must contain: 1 uppercase, 1 lowercase, 1 special character

### Stock
- Non-negative integer
- Maximum: 2,147,483,647 (signed 32-bit int)
- Enforced client-side and server-side

## Notes

- Products are auto-inserted with random stock (1–50) on first fetch from the API.

