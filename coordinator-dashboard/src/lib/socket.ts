import { io, Socket } from 'socket.io-client';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// The coordinator app connects only while an authenticated user is signed in,
// and the server now refuses a socket that presents no token (Audit #49).
// `auth` is a callback rather than a fixed object so a reconnect always sends
// the current token instead of the one captured when the page loaded.
export const socket: Socket = io(baseURL, {
  autoConnect: false,
  auth: (callback) => callback({ token: localStorage.getItem('reliefgrid_token') }),
});
