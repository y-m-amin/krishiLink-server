# 🌾 KrishiLink Server — Backend API

The backend service for **KrishiLink**, a modern platform that connects **farmers, traders, and consumers** in one digital ecosystem.  
Built with **Express.js**, **MongoDB**, and **dotenv**, this server provides a RESTful API to handle users, crop listings, and collaboration interests.

---

## 📝 Description

The **KrishiLink Server** is responsible for managing all backend operations of the KrishiLink web platform — including data storage, user management, crop listings, and interest-based collaboration.  
It is designed with scalability, security, and simplicity in mind, optimized for **serverless deployment (Vercel)**.

---

## ⚙️ Features

- 🌱 **User Management** — Register and retrieve users  
- 🌾 **Crop Management** — Add, update, delete, and fetch crop posts  
- 💬 **Interest System** — Users can show interest and collaborate with others  
- 🧭 **Dynamic Search** — Find crops by name with regex filtering  
- 🚀 **Optimized MongoDB Connection** for serverless cold starts  
- 🔒 **Environment-based configuration** using dotenv  
- 🌐 **CORS enabled** for smooth communication with the frontend  

---

## 🛠️ Tech Stack

- **Runtime:** Node.js  
- **Framework:** Express.js  
- **Database:** MongoDB Atlas  
- **Environment Variables:** dotenv  
- **Deployment:** Vercel / Render / Railway  

---

## 📡 API Endpoints

### 🧍 Users
| Method | Endpoint | Description |
|--------|-----------|-------------|
| `POST` | `/users` | Register a new user |
| `GET`  | `/users` | Get all registered users |

### 🌾 Crops
| Method | Endpoint | Description |
|--------|-----------|-------------|
| `GET`  | `/crops` | Get all crops (with optional search query) |
| `GET`  | `/latest-crops` | Get latest 6 crop posts |
| `GET`  | `/crops/:id` | Get a specific crop by ID |
| `POST` | `/crops` | Add a new crop |
| `PATCH` | `/crops/:id` | Update a crop |
| `DELETE` | `/crops/:id` | Delete a crop |

### 💬 Interests
| Method | Endpoint | Description |
|--------|-----------|-------------|
| `POST` | `/crops/:id/interests` | Submit an interest for a crop |
| `GET`  | `/crops/:id/interests` | Get all interests for a crop |
| `PATCH` | `/interests/:cropId/:interestId` | Update interest status (accept/reject) |
| `GET`  | `/my-interests?email=user@example.com` | Get all interests submitted by a specific user |

---

## 🧰 Environment Variables

Create a `.env` file in the project root and include the following:

-DB_USER=your_mongodb_username
-DB_PASS=your_mongodb_password


---

## 🚀 Local Development

```bash
# Clone the repository
git clone https://github.com/y-m-amin/krishiLink-server.git

# Navigate to the folder
cd krishilink-server

# Install dependencies
npm install

# Run the server
nodemon index.js

