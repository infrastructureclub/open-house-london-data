#!/usr/bin/python
import os
import json
import csv
from collections import defaultdict
from datetime import datetime

from dateutil import parser
import pytz
import simplekml
from shapely.geometry import mapping
from shapely.geometry import Point

year = os.environ["YEAR"]
timezone = pytz.timezone("Europe/London")
data_path = f"data/{year}"
maps_path = f"maps/{year}"

dates = defaultdict(list)

for filename in os.listdir(data_path):
    if ".json" not in filename:
        continue

    with open(data_path + "/" + filename, "r") as f:
        data = json.load(f)

    for date in set(event["date"] for event in data["events"]):
        dates[date].append(data)

    if data["all_week"]:
        dates["all_week"].append(data)

    if not data["events"]:
        dates["no_events"].append(data)

now = timezone.localize(datetime.now())

for date, locations in sorted(dates.items()):
    print(f"Writing {date}...")

    kml = simplekml.Kml()
    features = []

    seen_latlons = set()
    for location in sorted(locations, key=lambda l: l["id"]):
        fully_booked = "Yes"
        balloted_events = False

        start = None
        end = None

        # Choose the most open state
        # If any events are None it means we can't determine booking status
        if not location["events"]:
            # No events, this must be an all_week thing
            fully_booked = "Unknown"

        else:
            for event in location["events"]:
                if event["date"] == date:
                    # Open/close time
                    event_start = parser.parse(event["start"])
                    if not start or event_start < start:
                        start = event_start

                    event_end = parser.parse(event["end"])
                    if not end or event_end > end:
                        end = event_end

                    # Ticket status
                    if location["ticketed_events"]:
                        if fully_booked != "Unknown":
                            # If an event is in the past we discard it for figuring
                            # out fully_booked status, as it no longer matters and
                            # it defaults to false on the OH website after the
                            # event is over. This is a hack and we should do it
                            # differently.
                            if event["fully_booked"] == False and event_start > now:
                                fully_booked = "No"
                            if event["fully_booked"] == None:
                                fully_booked = "Unknown"
                    else:
                        fully_booked = ""

                if event["balloted"]:
                    balloted_events = True

        start_time = None
        end_time = None
        if start and end:
            start_time = start.time().isoformat()
            end_time = end.time().isoformat()

        lat = location["location"]["latitude"]
        lon = location["location"]["longitude"]

        # If someone uses the same lat/lon for multiple venues in the same
        # building only one of them will show up in most geojson renderers, so
        # we add a small amount to the longitude to avoid this
        while f"{lat},{lon}" in seen_latlons:
            lon = lon + 0.0001
        seen_latlons.add(f"{lat},{lon}")

        kml.newpoint(
            name=location["name"],
            coords=[(lon, lat)],
        )

        p = mapping(Point(float(lon), float(lat)))
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": location["name"],
                    "url": location["original_url"],
                    "description": location["description"],
                    "ticketed_events": "Yes" if location["ticketed_events"] else "No",
                    "fully_booked": fully_booked,
                    "start": start_time,
                    "end": end_time,
                    "balloted": "Yes" if balloted_events else "No",
                    "new_venue_this_year": "Yes" if location["new_venue_this_year"] else "No",
                    "images": [{
                        "archive_url": i["archive_url"],
                        "title": i["title"],
                    } for i in location["images"]],
                },
                "geometry": p,
            }
        )

    schema = {
        "type": "FeatureCollection",
        "features": features,
    }

    os.makedirs(maps_path + "/geojson", exist_ok=True)
    with open(maps_path + "/geojson/" + date + ".geojson", "w", encoding="utf-8") as f:
        f.write(
            json.dumps(
                schema,
                indent=4,
                sort_keys=True,
                separators=(",", ": "),
                ensure_ascii=False,
            )
        )

    os.makedirs(maps_path + "/kml", exist_ok=True)
    kml.save(maps_path + "/kml/" + date + ".kml")

os.makedirs(maps_path, exist_ok=True)
with open(maps_path + "/dates.json", "w", encoding="utf-8") as f:
    f.write(json.dumps(sorted(list(dates.keys()))))
