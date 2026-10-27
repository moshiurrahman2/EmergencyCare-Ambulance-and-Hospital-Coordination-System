import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

function locationOptions(options) {
  return {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? 20000,
    maximumAge: options.maximumAge ?? 5000,
  };
}

export async function getCurrentLocation(options = {}) {
  if (Capacitor.isNativePlatform()) {
    const position = await Geolocation.getCurrentPosition(locationOptions(options));
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  }

  if (!navigator.geolocation) {
    throw new Error("This device does not support location sharing.");
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
      }),
      () => reject(new Error("Allow location access to use this feature.")),
      locationOptions(options),
    );
  });
}

export async function watchCurrentLocation(onLocation, onError, options = {}) {
  if (Capacitor.isNativePlatform()) {
    const watchId = await Geolocation.watchPosition(
      locationOptions(options),
      (position, error) => {
        if (error) {
          onError(error);
          return;
        }
        if (position) {
          onLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        }
      },
    );
    return () => {
      Geolocation.clearWatch({ id: watchId }).catch((error) => {
        console.error("Could not stop native location updates:", error.message);
      });
    };
  }

  if (!navigator.geolocation) {
    onError(new Error("This device does not support location sharing."));
    return () => {};
  }
  const watchId = navigator.geolocation.watchPosition(
    ({ coords }) => onLocation({
      latitude: coords.latitude,
      longitude: coords.longitude,
    }),
    onError,
    locationOptions(options),
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
