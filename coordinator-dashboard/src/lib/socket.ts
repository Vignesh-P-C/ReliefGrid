import { io, Socket } from 'socket.io-client';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Single shared socket instance for the whole app.
export const socket: Socket = io(baseURL, { autoConnect: true });
