import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { fairRotation, type FindSlotsResult } from "@tzmeet/core";

export default function RotationCard({ result }: { result: FindSlotsResult }) {
  const [size, setSize] = useState<2 | 3>(2);
  const rotation = useMemo(
    () => fairRotation(result, { size }),
    [result, size],
  );
  if (!rotation || rotation.size === 1) return null;
  return (
    <section className="rotation-card" aria-labelledby="rotation-heading">
      <div className="rotation-heading">
        <div>
          <p className="eyebrow">FOR RECURRING MEETINGS</p>
          <h3 id="rotation-heading">Share the inconvenient times</h3>
        </div>
        <div
          className="duration-options rotation-size"
          role="group"
          aria-label="Times to rotate"
        >
          {([2, 3] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={size === option}
              onClick={() => setSize(option)}
            >
              {option} times
            </button>
          ))}
        </div>
      </div>
      <p className="rotation-message">{rotation.message}</p>
      <ol className="rotation-picks">
        {rotation.picks.map((pick, index) => (
          <li key={pick.time}>
            <span className="rotation-week">Week {index + 1}</span>
            {pick.slot.zones.map((zone) => (
              <span key={zone.id} className="rotation-time">
                <small>{zone.label}</small>
                <strong>
                  {DateTime.fromISO(zone.localStart, {
                    setZone: true,
                  }).toFormat("HH:mm")}
                </strong>
                <span className={`badge badge-${zone.classification}`}>
                  {zone.classification === "ideal" ? "Ideal" : "Acceptable"}
                </span>
              </span>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
