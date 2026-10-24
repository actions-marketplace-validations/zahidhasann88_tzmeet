import { holidayPresets, type HolidayPreset } from "@tzmeet/core";
import Icon from "./Icon";
import {
  downloadHolidays,
  googleSubscribeUrl,
  holidayFeedUrl,
  webcalUrl,
} from "./holiday-feeds";

export default function HolidayCalendarLinks({
  preset,
  name,
}: {
  preset: HolidayPreset;
  name: string;
}) {
  const country = holidayPresets[preset];
  return (
    <div className="holiday-links">
      <button
        type="button"
        className="text-button"
        aria-label={`Download ${country} holidays for ${name} (.ics)`}
        onClick={() => downloadHolidays(preset)}
      >
        <Icon name="download" /> Download holidays (.ics)
      </button>
      <details>
        <summary>Subscribe in your calendar</summary>
        <p className="detail-hint">
          Adds {country} holidays for this year and next, and your calendar
          keeps them up to date. They show as free time.
        </p>
        <ul>
          <li>
            <a
              href={googleSubscribeUrl(preset)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Calendar
            </a>
          </li>
          <li>
            <a href={webcalUrl(preset)}>Apple Calendar or Outlook</a>
          </li>
        </ul>
        <label className="full-field">
          Or subscribe by address
          <input
            readOnly
            aria-label={`${country} holiday calendar address for ${name}`}
            value={holidayFeedUrl(preset)}
            onFocus={(event) => event.target.select()}
          />
        </label>
      </details>
    </div>
  );
}
