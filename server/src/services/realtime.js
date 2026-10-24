let io;

export function setSocketServer(socketServer) {
  io = socketServer;
}

export function emitTripUpdate(requestId, update) {
  io?.to(`trip:${requestId}`).emit("trip:update", {
    requestId: String(requestId),
    ...update,
  });
}

export function emitUserNotification(userId, notification) {
  io?.to(`user:${userId}`).emit("notification:new", notification);
}

export function revokeTripAccess(requestId, userId) {
  const userRoom = `user:${userId}`;
  const tripRoom = `trip:${requestId}`;
  io?.in(userRoom).socketsLeave(tripRoom);
}

export function disconnectUserSockets(userId) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}
