const activeTripStatuses = ["accepted", "picked_up", "at_hospital"];

export function haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDifference = radians(latitudeB - latitudeA);
  const longitudeDifference = radians(longitudeB - longitudeA);
  const value =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(longitudeDifference / 2) ** 2;
  const safeValue = Math.min(1, Math.max(0, value));
  return 6371 * 2 * Math.atan2(Math.sqrt(safeValue), Math.sqrt(1 - safeValue));
}

export function estimateArrivalMinutes(distanceKm) {
  return Math.max(1, Math.ceil((distanceKm / 30) * 60));
}

export async function getAvailableAmbulances(
  database,
  { latitude, longitude },
) {
  const activePlaceholders = activeTripStatuses.map(() => "?").join(", ");
  const [ambulances] = await database.execute(
    `SELECT ap.user_id AS id, ap.driver_name AS driverName,
      ap.vehicle_number AS vehicleNumber,
      u.phone AS phone, loc.latitude, loc.longitude,
      loc.recorded_at AS locationUpdatedAt
     FROM ambulance_profiles ap
     INNER JOIN users u ON u.id = ap.user_id AND u.account_status = 'active'
     INNER JOIN ambulance_locations loc
       ON loc.id = (
         SELECT l.id FROM ambulance_locations l
         WHERE l.ambulance_id = ap.user_id
         ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1
       )
     WHERE ap.approval_status = 'approved'
       AND ap.is_online = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM ambulance_requests active_request
         WHERE active_request.ambulance_id = ap.user_id
           AND active_request.status IN (${activePlaceholders})
       )
       AND NOT EXISTS (
         SELECT 1 FROM ambulance_requests offered_request
         WHERE offered_request.ambulance_id = ap.user_id
           AND offered_request.status = 'requested_to_ambulance'
       )`,
    [
      ...activeTripStatuses,
    ],
  );

  return ambulances
    .map((ambulance) => {
      const distanceKm = haversineDistanceKm(
        Number(latitude),
        Number(longitude),
        Number(ambulance.latitude),
        Number(ambulance.longitude),
      );
      return {
        id: String(ambulance.id),
        driverName: ambulance.driverName,
        vehicleNumber: ambulance.vehicleNumber,
        phone: ambulance.phone,
        latitude: Number(ambulance.latitude),
        longitude: Number(ambulance.longitude),
        locationUpdatedAt: ambulance.locationUpdatedAt,
        distanceKm,
        etaMinutes: estimateArrivalMinutes(distanceKm),
      };
    })
    .sort((first, second) =>
      first.distanceKm - second.distanceKm ||
      first.etaMinutes - second.etaMinutes ||
      first.id.localeCompare(second.id, "en", { numeric: true }),
    )
    .map((ambulance) => ({
      ...ambulance,
      distanceKm: Number(ambulance.distanceKm.toFixed(2)),
    }));
}
