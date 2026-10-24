import { useEffect, useState } from "react";
import lookupLocationName from "./locationName.js";

export default function LocationName({ latitude, longitude }) {
  const [placeName, setPlaceName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setPlaceName("");
    setError("");

    lookupLocationName(Number(latitude), Number(longitude))
      .then((result) => {
        if (active) setPlaceName(result.placeName || "");
      })
      .catch((lookupError) => {
        if (active) setError(lookupError.message);
      });

    return () => {
      active = false;
    };
  }, [latitude, longitude]);

  return (
    <span className="location-name" aria-live="polite">
      {placeName || error || "Finding place name…"}
      <small>
        Place names by{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
        .
      </small>
    </span>
  );
}
