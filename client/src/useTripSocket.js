import { useEffect, useState } from "react";
import { io } from "socket.io-client";

export default function useTripSocket(requestIds, onTripUpdate) {
  const [connected, setConnected] = useState(false);
  const requestIdsKey = [...new Set(requestIds.filter(Boolean))].sort().join(",");

  useEffect(() => {
    if (!requestIdsKey) {
      setConnected(false);
      return undefined;
    }

    const socket = io({
      auth: { token: localStorage.getItem("emergencycare-token") },
      reconnection: true,
    });
    const ids = requestIdsKey.split(",");
    socket.on("connect", () => {
      setConnected(true);
      ids.forEach((requestId) => {
        socket.emit("trip:join", { requestId }, (result) => {
          if (!result?.ok) {
            console.error("Could not subscribe to trip updates:", result?.message);
          }
        });
      });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("trip:update", onTripUpdate);

    return () => {
      socket.disconnect();
    };
  }, [onTripUpdate, requestIdsKey]);

  return connected;
}
