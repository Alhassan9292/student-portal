# Frontend-Project Backend

This is a simple Node.js + Express backend to serve the static frontend and provide a minimal API for student records.

## Requirements
- Node.js (v14+ recommended)

## Install
Open PowerShell in the project folder and run:

```powershell
npm install
```

## Run
Start the server:

```powershell
npm start
```

The server runs on `http://localhost:3000` by default. It serves the static files in the project root and provides these API endpoints:

- `GET /api/students` — returns an array of students
- `POST /api/students` — add a student (JSON body: `{ name, class, grade }`)
- `DELETE /api/students/:id` — delete a student by id

The backend stores student data in `students.json` in the project root.

## Notes
- This is a minimal, file-backed implementation intended for development or demo use only.
- For production, use a database (SQLite, Postgres, etc.) and add validation/authentication as needed.
