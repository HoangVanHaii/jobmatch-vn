
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (socket && socket.connected) return socket;
  if (socket) return socket;

  socket = io(import.meta.env.VITE_SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
    auth: (cb) => cb({ token: localStorage.getItem('access_token') ?? '' }),
  });
  return socket;
};

export const connectSocket = (): void => {
  const s = getSocket();
  if (!s.connected) s.connect();
};

export const disconnectSocket = (): void => {
  socket?.disconnect();
};