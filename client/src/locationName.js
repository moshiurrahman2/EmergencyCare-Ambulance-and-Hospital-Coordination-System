import readApiResponse from "./readApiResponse.js";
import { apiUrl } from "./api.js";

export default async function lookupLocationName(latitude, longitude) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  });
  const response = await fetch(apiUrl(`/api/location/reverse?${query}`), {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("emergencycare-token"),
    },
  });
  return readApiResponse(response, "Could not look up this location.");
}
