import { io, Socket } from 'socket.io-client';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// The coordinator app connects only while an authenticated user is signed in.
export const socket: Socket = io(baseURL, { autoConnect: false });
